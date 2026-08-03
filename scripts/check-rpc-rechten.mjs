// Kan de publieke anon-sleutel een functie aanroepen die data verandert?
//
// Gebruik: node scripts/check-rpc-rechten.mjs
// Exitcode 0 als er niets muteerbaars openstaat, 1 als er wél iets openstaat.
// Zonder databasegegevens slaat hij over met exitcode 0 — zie onderaan.
//
// ── WAAROM DIT BESTAAT ──────────────────────────────────────────────────────
//
// PostgREST publiceert elke functie in het public-schema als RPC-endpoint, en Postgres geeft
// nieuwe functies standaard EXECUTE aan PUBLIC. Twee defaults die los van elkaar redelijk zijn en
// samen betekenen: wie een functie aanmaakt, publiceert hem op internet.
//
// Dat is hier ook echt gebeurd. Migratie 039 voegde `verwijder_klant_data` toe — een functie die
// alle data van een klant wist — en die was daarna aanroepbaar met de anon-sleutel die in elke
// browser zit. De bevestigingsparameter in die functie beschermt tegen een ongeluk, niet tegen
// iemand die `true` invult. Migratie 040 heeft het rechtgezet.
//
// Het punt van dit script is niet die ene fout. Het punt is dat niets me waarschuwde: ik vond het
// omdat ik ernaar zocht. De volgende functie die iemand toevoegt heeft dezelfde defaults, en die
// persoon zoekt er misschien niet naar. Vandaar een controle die het wél zegt.
//
// ── WAT ER GECONTROLEERD WORDT ──────────────────────────────────────────────
//
// Per functie in `public`: verandert hij data, en wie mag hem uitvoeren.
//
// "Verandert data" wordt bepaald uit de broncode, niet uit `provolatile`. Volatiel zijn is geen
// bewijs van muteren — `now()` is ook volatiel — en stabiel zijn is geen bewijs van het
// tegendeel. De broncode is wat er werkelijk gebeurt.
//
// Commentaar en tekstliteralen gaan er eerst af. Zonder dat zou een functie met het woord
// "update" in een toelichting als muterend gelden, en een controle die vals alarm geeft wordt
// binnen een maand genegeerd.
//
// ── WAT BEWUST GEEN FOUT IS ─────────────────────────────────────────────────
//
// Triggerfuncties (retourtype `trigger`) zijn uitgezonderd. Die worden door de database zelf
// aangeroepen bij een insert of update, niet door een client; PostgREST publiceert ze niet als
// endpoint omdat hun retourtype dat niet toelaat. Ze staan wel in het rapport, zodat zichtbaar
// blijft dat ze bestaan.
//
// Leesfuncties die anon mag aanroepen zijn géén fout maar wel een oppervlak, en worden daarom
// vermeld. `app_can_read_client`, `app_role` en `app_sees_all_clients` horen zelfs uitdrukkelijk
// door anon aanroepbaar te zijn: RLS-policies roepen ze aan als de rol van de aanvrager, en zonder
// dat recht zou elke policy die ze gebruikt de toegang weigeren.

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";

// Zonder databasegegevens overslaan in plaats van falen.
//
// Deze controle draait mee in scripts/gates.sh, en die moet ook werken op een machine zonder
// .env.local — in CI, of bij iemand die alleen aan de frontend zit. Een poort die daar rood wordt
// leert mensen om poorten te negeren, en dan vangt hij de echte fout ook niet meer op.
//
// Overslaan is hier verdedigbaar omdat de rechten in de DATABASE staan en niet in de code: een
// wijziging aan dit repo kan ze niet stukmaken. Wat ze wél stukmaakt is een migratie, en die
// draait tegen een omgeving waar deze gegevens per definitie zijn.
{
  try { readFileSync(".env.local", "utf8"); } catch { /* geen bestand: dan de omgeving zelf */ }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!url || !token) {
    console.log("rpc-rechten: overgeslagen (geen SUPABASE_ACCESS_TOKEN of project-URL).");
    process.exit(0);
  }
}

/** Woorden die alleen in een statement voorkomen dat iets verandert. */
const MUTATIE = /\b(insert\s+into|update\s+\w|delete\s+from|truncate|drop\s+(table|view|function|schema|index)|alter\s+(table|view|function|schema|default)|create\s+(table|view|function|index|or\s+replace)|grant\s|revoke\s)\b/i;

/**
 * Commentaar en tekstliteralen weg, zodat alleen echte code overblijft.
 *
 * Volgorde is significant: eerst de blokken, dan de regels, dan de literalen. Andersom zou een
 * apostrof in een commentaarregel de literaal-verwijdering laten ontsporen.
 */
function alleenCode(bron) {
  return String(bron ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const ROLLEN_DIE_ER_TOE_DOEN = ["anon", "authenticated"];

const functies = await sql(`
  select p.proname as naam,
         pg_get_function_result(p.oid) as retour,
         p.prosrc as bron,
         coalesce((select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
                   where has_function_privilege(r.rolname, p.oid, 'EXECUTE')
                     and r.rolname in ('anon','authenticated','service_role')), '') as rollen
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  order by p.proname
`);

const overtreders = [];
const leesbaarVoorAnon = [];
const triggers = [];

for (const f of functies) {
  const rollen = f.rollen ? f.rollen.split(",") : [];
  const publiek = rollen.filter((r) => ROLLEN_DIE_ER_TOE_DOEN.includes(r));
  const isTrigger = String(f.retour).trim() === "trigger";
  const muteert = MUTATIE.test(alleenCode(f.bron));

  if (isTrigger) {
    triggers.push(f.naam);
  } else if (muteert && publiek.length > 0) {
    overtreders.push({ naam: f.naam, rollen: publiek.join(", ") });
  } else if (publiek.length > 0) {
    leesbaarVoorAnon.push({ naam: f.naam, rollen: publiek.join(", ") });
  }
}

console.log(`${functies.length} functies in public gecontroleerd\n`);

if (leesbaarVoorAnon.length > 0) {
  console.log("  Leesfuncties die anon of authenticated mag aanroepen (geen fout, wel oppervlak):");
  for (const f of leesbaarVoorAnon) console.log(`    ${f.naam.padEnd(34)}${f.rollen}`);
  console.log("");
}
if (triggers.length > 0) {
  console.log(`  Triggerfuncties, uitgezonderd: ${triggers.join(", ")}\n`);
}

if (overtreders.length === 0) {
  console.log("  OK  geen muterende functie is aanroepbaar door anon of authenticated.");
  process.exit(0);
}

console.log("  FOUT  deze functies veranderen data en zijn publiek aanroepbaar:\n");
for (const f of overtreders) console.log(`    ${f.naam.padEnd(34)}${f.rollen}`);
console.log(`
  Herstellen:

    revoke execute on function <naam>(<argumenten>) from public, anon, authenticated;
    grant  execute on function <naam>(<argumenten>) to service_role;

  Zie scripts/migrations/040_functies_afschermen.sql voor het patroon. Roept de app de functie
  aan, laat dat dan via een server-route lopen die zelf autoriseert — niet vanuit de browser.`);
process.exit(1);

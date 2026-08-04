// Kan een gebruiker van bureau A bij de data van bureau B?
//
// Gebruik: node scripts/check-bureaugrens.mjs
// Exitcode 0 als de grens houdt, 1 zodra hij lekt. Zonder databasegegevens overslaan met 0.
//
// ── WAAROM DIT EEN POORT IS EN GEEN EENMALIGE CONTROLE ──────────────────────
//
// De toegangscontrole was tot migratie 057 rolgebonden en bureau-blind:
//
//   app_sees_all_clients() = role in ('admin','performance_marketeer','it')
//
// Nergens kwam het bureau erin voor. Met één bureau valt dat niet op; met twintig leest elke
// performance marketeer bij bureau A de data van bureau B. Gemeten met een wegwerpgebruiker:
// `mag_bij_ander_bureau` gaf `true`.
//
// Het punt is niet die ene fout. Het punt is dat niets het zei. Er is geen foutmelding bij te veel
// toegang -- de app werkt gewoon, en beter zelfs, want alles is zichtbaar. Zo'n regressie komt
// terug via een onschuldig ogende `or` in een policy of een rol die ergens wordt toegevoegd, en
// dan merkt niemand het tot een klant de data van een ander ziet.
//
// Vandaar een proef die het ECHT doet: een gebruiker aanmaken bij het ene bureau en hem laten
// vragen naar het andere. Geen redenering over functiedefinities -- die redeneerde ik ook, en toen
// zag ik het niet.
//
// ── HOE ─────────────────────────────────────────────────────────────────────
//
// De gebruiker wordt aangemaakt via de admin-API (geen mail, direct bevestigd), krijgt een rol en
// een bureau, en zijn JWT wordt nagebootst met set_config('request.jwt.claims'). Daarna wordt hij
// opgeruimd, ook als de proef faalt -- een achtergebleven testgebruiker met een rol is zelf een
// gat.

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";

let env = "";
try { env = readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }
const uitEnv = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "");
const lees = (k) => process.env[k] ?? uitEnv(k);

const url = lees("NEXT_PUBLIC_SUPABASE_URL") ?? lees("SUPABASE_URL");
const svc = lees("SUPABASE_SERVICE_ROLE_KEY") ?? lees("SUPABASE_SECRET_KEY");
const token = lees("SUPABASE_ACCESS_TOKEN");

if (!url || !svc || !token) {
  console.log("bureaugrens: overgeslagen (geen service-sleutel of project-URL).");
  process.exit(0);
}

const EMAIL = "poort-bureaugrens@voorbeeld.invalid";
const kop = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

async function adminApi(pad, opties) {
  const r = await fetch(`${url}/auth/v1/admin/users${pad}`, { headers: kop, ...opties });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** Twee bureaus met elk minstens één account; anders valt er niets te toetsen. */
const bureaus = await sql(`
  select a.id, a.name, (select client_id from accounts ac where ac.agency_id = a.id limit 1) as klant
  from agencies a
  where exists (select 1 from accounts ac where ac.agency_id = a.id)
  order by a.name`);

if (bureaus.length < 2) {
  console.log(`bureaugrens: overgeslagen (${bureaus.length} bureau(s) met accounts; er zijn er twee nodig).`);
  process.exit(0);
}

const [eigen, ander] = bureaus;
let id = null;
let fouten = 0;

try {
  const maak = await adminApi("", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: crypto.randomUUID(), email_confirm: true }),
  });
  id = maak.body?.id;
  if (!id) {
    console.log(`bureaugrens: kon geen proefgebruiker maken (${maak.status}). Overgeslagen.`);
    process.exit(0);
  }

  await sql(`insert into user_roles (user_id, role) values ('${id}', 'performance_marketeer')
             on conflict (user_id) do update set role = excluded.role`);
  await sql(`insert into user_agencies (user_id, agency_id) values ('${id}', '${eigen.id}')
             on conflict do nothing`);

  const [r] = await sql(`
    select set_config('request.jwt.claims',
             json_build_object('sub','${id}','role','authenticated')::text, true) is not null as _,
           app_role() as rol,
           app_is_platform() as platform,
           app_can_read_client('${eigen.klant}') as eigen,
           app_can_read_client('${ander.klant}') as ander`);

  console.log(`proefgebruiker: rol ${r.rol}, bureau "${eigen.name}"\n`);

  const eis = (label, waar, uitleg) => {
    console.log(`  ${waar ? "OK  " : "FOUT"}  ${label}`);
    if (!waar) { console.log(`        ${uitleg}`); fouten += 1; }
  };

  eis(`mag bij zijn eigen bureau ("${eigen.name}")`, r.eigen === true,
    "een gebruiker die zijn eigen klanten niet ziet, kan niet werken");
  eis(`mag NIET bij "${ander.name}"`, r.ander === false,
    "dit is het lek: rolgebonden toegang zonder bureaugrens");
  eis("is niet per ongeluk platformbeheerder", r.platform === false,
    "platformbeheer hoort expliciet te zijn, nooit een bijwerking van een rol");
} finally {
  if (id) {
    await sql(`delete from user_agencies where user_id = '${id}'`);
    await sql(`delete from user_roles where user_id = '${id}'`);
    await adminApi(`/${id}`, { method: "DELETE" });
  }
}

if (fouten === 0) {
  console.log("\n  OK  de bureaugrens houdt.");
  process.exit(0);
}
console.log(`
  ${fouten} probleem(en). Een gebruiker kan over de bureaugrens heen kijken.

  Zie scripts/migrations/057_bureaugrens.sql: toegang vereist dat de klant bij een bureau hoort
  waar de gebruiker lid van is, EN dat hij hem binnen dat bureau mag zien. Een rol alleen is niet
  genoeg -- een rol zegt wat iemand mag doen, niet bij wie.`);
process.exit(1);

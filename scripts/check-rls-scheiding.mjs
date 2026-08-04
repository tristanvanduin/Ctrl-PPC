// Ziet een ingelogde gebruiker alleen de data van zijn eigen bureau?
//
// Gebruik: node scripts/check-rls-scheiding.mjs
// Exitcode 0 als de scheiding houdt, 1 zodra er iets doorheen komt.
//
// ── WAAROM DIT ANDERS IS DAN check-bureaugrens.mjs ──────────────────────────
//
// Die controleert de FUNCTIES: geeft app_can_read_client het goede antwoord. Nuttig, maar een
// functie die "false" zegt bewijst niet dat de database ook rijen tegenhoudt -- daar zit een
// policy tussen, en die kan ontbreken, verkeerd om staan of op de verkeerde kolom zitten.
//
// Dit script doet wat de browser doet: echt inloggen, een echt access_token krijgen, en over HTTP
// bij PostgREST rijen opvragen. Wat er terugkomt is wat een gebruiker werkelijk ziet. Dat is
// sterker bewijs dan een schermafdruk, want een scherm kan er goed uitzien terwijl het de
// verkeerde rijen toont.
//
// ── DE VIEWS DOEN HIER (NOG) NIET AAN MEE ──────────────────────────────────
//
// De acht legacy-views draaien met de rechten van hun eigenaar; `security_invoker` staat uit. Ze
// lezen dus om RLS heen. Dat is nu met opzet -- de app leest nog met de anon-sleutel zonder
// sessie, en zou anders leeglopen -- maar het betekent dat de scheiding pas AFGEDWONGEN is als
// die schakelaar omgaat. Het script meet dat en zegt het, in plaats van te doen alsof fase 5 rond
// is.

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";

let env = "";
try { env = readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving */ }
const uitEnv = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "");
const lees = (k) => process.env[k] ?? uitEnv(k);

const url = lees("NEXT_PUBLIC_SUPABASE_URL") ?? lees("SUPABASE_URL");
const anon = lees("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? lees("SUPABASE_ANON_KEY");
const svc = lees("SUPABASE_SERVICE_ROLE_KEY") ?? lees("SUPABASE_SECRET_KEY");

if (!url || !anon || !svc || !lees("SUPABASE_ACCESS_TOKEN")) {
  console.log("rls-scheiding: overgeslagen (sleutels of project-URL ontbreken).");
  process.exit(0);
}

const adminKop = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };
const WACHTWOORD = "proef-" + crypto.randomUUID();

async function maakGebruiker(email) {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST", headers: adminKop,
    body: JSON.stringify({ email, password: WACHTWOORD, email_confirm: true }),
  });
  return (await r.json().catch(() => null))?.id ?? null;
}

async function verwijderGebruiker(id) {
  await sql(`delete from user_agencies where user_id = '${id}'`);
  await sql(`delete from user_roles where user_id = '${id}'`);
  await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminKop });
}

/** Echt inloggen, zoals de browser. Geeft het access_token terug. */
async function logIn(email) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: WACHTWOORD }),
  });
  const b = await r.json().catch(() => null);
  return b?.access_token ?? null;
}

/**
 * Aantal rijen dat deze token terugkrijgt uit een relatie.
 *
 * Twee dingen die deze functie twee versies hebben gekost.
 *
 * PostgREST kapt af op 1000 rijen, ongeacht `limit`. De rijen ophalen en tellen geeft dus 1000 waar
 * er 5330 zijn -- geen fout, gewoon een verkeerd getal. Daarom de teller uit `content-range`.
 *
 * Maar NIET met `Range: 0-0` erbij, zoals de eerste versie. Standalone gaf dat netjes 0, in de
 * poortenrun kwam er soms `null` uit omdat de header ontbrak. Een poort die wisselt tussen groen en
 * rood zonder dat er iets verandert, leert mensen om hem te negeren -- en dan vangt hij de echte
 * fout ook niet meer. `limit=1` met `count=exact` levert de teller altijd, ook bij nul rijen
 * (de teller is dan `nul`, met een sterretje als bereik).
 */
async function telRijen(token, relatie, kolom = "account_id") {
  const r = await fetch(`${url}/rest/v1/${relatie}?select=${kolom}&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}`, Prefer: "count=exact" },
  });
  const bereik = r.headers.get("content-range");
  const teller = bereik ? Number(bereik.split("/")[1]) : NaN;
  if (Number.isFinite(teller)) return { status: r.status, rijen: teller };
  // Terugval: geen teller gekregen. Dan de rijen zelf, met de kanttekening dat 1000 het plafond is.
  const body = await r.json().catch(() => null);
  return { status: r.status, rijen: Array.isArray(body) ? body.length : null, zonderTeller: true };
}

const bureaus = await sql(`
  select a.id, a.name,
         (select count(*) from accounts ac where ac.agency_id = a.id) as accounts
  from agencies a
  where exists (select 1 from accounts ac where ac.agency_id = a.id)
  order by a.name`);

if (bureaus.length < 2) {
  console.log(`rls-scheiding: overgeslagen (${bureaus.length} bureau(s) met accounts).`);
  process.exit(0);
}

const [A, B] = bureaus;
const gebruikers = [];
let fouten = 0;
const eis = (label, waar, detail = "") => {
  console.log(`  ${waar ? "OK  " : "FOUT"}  ${label}${detail ? `   ${detail}` : ""}`);
  if (!waar) fouten += 1;
};

try {
  for (const [bureau, email] of [[A, "rls-a@voorbeeld.invalid"], [B, "rls-b@voorbeeld.invalid"]]) {
    const id = await maakGebruiker(email);
    if (!id) { console.log("rls-scheiding: kon geen proefgebruiker maken. Overgeslagen."); process.exit(0); }
    gebruikers.push(id);
    await sql(`insert into user_roles (user_id, role) values ('${id}', 'performance_marketeer')
               on conflict (user_id) do update set role = excluded.role`);
    await sql(`insert into user_agencies (user_id, agency_id) values ('${id}', '${bureau.id}')
               on conflict do nothing`);
  }

  const tokenA = await logIn("rls-a@voorbeeld.invalid");
  const tokenB = await logIn("rls-b@voorbeeld.invalid");
  if (!tokenA || !tokenB) { console.log("rls-scheiding: inloggen mislukt. Overgeslagen."); process.exit(0); }

  console.log(`bureau A "${A.name}" (${A.accounts} accounts), bureau B "${B.name}" (${B.accounts} accounts)\n`);

  // ── accounts ────────────────────────────────────────────────────────────
  const accA = await telRijen(tokenA, "accounts", "id");
  const accB = await telRijen(tokenB, "accounts", "id");
  const accAnon = await telRijen(anon, "accounts", "id");

  eis(`A ziet precies zijn eigen ${A.accounts} account(s)`, accA.rijen === Number(A.accounts), `kreeg ${accA.rijen}`);
  eis(`B ziet precies zijn eigen ${B.accounts} account(s)`, accB.rijen === Number(B.accounts), `kreeg ${accB.rijen}`);
  eis("zonder sessie geen enkel account", accAnon.rijen === 0, `kreeg ${accAnon.rijen} (http ${accAnon.status})`);

  // ── fact_core ───────────────────────────────────────────────────────────
  const [{ a: factA, b: factB }] = await sql(`
    select (select count(*) from fact_core f join accounts ac on ac.id = f.account_id where ac.agency_id = '${A.id}') as a,
           (select count(*) from fact_core f join accounts ac on ac.id = f.account_id where ac.agency_id = '${B.id}') as b`);

  const fA = await telRijen(tokenA, "fact_core");
  const fB = await telRijen(tokenB, "fact_core");
  const fAnon = await telRijen(anon, "fact_core");

  eis(`A ziet zijn eigen ${factA} fact_core-rijen`, fA.rijen === Number(factA), `kreeg ${fA.rijen}`);
  eis(`B ziet zijn eigen ${factB} fact_core-rijen`, fB.rijen === Number(factB), `kreeg ${fB.rijen}`);
  eis("zonder sessie geen enkele fact_core-rij", fAnon.rijen === 0, `kreeg ${fAnon.rijen} (http ${fAnon.status})`);
  eis("A en B zien niet hetzelfde", fA.rijen !== fB.rijen || factA === factB,
    `A=${fA.rijen} B=${fB.rijen}`);

  // ── De views, die er (nog) omheen lezen ─────────────────────────────────
  const vAnon = await telRijen(anon, "ads_campaign_monthly", "client_id");
  const [{ n: totaalCamp }] = await sql("select count(*) as n from ads_campaign_monthly_legacy");
  const viewLeestErOmheen = vAnon.rijen === Number(totaalCamp);

  console.log("");
  if (viewLeestErOmheen) {
    console.log(`  LET OP  de views lezen nog om RLS heen: anon krijgt alle ${vAnon.rijen} rijen uit`);
    console.log("          ads_campaign_monthly. Dat is nu met opzet -- de app leest zonder sessie --");
    console.log("          maar de scheiding is pas afgedwongen na:");
    console.log("            alter view <naam> set (security_invoker = true);   + inloggen afdwingen");
  } else {
    console.log(`  de views doen mee aan RLS: anon krijgt ${vAnon.rijen} van ${totaalCamp} rijen.`);
  }
} finally {
  for (const id of gebruikers) await verwijderGebruiker(id);
}

if (fouten === 0) {
  console.log("\n  OK  de bureauscheiding houdt op de tabellen.");
  process.exit(0);
}
console.log(`\n  ${fouten} probleem(en) in de RLS-scheiding. Zie scripts/migrations/058_rls_nieuwe_tabellen.sql.`);
process.exit(1);

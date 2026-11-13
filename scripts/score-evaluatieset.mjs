// Scoort een analyse-uitvoer tegen de evaluatieset van de demo-klant: per scenario (S1 tot S20 en
// het stille scenario) gevonden, gemist of vals. De set en de regels staan in
// lib/eval/demo-scenarios.ts; dit script haalt alleen de uitvoer op en drukt de uitslag af.
//
// ── GEBRUIK ─────────────────────────────────────────────────────────────────
//
//   Opgeslagen uitvoer uit een bestand (markdown, tekst of JSON), geen database, geen model:
//     node scripts/score-evaluatieset.mjs --bestand pad/naar/analyse.md [--kanalen meta,linkedin]
//
//   De laatste opgeslagen analyses van de demo-klant uit sop_analysis_output (ALLEEN LEZEN):
//     node scripts/score-evaluatieset.mjs --uit-db [--klant demo-greentech] [--sop-type monthly]
//
//   Een VERSE analyse (roept het taalmodel aan, kost geld): alleen met beide vlaggen, en alleen
//   tegen een server op deze machine. De run legt via capture_fixtures zijn prompts vast in
//   eval_fixtures, zodat hij daarna met /api/eval/replay tegen een ander model af te spelen is;
//   de replay scoort een fixture-set van demo-greentech dan ook tegen deze set.
//     node scripts/score-evaluatieset.mjs --vers --bevestig-kosten [--kanaal google_ads]
//
//   Extra: --json (de uitslag als JSON), --streng (exit 1 bij iets gemist of vals).
//
// Zonder --vers roept dit script nooit een model aan. Dat is de standaard met opzet: een score
// over een opgeslagen uitvoer is gratis en herhaalbaar, een verse run is geen van beide.

import { readFileSync } from "node:fs";
import { scoorTegenScenarios, kanalenVanSopType } from "../lib/eval/demo-scenarios.ts";

const heeft = (naam) => process.argv.includes(`--${naam}`);
const arg = (naam, standaard = null) => {
  const i = process.argv.indexOf(`--${naam}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : standaard;
};
const KLANT = arg("klant", "demo-greentech");
if (!/^[a-z0-9_-]+$/i.test(KLANT)) { console.error(`--klant "${KLANT}" is geen geldig klant-id.`); process.exit(2); }

const KANAAL_NAMEN = ["google", "meta", "linkedin", "microsoft", "cross"];
const kanalenArg = arg("kanalen");
const kanalen = kanalenArg ? kanalenArg.split(",").map((k) => k.trim()) : undefined;
if (kanalen && kanalen.some((k) => !KANAAL_NAMEN.includes(k))) {
  console.error(`--kanalen kent alleen ${KANAAL_NAMEN.join(", ")}.`); process.exit(2);
}

/** Een lijst [{label, tekst, kanalen}] om te scoren. */
async function verzamel() {
  if (arg("bestand")) {
    return arg("bestand").split(",").map((pad) => ({ label: pad, tekst: readFileSync(pad, "utf8"), kanalen }));
  }
  if (heeft("uit-db")) return uitDatabase(arg("sop-type"));
  if (heeft("vers")) return vers();
  console.error("Geef --bestand <pad>, --uit-db, of --vers --bevestig-kosten. Zie de kop van dit script.");
  process.exit(2);
}

async function uitDatabase(sopType) {
  const { sql } = await import("./supabase-sql.mjs");
  if (sopType && !/^[a-z0-9_]+$/i.test(sopType)) { console.error(`--sop-type "${sopType}" is ongeldig.`); process.exit(2); }
  // Per sop_type de laatste analysedatum, en daarvan alle secties: dat is een volledige uitvoer.
  const rijen = await sql(`
    with laatste as (
      select sop_type, max(analysis_date) as datum
      from sop_analysis_output
      where client_id = '${KLANT}' ${sopType ? `and sop_type = '${sopType}'` : ""}
      group by sop_type
    )
    select o.sop_type, o.analysis_date, o.step_number, o.section, o.output
    from sop_analysis_output o join laatste l on l.sop_type = o.sop_type and l.datum = o.analysis_date
    where o.client_id = '${KLANT}'
    order by o.sop_type, o.step_number nulls last`);
  const perType = new Map();
  for (const r of rijen) {
    const k = `${r.sop_type} (${String(r.analysis_date).slice(0, 10)})`;
    const deel = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
    perType.set(k, { sopType: r.sop_type, tekst: `${perType.get(k)?.tekst ?? ""}\n${deel ?? ""}` });
  }
  if (perType.size === 0) {
    console.error(`Geen opgeslagen analyse voor ${KLANT}${sopType ? ` (${sopType})` : ""}.`);
    process.exit(2);
  }
  return [...perType].map(([label, v]) => ({ label, tekst: v.tekst, kanalen: kanalen ?? kanalenVanSopType(v.sopType) }));
}

async function vers() {
  if (!heeft("bevestig-kosten")) {
    console.error("--vers roept het taalmodel aan en kost geld. Voeg --bevestig-kosten toe als dat de bedoeling is.");
    process.exit(2);
  }
  const basis = process.env.BASIS_URL ?? "http://localhost:3190";
  // Alleen deze machine: een verse run tegen een gedeelde of live omgeving schrijft daar analyses
  // weg en kost daar geld, en dat hoort nooit een bijwerking van een evaluatie te zijn.
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(basis)) {
    console.error(`--vers draait alleen tegen een server op deze machine, niet tegen ${basis}.`);
    process.exit(2);
  }
  const geheim = process.env.CRON_SECRET;
  if (!geheim) { console.error("--vers heeft CRON_SECRET nodig (de route laat interne aanroepen alleen daarop toe)."); process.exit(2); }
  const fixtureSet = `${KLANT}:evaluatieset-${new Date().toISOString().slice(0, 19)}`;
  console.log(`Verse maandanalyse voor ${KLANT} via ${basis}; prompts gaan naar eval_fixtures als "${fixtureSet}".`);
  const r = await fetch(`${basis}/api/analysis/monthly`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${geheim}` },
    body: JSON.stringify({ client_id: KLANT, channel: arg("kanaal", "google_ads"), capture_fixtures: true, fixture_set: fixtureSet }),
  });
  await r.text();
  if (!r.ok) { console.error(`De analyse gaf ${r.status}; niets te scoren.`); process.exit(1); }
  return uitDatabase("monthly");
}

const invoer = await verzamel();
const uitslagen = invoer.map((i) => ({ label: i.label, ...scoorTegenScenarios(i.tekst, { kanalen: i.kanalen }) }));

if (heeft("json")) {
  console.log(JSON.stringify(uitslagen, null, 2));
} else {
  for (const u of uitslagen) {
    console.log(`\n${u.label}: ${u.gevonden} gevonden, ${u.gemist} gemist, ${u.vals} vals (${u.inBereik} scenario's in bereik)\n`);
    for (const s of u.scenarios) {
      if (s.status === "buiten bereik") continue;
      const teken = s.status === "gevonden" || s.status === "terecht stil" ? "OK  " : "FOUT";
      console.log(`  ${teken}  ${s.id.padEnd(5)} ${s.status.padEnd(13)} ${s.titel}`);
      for (const w of s.gemist) console.log(`          gemist: ${w}`);
      for (const v of s.vals) console.log(`          vals: ${v.wat}\n                "${v.eenheid}"`);
    }
  }
}

if (heeft("streng") && uitslagen.some((u) => u.gemist > 0 || u.vals > 0)) process.exit(1);

// Slagingspercentage van de analyses per cadans, uit generation_jobs. ALLEEN LEZEN.
//
// Gebruik:
//   node scripts/check-analyse-slagingen.mjs                 laatste 90 dagen, grens 80%
//   node scripts/check-analyse-slagingen.mjs --dagen 30 --grens 0.7
//   node scripts/check-analyse-slagingen.mjs --klant demo-greentech
//
// Exitcode 0 als elke cadans met genoeg pogingen boven de grens zit EN elke vaste cadans binnen zijn
// termijn afrondde; 1 bij een cadans eronder, een cadans die te lang niet afrondde, of een leeg
// venster (niets gedraaid is geen groen); 3 (overgeslagen, zie scripts/poort-overslaan.mjs) zonder
// databasegegevens.
//
// Waarom: zie de kop van lib/eval/analyse-slagingen.ts. Kort: de maandanalyse rondde sinds augustus
// 11 van de 40 keer af en geen scherm of poort zei het. Dit script schrijft niets en zet ook geen
// vastgelopen run op failed: dat is een beslissing voor de scheduler (isStaleRunning in
// lib/scheduler/core.ts heeft buiten de tests nog geen aanroeper), niet voor een controle.

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";
import { slaOver } from "./poort-overslaan.mjs";
// Rechtstreeks de .ts: node haalt de typen eraf. Beide bestanden zijn zuiver en zonder imports.
import { vatSlagingenSamen, slagingsRegel, beslisSlagingsPoort } from "../lib/eval/analyse-slagingen.ts";
import { STALE_RUNNING_MINUTES } from "../lib/scheduler/core.ts";

const arg = (naam, standaard) => {
  const i = process.argv.indexOf(`--${naam}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standaard;
};
const DAGEN = Number(arg("dagen", "90"));
const GRENS = Number(arg("grens", "0.8"));
const MINIMUM = Number(arg("minimum", "5"));
const KLANT = arg("klant", null);

if (!Number.isFinite(DAGEN) || DAGEN <= 0 || !Number.isFinite(GRENS) || GRENS < 0 || GRENS > 1) {
  console.error("Gebruik: --dagen <positief getal> --grens <0..1> [--minimum n] [--klant id]");
  process.exit(2);
}
if (KLANT !== null && !/^[a-z0-9_-]+$/i.test(KLANT)) {
  console.error(`--klant "${KLANT}" is geen geldig klant-id.`);
  process.exit(2);
}

{
  try { readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_ACCESS_TOKEN) slaOver("analyses", "geen SUPABASE_ACCESS_TOKEN of project-URL");
}

// Een select en niets anders. Het venster op started_at: een job die nooit startte heeft geen
// uitkomst om te tellen.
const rijen = await sql(`
  select job_type, status, started_at, updated_at
  from generation_jobs
  where started_at >= now() - interval '${Math.round(DAGEN)} days'
  ${KLANT ? `and client_id = '${KLANT}'` : ""}`);

// De laatste afgeronde run per cadans, buiten het venster om: een keten die stilvalt levert geen
// mislukkingen op, alleen stilte, en die zie je alleen aan de datum van de laatste afronding.
const laatsteAfrondingen = (await sql(`
  select job_type as cadans, max(updated_at)::text as laatst
  from generation_jobs
  where status = 'completed'
  ${KLANT ? `and client_id = '${KLANT}'` : ""}
  group by job_type`)).map((r) => ({ cadans: r.cadans ?? "onbekend", laatst: r.laatst ?? null }));

const nu = new Date();
const uitslag = vatSlagingenSamen(rijen, {
  nu,
  vastgelopenNaMinuten: STALE_RUNNING_MINUTES,
  grens: GRENS,
  minimumPogingen: MINIMUM,
});

console.log(`analyses: slagingspercentage per cadans, laatste ${DAGEN} dagen${KLANT ? `, klant ${KLANT}` : ""} (grens ${Math.round(GRENS * 100)}%, vastgelopen na ${STALE_RUNNING_MINUTES} min zonder update)\n`);
for (const u of uitslag) console.log(slagingsRegel(u));

// De beslissing staat in lib/eval/analyse-slagingen.ts (beslisSlagingsPoort), met een test die eist
// dat een leeg venster niet groen is.
const beslissing = beslisSlagingsPoort(uitslag, laatsteAfrondingen, { nu });
if (beslissing.meldingen.length > 0) console.log("");
for (const m of beslissing.meldingen) console.log(`  ${m}`);
if (beslissing.code !== 0) process.exit(beslissing.code);
console.log("\n  OK  elke cadans met genoeg pogingen zit boven de grens, en elke cadans rondde binnen zijn termijn af.");

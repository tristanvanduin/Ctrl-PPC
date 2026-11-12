// De demo die blijft leven: de demoklant opnieuw zaaien op de klok van vandaag (bouwplan fase 4).
//
//   node scripts/demo/herseed-demo.mjs                        # zegt wat er zou gebeuren, schrijft NIETS
//   node scripts/demo/herseed-demo.mjs --uitvoeren            # zaait opnieuw (env met service-role nodig)
//   node scripts/demo/herseed-demo.mjs --vandaag=2026-12-01   # met een vaste klok (ook met --uitvoeren)
//
// WAAROM DIT BESTAAT
//
// De demodata staat in de DATABASE, niet in code: scripts/demo/seed-demo-client.ts schrijft de
// rijen van demo-greentech, seed-geoclone-clients.ts leidt er de drie beursaccounts uit af. Die
// seed is klokrelatief: maand 0 is de maand waarin hij draait, dag 0 de dag zelf. Hij is alleen op
// 25 augustus 2026 voor het laatst gedraaid, en sindsdien veroudert de demo: in november leest een
// dashboard dat op 25 augustus ophoudt als een dood dashboard, en de band, de kaarten en het
// logboek zeggen terecht "demodata t/m 25 aug".
//
// Dit script draait de twee seeders na elkaar, met dezelfde vaste dag. Meer is het niet; het is er
// zodat "de demo verversen" één commando is dat je in een planner kunt zetten (dagelijks of
// wekelijks), in plaats van iets wat iemand zich moet herinneren.
//
// WAT HET WEL EN NIET RAAKT (zie insertViaSupabase in seed-demo-client.ts)
//
// - De DATATABELLEN van de demoklant worden gewist en opnieuw gevuld, en de projectie in fact_core
//   wordt opnieuw opgebouwd (wisDemoProjectie + refresh_fact_from_legacy). Alleen client_id's die
//   met "demo-" beginnen; die grens zit in lib/demo/projectie-opruimen.ts.
// - De ANALYSE-UITVOER blijft staan (sop_analysis_output, sprint_hypotheses, sop_recommendations,
//   taken): die schrijft de seed niet en wist hij dus ook niet. Bewust GEEN teardown hier: die
//   wist ook de voorstellen en beoordeelde hypothesen waar het logboek van de demo van leeft.
// - De voorbeeldregels in het logboek van de demo staan niet in de database: die maakt de code,
//   klokrelatief (demoVoorbeelden in lib/overzicht/logboek.ts). Daar hoeft niets voor te draaien.
//
// STANDAARD SCHRIJFT DIT NIETS. Zonder --uitvoeren laat het alleen zien welke dag het anker wordt,
// welke vensters daaruit volgen en welke commando's er zouden lopen. Draai het nooit onder een
// lopende meting of rookproef: de seed wist de datatabellen voor hij ze vult.
//
// Het tsx-binary wordt één keer opgezocht en rechtstreeks aangeroepen; geen npx (AGENTS.md).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const uitvoeren = args.includes("--uitvoeren");
const vast = args.find((a) => a.startsWith("--vandaag="))?.slice("--vandaag=".length);
const onbekend = args.filter((a) => a !== "--uitvoeren" && !a.startsWith("--vandaag="));
if (onbekend.length > 0) {
  console.error(`Onbekend argument: ${onbekend.join(" ")}. Gebruik --uitvoeren en/of --vandaag=JJJJ-MM-DD.`);
  process.exit(1);
}
if (vast !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(vast)) {
  console.error(`--vandaag moet JJJJ-MM-DD zijn, niet "${vast}".`);
  process.exit(1);
}

// Dezelfde dag als de seed zelf kiest: de Amsterdamse kalenderdag (lib/reporting-date.ts, today()).
const vandaag = vast ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
const dagenTerug = (n) => {
  const [j, m, d] = vandaag.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, d - n)).toISOString().slice(0, 10);
};
const maandenTerug = (n) => {
  const [j, m] = vandaag.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1 - n, 1)).toISOString().slice(0, 7);
};

const stappen = [
  { naam: "demo-greentech (alle kanalen)", script: join("scripts", "demo", "seed-demo-client.ts") },
  { naam: "de drie beursaccounts (afgeleid van demo-greentech)", script: join("scripts", "demo", "seed-geoclone-clients.ts") },
];

console.log(`Herseed van de demo, met als vandaag: ${vandaag}${vast ? " (vaste klok)" : " (Amsterdam, nu)"}`);
console.log(`  Google maanddata      ${maandenTerug(23)} t/m ${maandenTerug(0)} (24 maanden, de lopende maand is maand 0)`);
console.log(`  Meta en LinkedIn      dagdata ${dagenTerug(63)} t/m ${vandaag}; de langere reeksen vanaf ${dagenTerug(159)}`);
console.log(`  Weekdata Google       26 weken, tot en met de week van ${vandaag}`);
console.log("  Analyse-uitvoer       blijft staan (voorstellen, hypothesen, taken)");
console.log("");
for (const s of stappen) console.log(`  ${uitvoeren ? "draait" : "zou draaien"}: tsx ${s.script}   # ${s.naam}`);

if (!uitvoeren) {
  console.log("\nEr is niets geschreven. Voeg --uitvoeren toe om de demo werkelijk opnieuw te zaaien.");
  process.exit(0);
}

// Eerst lokaal, dan de npx-cache: dezelfde twee plekken als scripts/run-tests.mjs, één keer gezocht.
const tsx = (() => {
  const lokaal = join("node_modules", ".bin", "tsx");
  if (existsSync(lokaal)) return lokaal;
  const npxDir = join(process.env.npm_config_cache ?? join(process.env.HOME ?? "/root", ".npm"), "_npx");
  if (!existsSync(npxDir)) return null;
  return readdirSync(npxDir).map((d) => join(npxDir, d, "node_modules", ".bin", "tsx")).find((p) => existsSync(p)) ?? null;
})();
if (!tsx) {
  console.error("\ntsx is niet gevonden (node_modules/.bin of de npx-cache). Draai dit vanuit de projectmap, of haal tsx één keer op met `npx tsx --version`.");
  process.exit(1);
}
if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("\nZet NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in de omgeving. Zonder service-role schrijft de seed niet door RLS heen.");
  process.exit(1);
}

for (const s of stappen) {
  console.log(`\n── ${s.naam} ──`);
  // DEMO_VANDAAG altijd meegeven, ook zonder --vandaag: de twee seeders horen op DEZELFDE dag te
  // ankeren, ook als de eerste over middernacht heen loopt.
  const uit = spawnSync(tsx, [s.script], { stdio: "inherit", env: { ...process.env, DEMO_VANDAAG: vandaag } });
  if (uit.status !== 0) {
    console.error(`\n${s.script} stopte met code ${uit.status ?? uit.signal}. De herseed is NIET af: draai hem opnieuw, de seed is herhaalbaar.`);
    process.exit(uit.status ?? 1);
  }
}
console.log(`\nDe demo loopt nu t/m ${vandaag}.`);

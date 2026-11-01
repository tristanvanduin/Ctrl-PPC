// De demo-analyse Budgetallocatie (lib/demo/analyses-demo.ts) tegen het geseede impressieaandeel.
// Geen IO: de seeder wordt als tekst gelezen, niet geïmporteerd (importeren draait hem, en dan
// schrijft hij naar de database).
// Draaien: tsx lib/demo/__analyses_demo_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De kop van analyses-demo.ts belooft dat elke tekst leunt op cijfers die elders op hetzelfde
// scherm staan. De Budgetallocatie-tekst kwam uit de GreenTech-fixture, met "GRN | Search | Canada
// verliest 31% aan budget bij 95% benutting". Sinds de demo Google uit de geseede database leest,
// komt het impressieaandeel uit ads_campaign_impression_share, en daar heeft GRN geen rij (de
// campagne heet daar bovendien "GRN | Search | NA"). Wie doorklikte vond die 31% nergens.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyseOutputRows } from "./analyses-demo";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const root = join(import.meta.dirname, "..", "..");
const seeder = readFileSync(join(root, "scripts/demo/seed-demo-client.ts"), "utf8");
const isBlok = seeder.slice(seeder.indexOf("const isRows"), seeder.indexOf('tables["ads_campaign_impression_share"]'));
const geseed = new Map<string, { budget: number; rang: number; benutting: number }>();
for (const m of isBlok.matchAll(/campaign_name: "([^"]+)",[^}]*search_budget_lost_is: ([\d.]+), search_rank_lost_is: ([\d.]+),[^}]*budget_utilization: ([\d.]+)/g)) {
  geseed.set(m[1], { budget: Number(m[2]), rang: Number(m[3]), benutting: Number(m[4]) });
}
check("voorwaarde: de seeder heeft drie searchcampagnes met impressieaandeel", geseed.size === 3, [...geseed.keys()].join(" / "));

const tekst = String(analyseOutputRows("demo-greentech", "2026-08", "2026-08-26T00:00:00Z")
  .find((r) => r.sop_type === "budget_allocation")?.output ?? "");
check("voorwaarde: de Budgetallocatie-tekst bestaat", tekst.length > 0);

console.log("Elke genoemde campagne en elk percentage staat in de seed");
{
  const genoemd = [...new Set([...tekst.matchAll(/(GR[A-Z] \| [A-Za-z]+ \| [A-Za-z]+)/g)].map((m) => m[1]))];
  check("de tekst noemt campagnes", genoemd.length > 0);
  for (const naam of genoemd) check(`${naam} heeft een rij in ads_campaign_impression_share`, geseed.has(naam));
  // "X verliest 28% impressieaandeel aan budget", "X verliest 22% aan RANG".
  for (const m of tekst.matchAll(/(GR[A-Z] \| [A-Za-z]+ \| [A-Za-z]+) verliest (\d+)% (?:impressieaandeel )?aan (budget|RANG)/g)) {
    const rij = geseed.get(m[1]);
    const verwacht = rij ? Math.round((m[3] === "budget" ? rij.budget : rij.rang) * 100) : null;
    check(`${m[1]}: ${m[2]}% verlies aan ${m[3].toLowerCase()} zoals geseed`, verwacht === Number(m[2]), `seed ${verwacht}`);
  }
  check("geen GRN-regel met een impressieaandeel dat nergens staat", !/GRN \| Search/.test(tekst));
}

console.log("Elke CPA en elke opbrengst in het voorstel volgt uit de seed");
{
  // "Bij een CPA van € 66 ... ruwweg 50 extra conversies per maand" kwam uit de oude fixture. De
  // geseede GRT-rijen geven een CPA van 129 tot 173 per maand (de impressieaandeelrij: € 4.200 voor
  // 26 conversies), en zelfs bij € 66 levert € 35 per dag geen 50 conversies op maar 16.
  const kosten = new Map<string, { cost: number; conv: number }>();
  for (const m of isBlok.matchAll(/campaign_name: "([^"]+)",[^}]*cost: ([\d.]+), conversions: ([\d.]+)/g)) {
    kosten.set(m[1], { cost: Number(m[2]), conv: Number(m[3]) });
  }
  const plat = tekst.replace(/\s+/g, " ");
  const voorstellen = [...plat.matchAll(/dagbudget van (GR[A-Z] \| [A-Za-z]+ \| [A-Za-z]+) met \d+% \(€ (\d+) → € (\d+)\)\. Bij een CPA van € ([\d.]+)[^.]*?ruwweg (\d+) extra conversies per maand/g)];
  check("het voorstel noemt een CPA en een opbrengst", voorstellen.length > 0, plat.slice(plat.indexOf("Voorstel"), plat.indexOf("Voorstel") + 300));
  for (const [, naam, van, naar, cpa, extra] of voorstellen) {
    const rij = kosten.get(naam);
    const seedCpa = rij ? rij.cost / rij.conv : NaN;
    check(`${naam}: CPA € ${cpa} zoals geseed (€ ${seedCpa.toFixed(1)})`, Math.abs(Number(cpa) - seedCpa) < 1, JSON.stringify(rij));
    const verwacht = ((Number(naar) - Number(van)) * 30.4) / seedCpa;
    check(`${naam}: ${extra} extra conversies per maand volgt uit € ${van} → € ${naar} bij die CPA (${verwacht.toFixed(1)})`,
      Math.abs(Number(extra) - verwacht) <= 0.5);
  }
}

console.log("De kop van analyses-demo.ts");
{
  const bron = readFileSync(join(root, "lib/demo/analyses-demo.ts"), "utf8");
  const kop = bron.slice(0, bron.indexOf("type Row"));
  check("de kop telt drie searchcampagnes, geen vier", /drie searchcampagnes/.test(kop) && !/vier searchcampagnes/.test(kop));
  check("de kop noemt het geseede impressieaandeel als bron, niet greentech-mock",
    /ads_campaign_impression_share/.test(kop) && !/greentech-mock \(impression share/.test(kop));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

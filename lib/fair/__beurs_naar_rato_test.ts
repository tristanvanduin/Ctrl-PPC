// Gedragstest voor de rekenfouten in de beursanalyse uit de doorlichting van 13 november 2026:
//   1. een vlak account stond begin elke maand 17 tot 19% "achter" en kreeg een actie;
//   2. de projectie van een account dat exact op koers ligt miste het doel op elke dag behalve
//      de laatste van de maand;
//   3. een vorige editie met onvolledige historie gaf GRA +38% waar +10% gold;
//   4. na de beursdag kwam er nog een actie in de wachtrij.
// De tegenvoorbeelden komen uit het rapport (elke maand 100 conversies, beurs 10 juni; GRA met
// data vanaf december 2024).
// Draaien: tsx lib/fair/__beurs_naar_rato_test.ts

import { analyzeGeoClone, spreidMaandOverDagen } from "./geo-clone-analysis";
import type { CampaignMonthlyRow } from "./geo-clone-aggregate";
import { demoRows } from "../demo/demo-rows";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const maanden = (van: string, tot: string): string[] => {
  const out: string[] = [];
  let [j, m] = van.split("-").map(Number);
  const [tj, tm] = tot.split("-").map(Number);
  while (j < tj || (j === tj && m <= tm)) {
    out.push(`${j}-${String(m).padStart(2, "0")}-01`);
    m++; if (m > 12) { m = 1; j++; }
  }
  return out;
};
const dagenIn = (maand: string): number => { const [j, m] = maand.split("-").map(Number); return new Date(Date.UTC(j, m, 0)).getUTCDate(); };

// Maandrijen tot en met de maand van de peildatum; die laatste als maand-tot-nu, zoals de sync hem levert.
function vlakkeRijen(peil: string, perMaand: (maand: string) => { conv: number; cost: number }, van = "2024-01"): CampaignMonthlyRow[] {
  return maanden(van, peil.slice(0, 7)).map((month) => {
    const { conv, cost } = perMaand(month);
    const lopend = month.slice(0, 7) === peil.slice(0, 7);
    const frac = lopend ? Number(peil.slice(8, 10)) / dagenIn(month) : 1;
    return { campaign_name: "GRT | Search | NL", month, conversions: conv * frac, cost: cost * frac, impressions: 0, clicks: 0, conversions_value: 0 };
  });
}

console.log("spreidMaandOverDagen:");
{
  const juni = spreidMaandOverDagen("2026-06-01", 30, "2026-11-13");
  assert(juni.length === 30 && juni[0].date === "2026-06-01" && juni[29].date === "2026-06-30", "een afgesloten maand over al zijn dagen");
  assert(Math.abs(juni.reduce((s, p) => s + p.value, 0) - 30) < 1e-9, "de som blijft het maandtotaal");
  const nov = spreidMaandOverDagen("2026-11-01", 13, "2026-11-13");
  assert(nov.length === 13 && nov.at(-1)!.date === "2026-11-13", "de lopende maand alleen over de verstreken dagen (maand-tot-nu)");
  assert(spreidMaandOverDagen("2026-12-01", 50, "2026-11-13").length === 0, "een maand na de peildatum telt niet");
}

console.log("vlak account (elke maand 100, beurs 10 juni): op elke peildatum 0% en geen actie");
{
  const editions = [{ date: "2025-06-10", label: "2025" }, { date: "2026-06-10", label: "2026" }, { date: "2027-06-10", label: "2027" }];
  const projecties: number[] = [];
  for (const peil of ["2026-11-02", "2026-11-13", "2026-11-20", "2026-11-28", "2026-11-30", "2026-12-01", "2026-12-15"]) {
    const res = analyzeGeoClone({
      geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows: vlakkeRijen(peil, () => ({ conv: 100, cost: 1000 })),
      cadence: "annual", editions, conversionsTarget: null, asOfDate: peil,
    });
    const d = res.conversions?.deltaPct ?? null;
    // Vroeger: 2 nov -19,3%, 1 dec -16,7%, beide met actionNeeded.
    assert(res.conversions?.comparable === true && d != null && Math.abs(d) <= 0.01, `${peil}: delta ${d} (verwacht 0)`);
    assert(res.actionNeeded === false, `${peil}: geen actie voor een account dat gelijk loopt`);
    projecties.push(res.forecast?.projectedFinal ?? NaN);
  }
  const spreiding = Math.max(...projecties) - Math.min(...projecties);
  // Vroeger: 976 op 2 nov, 1.064 op 13 nov, 1.200 op 30 nov en weer 1.097 op 15 dec. Wat er
  // overblijft (enkele conversies over zes weken) komt van ongelijke vensterlengtes en de
  // schrikkeldag in de oudste editie, niet van de maandgrens.
  assert(spreiding / Math.min(...projecties) <= 0.01, `de projectie is op elke dag vrijwel dezelfde eindstand (${projecties.join(", ")})`);

}

console.log("vlak account met doel 1.200 (12 x 100): geen actie op welke peildatum ook");
{
  // Het tegenvoorbeeld uit de controle, letterlijk. Het doel staat vast en is niet afgeleid van
  // de eigen projectie (dat slaagde per constructie). De projectie komt uit op 1.190: het venster
  // van de editie is 361 dagen, het doel een jaar. Vroeger actionNeeded op 6 van de 7 dagen, na
  // de eerste reparatie op 7 van de 7.
  const editions = [{ date: "2025-06-10", label: "2025" }, { date: "2026-06-10", label: "2026" }, { date: "2027-06-10", label: "2027" }];
  const draai = (peil: string, doel: number) => analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows: vlakkeRijen(peil, () => ({ conv: 100, cost: 1000 })),
    cadence: "annual", editions, conversionsTarget: doel, asOfDate: peil,
  });
  for (const peil of ["2026-11-01", "2026-11-02", "2026-11-13", "2026-11-28", "2026-11-30", "2026-12-01", "2026-12-15"]) {
    const res = draai(peil, 1200);
    assert(res.actionNeeded === false, `${peil}: op koers, geen actie (projectie ${res.forecast?.projectedFinal} tegen 1.200)`);
  }
  assert(/binnen de marge/.test(draai("2026-11-13", 1200).markdown), "de tekst zegt dat het net onder het doel is, binnen de marge");
  // Een doel dat echt buiten bereik ligt houdt zijn actie: 1.300 is 8% meer dan dit account haalt.
  for (const peil of ["2026-11-02", "2026-11-13", "2026-12-15"]) {
    const res = draai(peil, 1300);
    assert(res.actionNeeded === true && /MIST het doel/.test(res.markdown), `${peil}: doel 1.300 wordt gemist en geeft een actie`);
  }
}

console.log("vlak account dat echt 35% achterloopt: de actie blijft");
{
  const peil = "2026-11-13";
  const res = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam",
    rows: vlakkeRijen(peil, (m) => ({ conv: m >= "2026-06-14" ? 65 : 100, cost: 1000 })),
    cadence: "annual", editions: [{ date: "2025-06-10", label: "2025" }, { date: "2026-06-10", label: "2026" }, { date: "2027-06-10", label: "2027" }],
    conversionsTarget: null, asOfDate: peil,
  });
  const d = res.conversions?.deltaPct ?? 0;
  assert(d < -0.3 && d > -0.4, `delta ${d} rond -35%`);
  assert(res.actionNeeded === true, "materieel achter => actionNeeded");
}

console.log("GRA: vorige editie met onvolledige historie (data pas vanaf december 2024)");
{
  // Ontwerp: dit jaar 10% meer conversies bij gelijke spend. Het venster van de editie 2025
  // valt terug op 365 dagen en begint in september 2024, de data pas in december.
  const peil = "2026-11-13";
  const rows = vlakkeRijen(peil, (m) => ({ conv: m >= "2025-09-20" ? 33 : 30, cost: 3000 }), "2024-12");
  const res = analyzeGeoClone({
    geoClone: "GRA", fairLabel: "GreenTech Americas", rows: rows.map((r) => ({ ...r, campaign_name: "GRA | Search | US" })),
    cadence: "annual", editions: [{ date: "2025-09-16", label: "2025" }, { date: "2026-09-15", label: "2026" }],
    conversionsTarget: 200, asOfDate: peil,
  });
  const d = res.conversions?.deltaPct ?? null;
  const s = res.cost?.deltaPct ?? null;
  // Vroeger: +38,1% conversies en +20% spend.
  assert(d != null && d > 0.05 && d < 0.15, `conversies ${d} rond +10%`);
  assert(s != null && Math.abs(s) < 0.02, `spend ${s} gelijk`);
  assert(res.conversions?.comparedFromDaysOut != null && /vergeleken vanaf/.test(res.markdown), "de inkorting staat in de tekst");
  assert(res.actionNeeded === false, "na de beurs geen actie");
}

console.log("na de beursdag: evaluatie, geen actie");
{
  // GRN: beurs 9 dagen geleden, 64 tegen doel 70.
  const res = analyzeGeoClone({
    geoClone: "GRN", fairLabel: "GreenTech North America",
    rows: maanden("2026-04", "2026-11").map((month) => ({ campaign_name: "GRN | Search | NA", month, conversions: 8, cost: 900 })),
    cadence: "custom", editions: [{ date: "2026-11-04", label: "2026" }], conversionsTarget: 70, asOfDate: "2026-11-13",
  });
  assert(res.forecast?.method === "beurs_bereikt", "methode beurs_bereikt");
  assert(res.forecast?.willHitTarget === false, "het doel is gemist (dat blijft zichtbaar)");
  assert(res.actionNeeded === false, "maar er komt geen actie meer in de wachtrij");
  assert(/evaluatie/.test(res.markdown), "de tekst noemt het een evaluatie");
}

console.log("Meta: een beurscampagne die vorig jaar later startte kort de vergelijking niet in");
{
  // Vorig jaar liep de Meta-campagne pas vanaf 60 dagen voor de beurs, dit jaar vanaf 200. De
  // historie van Meta in het account begint veel eerder. De eerste datum van de GEFILTERDE punten
  // als historiebegin kortte de vergelijking in tot de laatste 60 dagen, en dan telde de opbouw
  // van dit jaar daarvoor niet mee in de projectie.
  const dagen = (van: string, tot: string) => {
    const out: { date: string; value: number }[] = [];
    for (let t = Date.parse(van); t <= Date.parse(tot); t += 86_400_000) out.push({ date: new Date(t).toISOString().slice(0, 10), value: 1 });
    return out;
  };
  const peil = "2026-05-11"; // 30 dagen voor de beurs
  const punten = [...dagen("2025-04-11", "2025-06-10"), ...dagen("2025-11-22", peil)];
  const draai = (historyStart?: string | null) => analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows: vlakkeRijen(peil, () => ({ conv: 100, cost: 1000 })),
    cadence: "annual", editions: [{ date: "2025-06-10", label: "2025" }, { date: "2026-06-10", label: "2026" }],
    conversionsTarget: null, asOfDate: peil,
    channelConvPoints: [{ channel: "meta_ads", points: punten, target: null, historyStart }],
  }).perChannelForecast.find((c) => c.channel === "meta_ads")!.forecast;
  const accountBreed = draai("2024-01-01");
  const zonder = draai(null);
  const oud = draai("2025-04-11"); // wat de oude code meegaf: het begin van de beurscampagne
  assert(accountBreed.projectedFinal === zonder.projectedFinal, `met de historie van het account: geen inkorting (${accountBreed.projectedFinal} = ${zonder.projectedFinal})`);
  assert((oud.projectedFinal ?? 0) < (accountBreed.projectedFinal ?? 0), `het begin van de beurscampagne als historie gaf een lagere projectie (${oud.projectedFinal} tegen ${accountBreed.projectedFinal})`);
}

console.log("demo: de lopende maand van ads_campaign_monthly is een maand-tot-nu");
{
  // De sync levert de lopende maand als maand-tot-nu, en spreidMaandOverDagen verdeelt hem over de
  // verstreken dagen. De demo leverde een volle maand, en dan stond GRT op 13 november op +41%
  // waar +28% gold.
  const rijen = (demoRows() as Record<string, Record<string, unknown>[]>)["ads_campaign_monthly"];
  const nu = new Date();
  const maand = (terug: number) => new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - terug, 1)).toISOString().slice(0, 10);
  const dagenIn2 = (terug: number) => new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - terug + 1, 0)).getUTCDate();
  const kostenPerDag = (terug: number, delen: number) => rijen.filter((r) => r.month === maand(terug)).reduce((t, r) => t + Number(r.cost), 0) / delen;
  const lopend = kostenPerDag(0, nu.getUTCDate());
  const vorige = kostenPerDag(1, dagenIn2(1));
  assert(lopend / vorige > 0.7 && lopend / vorige < 1.3, `kosten per verstreken dag van deze maand liggen bij die van vorige maand (${Math.round(lopend)} tegen ${Math.round(vorige)})`);
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle beurs-naar-rato-tests geslaagd");

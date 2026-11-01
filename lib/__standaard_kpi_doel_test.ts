// Test: het standaard jaardoel zolang er geen KPI-doel is opgeslagen (of nog niet geladen).
// Draaien: tsx lib/__standaard_kpi_doel_test.ts
//
// Wat er misging. De routes geven als doel al "vorig jaar +10%" mee (standaardJaardoel in
// lib/analysis/standaard-jaardoel.ts). Zonder opgeslagen kpi_targets viel getClientSettings terug
// op DEFAULT_KPI_TARGETS, en die stond op "groei 10%". mergeKpiTargets legde die tien procent er
// nog eens bovenop: vorig jaar x 1,21, terwijl het scherm "vorig jaar +10%" zegt. En welk van de
// twee je zag, hing af van of de instellingen al binnen waren toen de data kwam (de demo:
// 1.938 of 2.132 conversies als doel).

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// lib/supabase maakt bij het laden een browserclient als de omgeving er een URL voor heeft; die
// leest document.cookie. Zonder window is er geen localStorage, dus geen opgeslagen instellingen.
Object.assign(globalThis, { document: { cookie: "" } });

async function main() {
  const { getClientSettings } = await import("./client-settings");
  const { mergeKpiTargets } = await import("./kpi-target-merge");
  const { standaardJaardoel } = await import("./analysis/standaard-jaardoel");
  type Data = Parameters<typeof mergeKpiTargets>[1];

  const vorigJaar = { conversions: 1340, revenue: 256420, adSpend: 133200 };
  const data: Data = {
    clientId: "nieuw", targetCurrentYear: standaardJaardoel(vorigJaar),
    historicalYears: {}, currentYearData: Array(12).fill(null), currentYear: 2026,
  };

  const kpi = getClientSettings("nieuw").kpiTargets;
  // De standaard in Instellingen is dezelfde +10% als het doel van de route, zodat de doelkaart daar
  // niet op "uit" staat terwijl het dashboard een doel toont. Dat die 10 niet nog eens bovenop het
  // routedoel komt, toetsen de checks hieronder.
  check("zonder opgeslagen doelen: Instellingen toont de standaard +10%",
    kpi.conversionsGrowthPct === 10 && kpi.revenueGrowthPct === 10, JSON.stringify(kpi));

  const samen = mergeKpiTargets("nieuw", data).targetCurrentYear;
  // Oud: 1.340 x 1,1 x 1,1 = 1.621 en 256.420 x 1,21 = 310.268.
  check("conversies: vorig jaar +10% (1.474), niet x 1,21 (1.621)", samen.conversions === 1474, String(samen.conversions));
  check("omzet: vorig jaar +10% (282.062), niet x 1,21", samen.revenue === 282062, String(samen.revenue));
  check("spend: het standaarddoel van de route (+5%)", samen.adSpend === 139860, String(samen.adSpend));
  check("dus precies standaardJaardoel(vorig jaar)", JSON.stringify(samen) === JSON.stringify(standaardJaardoel(vorigJaar)), JSON.stringify(samen));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

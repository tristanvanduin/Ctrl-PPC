// Test: waarop een ingevoerd groeipercentage werkt (lib/kpi-target-merge.ts).
// Draaien: tsx lib/__kpi_groei_basis_test.ts
//
// Wat er misging. In Instellingen heet het veld "% Groei tov vorig jaar" en eronder staat
// "+10% ten opzichte van vorig jaar". Maar mergeKpiTargets legde dat percentage op het doel van
// de route, en dat is al vorig jaar +10% (standaardJaardoel). Wie 10% intypte, kreeg vorig jaar
// x 1,21; wie 0% liet staan, kreeg +10%. Het getal in het veld en het doel op het scherm liepen
// dus altijd tien procent uiteen.

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// getClientSettings leest opgeslagen instellingen uit localStorage zolang de cache leeg is. Een
// nep-window met een nep-localStorage geeft zo per klant een opgeslagen doel, zonder database.
const opslag = new Map<string, string>();
Object.assign(globalThis, {
  document: { cookie: "" },
  window: {},
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); } },
});

function bewaar(clientId: string, kpi: Record<string, unknown>): void {
  opslag.set(`rm-dashboard-settings-${clientId}`, JSON.stringify({
    clientId, conversionActions: [], conversionLagDays: 3,
    kpiTargets: {
      conversionsMode: "growth", conversionsGrowthPct: 0, conversionsAbsolute: 0,
      revenueMode: "growth", revenueGrowthPct: 0, revenueAbsolute: 0, roasTarget: 0, cpaTarget: 0,
      ...kpi,
    },
  }));
}

async function main() {
  const { mergeKpiTargets } = await import("./kpi-target-merge");
  const { standaardJaardoel } = await import("./analysis/standaard-jaardoel");
  type Data = Parameters<typeof mergeKpiTargets>[1];

  // Google 2025 van de demo: 1.340 conversies, € 256.420 omzet.
  const vorigJaar = { conversions: 1340, revenue: 256420, adSpend: 133200 };
  const data = (clientId: string): Data => ({
    clientId, targetCurrentYear: standaardJaardoel(vorigJaar),
    historicalYears: {}, currentYear: 2026, currentYearData: Array(12).fill(null),
  });
  const doel = (clientId: string) => mergeKpiTargets(clientId, data(clientId)).targetCurrentYear;

  bewaar("tien", { conversionsGrowthPct: 10, revenueGrowthPct: 10 });
  const tien = doel("tien");
  // Oud: 1.474 x 1,1 = 1.621 en 282.062 x 1,1 = 310.268, terwijl het veld "+10%" zei.
  check("10% ingevoerd: vorig jaar +10% (1.474), niet x 1,21 (1.621)", tien.conversions === 1474, String(tien.conversions));
  check("10% ingevoerd: omzet vorig jaar +10% (282.062)", tien.revenue === 282062, String(tien.revenue));

  bewaar("vijfentwintig", { conversionsGrowthPct: 25, revenueGrowthPct: 25 });
  const vijf = doel("vijfentwintig");
  check("25% ingevoerd: 1.340 x 1,25 = 1.675", vijf.conversions === 1675, String(vijf.conversions));
  check("25% ingevoerd: 256.420 x 1,25 = 320.525", vijf.revenue === 320525, String(vijf.revenue));

  bewaar("krimp", { conversionsGrowthPct: -10 });
  check("-10% ingevoerd: 1.340 x 0,9 = 1.206", doel("krimp").conversions === 1206, String(doel("krimp").conversions));

  // Groei 0 is "niets ingevoerd" (de schakelaar staat uit): dan het standaarddoel, vorig jaar +10%.
  bewaar("uit", {});
  check("0% (uit): het standaarddoel, vorig jaar +10%", JSON.stringify(doel("uit")) === JSON.stringify(standaardJaardoel(vorigJaar)), JSON.stringify(doel("uit")));

  bewaar("vast", { conversionsMode: "absolute", conversionsAbsolute: 2600, revenueGrowthPct: 10 });
  const vast = doel("vast");
  check("een vast doel blijft het vaste doel", vast.conversions === 2600, String(vast.conversions));
  check("naast een vast conversiedoel werkt de omzetgroei ook op vorig jaar", vast.revenue === 282062, String(vast.revenue));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

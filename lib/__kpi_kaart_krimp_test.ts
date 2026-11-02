// Regressietest: een krimpdoel (negatief groeipercentage) in Instellingen (lib/kpi-kaart.ts, gebruikt
// door components/dashboard/client-settings.tsx).
// Draaien: tsx lib/__kpi_kaart_krimp_test.ts
//
// Wat er misging. Het dashboard past een opgeslagen -10% gewoon toe (mergeKpiTargets; vastgelegd in
// lib/__kpi_groei_basis_test.ts: 1.340 x 0,9 = 1.206), maar het paneel kon die waarde niet vasthouden:
// - bij het laden stond de kaart alleen aan bij een groei > 0, dus -10% toonde hem als "uit", met de
//   velden verborgen, terwijl het dashboard op 1.206 mikte;
// - de regel onder het veld verscheen alleen bij > 0, ook vlak na het intypen van -10;
// - en omdat de kaart "uit" stond, schreef de volgende opslag van WELK veld ook (alleen de sector,
//   bijvoorbeeld) groei 0 weg: het doel werd stil het standaarddoel, 1.474 (vorig jaar +10%).
// De beslissing: krimpdoelen blijven toegestaan, want een bureau met een klant die bewust afbouwt,
// hoort dat doel te kunnen zetten. Alleen boven -100%: daaronder is vorig jaar x (1 + groei) geen doel
// meer (zie het laatste blok hieronder).
//
// De module bestaat op de oude code niet; dan per geval een FAIL in plaats van een crash.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// mergeKpiTargets leest de opgeslagen instellingen uit localStorage zolang de cache leeg is.
const opslag = new Map<string, string>();
Object.assign(globalThis, {
  document: { cookie: "" },
  window: {},
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); } },
});

interface Kaart { enabled: boolean; value: number; period: "year" | "month"; inputMode: "absolute" | "growth"; growthPct: number }
interface Doel { mode: "growth" | "absolute"; growthPct: number; absolute: number }
interface Module {
  groeiKaartUitDoel: (doel: Doel) => Kaart;
  groeiDoelUitKaart: (kaart: Kaart) => Doel;
  groeiRegel: (growthPct: number) => string | null;
}

async function main() {
  let m: Module | null = null;
  try { m = (await import("./kpi-kaart")) as unknown as Module; } catch { /* oude code: bestaat niet */ }
  // Het paneel hangt aan React en een provider; of het deze regels gebruikt, op de bron. Breekt dit
  // bij een andere schrijfwijze met hetzelfde gedrag, pas dan de regex aan, niet het gedrag.
  console.log("Het paneel gebruikt deze regels");
  const paneel = readFileSync(join(__dirname, "..", "components/dashboard/client-settings.tsx"), "utf8");
  check("laden: conversies en omzet via groeiKaartUitDoel", (paneel.match(/groeiKaartUitDoel\(\{ mode: kpi\.(conversions|revenue)Mode/g) ?? []).length === 2);
  check("opslaan: conversies en omzet via groeiDoelUitKaart", /groeiDoelUitKaart\(kpiConversions\)/.test(paneel) && /groeiDoelUitKaart\(kpiRevenue\)/.test(paneel));
  check("de regel onder het veld via groeiRegel", /groeiRegel\(config\.growthPct\)/.test(paneel));
  check("geen 'groei > 0' meer als voorwaarde (dat las -10% als uit)", !/[gG]rowthPct > 0/.test(paneel));

  check("lib/kpi-kaart bestaat", m !== null && typeof m.groeiKaartUitDoel === "function");
  if (!m) return klaar();
  const { groeiKaartUitDoel, groeiDoelUitKaart, groeiRegel } = m;

  console.log("Een opgeslagen -10% laden");
  const krimp = groeiKaartUitDoel({ mode: "growth", growthPct: -10, absolute: 0 });
  check("de kaart staat AAN, in de groeimodus, met -10", krimp.enabled && krimp.inputMode === "growth" && krimp.growthPct === -10, JSON.stringify(krimp));
  check("de regel onder het veld noemt het teken", groeiRegel(-10) === "-10% ten opzichte van vorig jaar", String(groeiRegel(-10)));

  console.log("Een ander veld opslaan houdt de -10% vast");
  const terug = groeiDoelUitKaart(krimp);
  check("opgeslagen: groei -10, geen vast doel", terug.mode === "growth" && terug.growthPct === -10 && terug.absolute === 0, JSON.stringify(terug));
  // En het dashboard mikt daarna nog steeds op 1.206, niet op het standaarddoel 1.474.
  const { mergeKpiTargets } = await import("./kpi-target-merge");
  const { standaardJaardoel } = await import("./analysis/standaard-jaardoel");
  opslag.set("rm-dashboard-settings-krimp", JSON.stringify({
    clientId: "krimp", conversionActions: [], conversionLagDays: 3,
    kpiTargets: { conversionsMode: terug.mode, conversionsGrowthPct: terug.growthPct, conversionsAbsolute: terug.absolute, revenueMode: "growth", revenueGrowthPct: 0, revenueAbsolute: 0, roasTarget: 0, cpaTarget: 0 },
  }));
  type Data = Parameters<typeof mergeKpiTargets>[1];
  const data: Data = { clientId: "krimp", targetCurrentYear: standaardJaardoel({ conversions: 1340, revenue: 256420, adSpend: 133200 }), historicalYears: {}, currentYear: 2026, currentYearData: Array(12).fill(null) };
  const doel = mergeKpiTargets("krimp", data).targetCurrentYear.conversions;
  check("na laden en opnieuw opslaan: het dashboarddoel blijft 1.340 x 0,9 = 1.206", doel === 1206, String(doel));

  console.log("Wat er was, blijft");
  check("+10% laden: aan, regel met plusteken", groeiKaartUitDoel({ mode: "growth", growthPct: 10, absolute: 0 }).enabled && groeiRegel(10) === "+10% ten opzichte van vorig jaar", String(groeiRegel(10)));
  check("2,5%: Nederlandse komma", groeiRegel(2.5) === "+2,5% ten opzichte van vorig jaar", String(groeiRegel(2.5)));
  const niets = groeiKaartUitDoel({ mode: "growth", growthPct: 0, absolute: 0 });
  check("0% en geen vast doel: uit, geen regel (0 is niets ingevoerd, zoals in mergeKpiTargets)", !niets.enabled && groeiRegel(0) === null, JSON.stringify(niets));
  check("een ontbrekende waarde (null uit een oude rij) leest als niets ingevoerd",
    !groeiKaartUitDoel({ mode: "growth", growthPct: null as unknown as number, absolute: 0 }).enabled && groeiRegel(null as unknown as number) === null);
  const vast = groeiKaartUitDoel({ mode: "absolute", growthPct: 0, absolute: 2600 });
  check("een vast doel: aan, in de vaste modus", vast.enabled && vast.inputMode === "absolute" && vast.value === 2600, JSON.stringify(vast));
  check("een vast doel per maand wordt per jaar opgeslagen", groeiDoelUitKaart({ ...vast, period: "month", value: 200 }).absolute === 2400);
  check("een kaart die uit staat, slaat niets op", JSON.stringify(groeiDoelUitKaart({ ...krimp, enabled: false })) === JSON.stringify({ mode: "growth", growthPct: 0, absolute: 0 }));

  // -100% of lager is geen doel: vorig jaar x 0 (of minder) is nul of negatief, en dan valt
  // mergeKpiTargets terug op het standaarddoel, met "er is nog geen doel ingevoerd". De kaart stond
  // toch aan met "-100% ten opzichte van vorig jaar" eronder: Instellingen en het dashboard zeiden
  // over dezelfde invoer twee verschillende dingen.
  console.log("Krimp tot -100% en lager");
  const metGroei = (id: string, pct: number, routeConversies: number) => {
    opslag.set(`rm-dashboard-settings-${id}`, JSON.stringify({
      clientId: id, conversionActions: [], conversionLagDays: 3, kpiDoelenOpgeslagen: true,
      kpiTargets: { conversionsMode: "growth", conversionsGrowthPct: pct, conversionsAbsolute: 0, revenueMode: "growth", revenueGrowthPct: 0, revenueAbsolute: 0, roasTarget: 0, cpaTarget: 0 },
    }));
    const r = mergeKpiTargets(id, { ...data, clientId: id, targetCurrentYear: { ...data.targetCurrentYear, conversions: routeConversies } });
    return { doel: r.targetCurrentYear.conversions, herkomst: (r as { doelHerkomst?: { conversions: { soort: string } } }).doelHerkomst?.conversions.soort ?? "standaard" };
  };
  for (const pct of [-100, -120]) {
    const k = groeiKaartUitDoel({ mode: "growth", growthPct: pct, absolute: 0 });
    check(`${pct}%: de kaart staat uit`, !k.enabled, JSON.stringify(k));
    check(`${pct}%: geen regel onder het veld`, groeiRegel(pct) === null, String(groeiRegel(pct)));
    check(`${pct}%: een aangezette kaart slaat geen onmogelijke groei op`, groeiDoelUitKaart({ ...k, enabled: true }).growthPct === 0, JSON.stringify(groeiDoelUitKaart({ ...k, enabled: true })));
    check(`${pct}%: het dashboard zegt hetzelfde (de standaard)`, metGroei(`krimp${pct}`, pct, 1474).herkomst === "standaard");
  }
  // Alles boven -100% is wél een doel, ook als de afronding het op nul zou zetten.
  check("-99%: aan, met de regel", groeiKaartUitDoel({ mode: "growth", growthPct: -99, absolute: 0 }).enabled && groeiRegel(-99) === "-99% ten opzichte van vorig jaar", String(groeiRegel(-99)));
  const m99 = metGroei("krimp-99", -99, 1474);
  check("-99%: het dashboard mikt op een ingevoerd doel (13)", m99.herkomst === "groei" && m99.doel === 13, JSON.stringify(m99));
  const klein = metGroei("krimp-96-klein", -96, 11);
  check("-96% op een klein account (route 11): een doel van minstens 1, geen terugval op 11", klein.herkomst === "groei" && klein.doel === 1, JSON.stringify(klein));
  check("het paneel geeft het groeiveld een ondergrens van -99", /min=\{-99\}/.test(paneel));

  klaar();
}

function klaar() {
  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

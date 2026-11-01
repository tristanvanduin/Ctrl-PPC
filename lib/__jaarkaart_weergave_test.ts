// Regressietest: wat de jaaroverzicht-kaartjes (components/dashboard/metric-cards.tsx) op het
// scherm zetten. Draai met: tsx lib/__jaarkaart_weergave_test.ts
//
// __jaarkaart_cijfers_test.ts bewaakt de rekenhelper (jaarKaartCijfers) en dat de kaart hem
// aanroept. Dit bestand kijkt naar de UITKOMST: de kaart wordt echt gerenderd (react-dom/server,
// geen browser) en de test leest de tekst die de eigenaar ziet. Zo valt ook een kaart op die de
// helper wel aanroept maar het resultaat verkeerd neerzet, of de streep op een vaste plek laat.
//
// Wat er misging, op de demo (data t/m augustus): "CPA € 19, prognose € 34" in het groen, terwijl
// de forecast € 64 en € 68 zei, 50% boven het doel van € 45; en op alle vier de kaartjes een streep
// op 25% met "Q1 verwacht (25%)", in augustus. Dezelfde fixture als __jaarkaart_cijfers_test.ts.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricCardsView } from "../components/dashboard/metric-cards";
import { computeForecast, type ClientForecast } from "./forecast";
import { formatCurrency } from "./forecast-format";
import type { ClientHistoricalData, MonthlyRecord } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

type Rij = [conversies: number, kosten: number, omzet: number];
const naarMaanden = (rijen: Rij[]): MonthlyRecord[] =>
  rijen.map(([conversions, adSpend, revenue], i) => ({ month: i + 1, conversions, adSpend, revenue, weeks: [] }));
const NUL: Rij = [0, 0, 0];

const J2024: Rij[] = [NUL, NUL, NUL, NUL, NUL, NUL, NUL, NUL,
  [129, 11150, 25020], [113, 11100, 22060], [99, 11050, 19430], [93, 11150, 18150]];
const J2025: Rij[] = [[88, 11100, 17010], [92, 11050, 17440], [103, 11150, 19300], [113, 11100, 21010],
  [127, 11050, 23640], [143, 11150, 26670], [138, 11100, 26060], [134, 11050, 25630],
  [117, 11150, 23130], [105, 11100, 20830], [93, 11050, 18490], [87, 11150, 17210]];
const J2026: Rij[] = [[90, 12000, 17190], [243, 16700, 17110], [244, 16800, 36030], [337, 19500, 47530],
  [355, 19700, 50430], [361, 19550, 52170], [418, 25950, 62930], [370, 23650, 56930]];

const demo: ClientHistoricalData = {
  clientId: "demo-greentech",
  currentYear: 2026,
  targetCurrentYear: { conversions: 2600, revenue: 282062, adSpend: 117000 },
  historicalYears: { 2024: naarMaanden(J2024), 2025: naarMaanden(J2025) },
  currentYearData: [...naarMaanden(J2026), null, null, null, null],
};
const f = computeForecast(demo);

// Geen object-literal in createElement: zo rendert hetzelfde bestand ook tegen de oude kaart (die
// nog clientId en data wilde), en dat is precies de vergelijking die laat zien dat dit iets meet.
const rekwisieten = { forecast: f, clientId: demo.clientId, data: demo };
const html = renderToStaticMarkup(createElement(MetricCardsView, rekwisieten)).replace(/<!-- -->/g, "");

/** Het stuk HTML van één kaartje: vanaf zijn titel tot de titel van het volgende. */
function kaart(label: string): string {
  const start = html.indexOf(`>${label}</h3>`);
  if (start < 0) return "";
  const volgende = html.indexOf("</h3>", start + label.length + 6);
  return html.slice(start, volgende < 0 ? undefined : volgende);
}
const tel = (hooiberg: string, naald: string) => hooiberg.split(naald).length - 1;
const waarde = (v: number) => `>${formatCurrency(v)}<`;

console.log("jaaroverzicht-kaartjes, gerenderd");

const conv = kaart("Conversies");
const omzet = kaart("Omzet");
const roas = kaart("ROAS");
const cpa = kaart("CPA");
assert(conv !== "" && omzet !== "" && roas !== "" && cpa !== "", "alle vier de kaartjes staan er (alle vier hebben een doel)");

// De streep: de seizoensverwachting t/m augustus, niet een vaste 25% met "Q1".
assert(!html.includes("Q1 verwacht"), "nergens \"Q1 verwacht\"");
assert(!html.includes("left:25%"), "geen streep op een vaste 25%");
const verwachtConv = (f.conversions.kpi.ytdExpected / f.conversions.kpi.annualTarget) * 100;
const verwachtOmzet = (f.revenue.kpi.ytdExpected / f.revenue.kpi.annualTarget) * 100;
assert(conv.includes(`Verwacht t/m aug (${Math.round(verwachtConv)}%)`),
  `conversies: "Verwacht t/m aug (${Math.round(verwachtConv)}%)"`);
assert(omzet.includes(`Verwacht t/m aug (${Math.round(verwachtOmzet)}%)`),
  `omzet: "Verwacht t/m aug (${Math.round(verwachtOmzet)}%)"`);
const streep = /left:([\d.]+)%/.exec(conv);
assert(streep !== null && Math.abs(Number(streep[1]) - verwachtConv) < 0.01,
  `conversiestreep op ${verwachtConv.toFixed(2)}% (gevonden: ${streep?.[1] ?? "geen"})`);

// Balk en streep alleen bij optelbare metrics.
assert(tel(html, "% gerealiseerd") === 2, "precies twee voortgangsbalken: conversies en omzet");
assert(tel(roas, "left:") === 0 && tel(cpa, "left:") === 0, "geen streep bij ROAS en CPA");
assert(roas.includes("t.o.v. doel") && cpa.includes("t.o.v. doel"), "ROAS en CPA tonen alleen het verschil t.o.v. doel");

// De CPA-cijfers uit de forecast, niet uit Q1-kosten en het budgetdoel.
const q1Kosten = 12000 + 16700 + 16800;
assert(cpa.includes(waarde(f.cpa.kpi.ytdRealized)), `CPA gerealiseerd ${formatCurrency(f.cpa.kpi.ytdRealized)} (alle kosten t/m aug / conversies)`);
assert(!cpa.includes(waarde(q1Kosten / f.conversions.kpi.ytdRealized)), "CPA gerealiseerd is niet Q1-kosten / YTD-conversies (€ 19)");
assert(cpa.includes(waarde(f.cpa.kpi.adjustedAnnual)), `CPA-prognose ${formatCurrency(f.cpa.kpi.adjustedAnnual)} (prognosekosten / prognoseconversies)`);
assert(!cpa.includes(waarde(117000 / f.conversions.kpi.adjustedAnnual)), "CPA-prognose is niet budgetdoel / prognoseconversies (€ 34)");
assert(cpa.includes(waarde(45)), "CPA-jaardoel € 45");

// Het oordeel: een CPA 50% boven doel is slecht, ook al is het verschil positief.
assert(f.cpa.kpi.diffPct > 0, "voorwaarde: de CPA-prognose ligt boven het doel");
assert(cpa.includes("text-red-500") && !cpa.includes("text-green-600"), "CPA-kaart staat in het rood");
assert(cpa.includes(`+${f.cpa.kpi.diffPct.toFixed(1).replace(".", ",")}%`), "CPA-verschil met zijn echte teken (+)");
assert(conv.includes("text-green-600") === (f.conversions.kpi.diffPct >= 0), "conversies: groen bij een prognose boven doel");

// Zonder doel: geen balk en geen verschil (was "0% gerealiseerd" met een groen "+0,0%").
// computeForecast leidt zelf een doel af uit de historie, dus het doel gaat hier rechtstreeks op 0.
const zonderDoel: ClientForecast = { ...f };
for (const m of ["conversions", "revenue", "roas", "cpa"] as const) {
  zonderDoel[m] = { ...f[m], kpi: { ...f[m].kpi, annualTarget: 0, diffPct: 0 } };
}
const leeg = renderToStaticMarkup(createElement(MetricCardsView, { ...rekwisieten, forecast: zonderDoel })).replace(/<!-- -->/g, "");
assert(!leeg.includes("% gerealiseerd") && !leeg.includes("t.o.v. doel"), "zonder enig doel: geen voortgangsblok");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

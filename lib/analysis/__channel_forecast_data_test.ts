// Test voor het Meta/LinkedIn-jaaroverzicht (channel-forecast-data.ts).
// Draaien: npx tsx lib/analysis/__channel_forecast_data_test.ts

import { buildChannelHistoricalData, buildChannelForecast, type ChannelForecastRow } from "./channel-forecast-data";
import type { TargetRow } from "./o2-targets-cost";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Geen rijen: geen forecast, geen crash ──
assert(buildChannelHistoricalData("c1", [], { conversions: 0, revenue: 0, adSpend: 0 }, "2026-08-23") === null, "lege rijen leveren null op");
assert(buildChannelForecast("c1", [], [], "meta_ads", "2026-08-23") === null, "lege rijen leveren geen forecast op");

// ── Aggregatie: spend/conv/revenue van dezelfde maand tellen op, verdeeld over weken ──
function rij(date: string, spend: number, conv: number, revenue: number): ChannelForecastRow {
  return { date, spend, conv, revenue };
}
const rows: ChannelForecastRow[] = [
  ...Array.from({ length: 28 }, (_, i) => rij(`2025-08-${String(i + 1).padStart(2, "0")}`, 100, 2, 300)),
  // Juli 2026 is op peildatum 23 augustus de laatste AFGESLOTEN maand.
  ...Array.from({ length: 31 }, (_, i) => rij(`2026-07-${String(i + 1).padStart(2, "0")}`, 110, 3, 380)),
  // De lopende maand (augustus, 23 dagen): mag NIET als gerealiseerd meetellen.
  ...Array.from({ length: 23 }, (_, i) => rij(`2026-08-${String(i + 1).padStart(2, "0")}`, 120, 3, 400)),
];

const data = buildChannelHistoricalData("c1", rows, { conversions: 0, revenue: 0, adSpend: 0 }, "2026-08-23");
assert(data !== null, "met rijen levert het wel data op");
if (data) {
  assert(data.currentYear === 2026, "huidig jaar komt uit todayIso");
  const aug2025 = data.historicalYears[2025]?.find((m) => m.month === 8);
  assert(aug2025?.adSpend === 2800, `augustus 2025 telt spend op tot 2800 (kreeg ${aug2025?.adSpend})`);
  assert(aug2025?.conversions === 56, `augustus 2025 telt conversies op tot 56 (kreeg ${aug2025?.conversions})`);
  assert((aug2025?.weeks.reduce((s, w) => s + w.adSpend, 0) ?? 0) === 2800, "de weken van augustus 2025 tellen op tot dezelfde maandspend");

  // De herbouw van 1 sep 2026: de lopende (deel)maand telde als gerealiseerde eindstand en
  // drukte met het zwaarste recency-gewicht de jaarprognose. Nu telt alleen de afgesloten
  // maand; augustus (23/31 dagen) is null tot hij voorbij is.
  const jul2026 = data.currentYearData[6]; // index 6 = juli
  assert(jul2026?.adSpend === 3410, `juli 2026 (afgesloten) telt spend op tot 3410 (kreeg ${jul2026?.adSpend})`);
  assert(data.currentYearData[7] === null, "augustus 2026 is de lopende maand en telt niet als gerealiseerd");
  assert(data.currentYearData[8] === null, "september 2026 is nog niet gerealiseerd (null)");
  assert(data.currentYearData[0] === null, "januari 2026 heeft geen data en is null, niet nul-gevuld");
}

// ── Doel uit client_targets komt aan in targetCurrentYear ──
const targets: TargetRow[] = [
  { channel: "meta_ads", metric: "conversions", targetValue: 1000, validFrom: "2000-01-01", validTo: null },
  { channel: "meta_ads", metric: "spend", targetValue: 50000, validFrom: "2000-01-01", validTo: null },
  { channel: "google_ads", metric: "conversions", targetValue: 999999, validFrom: "2000-01-01", validTo: null },
];
const withTarget = buildChannelForecast("c1", rows, targets, "meta_ads", "2026-08-23");
assert(withTarget !== null, "forecast met doelen levert data op");
if (withTarget) {
  assert(withTarget.data.targetCurrentYear.conversions === 1000, `conversiedoel komt uit client_targets (kreeg ${withTarget.data.targetCurrentYear.conversions})`);
  assert(withTarget.data.targetCurrentYear.adSpend === 50000, `spenddoel komt uit client_targets (kreeg ${withTarget.data.targetCurrentYear.adSpend})`);
  // 24 augustus 2026: dit was "blijft 0". Zonder ingevoerd doel valt het jaardoel nu terug op het
  // laatst volledige jaar plus groei -- dezelfde regel die de Google-route en de blended historie
  // al toepasten (lib/analysis/standaard-jaardoel.ts). Het gat zat hier: met een doel van nul
  // spreidt toFairWeeks een verwachting van nul over de weken, en dan toont de beurs-sectie op
  // Meta en LinkedIn geen ratio terwijl dezelfde sectie op Google er wel een heeft.
  // 2025 in deze fixture: 28 dagen x 300 omzet = 8400, x 1,10 = 9240.
  assert(
    withTarget.data.targetCurrentYear.revenue === 9240,
    `geen omzetdoel ingesteld: terugval op vorig jaar +10% (kreeg ${withTarget.data.targetCurrentYear.revenue})`,
  );
  assert(withTarget.forecast.conversions.kpi.annualTarget === 1000, "de forecast zelf gebruikt hetzelfde doel");
}

// ── Geen vorig jaar: dan valt er ook niets terug te vallen ──
//
// Dit is de situatie van Meta en LinkedIn in de demo: hun dagdata begint pas in maart 2026. De
// terugval kan niets afleiden uit een jaar dat niet bestaat, en een verwachting verzinnen zou erger
// zijn dan geen verwachting tonen -- de beurs-sectie zegt in dat geval "geen jaardoel ingesteld".
const alleenDitJaar: ChannelForecastRow[] = Array.from({ length: 23 }, (_, i) =>
  rij(`2026-08-${String(i + 1).padStart(2, "0")}`, 120, 3, 400));
const zonderVorigJaar = buildChannelForecast("c1", alleenDitJaar, [], "meta_ads", "2026-08-23");
assert(zonderVorigJaar !== null, "alleen dit jaar levert nog steeds een forecast op");
if (zonderVorigJaar) {
  assert(zonderVorigJaar.data.targetCurrentYear.conversions === 0, "zonder vorig jaar geen conversiedoel");
  assert(zonderVorigJaar.data.targetCurrentYear.revenue === 0, "zonder vorig jaar geen omzetdoel");
  assert(zonderVorigJaar.data.targetCurrentYear.adSpend === 0, "zonder vorig jaar geen spenddoel");
}

// ── Zonder doel: het tempo is het dagtempo van de laatste AFGESLOTEN maand ──
//
// data2026 bevat alleen afgesloten maanden. Het tempo stond eerst op "de laatste vier weekbakken,
// zonder de laatste" -- dat liet na de merge de laatste AFGESLOTEN week vallen. Hier is dat de
// bak van 22 t/m 30 juni (9 dagen à 4), terwijl 1 t/m 21 juni 1 per dag liep. De oude regel nam
// alleen de drie bakken van 7 en kwam op 7 per week; het dagtempo van juni is 57/30 x 7 = 13,3.
const tempoRijen: ChannelForecastRow[] = Array.from({ length: 30 }, (_, i) =>
  rij(`2026-06-${String(i + 1).padStart(2, "0")}`, 100, i < 21 ? 1 : 4, 0));
const opTempo = buildChannelForecast("c1", tempoRijen, [], "meta_ads", "2026-07-20");
assert(opTempo !== null, "tempo-fixture levert een forecast op");
if (opTempo) {
  const conv = opTempo.forecast.conversions;
  assert(conv.kpi.annualTarget <= 0, `tempo-fixture verwacht geen doel (kreeg ${conv.kpi.annualTarget})`);
  const toekomstWeek = conv.weeklyPoints.find((w) => w.forecast !== null);
  assert(toekomstWeek?.forecast === 13, `weekprognose zonder doel = dagtempo juni x 7 = 13 (kreeg ${toekomstWeek?.forecast})`);
  const sept = conv.points.find((p) => p.month === 9);
  assert(sept?.forecast === Math.round((57 / 30) * 7 * (52 / 12)), `maandprognose = weektempo x 52/12 = 58 (kreeg ${sept?.forecast})`);
}

// ── De sync stopte halverwege een maand: gerealiseerd t/m de laatste VOLLE maand ──
//
// De vorm van de demo-Meta-reeks: dagdata van 13 maart t/m 26 augustus 2026, bekeken op
// 1 november. De oude regel ("t/m vorige kalendermaand", hier oktober) liet augustus, 26 van de 31
// dagen, als volle maand meetellen, met het zwaarste recency-gewicht in de prognose; de oude code
// gaf hier gerealiseerd t/m 8. Nu loopt de realisatie t/m juli (lib/sync/datastand.ts volleMaand)
// en wordt augustus geprojecteerd.
const gestopt: ChannelForecastRow[] = [];
for (let t = Date.UTC(2026, 2, 13); t <= Date.UTC(2026, 7, 26); t += 86_400_000) {
  gestopt.push(rij(new Date(t).toISOString().slice(0, 10), 10, 1, 0));
}
const gestoptData = buildChannelHistoricalData("c1", gestopt, { conversions: 0, revenue: 0, adSpend: 0 }, "2026-11-01");
assert(gestoptData !== null, "gestopte reeks levert data op");
if (gestoptData) {
  const gevuld = gestoptData.currentYearData.map((m, i) => (m !== null ? i + 1 : 0));
  const realizedThroughMonth = Math.max(...gevuld);
  assert(realizedThroughMonth === 7, `data t/m 26 aug op 1 nov: gerealiseerd t/m juli = 7 (kreeg ${realizedThroughMonth})`);
  assert(gestoptData.currentYearData[6]?.conversions === 31, `juli telt volledig mee: 31 (kreeg ${gestoptData.currentYearData[6]?.conversions})`);
  assert(gestoptData.currentYearData[7] === null, "augustus (26 van 31 dagen) telt NIET als gerealiseerd");
  assert(gestoptData.currentYearData[8] === null && gestoptData.currentYearData[9] === null,
    "september en oktober zijn geen gerealiseerde nullen");
  assert(gestoptData.currentYearData[2]?.conversions === 19, `maart telt vanaf de 13e: 19 (kreeg ${gestoptData.currentYearData[2]?.conversions})`);
}
const gestoptForecast = buildChannelForecast("c1", gestopt, [], "meta_ads", "2026-11-01");
assert(gestoptForecast !== null, "gestopte reeks levert een forecast op");
if (gestoptForecast) {
  const conv = gestoptForecast.forecast.conversions;
  const aug = conv.points[7];
  assert(aug?.realized === null, `augustus heeft in de prognose geen realisatie (kreeg ${aug?.realized})`);
  // Samen met de grens in lib/forecast.ts (de LAATSTE gerealiseerde maand, niet het aantal
  // niet-lege): 13-31 mrt (19) + apr (30) + mei (31) + jun (30) + jul (31) = 141. HEAD gaf 110
  // (mrt-jun): de reeks [null, null, mrt..aug] heeft 6 niet-lege maanden, en slice(0, 6) sneed
  // juli en augustus weg -- in de demo-Meta YTD 660 in plaats van 1.002.
  assert(Math.round(conv.kpi.ytdRealized) === 141, `YTD = 13 maart t/m 31 juli = 141 (kreeg ${conv.kpi.ytdRealized})`);
  assert(conv.points[0]?.realized === null && conv.points[0]?.forecast === null,
    `januari (kanaal liep nog niet) krijgt geen prognose (kreeg ${JSON.stringify(conv.points[0])})`);
}
// Een dag die op 31 augustus valt maakt augustus wel vol.
const totEindAug = [...gestopt, ...[27, 28, 29, 30, 31].map((d) => rij(`2026-08-${d}`, 10, 1, 0))];
const volAug = buildChannelHistoricalData("c1", totEindAug, { conversions: 0, revenue: 0, adSpend: 0 }, "2026-11-01");
assert(volAug?.currentYearData[7]?.conversions === 31, `data t/m 31 aug: augustus telt volledig (kreeg ${volAug?.currentYearData[7]?.conversions})`);
assert(volAug?.currentYearData[8] === null, "en september blijft leeg, niet nul");
// Een kanaal dat vorig jaar stopte: dit jaar is niets gerealiseerd.
const vorigJaarGestopt = buildChannelHistoricalData("c1", [rij("2025-12-31", 10, 1, 0)], { conversions: 0, revenue: 0, adSpend: 0 }, "2026-11-01");
assert(vorigJaarGestopt?.currentYearData.every((m) => m === null) === true, "data t/m vorig jaar: dit jaar niets gerealiseerd");

// ── Gepauzeerd met een gezonde sync: dezelfde stopregel als "Alle kanalen" ──
//
// Meta liep 2 conversies per dag t/m 15 augustus 2026 en ligt sindsdien stil; de sync draait, dus
// de route meet t/m 31 oktober (september en oktober zijn gemeten nullen). "Alle kanalen" telt zo'n
// kanaal na zijn laatste data als nul (kanaalGestopt in lib/forecast-som.ts); de tab projecteerde
// november en december op het oude tempo (55 en 57), en dan stonden er twee jaarprognoses voor
// hetzelfde kanaal op één dashboard: 566 hier, 454 in de som.
{
  const stil: ChannelForecastRow[] = [];
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2026, 7, 15); t += 86_400_000) stil.push(rij(new Date(t).toISOString().slice(0, 10), 10, 2, 0));
  const f = buildChannelForecast("c1", stil, [], "meta_ads", "2026-11-01", "2026-10-31");
  const c = f?.forecast.conversions;
  assert(c?.kpi.realizedThroughMonth === 10, `gepauzeerd: gerealiseerd t/m oktober (kreeg ${c?.kpi.realizedThroughMonth})`);
  assert(c?.points[10].forecast === 0 && c?.points[11].forecast === 0, `gepauzeerd: november en december 0, niet het oude tempo (kreeg ${c?.points[10].forecast}/${c?.points[11].forecast})`);
  assert(c !== undefined && Math.round(c.kpi.adjustedAnnual) === Math.round(c.kpi.ytdRealized) && Math.round(c.kpi.adjustedAnnual) === 454,
    `gepauzeerd: de jaarprognose is wat er gerealiseerd is, 454 (kreeg ${c?.kpi.adjustedAnnual})`);
  assert(f?.forecast.adSpend.points[11].forecast === 0, "gepauzeerd: ook geen spend meer");
  // Een CPA van nul kosten op nul conversies is geen CPA van € 0 (dat kleurt groen).
  assert(f?.forecast.cpa.points[11].forecast === null, `gepauzeerd: geen CPA-prognose voor december (kreeg ${f?.forecast.cpa.points[11].forecast})`);

  // Een seizoenspauze is geen stop: LinkedIn liep vorig jaar ook niet van april t/m september.
  const seizoen: ChannelForecastRow[] = [];
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2026, 2, 31); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const m = Number(d.slice(5, 7));
    if (m <= 3 || m >= 10) seizoen.push(rij(d, 10, 2, 0));
  }
  const s = buildChannelForecast("c1", seizoen, [], "linkedin_ads", "2026-10-15", "2026-10-14");
  assert((s?.forecast.conversions.points[10].forecast ?? 0) > 0, `seizoenspauze: november wordt geprojecteerd (kreeg ${s?.forecast.conversions.points[10].forecast})`);
}

// ── De rij van de syncdag is een deel van die dag ──
//
// Meta slaagde voor het laatst op 31 oktober om 05:00 UTC (daarna faalt de sync); de rij van
// 31 oktober is dus zo'n zes uur. De route zegt t/m 30 oktober (dataTotVanDagbron). Hier won de
// LAATSTE van de rij en de routedag, en bleef oktober een gerealiseerde maand: met een 31e van zes
// uur erin, en zonder dat de rest van die dag ooit geprojecteerd werd.
{
  const totSyncdag: ChannelForecastRow[] = [];
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 9, 31); t += 86_400_000) totSyncdag.push(rij(new Date(t).toISOString().slice(0, 10), 100, 1, 0));
  const d = buildChannelHistoricalData("c1", totSyncdag, { conversions: 0, revenue: 0, adSpend: 0 }, "2026-11-03", "2026-10-30");
  assert(d?.currentYearData[8]?.adSpend === 3000, `syncdag-rij: september gerealiseerd (kreeg ${JSON.stringify(d?.currentYearData[8])})`);
  assert(d?.currentYearData[9] === null, `syncdag-rij: oktober (t/m 30 gemeten) telt NIET als gerealiseerd (kreeg ${JSON.stringify(d?.currentYearData[9])})`);
  const f = buildChannelForecast("c1", totSyncdag, [], "meta_ads", "2026-11-03", "2026-10-30");
  assert(f?.forecast.conversions.kpi.realizedThroughMonth === 9, `syncdag-rij: gerealiseerd t/m september (kreeg ${f?.forecast.conversions.kpi.realizedThroughMonth})`);
  // Zonder routedag (de route faalde): de rijen, zoals voorheen.
  const zonder = buildChannelHistoricalData("c1", totSyncdag, { conversions: 0, revenue: 0, adSpend: 0 }, "2026-11-03");
  assert(zonder?.currentYearData[9]?.adSpend === 3100, `zonder routedag: oktober uit de rijen (kreeg ${JSON.stringify(zonder?.currentYearData[9])})`);
}

// ── De partiële eerste maand als laatste gerealiseerde: het tempo over de dagen dat het liep ──
//
// Meta sinds 20 juli 2026, 40 conversies in 12 dagen (en verder in augustus). Zonder doel nam het
// tempo juli gedeeld door 31 dagen: 39 per maand, waar het 103 is.
{
  const laat: ChannelForecastRow[] = [];
  for (let t = Date.UTC(2026, 6, 20); t <= Date.UTC(2026, 7, 26); t += 86_400_000) laat.push(rij(new Date(t).toISOString().slice(0, 10), 10, 40 / 12, 0));
  const f = buildChannelForecast("c1", laat, [], "meta_ads", "2026-11-01", "2026-08-26");
  const c = f?.forecast.conversions;
  assert(c?.kpi.realizedThroughMonth === 7 && Math.round(c.points[6].realized ?? 0) === 40, `start 20 juli: juli gerealiseerd met 40 (kreeg ${c?.points[6].realized})`);
  assert(c?.points.slice(7).every((p) => p.forecast === 101) === true, `start 20 juli: augustus-december op 40 / 12 dagen, 101 per maand (kreeg ${c?.points.slice(7).map((p) => p.forecast).join("/")})`);
}

// ── Terug na een pauze, midden in de laatste gerealiseerde maand: hetzelfde tempo ──
//
// Meta januari-maart, april-juni stil, terug op 20 juli: 12 conversies in 12 dagen. De eerste dag
// OOIT (1 januari) viel niet in juli, dus spreidde het tempo die 12 over 31 dagen: 12 per maand
// voor augustus-december, waar hij 30 doet. Een kanaal dat op 20 juli voor het eerst begon, gaf 30.
{
  const terug: ChannelForecastRow[] = [];
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 7, 25); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d < "2026-04-01" || d >= "2026-07-20") terug.push(rij(d, 10, 1, 0));
  }
  const f = buildChannelForecast("c1", terug, [], "meta_ads", "2026-11-01", "2026-08-25");
  assert(f?.data.eersteDag === "2026-07-20", `terug op 20 juli: de eerste dag van de huidige loop (kreeg ${f?.data.eersteDag})`);
  const c = f?.forecast.conversions;
  assert(c?.points.slice(7).every((p) => p.forecast !== null && Math.round(p.forecast) === 30) === true, `terug op 20 juli: augustus-december op 12 / 12 dagen, 30 per maand (kreeg ${c?.points.slice(7).map((p) => p.forecast).join("/")})`);
}

// ── Dagrijen per maand, voor de gevallen hieronder ──
const dagen = (van: string, tot: string, perMaand: (maand: string) => number, spendPerConv = 10): ChannelForecastRow[] => {
  const uit: ChannelForecastRow[] = [];
  for (let t = Date.parse(`${van}T00:00:00Z`); t <= Date.parse(`${tot}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const dim = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
    const c = perMaand(d.slice(0, 7)) / dim;
    uit.push(rij(d, c * spendPerConv, c, c * 100));
  }
  return uit;
};

// ── Een gat van vóór de start is geen seizoenspauze (kanaalGestopt) ──
//
// LinkedIn 60 per maand van november 2025 t/m maart 2026, daarna niets; de sync is gezond t/m
// 31 oktober. April-oktober 2025 lagen vóór zijn start en lazen als "vorig jaar ook leeg": de tab
// projecteerde november en december (246 voor het jaar), waar het kanaal sinds maart stil ligt.
{
  const li = dagen("2025-11-01", "2026-03-31", () => 60);
  const f = buildChannelForecast("c1", li, [], "linkedin_ads", "2026-11-01", "2026-10-31");
  const c = f?.forecast.conversions;
  assert(Math.round(c?.kpi.adjustedAnnual ?? -1) === 180, `gat vóór de start: het jaar is januari-maart, 180 (kreeg ${c?.kpi.adjustedAnnual})`);
  assert(c?.points.slice(10).every((p) => p.forecast === 0) === true, `gat vóór de start: november-december 0 (kreeg ${c?.points.slice(10).map((p) => p.forecast).join("/")})`);
}

// ── Nieuwste rij eerst (zoals de provider leest): de weken blijven in kalendervolgorde ──
//
// channel-data-provider.tsx leest `order date desc`. aggregateByYear bouwde de weken in de volgorde
// van binnenkomst (W5, W4 .. W1), en de forecast leest ze op POSITIE: de gerealiseerde weken van
// juli stonden omgekeerd (de drie dagen van W5 vooraan) en de weekverdeling van elke prognosemaand
// ook, waardoor de beursstrip de korte week in de verkeerde week zette.
{
  const oplopend = dagen("2025-01-01", "2026-08-25", () => 31).map((r) => ({ ...r }));
  const aflopend = [...oplopend].reverse();
  const op = buildChannelForecast("c1", oplopend, [], "meta_ads", "2026-11-01", "2026-08-25");
  const af = buildChannelForecast("c1", aflopend, [], "meta_ads", "2026-11-01", "2026-08-25");
  const juli = af?.data.currentYearData[6]?.weeks.map((w) => w.week).join(",");
  assert(juli === "1,2,3,4,5", `aflopende rijen: de weken van juli op volgorde (kreeg ${juli})`);
  const sep25 = af?.data.historicalYears[2025]?.find((m) => m.month === 9)?.weeks.map((w) => w.week).join(",");
  assert(sep25 === "1,2,3,4", `aflopende rijen: de weken van september 2025 op volgorde (kreeg ${sep25})`);
  const reeks = (f: typeof op) => f?.forecast.conversions.weeklyPoints.map((w) => `${w.realized === null ? "-" : Math.round(w.realized * 10)}/${w.forecast === null ? "-" : Math.round(w.forecast * 10)}`).join(" ");
  assert(reeks(af) === reeks(op), `aflopende rijen: dezelfde weekreeks als oplopende (kreeg\n    ${reeks(af)}\n  tegen ${reeks(op)})`);
  const w5 = af?.forecast.conversions.weeklyPoints.find((w) => w.month === 7 && w.week === 5)?.realized;
  assert(w5 !== undefined && w5 !== null && Math.round(w5) === 3, `aflopende rijen: W5 van juli is 29-31 juli, 3 dagen (kreeg ${w5})`);
}

// ── Een maand met een lege week: elke week op zijn eigen plek ──
//
// De forecast leest de weken op POSITIE (weeks[w] is W(w+1)), maar aggregateByYear maakte alleen
// emmers voor dagen met rijen. Meta begon op 13 maart: maart had [wk2..wk5], en dan stonden de
// cijfers van 13-14 maart onder "W1 Mrt", die van 29-31 maart onder W4, en ontbrak W5. Op de demo
// zette de beursstrip zo 23 gerealiseerde conversies in de week vóór de start.
{
  const meta = dagen("2026-03-13", "2026-04-19", () => 31, 10).map((r) => ({ ...r, conv: 1, spend: 10, revenue: 100 }));
  const f = buildChannelForecast("c1", [...meta].reverse(), [], "meta_ads", "2026-04-20", "2026-04-19");
  const maart = f?.forecast.conversions.weeklyPoints.filter((w) => w.month === 3).map((w) => `${w.label}=${w.realized === null ? "-" : Math.round(w.realized)}`).join(" ");
  assert(maart === "W1 Mrt=0 W2 Mrt=2 W3 Mrt=7 W4 Mrt=7 W5 Mrt=3",
    `start op 13 maart: W1 leeg, 13-14 maart in W2, 29-31 maart in W5 (kreeg ${maart})`);
  const weken = f?.data.currentYearData[2]?.weeks.map((w) => w.week).join(",");
  assert(weken === "1,2,3,4,5", `start op 13 maart: maart heeft al zijn vijf weken (kreeg ${weken})`);
  assert(f?.data.currentYearData[2]?.conversions === 19, `het maandtotaal blijft 19 (kreeg ${f?.data.currentYearData[2]?.conversions})`);

  // En een gestarte maand in de HISTORIE is geen weekpatroon. Microsoft begon op 23 juli 2025; met
  // alleen [wk4, wk5] in die juli kreeg de juli-prognose van 2026 twee weken (W1 en W2, op de vorm
  // van 22-28 en 29-31 juli), en met die weken opgevuld met nullen kregen de eerste drie weken een
  // prognose van nul. Het kanaal liep toen nog niet: dan de gelijke verdeling.
  const ms = dagen("2025-07-23", "2026-05-31", () => 31, 10).map((r) => ({ ...r, conv: 1, spend: 10, revenue: 100 }));
  const fm = buildChannelForecast("c1", [...ms].reverse(), [], "microsoft_ads", "2026-06-15", "2026-05-31");
  const juli = fm?.forecast.conversions.weeklyPoints.filter((w) => w.month === 7) ?? [];
  assert(juli.length === 5, `juli 2026 heeft vijf prognoseweken (kreeg ${juli.length}: ${juli.map((w) => w.label).join(", ")})`);
  const fc = juli.map((w) => w.forecast ?? 0), ex = juli.map((w) => w.expected);
  assert(fc.every((x) => x > 0) && Math.max(...fc) - Math.min(...fc) <= 1, `de juli-prognose gelijk over de weken, geen nulweken (kreeg ${fc.join("/")})`);
  assert(Math.max(...ex) - Math.min(...ex) <= 1, `de juli-verwachting ook (kreeg ${ex.join("/")})`);
}

// Zonder doel: computeForecast valt terug op het historisch totaal (zelfde gedrag als Google).
const withoutTarget = buildChannelForecast("c1", rows, [], "meta_ads", "2026-08-23");
assert(withoutTarget !== null, "forecast zonder doelen levert nog steeds data op");
if (withoutTarget) {
  assert(withoutTarget.forecast.conversions.kpi.annualTarget > 0, "zonder ingesteld doel valt de forecast terug op het historisch totaal, niet op 0");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

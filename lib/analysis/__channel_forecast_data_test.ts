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

// Zonder doel: computeForecast valt terug op het historisch totaal (zelfde gedrag als Google).
const withoutTarget = buildChannelForecast("c1", rows, [], "meta_ads", "2026-08-23");
assert(withoutTarget !== null, "forecast zonder doelen levert nog steeds data op");
if (withoutTarget) {
  assert(withoutTarget.forecast.conversions.kpi.annualTarget > 0, "zonder ingesteld doel valt de forecast terug op het historisch totaal, niet op 0");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

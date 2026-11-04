// Test voor de weken-tot-beurs-tijdas. Deterministisch, geen IO.
// Draaien: npx tsx lib/fair/__fair_weeks_test.ts

import type { WeeklyPoint } from "@/lib/forecast";
import {
  selectUpcomingEdition,
  weeksToFair,
  fairWeekLabel,
  nthMondayOfMonth,
  toFairWeeks,
  currentWeekIndex,
  type FairEventCfg,
} from "./fair-weeks";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Weken tot de beurs ──
assert(weeksToFair("2026-06-10", "2026-06-10") === 0, "op de beursdag is het 0 weken");
assert(weeksToFair("2026-06-10", "2026-06-08") === 0, "twee dagen ervoor is nog dezelfde week");
assert(weeksToFair("2026-06-10", "2026-06-03") === 1, "zeven dagen ervoor is 1 week");
// Kalenderweken, net als de strook: een beurs op woensdag 10 juni valt in de week van maandag 8 juni.
assert(weeksToFair("2026-06-10", "2026-06-07") === 1, "de zondag voor de beursweek is W-1, ook al is het maar drie dagen");
assert(weeksToFair("2026-06-10", "2026-05-28") === 2, "donderdag 28 mei ligt in de kalenderweek van 25 mei: W-2, net als de strook");
assert(weeksToFair("2026-06-10", "2026-05-27") === 2, "veertien dagen ervoor is 2 weken");
assert(weeksToFair("2026-06-10", "2026-06-17") === -1, "een week erna is negatief");
assert(weeksToFair("kapot", "2026-06-03") === null, "een ongeldige datum geeft null");

assert(fairWeekLabel(14) === "W-14", "veertien weken voor de beurs heet W-14");
assert(fairWeekLabel(0) === "beurs", "de beursweek heet beurs");
assert(fairWeekLabel(-2) === "W+2", "twee weken erna heet W+2");

// ── De n-de maandag van een maand ──
// Juli 2026 begint op een woensdag; de eerste maandag is 6 juli.
assert(nthMondayOfMonth(2026, 7, 1) === "2026-07-06", "eerste maandag van juli 2026 is de 6e");
assert(nthMondayOfMonth(2026, 7, 4) === "2026-07-27", "vierde maandag van juli 2026 is de 27e");
// Juni 2026 begint zelf op een maandag.
assert(nthMondayOfMonth(2026, 6, 1) === "2026-06-01", "begint de maand op maandag, dan is dat de eerste");
// Februari 2026 heeft vier maandagen; een gevraagde vijfde rolt door naar maart.
assert(nthMondayOfMonth(2026, 2, 5) === "2026-03-02", "een vijfde maandag die niet bestaat rolt door naar de maand erna");
assert(nthMondayOfMonth(2026, 13, 1) === null, "een onmogelijke maand geeft null");
assert(nthMondayOfMonth(2026, 7, 0) === null, "een week-index onder 1 geeft null");

// ── De eerstvolgende editie ──
const jaarlijks: FairEventCfg = {
  id: "grt", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual",
  editions: [{ date: "2025-06-11", label: "2025" }, { date: "2026-06-10", label: "2026" }],
};

const nogTeGaan = selectUpcomingEdition([jaarlijks], "2026-04-01");
assert(nogTeGaan?.fairDate === "2026-06-10", "een editie die nog moet komen wordt gekozen");
assert(nogTeGaan?.afgeleid === false, "een geconfigureerde datum is niet afgeleid");
assert(nogTeGaan?.previousFairDate === "2025-06-11", "de editie ervoor is het ijkpunt");

// Alles achter de rug: doorrekenen uit de cadans, en dat eerlijk markeren.
const doorgerekend = selectUpcomingEdition([jaarlijks], "2026-07-28");
assert(doorgerekend?.fairDate === "2027-06-10", "zonder toekomstige editie rekent de jaarcadans een jaar door");
assert(doorgerekend?.afgeleid === true, "een doorgerekende datum is gemarkeerd als afgeleid");
assert(doorgerekend?.previousFairDate === "2026-06-10", "de laatst gehouden editie blijft het ijkpunt");

const tweejaarlijks: FairEventCfg = { id: "x", name: "X", abbrev: "X", cadence: "biennial", editions: [{ date: "2024-03-05", label: "2024" }] };
assert(selectUpcomingEdition([tweejaarlijks], "2026-07-28")?.fairDate === "2028-03-05", "de 2-jaarlijkse cadans stapt met twee jaar tegelijk");

const zonderCadans: FairEventCfg = { id: "y", name: "Y", abbrev: "Y", cadence: "custom", editions: [{ date: "2024-03-05", label: "2024" }] };
assert(selectUpcomingEdition([zonderCadans], "2026-07-28") === null, "zonder bekende cadans wordt er geen datum verzonnen");
assert(selectUpcomingEdition([], "2026-07-28") === null, "geen beurzen geeft null");
assert(selectUpcomingEdition([{ id: "z", name: "Z", cadence: "annual", editions: [] }], "2026-07-28") === null, "een beurs zonder edities geeft null");

// Twee beurzen: de vroegste eerstvolgende wint.
const later: FairEventCfg = { id: "gra", name: "GreenTech Americas", abbrev: "GRA", cadence: "annual", editions: [{ date: "2026-11-04", label: "2026" }] };
const vroeger: FairEventCfg = { id: "grt2", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [{ date: "2026-09-02", label: "2026" }] };
assert(selectUpcomingEdition([later, vroeger], "2026-07-28")?.abbrev === "GRT", "van twee beurzen wint de eerstvolgende");

// De cadans reist mee met de editie: de periodekiezer waarschuwt alleen bij een jaarlijkse editie
// dat "voorgaande periode" de aanloop met de nasleep vergelijkt, en kon dat zonder dit veld niet weten.
const demoGrt: FairEventCfg = { id: "demo-grt", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [{ date: "2026-06-11", label: "2026" }, { date: "2027-06-10", label: "2027" }] };
const demoGrn: FairEventCfg = { id: "demo-grn", name: "GreenTech North America", abbrev: "GRN", cadence: "custom", editions: [{ date: "2026-11-04", label: "2026" }] };
assert(selectUpcomingEdition([demoGrt, demoGrn], "2026-11-05")?.cadence === "annual", "de editie draagt de cadans van zijn event mee (jaarlijks)");
assert(selectUpcomingEdition([demoGrt, demoGrn], "2026-11-01")?.cadence === "custom", "een eenmalige beurs zegt dat ook");
assert(selectUpcomingEdition([{ ...demoGrt, editions: [{ date: "2025-06-12", label: "2025" }] }], "2026-11-01")?.cadence === "annual", "ook een doorgerekende editie draagt de cadans");
assert(selectUpcomingEdition([{ id: "q", name: "Q", editions: [{ date: "2027-01-01", label: "2027" }] }], "2026-11-01")?.cadence === null, "zonder ingestelde cadans: null, niet verzonnen");

// ── Weekpunten omzetten ──
function wp(month: number, week: number, o: Partial<WeeklyPoint> = {}): WeeklyPoint {
  return { month, week, label: `W${week}`, expected: 100, realized: null, forecast: 80, ...o };
}

// Juli 2026: maandagen op 6, 13, 20, 27. Beurs op 2026-09-02.
const weken = toFairWeeks([wp(7, 1, { realized: 120, forecast: null }), wp(7, 2), wp(7, 3), wp(7, 4)], 2026, "2026-09-02");
assert(weken.length === 4, "vier weekpunten geven vier weken");
assert(weken[0].weekStart === "2026-07-06", "de eerste week begint op de eerste maandag");
assert(weken[0].weeksOut === 8, "6 juli is acht weken voor 2 september");
assert(weken[3].weeksOut === 5, "27 juli is vijf weken voor 2 september");
assert(weken[0].label === "W-8", "het label volgt de weken-tot-beurs");
assert(weken[0].monthLabel === "Jul", "de kalendermaand blijft zichtbaar als bijschrift");
assert(weken[0].realized === 120 && weken[1].realized === null, "gerealiseerd en prognose blijven onderscheiden");
assert(weken.every((w, i) => i === 0 || weken[i - 1].weekStart < w.weekStart), "de weken staan op datum gesorteerd");

// Een maand met een verzonnen vijfde week botste met de eerste week van de maand erna. Nu krijgt
// elke maand zijn eigen maandagen van de kalender, en botst er niets meer.
const metDubbel = toFairWeeks([wp(2, 5), wp(3, 1)], 2026, "2026-09-02");
assert(new Set(metDubbel.map((w) => w.weekStart)).size === metDubbel.length, "geen enkele maandag komt twee keer voor");
assert(metDubbel.length === 4 + 5, "februari 2026 krijgt zijn vier maandagen, maart zijn vijf");

// ── Prognosemaanden naar dagen, uit de maandpunten ──
// Zonder doel geeft computeForecast elke weekemmer het weektempo (42) en elke maand het tempo
// x 52/12 (182): oktober 2026 vijf emmers (210) op vier maandagen, november vier (168) op vijf.
// Gelijk over de maandagen verdeeld werd dat 52 per week in oktober en 34 in november, bij een
// tempo dat niet verandert; op de Meta-tab stond "Vorige week 52, Deze week 34". Met de
// maandpunten erbij gaat de maandprognose naar dagen: elke week zeven dagen op het tempo van de
// maand waarin die dagen vallen.
{
  const prognose = (month: number, n: number, v: number) =>
    Array.from({ length: n }, (_, i) => wp(month, i + 1, { expected: 0, forecast: v }));
  const maanden = (per: Record<number, number>) =>
    Object.entries(per).map(([m, v]) => ({ month: Number(m), expected: Math.round(v * 0.9), realized: null, forecast: v }));
  const emmers = [...prognose(10, 5, 42), ...prognose(11, 4, 42), ...prognose(12, 5, 42)];
  const vlak = toFairWeeks(emmers, 2026, "2026-11-04", { maanden: maanden({ 10: 182, 11: 182, 12: 182 }) });
  const w = vlak.map((x) => x.forecast ?? NaN);
  assert(vlak.length === 4 + 5 + 4, "oktober vier, november vijf, december vier maandagen");
  assert(w.every((v) => v >= 41 && v <= 43), `een vlak tempo blijft vlak over de maandgrens (${w.join(" ")})`);
  assert(w.every((v, i) => i === 0 || Math.abs(v - w[i - 1]) <= 1), "geen sprong tussen twee weken");
  // Opgeteld: de dagen van 5 oktober t/m 3 januari (de week van 28 december loopt het jaar uit op
  // het tempo van december): 27 x 182/31 + 182 + 182 + 3 x 182/31 = 540, op afronding per week na.
  const som = w.reduce((s, v) => s + v, 0);
  assert(Math.abs(som - 540) <= 7, `de weken tellen op tot hun dagen (${som})`);
  assert(vlak.every((x) => x.realized === null), "een prognosemaand heeft geen gerealiseerde weken");
  const verwacht = vlak.map((x) => x.expected);
  assert(verwacht.every((v) => v >= 36 && v <= 38), `de verwachting per week gaat ook naar dagen (${verwacht.join(" ")})`);

  // "Alle kanalen": emmers die wél optellen tot de maand (466 over vijf, 451 over vier), maar vier
  // tegen vijf maandagen gaf 116 tegen 90 bij maanden die 3% verschillen.
  const samen = toFairWeeks([...prognose(10, 5, 93), ...prognose(11, 4, 113)], 2026, "2026-11-04", { maanden: maanden({ 10: 466, 11: 451 }) });
  const ws = samen.map((x) => x.forecast ?? NaN);
  assert(Math.max(...ws) - Math.min(...ws) <= 2, `maanden die 3% verschillen geven weken die hooguit 2 verschillen (${ws.join(" ")})`);

  // Een gerealiseerde maand houdt zijn emmers: dat zijn gemeten weken, ook met maandpunten erbij.
  const gemeten = [wp(7, 1, { realized: 120, forecast: null }), wp(7, 2, { realized: 80, forecast: null }), wp(7, 3, { realized: 90, forecast: null }), wp(7, 4, { realized: 110, forecast: null })];
  const juli = toFairWeeks(gemeten, 2026, "2026-09-02", { maanden: [{ month: 7, expected: 400, realized: 400, forecast: null }] });
  assert(juli.map((x) => x.realized).join(",") === "120,80,90,110", "gerealiseerde emmers blijven per maandag staan");
  // Zonder maandpunt voor de maand: zoals voorheen (de emmersom over de maandagen).
  const zonderPunt = toFairWeeks(prognose(10, 5, 42), 2026, "2026-11-04", { maanden: [] });
  assert(zonderPunt.map((x) => x.forecast).join(",") === "53,52,53,52", "zonder maandpunt de oude verdeling van de emmersom");
  // Een verhouding (ROAS, CPA) laat de maandpunten links liggen: die weken dragen de verhouding.
  const cpaPts = [wp(10, 1, { forecast: 50 }), wp(10, 2, { forecast: 50 }), wp(10, 3, { forecast: 50 }), wp(10, 4, { forecast: 50 }), wp(10, 5, { forecast: 50 })];
  const verhouding = { teller: prognose(10, 5, 100), noemer: prognose(10, 5, 2) };
  const metPunt = toFairWeeks(cpaPts, 2026, "2026-11-04", { additief: false, verhouding, maanden: maanden({ 10: 50 }) });
  const zonder = toFairWeeks(cpaPts, 2026, "2026-11-04", { additief: false, verhouding });
  assert(JSON.stringify(metPunt) === JSON.stringify(zonder), "een verhouding verandert niet door de maandpunten");
}

// ── Het ankerpunt "nu" ──
assert(currentWeekIndex(weken, "2026-07-22") === 2, "vandaag valt in de week die op of voor vandaag begon");
assert(currentWeekIndex(weken, "2026-07-06") === 0, "op de maandag zelf is dat die week");
assert(currentWeekIndex(weken, "2026-01-01") === 0, "voor de eerste week ankeren we op de eerste");
assert(currentWeekIndex(weken, "2026-12-31") === 3, "na de laatste week ankeren we op de laatste");
assert(currentWeekIndex([], "2026-07-22") === -1, "zonder weken is er geen anker");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

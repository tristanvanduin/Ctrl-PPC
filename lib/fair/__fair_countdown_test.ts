// Regressietest stap 0 / item C: de weekstrook miste W+4, de aftellingen spraken elkaar tegen,
// en een beurs verdween de dag na afloop van het scherm (geen nasleep, geen ?geo=).
// Deterministisch, geen IO (op de bronbewaking van de hook onderaan na, die het bestand leest).
// Draaien: tsx lib/fair/__fair_countdown_test.ts
import { readFileSync } from "node:fs";
import type { WeeklyPoint } from "@/lib/forecast";
import * as fw from "./fair-weeks";
import type { FairEventCfg } from "./fair-weeks";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function check(label: string, f: () => boolean): void {
  try { assert(f(), label); } catch (e) { assert(false, `${label} (gooide: ${(e as Error).message})`); }
}

// ── 1. De strook heeft geen gaten: elke maandag precies één keer ──
// Het blended/kanaalraster: vijf emmers voor 31-dagenmaanden, vier voor de rest (zoals
// generateEvenWeeks en channel-forecast-data's weeksInMonth). Waarde 100 per emmer, alles prognose.
const VIJF = [1, 3, 5, 7, 8, 10, 12];
const raster: WeeklyPoint[] = [];
for (let m = 1; m <= 12; m++) {
  const n = VIJF.includes(m) ? 5 : 4;
  for (let w = 1; w <= n; w++) raster.push({ month: m, week: w, label: `W${w}`, expected: 100, realized: null, forecast: 100 });
}
const BEURS = "2026-11-04"; // woensdag; GreenTech North America in de demo
const weken = fw.toFairWeeks(raster, 2026, BEURS);
const labels = weken.map((w) => w.label);
check("W+4 staat in de strook (30 november 2026)", () => weken.some((w) => w.label === "W+4" && w.weekStart === "2026-11-30"));
check("geen gat tussen opeenvolgende weken", () => weken.every((w, i) => i === 0 || (Date.parse(w.weekStart) - Date.parse(weken[i - 1].weekStart)) === 7 * 86400000));
check("2026 heeft 52 maandagen en de strook ook", () => weken.length === 52);
check("W+3, W+4, W+5 volgen elkaar op", () => labels.join(" ").includes("W+3 W+4 W+5"));
check("geen enkele maandag komt twee keer voor", () => new Set(weken.map((w) => w.weekStart)).size === weken.length);
// De beursweek hoort bij november, niet bij oktobers vijfde emmer. November: 4 emmers x 100 = 400
// over 5 maandagen = 80 per week; oktober: 5 x 100 = 500 over 4 maandagen = 125.
check("de beursweek (2 nov) draagt novembers waarde, niet die van oktober", () => weken.find((w) => w.weekStart === "2026-11-02")?.forecast === 80);
check("de beursweek heet 'beurs' en ligt in november", () => { const b = weken.find((w) => w.weeksOut === 0); return b?.weekStart === "2026-11-02" && b.label === "beurs" && b.monthLabel === "Nov"; });
check("het maandtotaal van november blijft 400", () => weken.filter((w) => w.weekStart.slice(5, 7) === "11").reduce((s, w) => s + (w.forecast ?? 0), 0) === 400);
check("het maandtotaal van oktober blijft 500", () => weken.filter((w) => w.weekStart.slice(5, 7) === "10").reduce((s, w) => s + (w.forecast ?? 0), 0) === 500);
check("de verwachting van november blijft 400 in totaal", () => weken.filter((w) => w.weekStart.slice(5, 7) === "11").reduce((s, w) => s + w.expected, 0) === 400);
// Een maandtotaal dat niet deelbaar is: in hele weken, en de som blijft exact.
const oneven = fw.toFairWeeks([1, 2, 3, 4].map((w) => ({ month: 11, week: w, label: `W${w}`, expected: 100, realized: null, forecast: w === 1 ? 101 : 100 })), 2026, BEURS);
check("een ondeelbaar maandtotaal (401 over 5 weken) blijft exact 401, in hele getallen", () =>
  oneven.length === 5 && oneven.reduce((s, w) => s + (w.forecast ?? 0), 0) === 401 && oneven.every((w) => Number.isInteger(w.forecast)));
// Een verhouding (CPA/ROAS) wordt niet opgeteld maar gemiddeld.
const ratio = fw.toFairWeeks(raster.map((p) => ({ ...p, expected: 2.5, forecast: 2.5 })), 2026, BEURS, { additief: false });
check("een verhouding houdt zijn waarde bij herverdeling", () => ratio.find((w) => w.weekStart === "2026-11-30")?.forecast === 2.5);
check("een verhouding houdt ook zijn verwachting", () => ratio.find((w) => w.weekStart === "2026-11-30")?.expected === 2.5);
// Het Google-demoraster (altijd vier emmers) mist in 2026 ook 30 maart, 29 juni en 31 augustus.
const vier: WeeklyPoint[] = [];
for (let m = 1; m <= 12; m++) for (let w = 1; w <= 4; w++) vier.push({ month: m, week: w, label: `W${w}`, expected: 10, realized: 10, forecast: null });
check("ook met vier emmers per maand: 52 weken, geen gat", () => fw.toFairWeeks(vier, 2026, BEURS).length === 52);
// Gerealiseerd blijft gerealiseerd: een volledig gerealiseerde maand houdt dat etiket.
check("31 augustus (W-9) is gerealiseerd met augustus' waarde", () => fw.toFairWeeks(vier, 2026, BEURS).find((w) => w.weekStart === "2026-08-31")?.realized === 8);
// Het kanaalpad: oktober gerealiseerd in vijf emmers, november nog prognose. De vijfde
// oktoberemmer (29-31 okt) rolde naar 2 november en stond daar als 'gerealiseerd' in een week die
// nog moest komen.
const kanaal: WeeklyPoint[] = raster.map((p) => (p.month <= 10 ? { ...p, realized: 9, forecast: null } : p));
check("de beursweek is op het kanaalpad geen 'gerealiseerd' meer met oktoberdata", () => {
  const b = fw.toFairWeeks(kanaal, 2026, BEURS).find((w) => w.weekStart === "2026-11-02");
  return b?.realized === null && b.forecast === 80;
});
// Een half gerealiseerde maand die herverdeeld moet worden is in zijn geheel prognose: anders
// leent een toekomstige week het etiket van een voorbije.
const half: WeeklyPoint[] = [1, 2, 3, 4].map((w) => ({ month: 11, week: w, label: `W${w}`, expected: 100, realized: w <= 2 ? 90 : null, forecast: w <= 2 ? null : 100 }));
check("een half gerealiseerde, herverdeelde maand: geen week gerealiseerd, totaal = gerealiseerd + prognose", () => {
  const h = fw.toFairWeeks(half, 2026, BEURS);
  return h.every((w) => w.realized === null) && h.reduce((s, w) => s + (w.forecast ?? 0), 0) === 380;
});
// Een maand vóór de start van het kanaal: de forecast geeft daar realized en forecast null (geen
// rij, en geen prognose voor het verleden). Herverdeeld (4 emmers, 5 maandagen) werd dat eerst
// "prognose 0" per week; de week hoort leeg te blijven, de verwachting blijft wel staan.
const voorStart: WeeklyPoint[] = [1, 2, 3, 4].map((w) => ({ month: 11, week: w, label: `W${w}`, expected: 100, realized: null, forecast: null }));
check("een herverdeelde maand zonder data krijgt geen prognose 0 maar null", () => {
  const v = fw.toFairWeeks(voorStart, 2026, BEURS);
  return v.length === 5 && v.every((w) => w.realized === null && w.forecast === null)
    && v.reduce((s, w) => s + w.expected, 0) === 400;
});
// Passen de emmers wel, dan verandert er niets: emmer n blijft de n-de maandag, met zijn eigen waarde.
const passend = fw.toFairWeeks([1, 2, 3, 4, 5].map((w) => ({ month: 11, week: w, label: `W${w}`, expected: w, realized: null, forecast: w * 10 })), 2026, BEURS);
check("vijf emmers op vijf maandagen: emmer 5 is 30 november met zijn eigen waarde", () =>
  passend.length === 5 && passend[4].weekStart === "2026-11-30" && passend[4].forecast === 50 && passend[0].expected === 1);

check("mondaysInMonth: november 2026 heeft er vijf, oktober en februari vier", () =>
  fw.mondaysInMonth(2026, 11) === 5 && fw.mondaysInMonth(2026, 10) === 4 && fw.mondaysInMonth(2026, 2) === 4);
check("mondaysInMonth: juni 2026 (begint op maandag) heeft er vijf", () => fw.mondaysInMonth(2026, 6) === 5);
check("mondaysInMonth: een onmogelijke maand telt nul maandagen", () => fw.mondaysInMonth(2026, 13) === 0 && fw.mondaysInMonth(2026, 0) === 0);
check("elk jaar telt 52 of 53 maandagen op de kalender", () =>
  [2024, 2025, 2026, 2027, 2028].every((j) => { const t = Array.from({ length: 12 }, (_, i) => fw.mondaysInMonth(j, i + 1)).reduce((s, n) => s + n, 0); return t === 52 || t === 53; }));

// ── 2. Eén aftelling: hero, sectiekop en strook zeggen hetzelfde ──
const VANDAAG = "2026-11-01"; // zondag; de beurs is woensdag 4 november
const nu = fw.currentWeekIndex(weken, VANDAAG);
check("de strook noemt deze week W-1", () => weken[nu].label === "W-1");
check("weeksToFair(beurs, vandaag) is gelijk aan de week die de strook 'Deze week' noemt", () => fw.weeksToFair(BEURS, VANDAAG) === weken[nu].weeksOut);
check("fairCountdown geeft 1 week, 3 dagen, label W-1, fase aanloop", () => {
  const c = fw.fairCountdown(BEURS, VANDAAG);
  return c?.weken === 1 && c.dagen === 3 && c.label === "W-1" && c.fase === "aanloop";
});
check("donderdag na de beurs is nog de beursweek, niet W+1", () => fw.weeksToFair(BEURS, "2026-11-05") === 0);
check("fairCountdown op de dag na de beurs: beursweek, -1 dag", () => {
  const c = fw.fairCountdown(BEURS, "2026-11-05");
  return c?.fase === "beursweek" && c.weken === 0 && c.dagen === -1 && c.label === "beurs";
});
check("maandag 9 november is W+1", () => fw.weeksToFair(BEURS, "2026-11-09") === -1);
check("fairCountdown op 9 november: nasleep, W+1", () => { const c = fw.fairCountdown(BEURS, "2026-11-09"); return c?.fase === "nasleep" && c.label === "W+1"; });
check("op elke maandag is weeksToFair onveranderd (de strook verschuift niet)", () =>
  weken.every((w) => w.weeksOut === Math.floor((Date.parse(BEURS) - Date.parse(w.weekStart)) / 86400000 / 7)));
// Over een heel jaar: elke dag dezelfde aftelling als de week waarin de strook hem plaatst.
check("op elke dag van 2026 zegt weeksToFair hetzelfde als de strook voor die dag", () => {
  for (let t = Date.UTC(2026, 0, 5); t <= Date.UTC(2026, 11, 31); t += 86400000) {
    const dag = new Date(t).toISOString().slice(0, 10);
    if (fw.weeksToFair(BEURS, dag) !== weken[fw.currentWeekIndex(weken, dag)].weeksOut) return false;
  }
  return true;
});
check("fairCountdown met een kapotte datum geeft null", () => fw.fairCountdown("kapot", VANDAAG) === null);

// ── 3. De actieve editie: nasleep tot W+6, en de gekozen beurs ──
// De echte demo-events (client_settings.rai_events van demo-greentech, opgehaald 1 nov 2026).
const EVENTS: FairEventCfg[] = [
  { id: "demo-grt", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [{ date: "2026-06-11", label: "2026" }, { date: "2027-06-10", label: "2027" }] },
  { id: "demo-gra", name: "GreenTech Americas", abbrev: "GRA", cadence: "annual", editions: [{ date: "2025-09-16", label: "2025" }, { date: "2026-09-15", label: "2026" }] },
  { id: "demo-grn", name: "GreenTech North America", abbrev: "GRN", cadence: "custom", editions: [{ date: "2026-11-04", label: "2026" }] },
];
const actief = (d: string, geo?: string | null) => fw.selectActiveEdition(EVENTS, d, { selectedGeo: geo, nasleepWeken: 6 });
check("NASLEEP_WEKEN is zes", () => fw.NASLEEP_WEKEN === 6);
check("voor de beurs: GRN 2026-11-04", () => actief("2026-11-01")?.fairDate === "2026-11-04");
check("de dag na de beurs blijft GRN de actieve editie", () => actief("2026-11-05")?.fairDate === "2026-11-04");
check("op W+6 (14 dec) nog steeds GRN", () => actief("2026-12-14")?.fairDate === "2026-11-04" && fw.weeksToFair("2026-11-04", "2026-12-14") === -6);
check("zondag 20 dec (nog W+6) nog steeds GRN", () => actief("2026-12-20")?.fairDate === "2026-11-04");
check("op W+7 (21 dec) door naar GRT 2027", () => actief("2026-12-21")?.fairDate === "2027-06-10");
check("zonder opties geldt NASLEEP_WEKEN", () => fw.selectActiveEdition(EVENTS, "2026-12-14")?.fairDate === "2026-11-04" && fw.selectActiveEdition(EVENTS, "2026-12-21")?.fairDate === "2027-06-10");
check("?geo=GRA volgt GreenTech Americas, niet de eerstvolgende beurs", () => actief("2026-11-01", "GRA")?.abbrev === "GRA");
check("?geo=GRA op 1 nov: de editie van 15 sep zit op W+6 en is nog actief", () => actief("2026-11-01", "GRA")?.fairDate === "2026-09-15");
check("?geo=GRA op 2 nov (W+7): doorgerekend naar 2027-09-15", () => { const e = actief("2026-11-02", "GRA"); return e?.fairDate === "2027-09-15" && e.afgeleid === true; });
check("?geo=gra (kleine letters, spaties) telt als GRA", () => actief("2026-11-01", " gra ")?.abbrev === "GRA");
check("?geo=GRT op 1 nov: GRT 2027, niet GRN", () => actief("2026-11-01", "GRT")?.fairDate === "2027-06-10");
check("een gekozen beurs zonder ingesteld event geeft geen aftelling van een andere beurs", () => actief("2026-11-01", "XYZ") === null);
check("een lege geo telt als geen keuze", () => actief("2026-11-01", "")?.fairDate === "2026-11-04" && actief("2026-11-01", null)?.fairDate === "2026-11-04");
check("zonder geo: de nasleep van GRA (W+1) wint van GRN op W-6", () => actief("2026-09-23")?.abbrev === "GRA");
check("zonder geo: GRN op W-3 wint van de nasleep van GRA op W+4", () => actief("2026-10-14")?.abbrev === "GRN");
// Gelijke afstand: de komende wint. Een tweede event met een beurs drie weken na die van A.
const gelijk: FairEventCfg[] = [
  { id: "a", name: "A", abbrev: "A", cadence: "custom", editions: [{ date: "2026-03-04", label: "2026" }] },
  { id: "b", name: "B", abbrev: "B", cadence: "custom", editions: [{ date: "2026-03-18", label: "2026" }] },
];
check("op gelijke afstand (W+1 tegen W-1) wint de komende", () => fw.selectActiveEdition(gelijk, "2026-03-11")?.abbrev === "B");
check("zonder geo en zonder nasleep: gelijk aan selectUpcomingEdition", () => actief("2026-07-28")?.fairDate === fw.selectUpcomingEdition(EVENTS, "2026-07-28")?.fairDate);
// Een jaarlijkse beurs met alleen vorig jaar in de instellingen heeft ook een nasleep: de
// doorgerekende editie van dit jaar.
const alleenVorigJaar: FairEventCfg[] = [{ id: "x", name: "X", abbrev: "X", cadence: "annual", editions: [{ date: "2025-06-11", label: "2025" }] }];
check("een doorgerekende editie die net geweest is, zit in zijn nasleep", () => {
  const e = fw.selectActiveEdition(alleenVorigJaar, "2026-06-20");
  return e?.fairDate === "2026-06-11" && e.afgeleid === true && e.previousFairDate === "2025-06-11";
});
check("een eenmalige beurs na zijn nasleep: niets meer", () => actief("2026-12-21", "GRN") === null);
// De nasleep-editie draagt dezelfde velden als een aankomende, inclusief de cadans.
check("de nasleep-editie draagt de cadans van zijn event", () => actief("2026-11-01", "GRA")?.cadence === "annual" && actief("2026-11-05")?.cadence === "custom");
check("de nasleep-editie kent de editie ervoor", () => { const e = actief("2026-11-01", "GRA"); return e?.previousFairDate === "2025-09-16" && e.previousLabel === "2025" && e.afgeleid === false; });

// ── 4. De hook volgt de gekozen beurs zonder opnieuw op te halen ──
// Er is geen DOM in de suite; dit is een bronbewaking in de stijl van lib/branding/__brand_test.ts.
const hook = readFileSync("lib/fair/use-upcoming-edition.ts", "utf8");
check("de hook neemt de gekozen beurs aan", () => /useUpcomingEdition\(\s*clientId: string,\s*selectedGeo: string \| null = null\s*\)/.test(hook));
check("de hook kiest via selectActiveEdition, met de gekozen beurs", () => /selectActiveEdition\([^)]*selectedGeo/.test(hook));
check("de events worden alleen per klant opgehaald (effect op [clientId])", () => /\}, \[clientId\]\);/.test(hook) && !/\[clientId, selectedGeo\]/.test(hook));
check("de keuze is gememoïseerd op events, vandaag en de beurs", () => /useMemo\([\s\S]*\[events, vandaag, selectedGeo\]/.test(hook));

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

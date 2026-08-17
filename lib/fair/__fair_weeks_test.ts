// Test voor de weken-tot-beurs-tijdas. Deterministisch, geen IO.
// Draaien: npx tsx lib/rai/__fair_weeks_test.ts

import type { WeeklyPoint } from "@/lib/forecast";
import {
  selectUpcomingEdition,
  weeksToFair,
  fairWeekLabel,
  nthMondayOfMonth,
  toFairWeeks,
  currentWeekIndex,
  type RaiEventCfg,
} from "./fair-weeks";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Weken tot de beurs ──
assert(weeksToFair("2026-06-10", "2026-06-10") === 0, "op de beursdag is het 0 weken");
assert(weeksToFair("2026-06-10", "2026-06-08") === 0, "twee dagen ervoor is nog dezelfde week");
assert(weeksToFair("2026-06-10", "2026-06-03") === 1, "zeven dagen ervoor is 1 week");
assert(weeksToFair("2026-06-10", "2026-05-28") === 1, "dertien dagen ervoor is nog steeds 1 week");
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
const jaarlijks: RaiEventCfg = {
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

const tweejaarlijks: RaiEventCfg = { id: "x", name: "X", abbrev: "X", cadence: "biennial", editions: [{ date: "2024-03-05", label: "2024" }] };
assert(selectUpcomingEdition([tweejaarlijks], "2026-07-28")?.fairDate === "2028-03-05", "de 2-jaarlijkse cadans stapt met twee jaar tegelijk");

const zonderCadans: RaiEventCfg = { id: "y", name: "Y", abbrev: "Y", cadence: "custom", editions: [{ date: "2024-03-05", label: "2024" }] };
assert(selectUpcomingEdition([zonderCadans], "2026-07-28") === null, "zonder bekende cadans wordt er geen datum verzonnen");
assert(selectUpcomingEdition([], "2026-07-28") === null, "geen beurzen geeft null");
assert(selectUpcomingEdition([{ id: "z", name: "Z", cadence: "annual", editions: [] }], "2026-07-28") === null, "een beurs zonder edities geeft null");

// Twee beurzen: de vroegste eerstvolgende wint.
const later: RaiEventCfg = { id: "gra", name: "GreenTech Americas", abbrev: "GRA", cadence: "annual", editions: [{ date: "2026-11-04", label: "2026" }] };
const vroeger: RaiEventCfg = { id: "grt2", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [{ date: "2026-09-02", label: "2026" }] };
assert(selectUpcomingEdition([later, vroeger], "2026-07-28")?.abbrev === "GRT", "van twee beurzen wint de eerstvolgende");

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

// Een maand met een verzonnen vijfde week botst met de eerste week van de maand erna: één telt.
const metDubbel = toFairWeeks([wp(2, 5), wp(3, 1)], 2026, "2026-09-02");
assert(metDubbel.length === 1, "een dubbele startdatum telt maar een keer mee");

// ── Het ankerpunt "nu" ──
assert(currentWeekIndex(weken, "2026-07-22") === 2, "vandaag valt in de week die op of voor vandaag begon");
assert(currentWeekIndex(weken, "2026-07-06") === 0, "op de maandag zelf is dat die week");
assert(currentWeekIndex(weken, "2026-01-01") === 0, "voor de eerste week ankeren we op de eerste");
assert(currentWeekIndex(weken, "2026-12-31") === 3, "na de laatste week ankeren we op de laatste");
assert(currentWeekIndex([], "2026-07-22") === -1, "zonder weken is er geen anker");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

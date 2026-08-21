// Zelf-draaiende test voor de b2c-event-suggestie (Black Friday/Cyber Monday/Kerst/Valentijnsdag).
// Bewaakt vooral de datumformule: die moet correct blijven ongeacht in welk jaar dit draait.

import { nthWeekdayOfMonth, standardB2cEvents, STANDARD_B2C_EVENT_TEMPLATES } from "./standard-b2c-events";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("Black Friday/Cyber Monday vallen op vrijdag/maandag:");
{
  for (const year of [2025, 2026, 2027]) {
    const thu = nthWeekdayOfMonth(year, 10, 4, 4);
    assert(thu.getDay() === 4, `${year}: 4e donderdag van november is ook echt een donderdag`);
    const bf = STANDARD_B2C_EVENT_TEMPLATES.find((t) => t.abbrev === "BF")!.dateForYear(year);
    const cm = STANDARD_B2C_EVENT_TEMPLATES.find((t) => t.abbrev === "CM")!.dateForYear(year);
    assert(bf.getDay() === 5, `${year}: Black Friday valt op vrijdag`);
    assert(cm.getDay() === 1, `${year}: Cyber Monday valt op maandag`);
    assert(cm.getTime() > bf.getTime(), `${year}: Cyber Monday ligt na Black Friday`);
  }
}

console.log("bekende kalenderdatums (2026):");
{
  const bf = STANDARD_B2C_EVENT_TEMPLATES.find((t) => t.abbrev === "BF")!.dateForYear(2026);
  const cm = STANDARD_B2C_EVENT_TEMPLATES.find((t) => t.abbrev === "CM")!.dateForYear(2026);
  assert(bf.getMonth() === 10 && bf.getDate() === 27, "Black Friday 2026 = 27 november");
  assert(cm.getMonth() === 10 && cm.getDate() === 30, "Cyber Monday 2026 = 30 november");
}

console.log("standardB2cEvents(): 4 events, elk 3 edities (vorig/huidig/volgend jaar), oplopend:");
{
  const now = new Date(2026, 7, 21); // 21 augustus 2026, zelfde als "vandaag" in deze sessie
  const events = standardB2cEvents(now);
  assert(events.length === 4, "vier standaard-events");
  assert(new Set(events.map((e) => e.id)).size === 4, "elk event heeft een uniek id");
  for (const ev of events) {
    assert(ev.editions.length === 3, `${ev.name}: drie edities`);
    assert(ev.editions.every((ed) => /^\d{4}-\d{2}-\d{2}$/.test(ed.date)), `${ev.name}: elke editie heeft een ISO-datum`);
    const dates = ev.editions.map((ed) => ed.date);
    assert(dates[0] < dates[1] && dates[1] < dates[2], `${ev.name}: edities staan oplopend in de tijd`);
    assert(ev.editions[1].label === "2026", `${ev.name}: middelste editie is het huidige jaar`);
  }
  const kerst = events.find((e) => e.abbrev === "KERST")!;
  assert(kerst.editions[1].date === "2026-12-25", "Kerst 2026 = 25 december");
  const val = events.find((e) => e.abbrev === "VAL")!;
  assert(val.editions[1].date === "2026-02-14", "Valentijnsdag 2026 = 14 februari");
}

if (failed > 0) {
  console.error(`\n${failed} assertie(s) gefaald.`);
  process.exit(1);
} else {
  console.log("\nAlle assertie geslaagd.");
}

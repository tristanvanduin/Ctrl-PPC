// Standaard e-commerce-momenten voor b2c-klanten (Black Friday, Cyber Monday, Kerst,
// Valentijnsdag), gebruikt door components/dashboard/event-settings.tsx om een b2c-klant met een
// nog helemaal lege event-lijst een suggestie voor te schotelen -- verwijderbaar/aanpasbaar vóór
// opslaan, geen dwingend template. Datums niet hardcoded per jaar: berekend t.o.v. het huidige
// jaar zodat dit bestand niet elk jaar handmatig bijgewerkt hoeft te worden.

export interface Edition { date: string; label: string }
export interface StandardB2cEvent { id: string; name: string; abbrev: string; cadence: "annual"; editions: Edition[] }

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 0=zondag..6=zaterdag, net als Date.getDay(). n is 1-indexed ("de 4e donderdag"). */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

interface StandardEventTemplate {
  name: string;
  abbrev: string;
  dateForYear: (year: number) => Date;
}

export const STANDARD_B2C_EVENT_TEMPLATES: StandardEventTemplate[] = [
  {
    name: "Black Friday",
    abbrev: "BF",
    // Vrijdag na de 4e donderdag van november (Amerikaanse Thanksgiving-conventie, ook in NL gangbaar).
    dateForYear: (year) => {
      const d = nthWeekdayOfMonth(year, 10, 4, 4);
      d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    name: "Cyber Monday",
    abbrev: "CM",
    dateForYear: (year) => {
      const d = nthWeekdayOfMonth(year, 10, 4, 4);
      d.setDate(d.getDate() + 4);
      return d;
    },
  },
  { name: "Kerst", abbrev: "KERST", dateForYear: (year) => new Date(year, 11, 25) },
  { name: "Valentijnsdag", abbrev: "VAL", dateForYear: (year) => new Date(year, 1, 14) },
];

/** Vorig, huidig en volgend jaar per event, zodat zowel een net-verstreken als een aankomende
 * editie in de lijst staat -- ongeacht op welk moment van het jaar dit wordt aangeroepen. */
export function standardB2cEvents(now: Date = new Date()): StandardB2cEvent[] {
  const thisYear = now.getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  return STANDARD_B2C_EVENT_TEMPLATES.map((tpl) => ({
    id: globalThis.crypto?.randomUUID?.() ?? `${tpl.abbrev}-${thisYear}`,
    name: tpl.name,
    abbrev: tpl.abbrev,
    cadence: "annual" as const,
    editions: years.map((y) => ({ date: isoDate(tpl.dateForYear(y)), label: String(y) })),
  }));
}

// Periodekeuze en vergelijkingsperiode, op maandkorrel.
//
// WAAROM MAANDEN EN GEEN DAGEN
//
// Alle 29 gesynchroniseerde tabellen zijn maandkorrel (ads_account_monthly,
// ads_campaign_monthly, ads_country_monthly, ...). Eén uitzondering is week
// (ads_account_weekly) en één is uur maal weekdag (ads_ad_schedule_performance). Een vrij
// dagbereik zoals "15 maart tot en met 3 april" is dus niet te beantwoorden met de data die
// er is — niet omdat het filter ontbreekt, maar omdat die rijen niet bestaan. Dat vergt een
// extra dataset in de sync plus een migratie.
//
// Maandkorrel heeft één prettige eigenschap: schrikkeljaren, zomertijd en eeuwjaren doen er
// niet toe. Een maand is een maand. Alle rekenwerk hieronder is daarom pure indexrekenkunde
// op een doorlopende maandteller, en kan per definitie niet met een dag verschuiven zoals de
// datumhelpers eerder wel deden.
//
// WAT DE VERGELIJKING BETEKENT
//
// "Voorgaande periode" is even lang en sluit direct aan op de gekozen periode. "Vorig jaar"
// verschuift beide grenzen twaalf maanden terug. Die twee geven bij een beurs een wezenlijk
// ander antwoord: bij een jaarlijkse editie is de voorgaande periode betekenisloos (je
// vergelijkt de aanloop met de nasleep) en is vorig jaar juist alles. De kiezer laat daarom
// zien wat er vergeleken wordt in plaats van alleen "vorige periode".

import { today } from "../reporting-date";

/** Een maand als "YYYY-MM". */
export type Month = string;

/** Een periode, inclusief begin- en eindmaand. */
export interface PeriodRange {
  start: Month;
  end: Month;
}

export const PERIOD_PRESETS = [
  "last_3m",
  "last_6m",
  "last_12m",
  "this_year",
  "last_year",
  "custom",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const COMPARISON_MODES = ["none", "previous_period", "same_period_last_year"] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

export const PRESET_LABEL: Record<PeriodPreset, string> = {
  last_3m: "Laatste 3 maanden",
  last_6m: "Laatste 6 maanden",
  last_12m: "Laatste 12 maanden",
  this_year: "Dit jaar",
  last_year: "Vorig jaar",
  custom: "Aangepast",
};

export const COMPARISON_LABEL: Record<ComparisonMode, string> = {
  none: "Geen vergelijking",
  previous_period: "Voorgaande periode",
  same_period_last_year: "Zelfde periode vorig jaar",
};

// ── Maandrekenen ───────────────────────────────────────────────────────────
// Een doorlopende teller: jaar * 12 + (maand - 1). Optellen en aftrekken daarop kan niet
// overlopen zoals een Date dat wel doet.

export function monthIndex(m: Month): number {
  const [y, mm] = m.split("-").map(Number);
  return y * 12 + (mm - 1);
}

export function monthFromIndex(i: number): Month {
  const y = Math.floor(i / 12);
  const mm = i - y * 12 + 1;
  return `${y}-${String(mm).padStart(2, "0")}`;
}

export function addMonths(m: Month, n: number): Month {
  return monthFromIndex(monthIndex(m) + n);
}

/** Het aantal maanden in een periode, beide grenzen meegeteld. */
export function monthCount(p: PeriodRange): number {
  return monthIndex(p.end) - monthIndex(p.start) + 1;
}

/** Elke maand in de periode, oplopend. */
export function monthsIn(p: PeriodRange): Month[] {
  const out: Month[] = [];
  for (let i = monthIndex(p.start); i <= monthIndex(p.end); i += 1) out.push(monthFromIndex(i));
  return out;
}

export function isValidMonth(m: unknown): m is Month {
  return typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

/** Grenzen die omgedraaid staan worden rechtgezet in plaats van geweigerd: een gebruiker die
 *  eerst de eindmaand aanpast bedoelt geen lege periode. */
export function normalizeRange(a: Month, b: Month): PeriodRange {
  return monthIndex(a) <= monthIndex(b) ? { start: a, end: b } : { start: b, end: a };
}

// ── De gekozen periode ─────────────────────────────────────────────────────

/**
 * De laatste VOLLEDIGE maand. De lopende maand telt niet mee: die is per definitie
 * onvolledig, en een halve maand naast twaalf hele maanden zetten laat elke trend dalen.
 */
export function lastCompleteMonth(nu: Month = today().slice(0, 7)): Month {
  return addMonths(nu, -1);
}

export function resolvePeriod(
  preset: PeriodPreset,
  custom?: PeriodRange | null,
  nu: Month = today().slice(0, 7),
): PeriodRange {
  const eind = lastCompleteMonth(nu);
  const jaar = Number(nu.slice(0, 4));

  switch (preset) {
    case "last_3m":
      return { start: addMonths(eind, -2), end: eind };
    case "last_6m":
      return { start: addMonths(eind, -5), end: eind };
    case "last_12m":
      return { start: addMonths(eind, -11), end: eind };
    case "this_year":
      // Tot en met de laatste volledige maand. In januari is er nog geen volledige maand in
      // dit jaar; dan valt het terug op december van vorig jaar, wat de eerlijkste weergave
      // is van "wat weten we nu".
      return normalizeRange(`${jaar}-01`, eind);
    case "last_year":
      return { start: `${jaar - 1}-01`, end: `${jaar - 1}-12` };
    case "custom":
      return custom && isValidMonth(custom.start) && isValidMonth(custom.end)
        ? normalizeRange(custom.start, custom.end)
        : { start: addMonths(eind, -11), end: eind };
  }
}

// ── De vergelijkingsperiode ────────────────────────────────────────────────

/**
 * De periode waartegen vergeleken wordt, of null als er niet vergeleken wordt.
 *
 * Voorgaande periode: even lang, direct ervoor. Bij een periode van drie maanden zijn dat de
 * drie maanden daarvoor — niet "hetzelfde kwartaal", want een gekozen periode hoeft geen
 * kwartaal te zijn.
 *
 * Vorig jaar: beide grenzen twaalf maanden terug. Dat is iets anders dan "even lang, eindigend
 * twaalf maanden eerder" zodra de periode langer is dan een jaar; bij een periode van achttien
 * maanden overlappen de twee elkaar. Dat is geen fout maar een gevolg van wat er gevraagd
 * wordt, en overlapWaarschuwing maakt het zichtbaar.
 */
export function resolveComparison(p: PeriodRange, mode: ComparisonMode): PeriodRange | null {
  if (mode === "none") return null;
  if (mode === "previous_period") {
    const lengte = monthCount(p);
    return { start: addMonths(p.start, -lengte), end: addMonths(p.start, -1) };
  }
  return { start: addMonths(p.start, -12), end: addMonths(p.end, -12) };
}

/** Overlappen de periode en zijn vergelijking elkaar? Dan telt data dubbel mee. */
export function overlaps(a: PeriodRange, b: PeriodRange): boolean {
  return monthIndex(a.start) <= monthIndex(b.end) && monthIndex(b.start) <= monthIndex(a.end);
}

const MAAND_NAAM = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

export function formatMonth(m: Month, kort = false): string {
  if (!isValidMonth(m)) return m;
  const [y, mm] = m.split("-").map(Number);
  const naam = MAAND_NAAM[mm - 1];
  return `${kort ? naam.slice(0, 3) : naam} ${y}`;
}

/** "maart 2026 t/m juni 2026", of "maart 2026" bij een enkele maand. */
export function formatRange(p: PeriodRange): string {
  return p.start === p.end ? formatMonth(p.start) : `${formatMonth(p.start)} t/m ${formatMonth(p.end)}`;
}

/**
 * Waar de gebruiker op moet letten bij deze combinatie, of null als er niets aan de hand is.
 *
 * De beurs-waarschuwing is de belangrijkste: bij een jaarlijkse editie vergelijkt "voorgaande
 * periode" de aanloop met de nasleep, en dat leest als een instorting terwijl er niets aan de
 * hand is. Dat is precies het soort verkeerde conclusie waar een filter je in kan laten lopen.
 */
export function comparisonWarning(
  p: PeriodRange,
  mode: ComparisonMode,
  opties?: { jaarlijkseEditie?: boolean },
): string | null {
  const c = resolveComparison(p, mode);
  if (!c) return null;
  if (overlaps(p, c)) {
    return "De vergelijkingsperiode overlapt met de gekozen periode; een deel van de data telt twee keer mee.";
  }
  if (mode === "previous_period" && opties?.jaarlijkseEditie) {
    return "Deze beurs heeft een jaarlijkse editie. De voorgaande periode vergelijkt dan de aanloop met de nasleep; vorig jaar is hier de zinnige vergelijking.";
  }
  return null;
}

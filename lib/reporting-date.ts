// Datums, op een plek, zonder afhankelijkheden.
//
// Bewust een bladmodule: lib/analysis/helpers.ts importeert client-settings, dat weer een
// datum nodig heeft. Zou "vandaag" in helpers staan, dan ontstond er een cyclus. Alles
// hieronder is puur rekenwerk, dus dit bestand importeert niets.
//
// TWEE VERSCHILLENDE DINGEN, BEWUST UIT ELKAAR GEHOUDEN
//
// 1. KALENDERREKENEN (addDays, addYears): puur rekenen met datumstrings. Daar komt geen
//    tijdzone aan te pas — "1 januari plus 90 dagen" is overal dezelfde vraag. Het gaat via
//    Date.UTC, niet omdat UTC de juiste zone is maar omdat het de enige is zonder zomertijd,
//    en dus de enige waarin dag 32 van januari altijd 1 februari is. Wie hier lokale setters
//    gebruikt, mengt twee tijdlijnen en verliest een dag zodra een venster een zomertijdgrens
//    kruist — dat was 587 van de 7.056 gecontroleerde combinaties over drie jaar.
//
// 2. "WAT IS VANDAAG" (today, monthsAgo, daysAgo): dat is wél een tijdzonevraag, en het
//    antwoord is altijd Amsterdam. Er wordt niet buiten Amsterdam gerapporteerd, en Google Ads
//    levert zijn datums in de tijdzone van het account. De serverprocessen draaien in UTC, en
//    dat is precies het probleem: om 00:30 Amsterdamse tijd op 1 augustus zegt UTC nog 31 juli,
//    waardoor monthsAgo(0) op 2026-07-01 uitkomt in plaats van 2026-08-01 — een hele MAAND
//    ernaast, elke nacht tussen middernacht en 02:00. Precies het venster van de syncs.

export const REPORTING_TIMEZONE = "Europe/Amsterdam";

export function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * De huidige kalenderdatum in Amsterdam, ongeacht waar het proces draait.
 *
 * en-CA levert YYYY-MM-DD; dat is de kortste weg naar een datum in een andere zone zonder een
 * eigen offsettabel die bij de volgende zomertijdregeling achterloopt.
 */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE }).format(new Date());
}

/**
 * n dagen bij een datum optellen (n mag negatief zijn). Zuiver kalenderrekenen.
 *
 * Date.UTC met een doorlopende dagindex kan per definitie niet misgaan: dag 32 van januari is
 * 1 februari, en zomertijd bestaat in UTC niet.
 */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * n jaar bij een datum optellen (n mag negatief zijn), voor jaar-op-jaar-sleutels.
 *
 * 29 februari is het enige lastige geval: die dag bestaat in het doeljaar meestal niet.
 * Date.UTC rolt hem dan door naar 1 maart. Dat is hier de juiste keuze — een YoY-sleutel moet
 * altijd een bestaande datum opleveren — maar het betekent wel dat addYears geen exacte
 * inverse van zichzelf is: 2024-02-29 wordt 2023-03-01 en terug 2024-03-01.
 */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return fmt(new Date(Date.UTC(y + years, m - 1, d)));
}

/**
 * De eerste van de maand, n maanden terug, gerekend vanaf de Amsterdamse kalenderdag.
 *
 * Date.UTC met dag 1 is hier het hele punt. De vorige versie deed setMonth() vóór setDate(1),
 * en dan wordt "31 februari" doorgerold naar 1 maart: op de 29e tot en met de 31e van een maand
 * gaf monthsAgo(1) de HUIDIGE maand terug in plaats van de vorige. Vijftien dagen per jaar,
 * waarvan het gevolg was dat het analysevenster van dertien naar twaalf maanden kromp — precies
 * genoeg om de jaar-op-jaar-tegenhanger van de geanalyseerde maand te laten verdwijnen.
 */
export function monthsAgo(n: number): string {
  const [y, m] = today().split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m - 1 - n, 1)));
}

/** n dagen terug, gerekend vanaf de Amsterdamse kalenderdag. */
export function daysAgo(n: number): string {
  return addDays(today(), -n);
}

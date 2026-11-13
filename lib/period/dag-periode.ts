// Een periode per DAG, naast de maandperiode van period-range.ts. Stap 1 van het periodemodel:
// alleen de rekenlaag. De periodekiezer en de schermen weten hier nog niets van (dat is stap 3).
//
// WAAROM NAAST DE MAANDPERIODE EN NIET IN PLAATS VAN
//
// Het maandmodel (period-range.ts) is pure indexrekenkunde op een maandteller, en daarom kan het
// niet met een dag verschuiven. Dat blijft zo: elke bestaande preset en vergelijking is hele
// maanden. Een dagperiode is er voor wat maanden niet kunnen vangen: Black Friday, Moederdag, een
// eigen actie van tien dagen, een beursweek. De vertaling is eenduidig: een maandperiode is de
// dagperiode van de eerste dag van de eerste maand t/m de laatste dag van de laatste maand
// (uitMaandPeriode), en een dagperiode die precies zo begint en eindigt is weer die maandperiode
// (alsMaandPeriode).
//
// EEN REGEL DIE DE TWEE GELIJK HOUDT
//
// Een dagperiode van hele maanden vergelijkt ZOALS HET MAANDMODEL: "voorgaande periode" is dan
// even veel MAANDEN ervoor (niet even veel dagen: maart-mei is 92 dagen, december-februari 90),
// en "vorig jaar" schuift twaalf maanden. Dat gaat letterlijk via resolveComparison, zodat hele
// maanden per constructie dezelfde vergelijkingsperiode krijgen als nu. Alleen een periode die
// geen hele maanden is, rekent in dagen.
//
// DATUMS
//
// "YYYY-MM-DD" als kalenderdatum in Amsterdam, zoals lib/reporting-date.ts: rekenen gaat via
// addDays (UTC, geen zomertijd), "vandaag" via today() (Amsterdam). Een dagperiode is inclusief
// beide grenzen. ISO-datums sorteren als tekst, dus vergelijken gaat met < en >.
//
// WAT DE GEBRUIKER INVULT IS DE WAARHEID
//
// De vorige editie komt uit de instellingen (lib/events/event-periodes.ts), nooit uit een
// uitgerekende datum: Black Friday, Pasen en Moederdag schuiven, en een zelf berekende datum die
// een dag naast de echte actie ligt, vergelijkt de actie met een gewone dag.

import { addDays, today } from "../reporting-date";
import {
  addMonths, formatMonth, isValidMonth, OVERLAP_WAARSCHUWING, resolveComparison,
  type ComparisonMode, type Month, type PeriodRange,
} from "./period-range";
import type { EventPeriode } from "../events/event-periodes";

/** Een kalenderdatum, "YYYY-MM-DD". */
export type Dag = string;

/** Een periode per dag, beide grenzen meegeteld. */
export interface DagPeriode {
  start: Dag;
  eind: Dag;
}

/** Een bestaande kalenderdatum? "2026-02-30" is dat niet: addDays zou hem stil naar 2 maart rollen. */
export function isGeldigeDag(d: unknown): d is Dag {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;
}

/** Omgedraaide grenzen worden rechtgezet, zoals normalizeRange bij maanden. */
export function normaliseerDagPeriode(a: Dag, b: Dag): DagPeriode {
  return a <= b ? { start: a, eind: b } : { start: b, eind: a };
}

/** Het aantal dagen, beide grenzen meegeteld. */
export function aantalDagen(p: DagPeriode): number {
  const ms = (d: Dag) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(p.eind) - ms(p.start)) / 86_400_000) + 1;
}

/** De laatste dag van een maand: de dag vóór de eerste van de maand erna. */
export function laatsteDagVanMaand(m: Month): Dag {
  return addDays(`${addMonths(m, 1)}-01`, -1);
}

/** Een maandperiode als dagperiode: van de eerste dag van de eerste maand t/m de laatste dag van de laatste. */
export function uitMaandPeriode(p: PeriodRange): DagPeriode {
  return { start: `${p.start}-01`, eind: laatsteDagVanMaand(p.end) };
}

/** De maandperiode als de dagperiode precies hele maanden is, anders null. */
export function alsMaandPeriode(p: DagPeriode): PeriodRange | null {
  const start = p.start.slice(0, 7);
  const end = p.eind.slice(0, 7);
  if (!isValidMonth(start) || !isValidMonth(end)) return null;
  return p.start.endsWith("-01") && p.eind === laatsteDagVanMaand(end) ? { start, end } : null;
}

/** De maanden die de dagperiode raken, als maandperiode: voor een lezer die per maand snijdt. */
export function omhullendeMaanden(p: DagPeriode): PeriodRange {
  return { start: p.start.slice(0, 7), end: p.eind.slice(0, 7) };
}

/** Valt de dag binnen de periode? */
export function dagIn(d: Dag, p: DagPeriode): boolean {
  return d >= p.start && d <= p.eind;
}

/** Overlappen twee dagperiodes? Dan telt data dubbel mee, net als bij overlaps() op maanden. */
export function dagenOverlappen(a: DagPeriode, b: DagPeriode): boolean {
  return a.start <= b.eind && b.start <= a.eind;
}

/** "14 nov 2025". Het jaar staat er altijd bij, om dezelfde reden als in formatRangeKort. */
export function formatDag(d: Dag): string {
  return `${Number(d.slice(8, 10))} ${formatMonth(d.slice(0, 7), true)}`;
}

/** "14 t/m 20 nov 2025", "28 nov 2025 t/m 2 jan 2026", of "14 nov 2025" bij een enkele dag. */
export function formatDagPeriode(p: DagPeriode): string {
  if (p.start === p.eind) return formatDag(p.start);
  if (p.start.slice(0, 7) === p.eind.slice(0, 7)) return `${Number(p.start.slice(8, 10))} t/m ${formatDag(p.eind)}`;
  return `${formatDag(p.start)} t/m ${formatDag(p.eind)}`;
}

/** Vandaag in Amsterdam, als Dag. Alleen een doorgeefluik, zodat een lezer van dit bestand niet
 *  hoeft te weten dat "vandaag" een tijdzonevraag is. */
export function vandaag(): Dag {
  return today();
}

// ── De vergelijking ────────────────────────────────────────────────────────

export const DAG_VERGELIJKINGEN = ["none", "previous_period", "same_dates_last_year", "previous_edition", "custom"] as const;
export type DagVergelijkingModus = (typeof DAG_VERGELIJKINGEN)[number];

/**
 * Hoe "vorig jaar" de datums terugschuift.
 *
 * - kalender: dezelfde kalenderdatums een jaar terug. Vrijdag 28 november 2025 wordt donderdag
 *   28 november 2024.
 * - weekdag: 364 dagen terug, precies 52 weken, zodat elke dag op dezelfde weekdag valt. Voor een
 *   korte actie is dat de eerlijke vergelijking: een weekend tegen twee doordeweekse dagen zetten
 *   meet de weekdag, niet de actie. Voor een lange periode niet: 364 dagen per jaar schuift elk
 *   jaar een dag (twee in een schrikkeljaar) op de kalender, en na een paar maanden vergelijk je
 *   een andere maand.
 * - automatisch: weekdag tot en met WEEKDAG_GRENS_DAGEN dagen, anders kalender. Hele maanden
 *   blijven altijd kalender: dat is wat het maandmodel nu doet.
 */
export type JaarUitlijning = "automatisch" | "kalender" | "weekdag";

/** Acht weken. Langer dan dit is de 364-dagenverschuiving geen kleine kalenderafwijking meer. */
export const WEEKDAG_GRENS_DAGEN = 56;

export const DAG_VERGELIJKING_LABEL: Record<DagVergelijkingModus, string> = {
  none: "Alleen totalen",
  previous_period: "Voorgaande periode",
  same_dates_last_year: "Zelfde datums vorig jaar",
  previous_edition: "Vorige editie",
  custom: "Eigen vergelijkingsperiode",
};

/** Dezelfde zin als comparisonWarning bij maanden: één zin voor één verschijnsel. */
export { OVERLAP_WAARSCHUWING };

export interface DagVergelijkingOpties {
  /** Alleen voor same_dates_last_year; standaard "automatisch". */
  uitlijning?: JaarUitlijning;
  /** De editie waarvan de gekozen periode de periode is (uit eventPeriodesVoorKlant). Nodig voor
   *  previous_edition, en geeft bij previous_period de waarschuwing over aanloop en nasleep. */
  editie?: EventPeriode | null;
  /** De vrije vergelijkingsperiode, alleen voor custom. */
  eigen?: DagPeriode | null;
}

export interface DagVergelijking {
  modus: DagVergelijkingModus;
  /** De vergelijkingsperiode, of null: bij none, of als er niets te vergelijken valt (zie reden). */
  periode: DagPeriode | null;
  /** Waarom periode null is terwijl er wel om een vergelijking gevraagd werd. Null bij none. */
  reden: string | null;
  /** Wat er vergeleken wordt, in woorden: zegt bij vorig jaar ook WELKE verschuiving gebruikt is. */
  label: string;
  /** Alleen bij same_dates_last_year: welke van de twee verschuivingen het werd. */
  uitlijning: "kalender" | "weekdag" | null;
  waarschuwingen: string[];
}

/** De dagmodus bij een maandmodus: voor wie een bestaande PeriodeKeuze in dagen wil uitdrukken. */
export function dagModusVanMaandModus(m: ComparisonMode): DagVergelijkingModus {
  return m === "same_period_last_year" ? "same_dates_last_year" : m;
}

/**
 * Een datum een kalenderjaar terug. 29 februari bestaat in het jaar ervoor nooit; die wordt
 * 28 februari, de laatste dag van dezelfde maand. Niet addYears: die rolt hem door naar 1 maart,
 * en dan schuift een actie die op de laatste dag van februari eindigde een dag maart in.
 *
 * BEWUSTE KEUZE, DE SPIEGELVORM: is het jaar ervoor een schrikkeljaar, dan krijgt een periode over
 * eind februari er 29 februari bij. 28 februari t/m 1 maart 2025 (2 dagen) wordt 28 februari t/m
 * 1 maart 2024 (3 dagen). Dat is wat "dezelfde kalenderdatums" betekent; 29 februari overslaan zou
 * een dag uit de vergelijking weglaten die er echt was. resolveDagVergelijking meldt de ongelijke
 * lengte, en wie gelijke lengte wil, kiest de weekdaguitlijning (364 dagen). Geen fout voor stap 3:
 * __dag_periode_test.ts legt beide richtingen vast.
 */
function jaarTerug(d: Dag): Dag {
  const y = Number(d.slice(0, 4)) - 1;
  const md = d.slice(5) === "02-29" ? "02-28" : d.slice(5);
  return `${y}-${md}`;
}

/**
 * De vergelijkingsperiode bij een dagperiode.
 *
 * - none: geen vergelijking, alleen totalen.
 * - previous_period: even veel dagen direct ervoor; bij hele maanden even veel maanden (zie kop).
 * - same_dates_last_year: een jaar terug, op de kalender of 364 dagen (JaarUitlijning). Het label
 *   zegt welke van de twee.
 * - previous_edition: de vorige editie van HETZELFDE event, zoals hij in de instellingen staat.
 *   Zonder editie of zonder vorige editie: null, met de reden.
 * - custom: de vrije periode uit opties.eigen.
 *
 * De waarschuwingen zijn die van comparisonWarning plus wat bij dagen nieuw is: ongelijke lengte
 * (29 februari, een vorige editie die langer duurde) en een gevraagde 364-dagenverschuiving die
 * voor een lange periode niet gebruikt is.
 */
export function resolveDagVergelijking(
  p: DagPeriode,
  modus: DagVergelijkingModus,
  opties: DagVergelijkingOpties = {},
): DagVergelijking {
  const uit = (
    periode: DagPeriode | null, label: string, uitlijning: "kalender" | "weekdag" | null = null,
    reden: string | null = null, extra: string[] = [],
  ): DagVergelijking => ({
    modus, periode, reden, label, uitlijning,
    waarschuwingen: periode ? [...waarschuwingenVoor(p, periode, modus, opties), ...extra] : extra,
  });

  if (modus === "none") return uit(null, DAG_VERGELIJKING_LABEL.none);

  const maanden = alsMaandPeriode(p);
  const gevraagd = opties.uitlijning ?? "automatisch";

  if (modus === "previous_period") {
    // Hele maanden: letterlijk het maandmodel, zodat de vergelijkingsperiode per constructie dezelfde
    // is als nu (even veel maanden, niet even veel dagen).
    if (maanden) {
      return uit(uitMaandPeriode(resolveComparison(maanden, "previous_period")!),
        `${DAG_VERGELIJKING_LABEL.previous_period} (even veel maanden direct ervoor)`);
    }
    const n = aantalDagen(p);
    return uit({ start: addDays(p.start, -n), eind: addDays(p.start, -1) },
      `${DAG_VERGELIJKING_LABEL.previous_period} (${n === 1 ? "de dag" : `${n} dagen`} direct ervoor)`);
  }

  if (modus === "same_dates_last_year") {
    const n = aantalDagen(p);
    const kort = n <= WEEKDAG_GRENS_DAGEN;
    // Automatisch kiest bij hele maanden de kalender: dat is wat het maandmodel nu doet. Alleen een
    // uitdrukkelijk gevraagde weekdaguitlijning schuift ook een hele (korte) maand 364 dagen.
    const weekdag = kort && (gevraagd === "weekdag" || (gevraagd === "automatisch" && !maanden));
    const extra = gevraagd === "weekdag" && !kort
      ? [`Dezelfde weekdagen (364 dagen terug) kan alleen tot ${WEEKDAG_GRENS_DAGEN / 7} weken; deze periode is ${n} dagen, dus zijn het dezelfde datums vorig jaar.`]
      : [];
    if (weekdag) {
      return uit({ start: addDays(p.start, -364), eind: addDays(p.eind, -364) },
        "Vorig jaar, zelfde weekdagen (364 dagen terug)", "weekdag", null, extra);
    }
    // Hele maanden via het maandmodel (twaalf maanden terug, februari blijft heel februari); anders
    // dezelfde kalenderdatums, met 29 februari op 28 februari.
    const c = maanden
      ? uitMaandPeriode(resolveComparison(maanden, "same_period_last_year")!)
      : { start: jaarTerug(p.start), eind: jaarTerug(p.eind) };
    return uit(c, `${DAG_VERGELIJKING_LABEL.same_dates_last_year} (zelfde kalenderdatums)`, "kalender", null, extra);
  }

  if (modus === "previous_edition") {
    const ed = opties.editie;
    if (!ed) return uit(null, DAG_VERGELIJKING_LABEL.previous_edition, null,
      "Er is geen editie gekozen; kies een periode uit de events om met de vorige editie te vergelijken.");
    if (!ed.vorige) return uit(null, DAG_VERGELIJKING_LABEL.previous_edition, null,
      `Er staat geen eerdere editie van ${ed.naam} in de instellingen (Instellingen > Events).`);
    const extra = ed.start === p.start && ed.eind === p.eind ? [] : [
      `De gekozen periode (${formatDagPeriode(p)}) is niet die van ${ed.naam} ${ed.label} (${formatDagPeriode(ed)}); ` +
      `de vorige editie wordt vergeleken zoals hij in de instellingen staat.`,
    ];
    if (ed.waarschuwing) extra.push(ed.waarschuwing);
    return uit({ start: ed.vorige.start, eind: ed.vorige.eind },
      `${DAG_VERGELIJKING_LABEL.previous_edition} (${ed.naam} ${ed.vorige.label})`, null, null, extra);
  }

  // custom
  const e = opties.eigen;
  if (!e || !isGeldigeDag(e.start) || !isGeldigeDag(e.eind)) {
    return uit(null, DAG_VERGELIJKING_LABEL.custom, null, "Er is geen geldige eigen vergelijkingsperiode opgegeven.");
  }
  return uit(normaliseerDagPeriode(e.start, e.eind), DAG_VERGELIJKING_LABEL.custom);
}

function waarschuwingenVoor(
  p: DagPeriode, c: DagPeriode, modus: DagVergelijkingModus, opties: DagVergelijkingOpties,
): string[] {
  const uit: string[] = [];
  // De overlap gaat voor, zoals in comparisonWarning: dan klopt de vergelijking zelf niet.
  if (dagenOverlappen(p, c)) uit.push(OVERLAP_WAARSCHUWING);
  if (modus === "previous_period" && opties.editie) {
    uit.push(`Dit is een editie van ${opties.editie.naam}. De voorgaande periode vergelijkt dan de aanloop met de nasleep; de vorige editie is hier de zinnige vergelijking.`);
  }
  // Hele maanden van ongelijke lengte (februari tegen januari) zijn het maandmodel: daar zegt
  // comparisonWarning ook niets over, en een maand is een maand.
  const n = aantalDagen(p);
  const m = aantalDagen(c);
  if (n !== m && !(alsMaandPeriode(p) && alsMaandPeriode(c))) {
    uit.push(`De vergelijkingsperiode is ${m} ${m === 1 ? "dag" : "dagen"}, de gekozen periode ${n}; vergelijk de totalen daarom niet een op een.`);
  }
  return uit;
}

/**
 * De dagperiode en de vergelijking bij een bestaande maandkeuze: de brug van het maandmodel naar
 * dit model. Geeft per constructie dezelfde maanden als resolveComparison.
 */
export function uitMaandKeuze(p: PeriodRange, mode: ComparisonMode): { periode: DagPeriode; vergelijking: DagVergelijking } {
  const periode = uitMaandPeriode(p);
  return { periode, vergelijking: resolveDagVergelijking(periode, dagModusVanMaandModus(mode)) };
}

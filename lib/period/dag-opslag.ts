// Waar de dagopslag van Google begint, en wat een periode daarvóór wordt.
//
// HET BESLUIT. Elke periode werkt overal hetzelfde: per dag. De platforms leveren per dag; dat
// Google bij ons per maand en per week stond, was onze eigen opslagkeuze. Sinds migratie 111
// bewaren we Google zelf per dag (ads_account_daily, ads_country_daily, ads_region_daily) en gooien
// we niets weg. Maar die opslag begint ergens: bij de eerste sync met dagrijen, of zo ver terug als
// Google toen nog leverde. Wat daarvóór ligt, staat alleen per maand.
//
// DE REGEL. Een periode wordt gesplitst op de eerste dagrij:
// - begint de periode op of na de eerste dagrij, dan dekken de dagrijen hem helemaal: alles per dag,
//   ook als die eerste rij midden in een maand ligt;
// - alleen een periode die echt VÓÓR de eerste dagrij begint, valt voor dat deel terug op hele
//   maanden, en het label zegt dat precies: "1 t/m 30 nov 2026 per dag; sep 2026 per maand, voor de
//   dagopslag begon".
// Begint de dagopslag midden in een maand en begint de periode daarvóór, dan telt die hele maand nog
// per maand en de dagen pas vanaf de eerste van de maand erna: de maandrij bevat de hele maand, en de
// dagen erbij tellen zou die dagen dubbel tellen. Een maand naar rato verdelen doen we niet (zie
// dag-telling.ts).
//
// Geen terugval, geen label: een periode die helemaal in de dagopslag ligt, is gewoon "per dag".
//
// Eén plek voor deze regel, voor de kerncijfers (dag-telling.ts) en de kaart (lib/geo/geo-dag.ts):
// twee splitsingen zouden bij een dagopslag die midden in een maand begint uit elkaar lopen.

import { addMonths, formatRangeKort, type PeriodRange } from "./period-range";
import { addDays } from "@/lib/reporting-date";
import { formatDagPeriode, laatsteDagVanMaand, omhullendeMaanden, type Dag, type DagPeriode } from "./dag-periode";

export interface DagOpslagSplitsing {
  /** Het deel dat per dag telt, of null als de hele periode vóór de dagopslag ligt. */
  dagDeel: DagPeriode | null;
  /** Het deel vóór de dagopslag, of null als er geen terugval is. */
  maandDeel: DagPeriode | null;
  /** De hele maanden die het maanddeel telt; null zonder maanddeel. */
  maanden: PeriodRange | null;
  /** True als de maanden meer dagen dekken dan het maanddeel (een maand telt helemaal). */
  maandenRuimer: boolean;
  /** Wat het venster zegt, of null als alles per dag telt. */
  label: string | null;
}

/** De eerste dag die per dag telt voor een periode die VÓÓR de eerste dagrij begint: die rij, of de
 *  eerste van de maand erna als hij niet op de eerste van een maand valt. Null zonder dagrijen. */
export function dagStart(eersteDagRij: Dag | null): Dag | null {
  if (!eersteDagRij) return null;
  return eersteDagRij.endsWith("-01") ? eersteDagRij : `${addMonths(eersteDagRij.slice(0, 7), 1)}-01`;
}

/**
 * Splitst een periode op de dagopslag. `eersteDagRij` is de vroegste dag met een rij in de dagtabel
 * (over ALLE rijen, niet alleen die van de periode), of null als er geen dagopslag is: dan telt de
 * hele periode per maand.
 *
 * `opslag` "week": dezelfde regel voor Google zonder dagrijen, met de eerste weekrij als grens
 * (telGoogle in dag-telling.ts). Alleen het label zegt dan "per week" en "de weekcijfers".
 */
export function splitsOpDagOpslag(p: DagPeriode, eersteDagRij: Dag | null, opslag: "dag" | "week" = "dag"): DagOpslagSplitsing {
  // Op of na de eerste dagrij: de dagrijen dekken de hele periode, er valt niets terug.
  const start = eersteDagRij !== null && p.start >= eersteDagRij ? p.start : dagStart(eersteDagRij);
  const dagDeel = start === null ? null : start <= p.start ? p : start <= p.eind ? { start, eind: p.eind } : null;
  const maandDeel = start === null ? p : start > p.start ? { start: p.start, eind: start <= p.eind ? addDays(start, -1) : p.eind } : null;
  const maanden = maandDeel ? omhullendeMaanden(maandDeel) : null;
  const maandenRuimer = !!maandDeel && !!maanden && (!maandDeel.start.endsWith("-01") || maandDeel.eind !== laatsteDagVanMaand(maanden.end));
  return { dagDeel, maandDeel, maanden, maandenRuimer, label: terugvalLabel(dagDeel, maanden, maandenRuimer, start !== null, opslag) };
}

function terugvalLabel(dagDeel: DagPeriode | null, maanden: PeriodRange | null, ruimer: boolean, heeftOpslag: boolean, opslag: "dag" | "week"): string | null {
  if (!maanden) return null;
  const waarom = opslag === "dag"
    ? (heeftOpslag ? "voor de dagopslag begon" : "er is nog geen dagopslag")
    : (heeftOpslag ? "voor de weekcijfers begonnen" : "er zijn geen weekcijfers");
  const heel = ruimer ? " (hele maanden: een maand wordt niet naar rato verdeeld)" : "";
  const maandTekst = `${formatRangeKort(maanden)} per maand, ${waarom}${heel}`;
  return dagDeel ? `${formatDagPeriode(dagDeel)} per ${opslag}; ${maandTekst}` : maandTekst;
}

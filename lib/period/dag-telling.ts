// Optellen over een dagperiode, per kanaal, met eerlijke fijnheid. Stap 1 van het periodemodel:
// nog niet aangesloten op een scherm (dat is stap 3), wel bruikbaar vanaf de bestaande hooks.
//
// WAT ELK KANAAL KAN
//
// Meta, LinkedIn en Microsoft hebben dagrijen (meta_account_daily, linkedin_account_daily,
// microsoft_account_daily): die tellen elke dagperiode exact. Google ook, sinds migratie 111
// (ads_account_daily): elke periode telt per dag. Alleen het deel van een periode dat vóór de
// eerste dagrij ligt, valt terug op hele maanden, en de uitleg zegt dat precies
// (lib/period/dag-opslag.ts). Zonder dagrijen (de tabel bestaat nog niet, of de sync vulde hem nog
// niet) telt Google zoals voorheen: hele maanden als dat kan, anders per hele week (maandag t/m
// zondag): alle weken die de periode RAKEN, en het resultaat zegt welke weken dat waren. Een week of maand naar rato verdelen doen we niet: het
// tempo binnen een week is niet vlak (Black Friday is geen gemiddelde dag van zijn week), en een
// verdeling die er als meting uitziet, is een schatting die niet zegt dat hij er een is.
//
// GEEN TWEEDE REKENWEG
//
// - Hele maanden Google: slicePeriod op de ClientHistoricalData die de hooks al hebben
//   (use-client-data via de adapter). Exact het bestaande pad.
// - Dagkanalen: de dagrijen zoals de hook ze leest (kanaalDagbron), eerst op de periode gefilterd
//   en dan door kanaalStandUitDagen en slicePeriod: dezelfde keten als de KPI-band, met dezelfde
//   conversieselectie (kanaalMaandenUitDagen). Voor hele maanden geeft dat per constructie dezelfde
//   cijfers als nu; __dag_telling_test.ts legt dat vast op de demo.
// - Google per week: de weekrijen (ads_account_weekly). Die staan nog niet in ClientHistoricalData
//   met een datum (WeeklyRecord kent alleen "week 1-5 van de maand"), dus de lezer geeft de rijen
//   mee. De sync haalt ze met dezelfde conversieselectie als de maandrijen (orchestrator.ts). Geef
//   de rijen van ÉÉN klant mee: per week_start telt één rij; een dubbele wordt gemeld en niet
//   opgeteld, een week_start die geen maandag is wordt gemeld en overgeslagen.
//
// WAT ER WERKELIJK GETELD IS
//
// Elk kanaal zegt welke periode het telde. Een dagkanaal telt van zijn eerste t/m zijn laatste rij:
// een periode die doorloopt in vandaag, de toekomst of een sync die achterloopt, is korter geteld
// dan gevraagd, en dat staat erbij ("data t/m ..."). Google telt hooguit t/m gisteren: de lopende
// week of maand is nog niet af.
//
// DE START VAN EEN KANAAL, EN VERGELIJKEN
//
// De start (KanaalTelling.bronStart) komt uit ALLE rijen, vóór het filter op de periode. Binnen de
// periode gefilterd was de start altijd de eerste dag van de periode, en dan telde een kanaal dat
// in de vergelijkingsperiode nog niet liep stil als nul: Microsoft (sinds oktober 2025 bij de demo)
// stond zo op +1559% tegen vorig jaar, waar de band "geen vergelijking" zegt.
//
// telDagVergelijking paart per kanaal, zoals gepaardeTotalen in apply-period.ts:
// - Hele maanden aan beide kanten: letterlijk gepaardeTotalen, met dezelfde bronnen als de band
//   (bandPerKanaal: Google zonder `vanaf`, een dagkanaal vanaf zijn eerste volle maand). Dus exact
//   dezelfde gepaarde delta's als comparePeriods.
// - Anders: een kanaal paart alleen als BEIDE periodes op of na zijn start beginnen. Liep het in
//   een van de twee geheel of deels nog niet, dan valt het buiten het percentage, met de reden
//   erbij. Een dag delen kan niet zoals een maand: binnen een korte actie is er geen "vanaf de
//   eerste volle maand" om op terug te vallen, en een halve vergelijking leest als een hele.

import type { ClientHistoricalData } from "@/lib/types";
import type { ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { maandagVanWeek } from "@/lib/api/google-weekvensters";
import { KANAAL_NAAM } from "@/lib/kanalen/beschikbaar";
import { KANAAL_DAGBRON } from "@/lib/analysis/channel-report-blend";
import { addDays, today } from "@/lib/reporting-date";
import {
  alsBronReeks, bronStart, delta, gepaardeTotalen, heeftData, slicePeriod,
  type BronReeks, type PeriodDelta, type Totalen,
} from "./apply-period";
import {
  CONVERSIE_KANAAL, eersteDagUitRijen, kanaalStandUitDagen, laatsteDagUitRijen, NIET_GOOGLE,
  type NietGoogleKanaal,
} from "./kanaal-maanden";
import { formatRange, monthIndex, monthsIn, type Month } from "./period-range";
import {
  alsMaandPeriode, dagIn, formatDag, formatDagPeriode, laatsteDagVanMaand, omhullendeMaanden,
  type Dag, type DagPeriode,
} from "./dag-periode";
import { splitsOpDagOpslag } from "./dag-opslag";

export type TelKanaal = "google" | NietGoogleKanaal;

/** Hoe fijn een kanaal over deze periode geteld is. "dag+maand": Google per dag, met het deel vóór
 *  de dagopslag per maand. */
export type Fijnheid = "dag" | "week" | "maand" | "dag+maand";

/** Een rij uit ads_account_daily (migratie 111): één per klant per dag. */
export interface GoogleDagRij {
  date: string;
  impressions?: number | null;
  clicks?: number | null;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
}

/** Een rij uit ads_account_weekly: week_start is de maandag van de week. */
export interface GoogleWeekRij {
  week_start: string;
  impressions?: number | null;
  clicks?: number | null;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
}

/** Vertoningen en klikken: de eerste twee stappen van de trechter (lib/overzicht/trechter.ts). */
export interface Tellers {
  impressions: number;
  clicks: number;
}

export interface DagTelInvoer {
  /**
   * Google: de maandreeks van de hooks (ClientHistoricalData) en, voor dagperiodes, de weekrijen.
   * `maandTellers` zijn de vertoningen en klikken per maand ("YYYY-MM") uit de blended route: de
   * maandreeks van de hooks kent ze niet. Zonder telt Google over hele maanden zonder tellers.
   */
  google?: {
    maanden?: ClientHistoricalData | null;
    weken?: readonly GoogleWeekRij[] | null;
    /** De dagrijen (ads_account_daily), ALLE rijen van de klant: de eerste rij bepaalt waar de
     *  dagopslag begint. Null of leeg: geen dagopslag, dan maanden of weken zoals voorheen. */
    dagen?: readonly GoogleDagRij[] | null;
    maandTellers?: ReadonlyMap<Month, Tellers> | null;
  } | null;
  /** Dagrijen per kanaal, gelezen met kanaalDagbron (lib/period/kanaal-maanden.ts). ALLE rijen van
   *  het kanaal, niet alleen die van de periode: de start van het kanaal komt eruit. */
  dagkanalen?: Partial<Record<NietGoogleKanaal, readonly Record<string, unknown>[] | null>>;
  /** De conversieselectie van de klant (resolveChannelConversionConfig). Nodig bij dagkanalen. */
  convConfig?: ChannelConversionConfig;
}

export interface KanaalTelling {
  kanaal: TelKanaal;
  gevraagd: DagPeriode;
  /** De periode die werkelijk geteld is. Null als er voor dit kanaal niets te tellen viel. */
  geteld: DagPeriode | null;
  fijnheid: Fijnheid;
  /** True als `geteld` niet precies `gevraagd` is: dan zegt `uitleg` hoe en waarom. */
  wijktAf: boolean;
  /** De getelde eenheden: de maandagen van de weken ("YYYY-MM-DD") of de maanden ("YYYY-MM").
   *  Leeg bij dagen: elke dag van `geteld` telt. */
  eenheden: string[];
  /** Gevraagde weken of maanden zonder rij. Bij dagen leeg: een dag zonder rij is van een dag
   *  zonder uitgaven niet te onderscheiden, en die telt als nul, zoals in de maandoptelling. */
  ontbrekend: string[];
  totalen: Totalen;
  /**
   * Vertoningen en klikken over dezelfde eenheden als `totalen`, of null als de bron ze niet kent
   * (Google over hele maanden zonder `maandTellers`, of weekrijen zonder die kolommen).
   */
  tellers: Tellers | null;
  /**
   * De eerste dag waarop het kanaal iets deed, uit ALLE rijen (niet alleen die van de periode); null
   * als het nergens iets deed. Per fijnheid zo precies als de rijen zijn: een dagkanaal de dag zelf
   * (eersteDagUitRijen), Google per week de maandag van de eerste week met data, Google per maand
   * de eerste dag van de eerste maand met data. Nodig om een vergelijking te paren.
   */
  bronStart: Dag | null;
  /** De laatste dag waarvoor het kanaal data heeft (de laatste rij; bij Google hooguit gisteren). */
  dataTot: Dag | null;
  /** Wat de lezer moet weten als de telling afwijkt of iets mist, anders null. */
  uitleg: string | null;
  /**
   * False als een deel van de periode als hele maand telde terwijl er maar een deel van die maand
   * gevraagd was (Google vóór de dagopslag, splitsOpDagOpslag: maandenRuimer). De totalen gaan dan
   * over meer dagen dan gevraagd, en telDagVergelijking zet dit kanaal buiten het percentage.
   * Ontbreekt hij, dan telt de telling zoals hij altijd telde.
   */
  exact?: boolean;
  /**
   * Het venster in een regel als niet alles per dag telde ("1 t/m 30 nov 2026 per dag; sep 2026 per
   * maand, voor de dagopslag begon"); null als er niets terugviel. Alleen Google kent dit.
   */
  venster?: string | null;
}

export interface DagTelling {
  periode: DagPeriode;
  perKanaal: KanaalTelling[];
  /** De som over de kanalen. Telt een kanaal een andere periode (Google per week, een kanaal dat
   *  later begon of nog niet bij is), dan is dit een optelling van ongelijke periodes: `gemengd`
   *  zegt dat, en de uitleg per kanaal zegt hoe. */
  totaal: Totalen;
  gemengd: boolean;
}

const nul = (): Totalen => ({ conversions: 0, revenue: 0, adSpend: 0 });
const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isDag = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** De doorsnede van een periode met [van, tot]; null als die leeg is. */
function begrens(p: DagPeriode, van: Dag | null, tot: Dag | null): DagPeriode | null {
  const start = van && van > p.start ? van : p.start;
  const eind = tot && tot < p.eind ? tot : p.eind;
  return start <= eind ? { start, eind } : null;
}

const zelfde = (a: DagPeriode | null, b: DagPeriode): boolean => !!a && a.start === b.start && a.eind === b.eind;

/**
 * Google over een dagperiode. Hele maanden met een maandreeks: het bestaande pad (slicePeriod), want
 * daar zijn de maandrijen en de dagrijen dezelfde optelling en de band rekent met de maandrijen.
 * Anders per dag als er dagrijen zijn (telGoogleDagen), en zonder dagrijen per week.
 */
export function telGoogle(
  p: DagPeriode,
  google: NonNullable<DagTelInvoer["google"]>,
): KanaalTelling | null {
  const maanden = alsMaandPeriode(p);
  if (maanden && google.maanden) {
    // Het bestaande pad, ongewijzigd: de totalen zijn slicePeriod.
    const s = slicePeriod(google.maanden, maanden);
    const gisteren = addDays(today(), -1);
    const reeks = alsBronReeks("google", google.maanden);
    const { start } = bronStart(reeks);
    const metData = [...reeks.maanden].filter(([, t]) => heeftData(t)).map(([m]) => m)
      .sort((a, b) => monthIndex(a) - monthIndex(b));
    const laatste = metData[metData.length - 1];
    const dataTot = laatste ? minDag(laatsteDagVanMaand(laatste), gisteren) : null;
    // Alleen het einde begrenzen: een maand zonder rij aan het begin staat al in `ontbrekend`.
    const geteld = begrens(p, null, gisteren);
    const wijktAf = !zelfde(geteld, p);
    const delen: string[] = [];
    if (wijktAf) {
      delen.push(geteld
        ? `${KANAAL_NAAM.google}: de lopende maand is nog niet af; geteld is hooguit t/m ${formatDag(gisteren)}.`
        : `${KANAAL_NAAM.google}: ${formatDagPeriode(p)} ligt na gisteren; daar is nog geen data.`);
    }
    if (s.missing.length) delen.push(`${KANAAL_NAAM.google} heeft geen data voor ${s.missing.join(", ")}.`);
    return {
      kanaal: "google", gevraagd: p, geteld, fijnheid: "maand", wijktAf,
      eenheden: monthsIn(maanden), ontbrekend: s.missing, totalen: s.totals,
      tellers: google.maandTellers ? maandTellersOver(google.maandTellers, monthsIn(maanden)) : null,
      bronStart: start ? `${start}-01` : null, dataTot,
      uitleg: delen.length ? delen.join(" ") : null,
    };
  }
  if (google.dagen && google.dagen.length > 0) return telGoogleDagen(p, google);
  if (!google.weken) return null;
  return telGoogleWeken(p, google.weken);
}

/**
 * Google per dag (ads_account_daily). Het deel van de periode vóór de eerste dagrij telt per hele
 * maand uit de maandreeks (splitsOpDagOpslag); de rest per dag, exact. Een dag zonder rij telt als
 * nul, zoals bij de andere dagkanalen: een dag zonder uitgaven heeft geen rij nodig.
 */
export function telGoogleDagen(p: DagPeriode, google: NonNullable<DagTelInvoer["google"]>): KanaalTelling {
  const naam = KANAAL_NAAM.google;
  const gisteren = addDays(today(), -1);
  // Eén rij per dag: een tweede rij voor dezelfde dag (een dubbele sync, rijen van twee klanten) telde
  // anders stil dubbel. De unieke sleutel (client_id, date) maakt dat in de tabel onmogelijk, maar
  // een lezer die meer klanten meegeeft, krijgt een melding in plaats van een optelling.
  const perDag = new Map<Dag, GoogleDagRij>();
  const dubbel = new Set<Dag>();
  for (const r of google.dagen ?? []) {
    const d = String(r.date ?? "").slice(0, 10);
    if (!isDag(d)) continue;
    if (perDag.has(d)) { dubbel.add(d); continue; }
    perDag.set(d, r);
  }
  const dagen = [...perDag.keys()].sort();
  const eersteRij = dagen[0] ?? null;
  const laatsteRij = dagen[dagen.length - 1] ?? null;
  const split = splitsOpDagOpslag(p, eersteRij);

  const totalen = nul();
  const tellers: Tellers = { impressions: 0, clicks: 0 };
  let tellersBekend = true;
  if (split.dagDeel) {
    for (const d of dagen) {
      if (!dagIn(d, split.dagDeel)) continue;
      const r = perDag.get(d)!;
      totalen.conversions += n(r.conversions);
      totalen.revenue += n(r.conversions_value);
      totalen.adSpend += n(r.cost);
      tellers.impressions += n(r.impressions);
      tellers.clicks += n(r.clicks);
    }
  }
  let ontbrekend: string[] = [];
  let eenheden: string[] = [];
  const delen: string[] = [];
  if (split.maanden) {
    if (google.maanden) {
      const s = slicePeriod(google.maanden, split.maanden);
      totalen.conversions += s.totals.conversions;
      totalen.revenue += s.totals.revenue;
      totalen.adSpend += s.totals.adSpend;
      eenheden = monthsIn(split.maanden);
      ontbrekend = s.missing;
      if (google.maandTellers) {
        const t = maandTellersOver(google.maandTellers, eenheden);
        tellers.impressions += t.impressions;
        tellers.clicks += t.clicks;
      } else tellersBekend = false;
      if (s.missing.length) delen.push(`${naam} heeft geen data voor ${s.missing.join(", ")}.`);
    } else {
      delen.push(`${naam}: vóór de dagopslag zijn er geen maandcijfers geladen; ${formatDagPeriode(split.maandDeel!)} telt niet mee.`);
    }
  }

  // Wat er werkelijk geteld is: het maanddeel (hele maanden) en het dagdeel t/m de laatste rij.
  const maandGeteld = split.maanden && google.maanden
    ? { start: split.maandenRuimer ? `${split.maanden.start}-01` : split.maandDeel!.start, eind: split.dagDeel ? split.maandDeel!.eind : minDag(laatsteDagVanMaand(split.maanden.end), gisteren) }
    : null;
  const dagGeteld = split.dagDeel && laatsteRij ? begrens(split.dagDeel, null, laatsteRij) : null;
  const geteld = maandGeteld && dagGeteld ? { start: maandGeteld.start, eind: dagGeteld.eind }
    : maandGeteld ?? dagGeteld;
  const wijktAf = !zelfde(geteld, p);

  if (split.label) delen.unshift(`${naam}: ${split.label}.`);
  if (split.dagDeel && laatsteRij && laatsteRij < split.dagDeel.eind) {
    delen.push(laatsteRij < split.dagDeel.start
      ? `${naam} heeft nog geen dagdata in ${formatDagPeriode(split.dagDeel)}; de dagrijen lopen t/m ${formatDag(laatsteRij)}.`
      : `${naam}: data t/m ${formatDag(laatsteRij)}.`);
  }
  if (dubbel.size) delen.push(`Voor ${[...dubbel].sort().map(formatDag).join(", ")} stond meer dan één dagrij; alleen de eerste telt.`);

  // De start: de eerste dag met activiteit, of eerder als de maandreeks eerder begint.
  const actief = dagen.find((d) => { const r = perDag.get(d)!; return !!(n(r.cost) || n(r.conversions) || n(r.conversions_value)); }) ?? null;
  const maandStart = google.maanden ? bronStart(alsBronReeks("google", google.maanden)).start : null;
  const vanMaand = maandStart ? `${maandStart}-01` : null;
  const start = actief && vanMaand ? (vanMaand < actief ? vanMaand : actief) : actief ?? vanMaand;

  return {
    kanaal: "google", gevraagd: p, geteld,
    fijnheid: split.dagDeel && split.maanden ? "dag+maand" : split.maanden ? "maand" : "dag",
    wijktAf, eenheden, ontbrekend, totalen, tellers: tellersBekend ? tellers : null,
    bronStart: start, dataTot: laatsteRij,
    uitleg: delen.length ? delen.join(" ") : null,
    venster: split.label,
    exact: !split.maandenRuimer,
  };
}

function minDag(a: Dag, b: Dag): Dag {
  return a < b ? a : b;
}

/** De tellers over een rij maanden; een maand zonder tellers telt als nul, zoals in slicePeriod. */
function maandTellersOver(perMaand: ReadonlyMap<Month, Tellers>, maanden: readonly Month[]): Tellers {
  const t: Tellers = { impressions: 0, clicks: 0 };
  for (const m of maanden) {
    const x = perMaand.get(m);
    t.impressions += n(x?.impressions);
    t.clicks += n(x?.clicks);
  }
  return t;
}

/**
 * Google per week: elke week (maandag t/m zondag) die de periode raakt telt helemaal mee. De
 * werkelijk getelde periode loopt van de eerste getelde maandag t/m de zondag van de laatste week,
 * en hooguit t/m gisteren: de lopende week is nog niet af.
 */
export function telGoogleWeken(p: DagPeriode, weken: readonly GoogleWeekRij[]): KanaalTelling {
  const gisteren = addDays(today(), -1);

  // Eerst de rijen zelf: één per week, en alleen echte maandagen. Twee rijen voor dezelfde week
  // (rijen van meerdere klanten, een dubbele sync) telden anders stil dubbel, en een week_start op
  // een zondag telde als een eigen week die de echte week voor de helft overlapt.
  const perWeek = new Map<Dag, GoogleWeekRij & { week_start: Dag }>();
  const dubbel: Dag[] = [];
  const geenMaandag: Dag[] = [];
  for (const w of weken) {
    const ws = String(w.week_start ?? "").slice(0, 10);
    if (!isDag(ws)) continue;
    if (maandagVanWeek(ws) !== ws) { geenMaandag.push(ws); continue; }
    if (perWeek.has(ws)) { dubbel.push(ws); continue; }
    perWeek.set(ws, { ...w, week_start: ws });
  }
  const schoon = [...perWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const actief = (w: GoogleWeekRij) => !!(n(w.cost) || n(w.conversions) || n(w.conversions_value));
  const eersteActief = schoon.find(actief);
  const laatsteRij = schoon[schoon.length - 1];

  // Een week die na gisteren begint, heeft nog geen hele dag: die telt niet, ook als er een rij is.
  const raakt = schoon.filter((w) => w.week_start <= p.eind && w.week_start <= gisteren && addDays(w.week_start, 6) >= p.start);
  const totalen = nul();
  const tellers: Tellers = { impressions: 0, clicks: 0 };
  for (const w of raakt) {
    totalen.conversions += n(w.conversions);
    totalen.revenue += n(w.conversions_value);
    totalen.adSpend += n(w.cost);
    tellers.impressions += n(w.impressions);
    tellers.clicks += n(w.clicks);
  }
  // Zonder de kolommen in de rijen (een oudere lezer) zijn de tellers onbekend, geen nul.
  const metTellers = raakt.some((w) => typeof w.impressions === "number" || typeof w.clicks === "number");

  // Een week die nog moet beginnen ontbreekt niet: hij bestaat nog niet.
  const verwacht: Dag[] = [];
  for (let m = maandagVanWeek(p.start); m <= p.eind && m <= gisteren; m = addDays(m, 7)) verwacht.push(m);
  const aanwezig = new Set(raakt.map((w) => w.week_start));
  const ontbrekend = verwacht.filter((m) => !aanwezig.has(m));
  const eenheden = [...aanwezig];

  const weekEind = raakt.length ? addDays(raakt[raakt.length - 1].week_start, 6) : null;
  const lopend = weekEind !== null && weekEind > gisteren;
  const geteld = raakt.length
    ? begrens({ start: raakt[0].week_start, eind: weekEind! }, null, gisteren)
    : null;
  const wijktAf = !zelfde(geteld, p);

  const delen: string[] = [];
  if (geteld && wijktAf) {
    delen.push(`${KANAAL_NAAM.google} telt per week (maandag t/m zondag): geteld is ${formatDagPeriode(geteld)}, ` +
      `gevraagd ${formatDagPeriode(p)}. Een week wordt niet naar rato verdeeld.`);
  }
  if (lopend) {
    delen.push(`De week van ${formatDag(raakt[raakt.length - 1].week_start)} is nog niet af; die telt t/m gisteren (${formatDag(gisteren)}).`);
  }
  if (ontbrekend.length) {
    delen.push(`${KANAAL_NAAM.google} heeft geen weekdata voor de week van ${ontbrekend.map(formatDag).join(", ")}.`);
  }
  if (!raakt.length && p.start > gisteren) {
    delen.push(`${formatDagPeriode(p)} ligt na gisteren; daar is nog geen data.`);
  }
  if (dubbel.length) {
    delen.push(`Voor de week van ${[...new Set(dubbel)].map(formatDag).join(", ")} stond meer dan één rij; alleen de eerste telt.`);
  }
  if (geenMaandag.length) {
    delen.push(`Weekrijen die niet op een maandag beginnen (${geenMaandag.map(formatDag).join(", ")}) zijn overgeslagen.`);
  }
  return {
    kanaal: "google", gevraagd: p, geteld, fijnheid: "week", wijktAf,
    eenheden, ontbrekend, totalen, tellers: raakt.length === 0 || metTellers ? tellers : null,
    bronStart: eersteActief?.week_start ?? null,
    dataTot: laatsteRij ? minDag(addDays(laatsteRij.week_start, 6), gisteren) : null,
    uitleg: delen.length ? delen.join(" ") : null,
  };
}

/** De eerste dag met een rij, ook een rij met alleen nullen: vanaf daar is er gemeten. */
function eersteRijDag(rijen: readonly Record<string, unknown>[]): Dag | null {
  let eerste: Dag | null = null;
  for (const r of rijen) {
    const d = String(r.date ?? "").slice(0, 10);
    if (isDag(d) && (eerste === null || d < eerste)) eerste = d;
  }
  return eerste;
}

/**
 * Een dagkanaal over een dagperiode: de dagrijen binnen de periode, door dezelfde keten als de
 * KPI-band (kanaalStandUitDagen, dan slicePeriod over de maanden die de periode raakt). De start
 * en het einde van het kanaal komen uit ALLE rijen.
 */
export function telDagkanaal(
  p: DagPeriode,
  kanaal: NietGoogleKanaal,
  rijen: readonly Record<string, unknown>[],
  convConfig: ChannelConversionConfig,
): KanaalTelling {
  const naam = KANAAL_NAAM[kanaal];
  // Vóór het filter: binnen de periode is de eerste rij de eerste dag van de periode.
  const bron = eersteDagUitRijen(rijen, CONVERSIE_KANAAL[kanaal]);
  const eersteRij = eersteRijDag(rijen);
  const laatsteRij = laatsteDagUitRijen(rijen);

  const binnen = rijen.filter((r) => dagIn(String(r.date ?? "").slice(0, 10), p));
  // De vertoningen en klikken uit dezelfde rijen, met de klikkolom van het kanaal (Meta: link_clicks),
  // zoals monthlyFromDaily ze per maand optelt.
  const klikveld = KANAAL_DAGBRON[CONVERSIE_KANAAL[kanaal]].clicksField;
  const tellers: Tellers = { impressions: 0, clicks: 0 };
  for (const r of binnen) {
    tellers.impressions += n(Number(r.impressions ?? 0));
    tellers.clicks += n(Number(r[klikveld] ?? 0));
  }
  const stand = kanaalStandUitDagen("", [...binnen], kanaal, convConfig);
  const s = slicePeriod(stand.data, omhullendeMaanden(p));

  const geteld = eersteRij && laatsteRij ? begrens(p, eersteRij, laatsteRij) : null;
  const wijktAf = !zelfde(geteld, p);
  let uitleg: string | null = null;
  if (!eersteRij || !laatsteRij) uitleg = `${naam} heeft geen dagrijen.`;
  else if (!geteld) {
    uitleg = `${naam} heeft geen data in ${formatDagPeriode(p)}; de rijen lopen van ${formatDag(eersteRij)} t/m ${formatDag(laatsteRij)}.`;
  } else if (wijktAf) {
    const delen: string[] = [];
    if (geteld.start !== p.start) delen.push(`data vanaf ${formatDag(eersteRij)}`);
    if (geteld.eind !== p.eind) delen.push(`data t/m ${formatDag(laatsteRij)}`);
    uitleg = `${naam}: ${delen.join(", ")}; geteld is ${formatDagPeriode(geteld)}, gevraagd ${formatDagPeriode(p)}.`;
  }
  return {
    kanaal, gevraagd: p, geteld, fijnheid: "dag", wijktAf,
    eenheden: [], ontbrekend: [], totalen: s.totals, tellers,
    bronStart: bron, dataTot: laatsteRij, uitleg,
  };
}

/** Alle kanalen waarvoor invoer is, over een dagperiode, plus de som. */
export function telDagPeriode(p: DagPeriode, invoer: DagTelInvoer): DagTelling {
  const perKanaal: KanaalTelling[] = [];
  if (invoer.google) {
    const g = telGoogle(p, invoer.google);
    if (g) perKanaal.push(g);
  }
  for (const k of NIET_GOOGLE) {
    const rijen = invoer.dagkanalen?.[k];
    if (!rijen) continue;
    if (!invoer.convConfig) throw new Error(`telDagPeriode: dagrijen voor ${k} zonder conversieselectie`);
    perKanaal.push(telDagkanaal(p, k, rijen, invoer.convConfig));
  }
  const totaal = nul();
  for (const t of perKanaal) {
    totaal.conversions += t.totalen.conversions;
    totaal.revenue += t.totalen.revenue;
    totaal.adSpend += t.totalen.adSpend;
  }
  return { periode: p, perKanaal, totaal, gemengd: perKanaal.some((t) => t.wijktAf) };
}

// ── Vergelijken ────────────────────────────────────────────────────────────

export interface KanaalVergelijking {
  kanaal: TelKanaal;
  /** De telling van de gekozen periode en van de vergelijkingsperiode: wat in beeld staat. */
  huidig: KanaalTelling | null;
  vorig: KanaalTelling | null;
  /** Hoe gepaard is: maand voor maand (hele maanden, gepaardeTotalen) of de periode als geheel. */
  paring: "maand" | "periode";
  /** Wat in het percentage zit, of null als het kanaal niet te paren viel. Bij paring per maand kan
   *  dit kleiner zijn dan de totalen (alleen de maanden vanaf de eerste volle maand). */
  gepaard: { huidig: Totalen; vorig: Totalen } | null;
  /** Waarom het kanaal (deels) buiten het percentage valt, of wat er anders geteld is; anders null. */
  uitleg: string | null;
}

export interface DagVergelijkingTelling {
  periode: DagPeriode;
  vergelijking: DagPeriode;
  huidig: DagTelling;
  vorig: DagTelling;
  perKanaal: KanaalVergelijking[];
  /** Over de gepaarde kanalen. Bij hele maanden exact de deltas van comparePeriods met de bronnen
   *  van de band. */
  deltas: { conversions: PeriodDelta; revenue: PeriodDelta; adSpend: PeriodDelta };
  /** Kanalen die helemaal buiten het percentage vallen. */
  ongepaard: TelKanaal[];
}

/**
 * De bronreeks van een kanaal zoals de band hem paart (bandPerKanaal in use-channel-period-data.ts):
 * Google als maandbron zonder `vanaf`, een dagkanaal uit al zijn dagrijen met zijn eerste volle
 * maand. Null als het kanaal geen maandreeks heeft (Google met alleen weekrijen).
 */
function maandBron(k: TelKanaal, invoer: DagTelInvoer): BronReeks | null {
  if (k === "google") return invoer.google?.maanden ? alsBronReeks("google", invoer.google.maanden) : null;
  const rijen = invoer.dagkanalen?.[k];
  if (!rijen || !invoer.convConfig) return null;
  const stand = kanaalStandUitDagen("", [...rijen], k, invoer.convConfig);
  return alsBronReeks(k, stand.data, stand.vanaf);
}

const maandTekst = (r: { start: Month; end: Month }) => formatRange(r);

/**
 * Een dagperiode tegen zijn vergelijkingsperiode, per kanaal gepaard (zie de kop van dit bestand).
 *
 * `huidig` en `vorig` zijn de volle tellingen, de getallen in beeld; `deltas` gaat alleen over wat
 * gepaard is, net als comparePeriods. Een kanaal dat in de vergelijkingsperiode nog niet liep, telt
 * daar dus niet als nul, en `perKanaal[].uitleg` zegt waarom het ontbreekt.
 */
export function telDagVergelijking(p: DagPeriode, c: DagPeriode, invoer: DagTelInvoer): DagVergelijkingTelling {
  const huidig = telDagPeriode(p, invoer);
  const vorig = telDagPeriode(c, invoer);
  const pm = alsMaandPeriode(p);
  const cm = alsMaandPeriode(c);

  const kanalen: TelKanaal[] = [];
  for (const t of [...huidig.perKanaal, ...vorig.perKanaal]) if (!kanalen.includes(t.kanaal)) kanalen.push(t.kanaal);

  const perKanaal: KanaalVergelijking[] = [];
  const maandBronnen: BronReeks[] = [];
  const dagGepaard = { huidig: nul(), vorig: nul() };
  let dagIets = false;

  for (const k of kanalen) {
    const naam = KANAAL_NAAM[k];
    const h = huidig.perKanaal.find((t) => t.kanaal === k) ?? null;
    const v = vorig.perKanaal.find((t) => t.kanaal === k) ?? null;
    const bron = pm && cm ? maandBron(k, invoer) : null;

    if (pm && cm && bron) {
      // Hele maanden: de regel en de bronnen van de band, dus dezelfde delta's als comparePeriods.
      maandBronnen.push(bron);
      const g = gepaardeTotalen([bron], pm, cm);
      const bp = g.perBron[0];
      let uitleg: string | null = null;
      if (!bp.bereik) {
        uitleg = bp.vanaf
          ? `${naam} telt pas vanaf ${maandTekst({ start: bp.vanaf, end: bp.vanaf })}: in ${maandTekst(pm)} tegen ${maandTekst(cm)} ligt geen maandpaar aan beide kanten daarna. Dit kanaal valt buiten het percentage.`
          : `${naam} deed in geen enkele maand iets; er valt niets te vergelijken.`;
      } else if (bp.ongepaardHuidig || bp.ongepaardVorig) {
        uitleg = `${naam} telt in het percentage alleen ${maandTekst(bp.bereik.huidig)} tegen ${maandTekst(bp.bereik.vorig)}: daarvóór liep het kanaal nog niet (een volle maand).`;
      }
      perKanaal.push({ kanaal: k, huidig: h, vorig: v, paring: "maand", gepaard: bp.bereik ? { huidig: g.huidig, vorig: g.vorig } : null, uitleg });
      continue;
    }

    // Per periode: beide periodes moeten op of na de start van het kanaal beginnen.
    let uitleg: string | null = null;
    let gepaard: KanaalVergelijking["gepaard"] = null;
    if (!h || !v) {
      uitleg = `${naam} is maar in een van beide periodes te tellen.`;
    } else if (!h.bronStart || !v.bronStart) {
      uitleg = `${naam} deed nog nergens iets; er valt niets te vergelijken.`;
    } else {
      const teVroeg = ([[p, h, "de gekozen periode"], [c, v, "de vergelijkingsperiode"]] as const)
        .filter(([q, t]) => q.start < t.bronStart!);
      const ruim = ([[h, "de gekozen periode"], [v, "de vergelijkingsperiode"]] as const).filter(([t]) => t.exact === false);
      if (teVroeg.length) {
        uitleg = teVroeg.map(([q, t, wat]) =>
          `${naam} liep pas vanaf ${formatDag(t.bronStart!)}; ${wat} (${formatDagPeriode(q)}) begint eerder.`).join(" ") +
          " Een periode waarin het kanaal (deels) nog niet liep, telt niet als nul: dit kanaal valt buiten het percentage.";
      } else if (ruim.length) {
        // Hele maanden aan een kant, dagen aan de andere: dan vergelijk je niet dezelfde dagen.
        uitleg = ruim.map(([t, wat]) => `${naam} telt in ${wat} een deel als hele maand${t.venster ? ` (${t.venster})` : ""}.`).join(" ") +
          " De periodes tellen dan niet even veel dagen: dit kanaal valt buiten het percentage.";
      } else {
        gepaard = { huidig: { ...h.totalen }, vorig: { ...v.totalen } };
        const afwijkend = [h, v].filter((t) => t.wijktAf && t.uitleg).map((t) => t.uitleg!);
        uitleg = afwijkend.length ? afwijkend.join(" ") : null;
      }
    }
    if (gepaard) {
      dagIets = true;
      for (const kant of ["huidig", "vorig"] as const) {
        dagGepaard[kant].conversions += gepaard[kant].conversions;
        dagGepaard[kant].revenue += gepaard[kant].revenue;
        dagGepaard[kant].adSpend += gepaard[kant].adSpend;
      }
    }
    perKanaal.push({ kanaal: k, huidig: h, vorig: v, paring: "periode", gepaard, uitleg });
  }

  // De som: de maandbronnen in één gepaardeTotalen (dezelfde volgorde en optelling als
  // comparePeriods), plus wat per periode gepaard is. Zonder dat laatste wordt er niets bij opgeteld,
  // zodat hele maanden tot op de laatste bit gelijk blijven.
  const som = pm && cm && maandBronnen.length ? gepaardeTotalen(maandBronnen, pm, cm) : { huidig: nul(), vorig: nul() };
  if (dagIets) {
    for (const kant of ["huidig", "vorig"] as const) {
      som[kant].conversions += dagGepaard[kant].conversions;
      som[kant].revenue += dagGepaard[kant].revenue;
      som[kant].adSpend += dagGepaard[kant].adSpend;
    }
  }
  return {
    periode: p, vergelijking: c, huidig, vorig, perKanaal,
    deltas: {
      conversions: delta(som.huidig.conversions, som.vorig.conversions),
      revenue: delta(som.huidig.revenue, som.vorig.revenue),
      adSpend: delta(som.huidig.adSpend, som.vorig.adSpend),
    },
    ongepaard: perKanaal.filter((x) => !x.gepaard).map((x) => x.kanaal),
  };
}

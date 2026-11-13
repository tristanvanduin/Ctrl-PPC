// De keuze van de nieuwe periodekiezer (stap 3 van het periodemodel): een periode en waartegen hij
// staat, per dag. Zuiver, zonder React: de provider, de kiezer, de cookie en de tests lezen allemaal
// deze regels.
//
// NAAST DE MAANDKEUZE, NIET IN PLAATS VAN
//
// De vertrouwde weergave kent alleen PeriodeKeuze (preset, eigen maanden, drie vergelijkingen), en
// die blijft precies zoals hij was. De nieuwe weergave kiest meer: een event uit Instellingen, vrije
// datums, en twee vergelijkingen erbij (de vorige editie, een vrije periode), plus "weekdagen
// gelijk". Dat is een DagKeuze. Elke DagKeuze heeft een maandkeuze ernaast (maandKeuzeVan): de
// maanden die de periode raken. Die gebruiken de blokken die alleen per maand kunnen tellen, en die
// bewaart de vertrouwde weergave als iemand terugschakelt.
//
// Kan de keuze zonder verlies als maandkeuze (hele maanden met een van de drie oude
// vergelijkingen), dan IS hij die maandkeuze: metDag laat `dag` dan weg. Zo blijft een oud adres
// letterlijk hetzelfde object, rekent het bestaande pad de cijfers (en dus exact dezelfde), en
// ziet een lezer aan `dag` alleen dat er iets is wat maanden niet kunnen.
//
// IN DE ADRESBALK (en in de cookie, dezelfde schrijfwijze)
//
//   ?periode=last_3m                      zoals altijd (een preset)
//   ?periode=2026-03..2026-08             zoals altijd (eigen maanden)
//   ?periode=2026-11-20..2026-11-30       vrije datums, of een event:
//   &event=<id>                           ... met de id uit Instellingen > Events
//   &vergelijk=previous_period            zoals altijd; ook none
//   &vergelijk=previous_edition           de vorige editie (alleen met &event=)
//   &vergelijk=2025-11-01..2025-11-14     een vrije vergelijkingsperiode
//   &weekdag=uit                          vorig jaar op de kalender in plaats van 52 weken terug
//
// Dezelfde datums vorig jaar is de standaard en staat er dus niet (zoals same_period_last_year nu).
// Een event staat er met zijn datums: een gedeelde link toont wat de afzender zag, ook als de
// edities later anders ingevuld worden. De id is er voor de naam en de vorige editie.

import {
  DEFAULT_COMPARISON, DEFAULT_PRESET, formatRange, formatRangeKort, PRESET_LABEL, SNELKOPPELINGEN,
  type ComparisonMode, type PeriodPreset, type PeriodRange, type PeriodeKeuze,
} from "./period-range";
import { PERIODE_PARAM, VERGELIJK_PARAM, periodeUitParams, schonePeriodeKeuze, zetPeriodeParams } from "./periode-url";
import {
  aantalDagen, alsMaandPeriode, dagIn, dagModusVanMaandModus, formatDagPeriode, isGeldigeDag, normaliseerDagPeriode,
  omhullendeMaanden, resolveDagVergelijking, uitMaandPeriode, WEEKDAG_GRENS_DAGEN,
  type Dag, type DagPeriode, type DagVergelijking, type DagVergelijkingModus,
} from "./dag-periode";
import type { EventPeriode } from "../events/event-periodes";
import { addDays } from "../reporting-date";
import { maandagVanWeek } from "../api/google-weekvensters";
import { KANAAL_NAAM, type Kanaal } from "../kanalen/beschikbaar";
import { opsomming } from "../util/tekst";
import { splitsOpDagOpslag } from "./dag-opslag";

export const EVENT_PARAM = "event";
export const WEEKDAG_PARAM = "weekdag";

/** De periode van een keuze: hele maanden (de bestaande presets en eigen maanden) of dagen. */
export type KeuzePeriode =
  | { soort: "maanden"; preset: PeriodPreset; custom: PeriodRange | null }
  | { soort: "dagen"; start: Dag; eind: Dag; event: string | null };

export interface DagKeuze {
  periode: KeuzePeriode;
  vergelijk: DagVergelijkingModus;
  /** De vrije vergelijkingsperiode; alleen bij `custom`. */
  eigen: DagPeriode | null;
  /** Vorig jaar met dezelfde weekdagen (364 dagen terug). Alleen van belang bij een korte dagperiode
   *  tegen vorig jaar; anders altijd true, zodat hij weer aan staat als het wel van belang wordt. */
  weekdag: boolean;
}

/** Een maandkeuze met, als maanden niet volstaan, de keuze per dag erbij. */
export type PeriodeKeuzeMetDag = PeriodeKeuze & { dag?: DagKeuze };

/** De snelle keuzes: de drie snelkoppelingen en de twee kalenderjaren. Allemaal bestaande presets. */
export const SNELLE_PERIODES: readonly { preset: PeriodPreset; kort: string }[] = [
  ...SNELKOPPELINGEN,
  { preset: "this_year", kort: "Dit jaar" },
  { preset: "last_year", kort: "Vorig jaar" },
];

const DAG_BEREIK = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

const MAAND_MODI: readonly DagVergelijkingModus[] = ["none", "previous_period", "same_dates_last_year"];

/** Kunnen de maanden het zonder verlies: hele maanden met een van de drie oude vergelijkingen? */
export function isMaandPad(k: DagKeuze): boolean {
  return k.periode.soort === "maanden" && MAAND_MODI.includes(k.vergelijk);
}

/** Geldt "weekdagen gelijk" voor deze keuze? Een korte dagperiode tegen dezelfde datums vorig jaar. */
export function weekdagVanBelang(k: DagKeuze): boolean {
  return k.periode.soort === "dagen" && k.vergelijk === "same_dates_last_year"
    && aantalDagen(k.periode) <= WEEKDAG_GRENS_DAGEN;
}

/**
 * De keuze in één vaste vorm, met de velden altijd in dezelfde volgorde: twee keuzes die hetzelfde
 * betekenen zijn dan ook gelijk als tekst (zo vergelijkt de provider de adresbalk met zijn staat).
 * Wat bij deze periode niet kan, valt terug op de standaard: de vorige editie zonder event, een
 * vrije vergelijking zonder geldige datums.
 */
export function schoneDagKeuze(k: DagKeuze): DagKeuze {
  let periode: KeuzePeriode;
  if (k.periode.soort === "dagen") {
    const p = normaliseerDagPeriode(k.periode.start, k.periode.eind);
    periode = { soort: "dagen", start: p.start, eind: p.eind, event: k.periode.event || null };
  } else {
    const m = schonePeriodeKeuze({ preset: k.periode.preset, custom: k.periode.custom, comparison: DEFAULT_COMPARISON });
    periode = { soort: "maanden", preset: m.preset, custom: m.custom };
  }
  let vergelijk = k.vergelijk;
  const eigen = vergelijk === "custom" && k.eigen && isGeldigeDag(k.eigen.start) && isGeldigeDag(k.eigen.eind)
    ? normaliseerDagPeriode(k.eigen.start, k.eigen.eind) : null;
  if (vergelijk === "previous_edition" && !(periode.soort === "dagen" && periode.event)) vergelijk = "same_dates_last_year";
  if (vergelijk === "custom" && !eigen) vergelijk = "same_dates_last_year";
  const uit: DagKeuze = { periode, vergelijk, eigen: vergelijk === "custom" ? eigen : null, weekdag: true };
  if (weekdagVanBelang(uit)) uit.weekdag = k.weekdag !== false;
  return uit;
}

/** De maandkeuze bij een keuze per dag: de maanden die de periode raken. */
export function maandKeuzeVan(k: DagKeuze): PeriodeKeuze {
  const comparison: ComparisonMode = k.vergelijk === "none" ? "none"
    : k.vergelijk === "previous_period" ? "previous_period" : "same_period_last_year";
  if (k.periode.soort === "maanden") return schonePeriodeKeuze({ preset: k.periode.preset, custom: k.periode.custom, comparison });
  return schonePeriodeKeuze({ preset: "custom", custom: omhullendeMaanden(k.periode), comparison });
}

/** De keuze per dag bij een maandkeuze: dezelfde maanden, dezelfde vergelijking. */
export function dagKeuzeUitMaand(m: PeriodeKeuze): DagKeuze {
  return schoneDagKeuze({
    periode: { soort: "maanden", preset: m.preset, custom: m.custom },
    vergelijk: dagModusVanMaandModus(m.comparison), eigen: null, weekdag: true,
  });
}

/** De keuze per dag van een (eventueel aangevulde) maandkeuze. */
export function dagVan(k: PeriodeKeuzeMetDag): DagKeuze {
  return k.dag ? schoneDagKeuze(k.dag) : dagKeuzeUitMaand(k);
}

/** De maandkeuze, met `dag` erbij alleen als maanden niet volstaan (zie de kop). */
export function metDag(k: DagKeuze): PeriodeKeuzeMetDag {
  const s = schoneDagKeuze(k);
  const m = maandKeuzeVan(s);
  return isMaandPad(s) ? m : { preset: m.preset, custom: m.custom, comparison: m.comparison, dag: s };
}

/** Zonder `dag`: wat de vertrouwde weergave bewaart en kent. */
export function zonderDag(k: PeriodeKeuzeMetDag): PeriodeKeuze {
  return { preset: k.preset, custom: k.custom, comparison: k.comparison };
}

// ── De adresbalk ───────────────────────────────────────────────────────────

/** De keuze uit de adresbalk, of null als er geen geldige periode in staat. Oude adressen werken. */
export function dagKeuzeUitParams(p: { get(sleutel: string): string | null }): DagKeuze | null {
  const ruw = p.get(PERIODE_PARAM);
  if (!ruw) return null;
  let periode: KeuzePeriode;
  const d = DAG_BEREIK.exec(ruw);
  if (d) {
    if (!isGeldigeDag(d[1]) || !isGeldigeDag(d[2])) return null;
    periode = { soort: "dagen", start: d[1], eind: d[2], event: p.get(EVENT_PARAM) || null };
  } else {
    const m = periodeUitParams(p);
    if (!m) return null;
    periode = { soort: "maanden", preset: m.preset, custom: m.custom };
  }
  const v = p.get(VERGELIJK_PARAM);
  const e = v ? DAG_BEREIK.exec(v) : null;
  let vergelijk: DagVergelijkingModus = "same_dates_last_year";
  let eigen: DagPeriode | null = null;
  if (e && isGeldigeDag(e[1]) && isGeldigeDag(e[2])) { vergelijk = "custom"; eigen = { start: e[1], eind: e[2] }; }
  else if (v === "none" || v === "previous_period" || v === "previous_edition") vergelijk = v;
  return schoneDagKeuze({ periode, vergelijk, eigen, weekdag: p.get(WEEKDAG_PARAM) !== "uit" });
}

/** Hetzelfde, als maandkeuze met `dag` waar nodig: wat de provider in de nieuwe weergave leest. */
export function metDagUitParams(p: { get(sleutel: string): string | null }): PeriodeKeuzeMetDag | null {
  const k = dagKeuzeUitParams(p);
  return k ? metDag(k) : null;
}

/**
 * Zet de keuze in de zoekparameters, of haalt hem eruit (null). Kan hij als maandkeuze, dan precies
 * zoals zetPeriodeParams: een oud adres en een nieuw adres voor dezelfde keuze zijn gelijk.
 */
export function zetDagKeuzeParams(p: URLSearchParams, keuze: DagKeuze | null): void {
  p.delete(EVENT_PARAM);
  p.delete(WEEKDAG_PARAM);
  if (!keuze) { zetPeriodeParams(p, null); return; }
  const k = schoneDagKeuze(keuze);
  zetPeriodeParams(p, maandKeuzeVan(k));
  if (isMaandPad(k)) return;
  if (k.periode.soort === "dagen") {
    p.set(PERIODE_PARAM, `${k.periode.start}..${k.periode.eind}`);
    if (k.periode.event) p.set(EVENT_PARAM, k.periode.event);
  }
  if (k.vergelijk === "same_dates_last_year") p.delete(VERGELIJK_PARAM);
  else if (k.vergelijk === "custom" && k.eigen) p.set(VERGELIJK_PARAM, `${k.eigen.start}..${k.eigen.eind}`);
  else p.set(VERGELIJK_PARAM, k.vergelijk);
  if (!k.weekdag) p.set(WEEKDAG_PARAM, "uit");
}

/** Idem voor een maandkeuze met eventueel `dag`. */
export function zetMetDagParams(p: URLSearchParams, keuze: PeriodeKeuzeMetDag | null): void {
  zetDagKeuzeParams(p, keuze ? dagVan(keuze) : null);
}

// ── Kiezen, met de standaarden ─────────────────────────────────────────────

/**
 * Een andere periode, met de standaardvergelijking (de regel uit het ontwerp):
 * - een event: de vorige editie, tenzij de gebruiker in deze sessie al zelf een vergelijking koos,
 *   of er geen vorige editie is;
 * - een periode in maanden of vrije datums: vorig jaar, tenzij zelf iets gekozen. De vorige editie
 *   kan daar niet, en valt dan altijd terug op vorig jaar.
 */
export function kiesPeriode(
  k: DagKeuze,
  periode: KeuzePeriode,
  opties: { expliciet: boolean; heeftVorigeEditie?: boolean },
): DagKeuze {
  let vergelijk = k.vergelijk;
  if (periode.soort === "dagen" && periode.event) {
    if (!opties.expliciet && opties.heeftVorigeEditie) vergelijk = "previous_edition";
    else if (!opties.expliciet || (vergelijk === "previous_edition" && !opties.heeftVorigeEditie)) vergelijk = "same_dates_last_year";
  } else if (!opties.expliciet || vergelijk === "previous_edition") {
    vergelijk = "same_dates_last_year";
  }
  return schoneDagKeuze({ ...k, periode, vergelijk });
}

/**
 * Een andere vergelijking. De vorige editie kan alleen als de staat zegt dat het kan; een vrije
 * periode begint op dezelfde datums vorig jaar, zodat er meteen iets staat om bij te stellen.
 */
export function kiesVergelijk(staat: DagStaat, modus: DagVergelijkingModus, eigen?: DagPeriode | null): DagKeuze {
  const k = staat.keuze;
  if (modus === "previous_edition" && !staat.vorigeEditie.kan) return k;
  const beginEigen = eigen ?? k.eigen
    ?? resolveDagVergelijking(staat.periode, "same_dates_last_year", { uitlijning: "kalender" }).periode;
  return schoneDagKeuze({ ...k, vergelijk: modus, eigen: modus === "custom" ? beginEigen : null });
}

// ── Wat er uit de keuze volgt ──────────────────────────────────────────────

export interface DagStaat {
  keuze: DagKeuze;
  /** Hele maanden met een maandvergelijking: de cijfers lopen dan over het bestaande pad. */
  maandPad: boolean;
  /** De gekozen periode per dag. Bij maanden: de maanden zoals de provider ze uitrekent. */
  periode: DagPeriode;
  vergelijking: DagVergelijking;
  /** De editie als de periode een event is, en dat event (nog) in de instellingen staat. */
  editie: EventPeriode | null;
  /** Kan "de vorige editie" gekozen worden? Anders de reden, voor naast de uitgeschakelde keuze. */
  vorigeEditie: { kan: true; uitleg: string } | { kan: false; reden: string };
  /** Toon de schakelaar "weekdagen gelijk": alleen bij een korte dagperiode tegen vorig jaar. */
  weekdagZichtbaar: boolean;
}

/** De editie bij een event-periode: dezelfde datums, of anders de editie waarvan het ankerpunt erin valt. */
function zoekEditie(p: KeuzePeriode, events: readonly EventPeriode[] | null): EventPeriode | null {
  if (p.soort !== "dagen" || !p.event || !events) return null;
  const van = events.filter((e) => e.eventId === p.event);
  return van.find((e) => e.start === p.start && e.eind === p.eind)
    ?? van.find((e) => dagIn(e.datum, p)) ?? null;
}

/**
 * De keuze uitgerekend. `range` is de maandperiode zoals de provider hem uitrekent (geklemd op de
 * datastand); bij een periode in maanden is dat de periode. `events` is null zolang de instellingen
 * nog laden.
 */
export function lostDagKeuzeOp(keuze: DagKeuze, range: PeriodRange, events: readonly EventPeriode[] | null): DagStaat {
  const k = schoneDagKeuze(keuze);
  const periode: DagPeriode = k.periode.soort === "dagen" ? { start: k.periode.start, eind: k.periode.eind } : uitMaandPeriode(range);
  const editie = zoekEditie(k.periode, events);
  const event = k.periode.soort === "dagen" ? k.periode.event : null;

  const vorigeEditie: DagStaat["vorigeEditie"] = !event
    ? { kan: false, reden: "Alleen bij een event. Kies er een bij Periode." }
    : !events ? { kan: false, reden: "De events van deze klant worden nog geladen." }
    : !editie ? { kan: false, reden: "Dit event staat niet meer zo in Instellingen > Events." }
    : !editie.vorige ? { kan: false, reden: `Er staat geen eerdere editie van ${editie.naam} in Instellingen > Events.` }
    : { kan: true, uitleg: `${editie.naam} ${editie.vorige.label} (${formatDagPeriode(editie.vorige)})` };

  const weekdag = weekdagVanBelang(k);
  // Kan de vorige editie niet, dan zegt de regel onder de kiezer dezelfde reden als de uitgeschakelde
  // radio (ook bij een event dat niet meer in de instellingen staat), niet een tweede formulering.
  const vergelijking: DagVergelijking = k.vergelijk === "previous_edition" && !vorigeEditie.kan
    ?{ modus: "previous_edition", periode: null, reden: vorigeEditie.reden, label: "Vorige editie", uitlijning: null, waarschuwingen: [] }
    : resolveDagVergelijking(periode, k.vergelijk, {
      uitlijning: weekdag ? (k.weekdag ? "weekdag" : "kalender") : "automatisch",
      editie, eigen: k.eigen,
    });
  return { keuze: k, maandPad: isMaandPad(k), periode, vergelijking, editie, vorigeEditie, weekdagZichtbaar: weekdag };
}

// ── In woorden ─────────────────────────────────────────────────────────────

/** De knop Periode: een kort label en het bereik ernaast ("12 mnd" · "nov 2025–okt 2026"). */
export function periodeKnop(staat: DagStaat, range: PeriodRange): { label: string; bereik: string } {
  const p = staat.keuze.periode;
  if (p.soort === "maanden") {
    const snel = SNELLE_PERIODES.find((s) => s.preset === p.preset);
    return { label: snel?.kort ?? (p.preset === "custom" ? "Eigen maanden" : PRESET_LABEL[p.preset]), bereik: formatRangeKort(range) };
  }
  const bereik = formatDagPeriode(staat.periode);
  if (staat.editie) return { label: `${staat.editie.naam} ${staat.editie.label}`, bereik };
  return { label: p.event ? "Event" : "Vrije datums", bereik };
}

export const VERGELIJK_KEUZES: readonly { modus: DagVergelijkingModus; label: string }[] = [
  { modus: "none", label: "Niets, alleen totalen" },
  { modus: "previous_period", label: "De periode ervoor" },
  { modus: "same_dates_last_year", label: "Dezelfde datums vorig jaar" },
  { modus: "previous_edition", label: "De vorige editie" },
  { modus: "custom", label: "Een vrije periode" },
];

/** De uitleg onder een vergelijkingskeuze, of waarom hij niet kan. */
export function vergelijkUitleg(staat: DagStaat, modus: DagVergelijkingModus): string {
  const maanden = staat.keuze.periode.soort === "maanden";
  switch (modus) {
    case "none": return "Geen pijlen, geen percentages.";
    case "previous_period": {
      const n = aantalDagen(staat.periode);
      return maanden ? "Even veel maanden, direct ervoor." : `Even lang, direct ervoor: ${n === 1 ? "de dag" : `${n} dagen`}.`;
    }
    case "same_dates_last_year":
      return maanden ? "Per kalendermaand, een jaar terug."
        : aantalDagen(staat.periode) <= WEEKDAG_GRENS_DAGEN ? "Met of zonder weekdagen gelijk (hieronder)." : "Dezelfde kalenderdatums, een jaar terug.";
    case "previous_edition": return staat.vorigeEditie.kan ? staat.vorigeEditie.uitleg : staat.vorigeEditie.reden;
    case "custom": return "Kies zelf de datums om tegen te zetten.";
  }
}

/** Een periode in woorden: maanden als maanden, anders de datums. */
function periodeTekst(p: DagPeriode): string {
  const m = alsMaandPeriode(p);
  return m ? formatRange(m) : formatDagPeriode(p);
}

/**
 * De regel onder de kiezer: wat er tegen wat staat, met de datums. Altijd een zin, ook zonder
 * vergelijking of als er niets te vergelijken valt (dan de reden).
 */
export function vergelijkZin(staat: DagStaat): string {
  const wat = staat.editie
    ? `${staat.editie.naam} ${staat.editie.label} (${formatDagPeriode(staat.periode)})`
    : periodeTekst(staat.periode);
  const v = staat.vergelijking;
  if (staat.keuze.vergelijk === "none") return `Je ziet de totalen van ${wat}. Geen vergelijking, dus geen pijlen of percentages.`;
  if (!v.periode) return `Je ziet de totalen van ${wat}. ${v.reden ?? "Er valt niets te vergelijken."}`;
  const c = periodeTekst(v.periode);
  const tegen = staat.keuze.vergelijk === "previous_period" ? `de periode ervoor (${c})`
    : staat.keuze.vergelijk === "same_dates_last_year"
      ? (v.uitlijning === "weekdag" ? `dezelfde weekdagen 52 weken eerder (${c})` : `dezelfde datums vorig jaar (${c})`)
    : staat.keuze.vergelijk === "previous_edition" && staat.editie?.vorige
      ? `${staat.editie.naam} ${staat.editie.vorige.label} (${c}, zoals ingevuld)`
    : `een vrije periode (${c})`;
  const extra = staat.keuze.vergelijk === "previous_edition" ? " De datums komen uit Instellingen > Events."
    : v.uitlijning === "weekdag" ? " Vrijdag staat tegen vrijdag." : "";
  return `Je ziet ${wat}, tegen ${tegen}.${extra}`;
}

/**
 * De regel over Google bij een dagperiode die geen hele maanden is. Null als Google er niet bij is of
 * de periode hele maanden is.
 *
 * `googleEersteDag` is de eerste dagrij van Google (ads_account_daily, migratie 111). Met dagopslag
 * telt Google per dag zoals de rest, en is er alleen een regel als een deel van de periode vóór de
 * dagopslag ligt (lib/period/dag-opslag.ts): geen terugval, geen regel. Zonder dagopslag (null of
 * weggelaten) telt Google per week, en zegt de regel welke weken dat zijn.
 */
export function googleWeekNoot(periode: DagPeriode, kanalen: readonly Kanaal[], googleEersteDag?: Dag | null): string | null {
  if (!kanalen.includes("google") || alsMaandPeriode(periode)) return null;
  const dag = kanalen.filter((k) => k !== "google").map((k) => KANAAL_NAAM[k]);
  const rest = dag.length === 0 ? "" : ` ${opsomming(dag)} ${dag.length === 1 ? "telt" : "tellen"} per dag.`;
  if (googleEersteDag) {
    const { label } = splitsOpDagOpslag(periode, googleEersteDag);
    return label ? `Google: ${label}.${rest}` : null;
  }
  const weken = { start: maandagVanWeek(periode.start), eind: addDays(maandagVanWeek(periode.eind), 6) };
  return `Google telt op weekniveau: de weken die de periode raken (${formatDagPeriode(weken)}).${rest}`;
}

/** De standaardkeuze, voor wie niets koos. */
export const STANDAARD_DAG_KEUZE: DagKeuze = dagKeuzeUitMaand({ preset: DEFAULT_PRESET, custom: null, comparison: DEFAULT_COMPARISON });

/** Een geldige vrije periode uit twee invoervelden ("YYYY-MM-DD"), of null. */
export function vrijePeriode(van: string, tot: string): DagPeriode | null {
  return isGeldigeDag(van) && isGeldigeDag(tot) ? normaliseerDagPeriode(van, tot) : null;
}

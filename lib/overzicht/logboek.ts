// Het logboek "Wat er gebeurde" op het Overzicht (bouwplan fase 4): de regels, zonder React en
// zonder database.
//
// WAAROM DIT BESTAAT. Het Overzicht opende elke dag hetzelfde. De cijfers bewegen sinds fase 2 en 3
// mee met een klik, maar wie niets aanklikt, ziet niet dat er vannacht een sync mislukte, dat de
// maandanalyse klaar is of dat een hypothese is beoordeeld. Die gebeurtenissen staan allemaal al
// ergens in de database; dit bestand maakt er één tijdlijn van.
//
// WAT ER WEL EN NIET IN STAAT. Alleen wat er werkelijk gebeurd is en ergens is vastgelegd:
//   code_rood_meldingen                   een Code Rood of Code Amber
//   sync_runs en <kanaal>_sync_runs       de laatste sync per kanaal, en elke WISSEL in de stand
//                                         (slaagde, en mislukt nu; mislukte, en slaagt weer)
//   generation_jobs                       een analyse of rapport dat klaar is, of mislukte
//   sprint_hypotheses (pending)           een voorstel dat op een oordeel wacht
//   sprint_hypotheses (evaluated_at)      een hypothese die slaagde of niet
//   client_notes                          een notitie of to-do
// Er wordt niets bij verzonnen en niets uit cijfers afgeleid ("kosten +151%"): dat is een analyse,
// en die hoort uit een analyse te komen. Een lege tijdlijn zegt waarom hij leeg is (legeStaat).
//
// NIET ELKE SYNC IS EEN REGEL. Vier kanalen die elke nacht syncen zijn honderdtwintig regels per
// maand waarin niets staat. Per kanaal daarom: de LAATSTE run, en elke overgang tussen "slaagt" en
// "mislukt". Een sync die drieëntwintig nachten achter elkaar faalt is één regel, met het aantal.
//
// DE TIJD. "zojuist" alleen als er echt net iets binnenkwam (ZOJUIST_BINNEN_MS). Alles daarna
// krijgt een maat: minuten, een kloktijd, een datum. De klok is Amsterdam, zoals overal.
//
// De demo krijgt er voorbeelden bij (demoVoorbeelden), klokrelatief en per stuk gemarkeerd:
// `voorbeeld: true`, en het scherm zet "voorbeeld" op de regel zelf.

import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal, type Kanaalkeuze } from "../kanalen/beschikbaar";
import { channelOfSource } from "../insights/channel-of";
import { REPORTING_TIMEZONE, addDays } from "../reporting-date";
import { opsomming } from "../util/tekst";

/** Hoe ver het logboek terugkijkt. Een open Code Rood blijft staan, hoe oud ook. */
export const LOGBOEK_DAGEN = 30;
/** Hoeveel regels de route hooguit teruggeeft. */
export const LOGBOEK_MAX = 40;
/** Hoeveel voorstellen er als eigen regel in staan; de rest telt mee in `wachtOpOordeel`. */
export const VOORSTELLEN_MAX = 8;
/** "zojuist" geldt voor wat hooguit zo lang geleden gebeurde. */
export const ZOJUIST_BINNEN_MS = 5 * 60_000;

export type LogboekSoort = "code-rood" | "sync" | "datastand" | "analyse" | "voorstel" | "hypothese" | "notitie" | "todo";
export type LogboekToon = "neutraal" | "goed" | "let-op" | "alarm" | "voorstel";

export interface LogboekItem {
  /** Stabiel over verzoeken heen: de soort en de sleutel van de bronrij. */
  id: string;
  soort: LogboekSoort;
  /** Het kanaal waar dit over gaat; null als het de hele klant raakt. */
  kanaal: Kanaal | null;
  /** Wanneer het gebeurde, ISO. */
  tijd: string;
  titel: string;
  /** Eén feit naast de titel: de ICE-score, het aantal rijen, de uitkomst. */
  chip: string | null;
  toon: LogboekToon;
  /** De onderbouwing, per alinea; zichtbaar als de regel openklapt. */
  detail: string[];
  /** Valt hier iets te beslissen of na te lezen in Bevindingen? */
  beoordeelbaar: boolean;
  /** Een verzonnen regel voor de demo. Staat op de regel zelf. */
  voorbeeld?: boolean;
}

export type LogboekBronNaam = "code-rood" | "sync" | "analyses" | "voorstellen" | "hypothesen" | "notities";

/** Wat één bron opleverde, ook als dat niets was: de lege staat vertelt het na. */
export interface LogboekBron {
  bron: LogboekBronNaam;
  /** Minstens één tabel van deze bron antwoordde. Niet: alles is gelezen; zie `deels`. */
  ok: boolean;
  /** Hoeveel regels deze bron aan het logboek gaf. */
  aantal: number;
  /**
   * Een deel van deze bron was niet te lezen, de rest wel: één van de vier runtabellen, of één van
   * de twee lezingen van de meldingen. De bron blijft `ok` (wat er staat is waar), maar "niets
   * gebeurd" mag er niet meer over gezegd worden zonder dit erbij.
   */
  deels?: boolean;
  /** Bij de syncs: de kanalen waarvan de runtabel niet te lezen was. */
  kanalenStuk?: Kanaal[];
  /** Waarom (een deel van) de bron niet te lezen was: een vaste, korte reden per tabel. De melding
   *  van de database zelf gaat niet naar de browser; die staat in het serverlog. */
  fout?: string;
}

export interface Logboek {
  items: LogboekItem[];
  bronnen: LogboekBron[];
  /** Alle voorstellen die op een oordeel wachten, ook die buiten het venster. Een telling in de
   *  database, geen lengte van een afgekapte lijst. null: de bron was niet te lezen, en dan is
   *  "0 wachten" een bewering die niemand kan doen. */
  wachtOpOordeel: number | null;
  /** Wanneer de server dit las, ISO. */
  opgehaaldOp: string;
  dagen: number;
}

export const SOORT_LABEL: Record<LogboekSoort, string> = {
  "code-rood": "Melding", sync: "Data", datastand: "Datastand", analyse: "Analyse",
  voorstel: "Voorstel", hypothese: "Hypothese", notitie: "Notitie", todo: "To-do",
};

const isKanaal = (v: unknown): v is Kanaal => typeof v === "string" && (ALLE_KANALEN as string[]).includes(v);
const tijdMs = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);
const kort = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const getal = (n: number): string => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(n);

// ── De tijd op een regel ────────────────────────────────────────────────────────────────────────

const amsterdamDag = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE }).format(d);
const amsterdamTijd = (d: Date): string => new Intl.DateTimeFormat("nl-NL", { timeZone: REPORTING_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const MAAND_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "12 nov", met het jaar erbij als dat een ander jaar is dan `tenOpzichteVan`. */
export function dagLabel(dag: string, tenOpzichteVan?: string): string {
  const [j, m, d] = dag.slice(0, 10).split("-").map(Number);
  if (!j || !m || !d) return dag;
  const jaar = tenOpzichteVan && tenOpzichteVan.slice(0, 4) === String(j) ? "" : ` ${j}`;
  return `${d} ${MAAND_KORT[m - 1]}${jaar}`;
}

/**
 * Wanneer iets gebeurde, zoals het op een regel staat.
 *
 * "zojuist" alleen binnen ZOJUIST_BINNEN_MS; daarna minuten, dan "vandaag 09:41", "gisteren
 * 16:20", en verder de datum met de tijd. Een tijdstip in de toekomst (een klok die voorloopt)
 * krijgt gewoon zijn datum en nooit "zojuist". Zonder geldig tijdstip: een streepje.
 */
export function tijdLabel(iso: string | null | undefined, nu: Date = new Date()): string {
  const t = tijdMs(iso);
  if (!Number.isFinite(t)) return "—";
  const toen = new Date(t);
  const verschil = nu.getTime() - t;
  if (verschil >= 0 && verschil < ZOJUIST_BINNEN_MS) return "zojuist";
  if (verschil >= 0 && verschil < 60 * 60_000) return `${Math.floor(verschil / 60_000)} min geleden`;
  const dag = amsterdamDag(toen), vandaag = amsterdamDag(nu);
  if (dag === vandaag) return `vandaag ${amsterdamTijd(toen)}`;
  if (dag === addDays(vandaag, -1)) return `gisteren ${amsterdamTijd(toen)}`;
  return `${dagLabel(dag, vandaag)} ${amsterdamTijd(toen)}`;
}

/**
 * Hoe lang geleden, in een paar tekens, voor de syncbadge: "zojuist", "12 min geleden",
 * "3u geleden", "2d geleden". Dezelfde grens voor "zojuist" als op een logboekregel: een run van
 * veertig minuten oud is niet "zojuist".
 */
export function geledenLabel(iso: string | null | undefined, nu: Date = new Date()): string | null {
  const t = tijdMs(iso);
  if (!Number.isFinite(t)) return null;
  const verschil = Math.max(0, nu.getTime() - t);
  if (verschil < ZOJUIST_BINNEN_MS) return "zojuist";
  if (verschil < 60 * 60_000) return `${Math.floor(verschil / 60_000)} min geleden`;
  if (verschil < 24 * 60 * 60_000) return `${Math.floor(verschil / (60 * 60_000))}u geleden`;
  return `${Math.floor(verschil / (24 * 60 * 60_000))}d geleden`;
}

// ── Code Rood ───────────────────────────────────────────────────────────────────────────────────

export interface CodeRoodRij {
  id: string;
  licht: string | null;
  redenen: unknown;
  gedetecteerd_op: string | null;
  status: string | null;
  gereageerd_op?: string | null;
}

const CODE_STATUS: Record<string, string> = { open: "open", geaccepteerd: "geaccepteerd", afgewezen: "afgewezen", opgelost: "opgelost" };

/**
 * Een melding binnen het venster, of een die nog open staat (of geaccepteerd is): die blijft
 * staan tot hij is afgehandeld, hoe oud ook.
 */
export function codeRoodItems(rijen: readonly CodeRoodRij[], vanaf: string): LogboekItem[] {
  return rijen.flatMap((r): LogboekItem[] => {
    if (!r.gedetecteerd_op) return [];
    const loopt = r.status === "open" || r.status === "geaccepteerd";
    if (!loopt && r.gedetecteerd_op < vanaf) return [];
    const rood = r.licht === "rood";
    const redenen = Array.isArray(r.redenen) ? r.redenen.map((x) => kort(String(x))).filter(Boolean) : [];
    return [{
      id: `code-rood:${r.id}`, soort: "code-rood", kanaal: null, tijd: r.gedetecteerd_op,
      titel: rood ? "Code Rood: churnrisico" : "Code Amber: wees alert",
      chip: CODE_STATUS[r.status ?? ""] ?? null,
      toon: !loopt ? "neutraal" : rood ? "alarm" : "let-op",
      detail: [
        ...(redenen.length > 0 ? redenen : ["De melding noemt geen redenen."]),
        ...(r.gereageerd_op ? [`Op gereageerd: ${tijdLabelVast(r.gereageerd_op)}.`] : []),
      ],
      beoordeelbaar: false,
    }];
  });
}

/** Een datum met tijd, zonder "zojuist" of "gisteren": voor een zin in de onderbouwing, die ook
 *  morgen nog klopt. */
function tijdLabelVast(iso: string): string {
  const t = tijdMs(iso);
  if (!Number.isFinite(t)) return "onbekend";
  const d = new Date(t);
  return `${dagLabel(amsterdamDag(d))} ${amsterdamTijd(d)}`;
}

// ── Syncs en wissels in de datastand ────────────────────────────────────────────────────────────

/** Eén syncrun, in de vorm die voor alle vier de kanalen geldt (de route zet de rijen om). */
export interface SyncRun {
  id: string;
  /** Wanneer hij eindigde, of begon als het einde niet is vastgelegd. */
  tijd: string | null;
  uitkomst: "geslaagd" | "deels" | "mislukt" | "loopt";
  rijen: number | null;
  fout: string | null;
  /**
   * Google: het einde van het venster dat de run OPVROEG (sync_runs.date_range_end, ingevuld bij
   * de start). Dat is niet de dag tot waar er data staat: een geslaagde run zonder nieuwe rijen
   * heeft hetzelfde venster. De datastand zelf staat in de bronrij, uit een andere bron.
   */
  gevraagdTot?: string | null;
}

/** De uitkomst van een run uit de statuskolom van zijn tabel (Google: success/partial/failed;
 *  de dagkanalen: completed/failed; running bij allemaal). */
export function syncUitkomst(status: string | null | undefined): SyncRun["uitkomst"] {
  const s = (status ?? "").toLowerCase();
  if (s === "success" || s === "completed") return "geslaagd";
  if (s === "partial") return "deels";
  if (s === "running") return "loopt";
  return "mislukt";
}

/**
 * De regels van één kanaal: de laatste run, en elke wissel tussen slagen en mislukken.
 *
 * Een run die nog loopt telt niet (hij heeft nog niets opgeleverd). De eerste run in het venster
 * is geen wissel: wat ervoor gebeurde is niet gelezen, en "hersteld" zeggen over iets waarvan de
 * storing niet in beeld is, is gokken.
 */
export function syncItems(kanaal: Kanaal, runs: readonly SyncRun[]): LogboekItem[] {
  const naam = KANAAL_NAAM[kanaal];
  const rij = runs.filter((r) => r.uitkomst !== "loopt" && Number.isFinite(tijdMs(r.tijd)))
    .sort((a, b) => tijdMs(a.tijd) - tijdMs(b.tijd));
  if (rij.length === 0) return [];
  const slaagt = (r: SyncRun) => r.uitkomst !== "mislukt";
  const uit: LogboekItem[] = [];
  // Hoeveel runs op rij dezelfde kant op gingen, tot en met index i.
  const reeks = (i: number): number => { let n = 1; while (i - n >= 0 && slaagt(rij[i - n]) === slaagt(rij[i])) n += 1; return n; };
  const reeksNa = (i: number): number => { let n = 0; while (i + 1 + n < rij.length && slaagt(rij[i + 1 + n]) === slaagt(rij[i])) n += 1; return n; };

  for (let i = 1; i < rij.length; i += 1) {
    const r = rij[i], vorige = rij[i - 1];
    if (slaagt(r) === slaagt(vorige)) continue;
    const ervoor = reeks(i - 1), erna = reeksNa(i);
    if (slaagt(r)) {
      uit.push({
        id: `datastand:${kanaal}:${r.id}`, soort: "datastand", kanaal, tijd: r.tijd!, titel: `${naam}-sync slaagt weer`,
        chip: "hersteld", toon: "goed",
        detail: [
          `Na ${ervoor} mislukte ${ervoor === 1 ? "poging" : "pogingen"} sinds ${tijdLabelVast(rij[i - ervoor].tijd!)} kwam er weer data binnen.`,
          ...(r.rijen != null ? [`Deze run schreef ${getal(r.rijen)} rijen.`] : []),
          ...(erna > 0 ? [`Daarna nog ${erna} keer geslaagd.`] : []),
        ],
        beoordeelbaar: false,
      });
    } else {
      uit.push({
        id: `datastand:${kanaal}:${r.id}`, soort: "datastand", kanaal, tijd: r.tijd!, titel: `${naam}-sync mislukt`,
        chip: erna > 0 ? `${erna + 1} keer` : "mislukt", toon: "alarm",
        detail: [
          kort(r.fout) ? `De sync gaf: ${kort(r.fout)}` : "De sync gaf geen reden op.",
          `Daarvoor slaagde hij ${ervoor} keer op rij.`,
          ...(erna > 0 ? [`Sindsdien nog ${erna} keer mislukt; de cijfers van ${naam} lopen niet verder dan de laatste geslaagde sync.`] : []),
        ],
        beoordeelbaar: false,
      });
    }
  }

  // De laatste run, tenzij die zelf al als wissel in de lijst staat.
  const laatste = rij[rij.length - 1];
  if (!uit.some((u) => u.id === `datastand:${kanaal}:${laatste.id}`)) {
    const n = reeks(rij.length - 1);
    // Mislukt de laatste run en stond het begin van die reeks al als wissel in de lijst, dan zegt
    // die regel het al (met het aantal); een tweede regel voor dezelfde storing is ruis.
    const beginAlGemeld = n < rij.length && uit.some((u) => u.id === `datastand:${kanaal}:${rij[rij.length - n].id}`);
    if (slaagt(laatste)) {
      uit.push({
        id: `sync:${kanaal}:${laatste.id}`, soort: "sync", kanaal, tijd: laatste.tijd!,
        // De titel noemt geen dag: "bijgewerkt t/m" zou een datastand beweren die een run zonder
        // nieuwe rijen niet heeft, en de chip in de bronrij ("Stil sinds ...") tegenspreken.
        titel: laatste.uitkomst === "deels" ? `${naam}-sync deels geslaagd` : `${naam}-sync geslaagd`,
        chip: laatste.uitkomst === "deels" ? "deels" : laatste.rijen != null ? `${getal(laatste.rijen)} rijen` : null,
        toon: laatste.uitkomst === "deels" ? "let-op" : "neutraal",
        detail: [
          laatste.uitkomst === "deels"
            ? `De laatste sync slaagde voor een deel${kort(laatste.fout) ? `: ${kort(laatste.fout)}` : "; niet elke dataset kwam binnen."}`
            : "De laatste sync slaagde.",
          ...(n > 1 ? [`In de laatste ${LOGBOEK_DAGEN} dagen ${n} keer op rij geslaagd.`] : []),
          ...(laatste.rijen != null && laatste.uitkomst === "deels" ? [`Deze run schreef ${getal(laatste.rijen)} rijen.`] : []),
          ...(laatste.gevraagdTot ? [`De run vroeg data op t/m ${dagLabel(laatste.gevraagdTot, amsterdamDag(new Date(tijdMs(laatste.tijd))))}. Tot welke dag er werkelijk data staat, zie je in de bronrij onder de grafiek.`] : []),
        ],
        beoordeelbaar: false,
      });
    } else if (!beginAlGemeld) {
      uit.push({
        id: `datastand:${kanaal}:${laatste.id}`, soort: "datastand", kanaal, tijd: laatste.tijd!, titel: `${naam}-sync mislukt`,
        chip: n > 1 ? `${n} keer` : "mislukt", toon: "alarm",
        detail: [
          kort(laatste.fout) ? `De sync gaf: ${kort(laatste.fout)}` : "De sync gaf geen reden op.",
          n > 1 ? `Al ${n} pogingen op rij mislukt sinds ${tijdLabelVast(rij[rij.length - n].tijd!)}; in de laatste ${LOGBOEK_DAGEN} dagen is er geen geslaagde sync.` : "De pogingen ervoor vallen buiten het venster van dit logboek.",
        ],
        beoordeelbaar: false,
      });
    }
  }
  return uit;
}

// ── Analyses en rapporten ───────────────────────────────────────────────────────────────────────

export interface JobRij {
  job_id: string;
  job_type: string | null;
  status: string | null;
  channel?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  error_message?: string | null;
  triggered_by?: string | null;
}

/** De jobs die een mens iets opleveren. pdf_generation (een knop die een bestand maakt) en de
 *  rookproef van de wachtrij zijn geen gebeurtenis voor de klant. */
const JOB_NAAM: Record<string, string> = {
  monthly_sop: "Maandanalyse", biweekly_sop: "Tweewekelijkse analyse", weekly_sop: "Weekanalyse",
  second_opinion: "Second opinion", report_generation: "Rapport",
};
/** De jobtypen die een regel opleveren, voor het filter in de query zelf. De lezer kapt af op een
 *  vast aantal rijen; zonder dit filter vulden veertig pdf-jobs die plekken en viel een afgeronde
 *  analyse stil uit het logboek. Afgeleid van JOB_NAAM, dus de twee lopen niet uiteen. */
export const JOB_TYPEN: readonly string[] = Object.keys(JOB_NAAM);

export function jobItems(rijen: readonly JobRij[], vanaf: string): LogboekItem[] {
  return rijen.flatMap((r): LogboekItem[] => {
    const naam = JOB_NAAM[r.job_type ?? ""];
    const tijd = r.completed_at ?? r.updated_at ?? null;
    if (!naam || !tijd || tijd < vanaf) return [];
    if (r.status !== "completed" && r.status !== "failed") return [];
    const klaar = r.status === "completed";
    const kanaal = isKanaal(r.channel) ? r.channel : null;
    const periode = r.period_start && r.period_end
      ? `Over ${dagLabel(r.period_start)} t/m ${dagLabel(r.period_end)}.` : null;
    return [{
      id: `analyse:${r.job_id}`, soort: "analyse", kanaal, tijd,
      titel: `${naam}${kanaal ? ` ${KANAAL_NAAM[kanaal]}` : ""} ${klaar ? "afgerond" : "mislukt"}`,
      chip: klaar ? "klaar" : "mislukt", toon: klaar ? "goed" : "alarm",
      detail: [
        ...(periode ? [periode] : []),
        klaar ? "De uitkomst staat in Bevindingen; voorstellen die eruit kwamen wachten daar op een oordeel."
          : kort(r.error_message) ? `De run stopte met: ${kort(r.error_message)}` : "De run stopte zonder een reden op te geven.",
        ...(kort(r.triggered_by) ? [`Gestart door: ${kort(r.triggered_by)}.`] : []),
      ],
      beoordeelbaar: klaar,
    }];
  });
}

// ── Voorstellen en hypothesen ───────────────────────────────────────────────────────────────────

export interface HypotheseRij {
  id: string;
  hypothesis: string | null;
  expected_result?: string | null;
  measurement_metric?: string | null;
  timeframe?: string | null;
  rationale?: string | null;
  ice_total?: number | null;
  source?: string | null;
  created_at?: string | null;
  outcome?: string | null;
  result_met?: boolean | null;
  learning?: string | null;
  evaluated_at?: string | null;
}

/** Het kanaal van een hypothese; cross-channel raakt de hele klant en heeft dus geen kanaal. */
function kanaalVanBron(source: string | null | undefined): Kanaal | null {
  const k = channelOfSource(source);
  return k === "cross" ? null : k;
}

/** De voorstellen die op een oordeel wachten, binnen het venster; de nieuwste eerst, hooguit
 *  VOORSTELLEN_MAX. Het totaal dat wacht telt de aanroeper (ook buiten het venster). */
export function voorstelItems(rijen: readonly HypotheseRij[], vanaf: string): LogboekItem[] {
  return rijen
    .filter((r) => !!r.created_at && r.created_at >= vanaf && !!kort(r.hypothesis))
    .sort((a, b) => tijdMs(b.created_at) - tijdMs(a.created_at) || (b.ice_total ?? 0) - (a.ice_total ?? 0))
    .slice(0, VOORSTELLEN_MAX)
    .map((r): LogboekItem => ({
      id: `voorstel:${r.id}`, soort: "voorstel", kanaal: kanaalVanBron(r.source), tijd: r.created_at!,
      titel: kort(r.hypothesis),
      chip: typeof r.ice_total === "number" && Number.isFinite(r.ice_total) ? `ICE ${getal(r.ice_total)}` : null,
      toon: "voorstel",
      detail: [
        ...(kort(r.rationale) ? [kort(r.rationale)] : []),
        ...(kort(r.expected_result) ? [`Verwacht: ${kort(r.expected_result)}`] : []),
        ...(kort(r.measurement_metric) ? [`Meten met ${kort(r.measurement_metric)}${kort(r.timeframe) ? `, ${kort(r.timeframe)}` : ""}.`] : []),
        ...(kort(r.source) ? [`Bron: ${kort(r.source)}.`] : []),
      ],
      beoordeelbaar: true,
    }));
}

/** De hypothesen die in het venster beoordeeld zijn: geslaagd, niet geslaagd, of zonder uitspraak. */
export function hypotheseItems(rijen: readonly HypotheseRij[], vanaf: string): LogboekItem[] {
  return rijen
    .filter((r) => !!r.evaluated_at && r.evaluated_at >= vanaf && !!kort(r.hypothesis))
    .map((r): LogboekItem => {
      const uitspraak = r.result_met === true ? "geslaagd" : r.result_met === false ? "niet geslaagd" : "geen uitspraak";
      return {
        id: `hypothese:${r.id}`, soort: "hypothese", kanaal: kanaalVanBron(r.source), tijd: r.evaluated_at!,
        titel: kort(r.hypothesis), chip: uitspraak,
        toon: r.result_met === true ? "goed" : r.result_met === false ? "let-op" : "neutraal",
        detail: [
          ...(kort(r.learning) ? [kort(r.learning)] : ["De beoordeling gaf geen toelichting."]),
          ...(kort(r.expected_result) ? [`Verwacht was: ${kort(r.expected_result)}`] : []),
        ],
        beoordeelbaar: true,
      };
    });
}

// ── Notities en to-do's ─────────────────────────────────────────────────────────────────────────

export interface NotitieRij {
  id: string;
  title?: string | null;
  content?: string | null;
  created_at?: string | null;
  is_todo?: boolean | null;
  done?: boolean | null;
}

export function notitieItems(rijen: readonly NotitieRij[], vanaf: string): LogboekItem[] {
  return rijen.flatMap((r): LogboekItem[] => {
    if (!r.created_at || r.created_at < vanaf) return [];
    const inhoud = kort(r.content);
    const titel = kort(r.title) || inhoud.slice(0, 80) || (r.is_todo ? "To-do zonder tekst" : "Notitie zonder tekst");
    return [{
      id: `${r.is_todo ? "todo" : "notitie"}:${r.id}`, soort: r.is_todo ? "todo" : "notitie", kanaal: null, tijd: r.created_at,
      titel, chip: r.is_todo ? (r.done ? "afgevinkt" : "open") : null,
      toon: r.is_todo && !r.done ? "let-op" : "neutraal",
      detail: inhoud && inhoud !== titel ? [inhoud] : [r.is_todo ? "Een to-do zonder verdere toelichting." : "Een notitie zonder verdere tekst."],
      beoordeelbaar: false,
    }];
  });
}

// ── Samenvoegen, filteren, de lege staat ────────────────────────────────────────────────────────

/** De nieuwste eerst, hooguit LOGBOEK_MAX. Bij gelijke tijd een vaste volgorde (de id), zodat twee
 *  verzoeken dezelfde lijst geven. */
export function sorteerLogboek(items: readonly LogboekItem[]): LogboekItem[] {
  return [...items]
    .filter((i) => Number.isFinite(tijdMs(i.tijd)))
    .sort((a, b) => tijdMs(b.tijd) - tijdMs(a.tijd) || a.id.localeCompare(b.id))
    .slice(0, LOGBOEK_MAX);
}

/**
 * Wat er bij een kanaalkeuze te zien is: op "Alle kanalen" alles, op een kanaal dat kanaal plus
 * wat de hele klant raakt (een Code Rood, een notitie). Puur filteren in de browser: een
 * kanaalwissel kost geen verzoek.
 */
export function voorKanaal(items: readonly LogboekItem[], keuze: Kanaalkeuze): LogboekItem[] {
  return keuze === "blended" ? [...items] : items.filter((i) => i.kanaal === null || i.kanaal === keuze);
}

const BRON_ZIN: Record<LogboekBronNaam, { leeg: string; naam: string }> = {
  "code-rood": { leeg: "geen Code Rood of Amber", naam: "de meldingen" },
  sync: { leeg: "geen sync gedraaid", naam: "de syncs" },
  analyses: { leeg: "geen analyse of rapport afgerond", naam: "de analyses" },
  voorstellen: { leeg: "geen nieuw voorstel", naam: "de voorstellen" },
  hypothesen: { leeg: "geen hypothese beoordeeld", naam: "de hypothesen" },
  notities: { leeg: "geen notitie of to-do geschreven", naam: "de notities" },
};

/** Uit welke bron een regel van deze soort komt. */
const BRON_VAN_SOORT: Record<LogboekSoort, LogboekBronNaam> = {
  "code-rood": "code-rood", sync: "sync", datastand: "sync", analyse: "analyses",
  voorstel: "voorstellen", hypothese: "hypothesen", notitie: "notities", todo: "notities",
};

/**
 * Waarom het logboek leeg is, in één of twee zinnen. Een bron die niet te lezen was, wordt bij
 * naam genoemd: "niets gebeurd" en "niet kunnen kijken" zijn verschillende dingen.
 */
export function legeStaat(logboek: Pick<Logboek, "items" | "bronnen" | "dagen" | "wachtOpOordeel">, keuze: Kanaalkeuze = "blended"): string {
  // De runtabel van het GEKOZEN kanaal was niet te lezen: dan zijn de syncs voor deze keuze niet
  // te lezen, ook al antwoordden de andere drie tabellen. "Voor Microsoft Ads: geen sync gedraaid"
  // was daar een bewering over een tabel waar niemand in gekeken had.
  const kanaalStuk = (b: LogboekBron) => keuze !== "blended" && (b.kanalenStuk ?? []).includes(keuze);
  const stuk = logboek.bronnen.filter((b) => !b.ok || kanaalStuk(b));
  // Deels gelezen, en dat deel raakt deze keuze: op Alle kanalen elke bron met een gat, op een
  // kanaal alleen een bron zonder kanaalverdeling (de meldingen). Een runtabel van een ANDER kanaal
  // die faalde, zegt niets over dit kanaal.
  const deels = logboek.bronnen.filter((b) => b.ok && b.deels && !kanaalStuk(b) && (keuze === "blended" || !b.kanalenStuk));
  // Leeg is een bron die BIJ DEZE KANAALKEUZE geen regel heeft. De telling op de bron zelf
  // (`aantal`) gaat over alle kanalen: met Meta gekozen en alleen een Google-sync zou de zin over
  // de sync zwijgen, terwijl er voor Meta geen was.
  const gevuld = new Set(voorKanaal(logboek.items, keuze).map((i) => BRON_VAN_SOORT[i.soort]));
  const leeg = logboek.bronnen.filter((b) => b.ok && !kanaalStuk(b) && !gevuld.has(b.bron));
  const n = logboek.wachtOpOordeel;
  const waar = keuze === "blended" ? "" : ` voor ${KANAAL_NAAM[keuze]}`;
  const zinnen: string[] = [];
  if (leeg.length > 0 || stuk.length === 0) {
    zinnen.push(leeg.length > 0
      ? `In de laatste ${logboek.dagen} dagen${waar}: ${opsomming(leeg.map((b) => BRON_ZIN[b.bron].leeg))}.`
      : `In de laatste ${logboek.dagen} dagen is er${waar} niets vastgelegd.`);
  }
  if (stuk.length > 0) zinnen.push(`Niet te lezen: ${opsomming(stuk.map((b) => BRON_ZIN[b.bron].naam))}; daar kan dus wel iets gebeurd zijn.`);
  if (deels.length > 0) {
    zinnen.push(`Niet volledig te lezen: ${opsomming(deels.map((b) =>
      `${BRON_ZIN[b.bron].naam}${b.kanalenStuk?.length ? ` (${opsomming(b.kanalenStuk.map((k) => KANAAL_NAAM[k]))})` : ""}`))}; daar kan dus meer gebeurd zijn dan hier staat.`);
  }
  // "Ouder" alleen op Alle kanalen: daar is een voorstel dat wacht en niet in de lijst staat ook
  // echt van voor het venster. Op een kanaal kan het van gisteren zijn en bij een ander kanaal
  // horen; de telling gaat over alle kanalen, en dat staat er dan bij. Zonder telling (de bron was
  // niet te lezen) geen zin: die bron staat hierboven al bij "niet te lezen".
  if (n !== null && n > 0) {
    zinnen.push(keuze === "blended"
      ? `Er ${n === 1 ? "wacht" : "wachten"} nog ${n} ${n === 1 ? "ouder voorstel" : "oudere voorstellen"} op een oordeel in Bevindingen.`
      : `Over alle kanalen ${n === 1 ? "wacht" : "wachten"} er ${n} ${n === 1 ? "voorstel" : "voorstellen"} op een oordeel in Bevindingen.`);
  }
  return zinnen.join(" ");
}

/**
 * De bronnen waar bij deze kanaalkeuze iets niet van gelezen is, geheel of deels, met de naam
 * zoals het scherm hem noemt. Voor de regel "niet elke bron was te lezen" onder een logboek dat
 * wel regels heeft: die keek alleen naar `ok`, en een bron waarvan één tabel faalde is `ok`.
 */
export function bronnenMetLeesfout(bronnen: readonly LogboekBron[], keuze: Kanaalkeuze = "blended"): { naam: string; reden: string }[] {
  return bronnen
    .filter((b) => !b.ok || (b.deels && (keuze === "blended" || !b.kanalenStuk || b.kanalenStuk.includes(keuze))))
    .map((b) => ({ naam: BRON_ZIN[b.bron].naam, reden: b.fout ?? "niet te lezen" }));
}

// ── De demo: voorbeelden die meelopen met de klok ───────────────────────────────────────────────

/**
 * Voorbeeldregels voor de demoklant, klokrelatief: ze liggen altijd in de afgelopen dagen, wanneer
 * de demo ook geopend wordt. Elk draagt `voorbeeld: true`; het scherm zet dat op de regel.
 *
 * Vaste kloktijden op vaste dagen terug (niet "drie uur geleden"): dan staat er na een herlaad
 * dezelfde regel op hetzelfde tijdstip, en is er na een nacht echt iets nieuws sinds het vorige
 * bezoek. De regel van vanochtend bestaat pas als dat tijdstip voorbij is.
 */
export function demoVoorbeelden(nu: Date = new Date()): LogboekItem[] {
  const vandaag = amsterdamDag(nu);
  // Een Amsterdamse kloktijd op een dag terug, als ISO. De verschuiving van die dag (zomer- of
  // wintertijd) komt uit de zone zelf, niet uit een vaste +1 of +2.
  const op = (dagenTerug: number, uur: number, minuut: number): string => {
    const dag = addDays(vandaag, -dagenTerug);
    const gok = Date.parse(`${dag}T${String(uur).padStart(2, "0")}:${String(minuut).padStart(2, "0")}:00Z`);
    const [u, m] = amsterdamTijd(new Date(gok)).split(":").map(Number);
    const verschuiving = ((u * 60 + m) - (uur * 60 + minuut) + 1440 + 720) % 1440 - 720;
    return new Date(gok - verschuiving * 60_000).toISOString();
  };
  // Een voorbeeld is nooit te beoordelen: de knop "Beoordeel" zou Bevindingen openen voor iets dat
  // daar niet staat, want de regel is verzonnen. De onderbouwing zegt wat er bij een echte klant
  // wel zou staan.
  const v = (item: Omit<LogboekItem, "voorbeeld" | "beoordeelbaar">): LogboekItem =>
    ({ ...item, beoordeelbaar: false, voorbeeld: true });
  const ECHT = "Bij een echte klant staat hier de knop Beoordeel, die naar Bevindingen leidt; dit voorbeeld staat daar niet.";
  return [
    v({
      id: "voorbeeld:sync-vanochtend", soort: "sync", kanaal: "google", tijd: op(0, 6, 44),
      titel: "Nachtelijke sync van Google Ads geslaagd", chip: null, toon: "neutraal",
      detail: ["Zo ziet de nachtelijke sync eruit bij een klant met een koppeling. De demo heeft geen koppeling; tot welke dag de demodata werkelijk loopt, staat in de bronrij onder de grafiek."],
    }),
    v({
      id: "voorbeeld:voorstel-blog", soort: "voorstel", kanaal: "meta", tijd: op(1, 14, 41),
      titel: "GreenTech Blog Traffic pauzeren, budget naar GRA", chip: "ICE 7,7", toon: "voorstel",
      detail: [
        "De CTR van Blog Traffic halveerde terwijl de besteding steeg; GRA zit in de aanloop naar de beurs en haalt meer uit hetzelfde budget.",
        "Verwacht: lagere kosten per conversie op Meta bij gelijke besteding.",
        ECHT,
      ],
    }),
    v({
      id: "voorbeeld:analyse-meta", soort: "analyse", kanaal: "meta", tijd: op(1, 14, 38),
      titel: "Tweewekelijkse analyse Meta afgerond", chip: "klaar", toon: "goed",
      detail: ["Zo staat een afgeronde analyse in het logboek; de voorstellen die eruit komen wachten in Bevindingen op een oordeel.", ECHT],
    }),
    v({
      id: "voorbeeld:hypothese-negatives", soort: "hypothese", kanaal: "microsoft", tijd: op(2, 9, 15),
      titel: "Verouderde negatives op de importcampagne vervangen verlaagt de verspilling", chip: "geslaagd", toon: "goed",
      detail: ["De verspilling op zoektermen als 'greenhouse jobs' daalde in het meetvenster tot onder de grens die vooraf was afgesproken.", ECHT],
    }),
    v({
      id: "voorbeeld:datastand-linkedin", soort: "datastand", kanaal: "linkedin", tijd: op(4, 6, 51),
      titel: "LinkedIn-sync slaagt weer", chip: "hersteld", toon: "goed",
      detail: ["Na 2 mislukte pogingen kwam er weer data binnen. Bij een echte klant staat hier wat de sync als reden gaf."],
    }),
    v({
      id: "voorbeeld:todo-beurs", soort: "todo", kanaal: null, tijd: op(5, 16, 20),
      titel: "Standbouwer bellen over de leadscanner", chip: "open", toon: "let-op",
      detail: ["Zo staat een to-do uit Notities in het logboek."],
    }),
  ].filter((i) => Date.parse(i.tijd) <= nu.getTime());
}

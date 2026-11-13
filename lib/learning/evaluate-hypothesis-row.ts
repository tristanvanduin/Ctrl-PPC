// De beslissing per hypothese: van één sprint_hypotheses-rij plus weekdata naar één oordeel.
//
// ── WAAROM DIT UIT DE ROUTE IS GEHAALD ──────────────────────────────────────
//
// Deze keten stond inline in app/api/cron/evaluate-hypotheses/route.ts, verweven met de
// auth-check, de supabase-reads en het wegschrijven. Daardoor was hij alleen te draaien met een
// echte database en een echte cron-aanroep, en stond er dus ook `LIVE-ONGETEST` boven dat bestand.
// Dat is precies de stap die de lerende lus sluit -- de enige plek waar het systeem terugkijkt of
// een belofte is uitgekomen -- en juist die was nergens op te toetsen.
//
// Zelfde opzet als lib/eval/replay-core.ts: de route is een dunne schil, alle logica leeft hier,
// puur en op fixtures te draaien. De route houdt wat hij hoort te houden: autoriseren, lezen,
// schrijven.
//
// ── DE VOLGORDE VAN DE BESLISSING ───────────────────────────────────────────
//
// Er zijn vier manieren waarop een hypothese GEEN oordeel krijgt, en ze betekenen alle vier iets
// anders. Ze door elkaar halen is de fout die deze module voorkomt:
//
//  1. Niet toetsbaar geformuleerd  -- de tekst draagt geen meetbare belofte.
//  2. Het venster loopt nog        -- te vroeg, kom later terug (geen verdict, geen schrijfactie).
//  3. Metric niet af te leiden     -- de belofte is meetbaar, maar niet uit accountweekdata.
//  4. Onvoldoende volume / inactief -- er is gemeten, maar er valt niets te concluderen.
//
// Alleen bij een echt oordeel komt daar de uitvoeringsdetectie overheen, en die kan een verworpen
// hypothese alsnog tot "niet_uitgevoerd" maken: een beweging die niet aan een interventie is toe te
// schrijven is geen leerpunt over die interventie.

import { parseHypothesis, resolvePredicate, DEFAULT_WINDOW_DAYS } from "./hypothesis-parser";
import { evaluateHypothesisOutcome, detectExecutionAccountWide, type ChangeEvent, type Predicate } from "./hypothesis-evaluator";
import { aggregateWeeks, weeksInWindow, addDays, isDerivableMetric, type WeeklyRow } from "./weekly-metrics";
import { KANAAL_NAAM, kanaalVoorBron, type HypotheseKanaal } from "./kanaal-weekdata";
import { medianAbsoluteDeviation } from "@/lib/util/stats";

// Staat in hypothesis-parser.ts zodat de meetbaarheid bij het wegschrijven en dit oordeel
// hetzelfde venster aannemen; hier doorgegeven voor wie hem van oudsher hier importeert.
export { DEFAULT_WINDOW_DAYS };

export const ACCOUNT_SCOPE_NOTE =
  "Gemeten op accountniveau: de hypothese draagt geen entiteit-referentie en er is geen campagne-weekdata, dus een effect op een enkele campagne kan in het accountgemiddelde wegvallen.";

/**
 * Hoeveel weken voor acceptatie de spreiding geschat wordt. Bewust los van het meetvenster: met
 * een venster van 7 of 14 dagen had de spreiding anders uit 1 of 2 weken moeten komen, en dan
 * werd elk voorstel zonder drempel met zo'n venster altijd "unmeasurable" -- terwijl de
 * meetbaarheid bij het wegschrijven het als meetbaar had vastgelegd (doorlichting, herstelronde).
 */
export const RUIS_BASELINE_WEKEN = 12;

/**
 * Minder weken dan dit in die twaalf: geen spreiding te schatten, dus geen ruisband. Een MAD uit
 * drie of vier weken springt alle kanten op; bij zes is hij bruikbaar.
 */
export const MIN_BASELINE_WEKEN = 6;

/** De grootheden die aggregateWeeks over het venster OPTELT; de rest zijn ratio's uit die sommen. */
const SOM_METRIEKEN = new Set(["impressions", "clicks", "cost", "conversions", "conversions_value"]);

/** Een volumeguardrail is nooit strenger dan dit deel van de baseline. */
export const VOLUME_MARGE = 0.2;

export interface HypothesisRow {
  id: string;
  client_id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  accepted_at: string | null;
  /** sprint_hypotheses.source: bepaalt het kanaal waartegen gemeten wordt. */
  source?: string | null;
}

export interface Verdict {
  verdict: string;
  resultMet: boolean | null;
  reason: string;
  metrics: unknown;
}

export type RijUitkomst =
  /** Bewust nog geen oordeel: het meetvenster is niet verstreken. Niet wegschrijven. */
  | { soort: "overgeslagen"; reden: string }
  /**
   * Het venster is voorbij, maar de data van het kanaal houdt eerder op (stilgevallen sync). Dat is
   * geen uitkomst van het voorstel: vastleggen als "niet te beoordelen, geen data" en later opnieuw
   * proberen, nooit definitief afsluiten. De oude evaluator schreef hier "expired" of "niet
   * uitgevoerd" weg en sloeg de rij daarna voor altijd over.
   */
  | { soort: "geen_data"; reden: string }
  /** Een oordeel, klaar om weg te schrijven. */
  | { soort: "oordeel"; uitkomst: Verdict };

export function describeOutcome(
  verdict: string,
  metric: string,
  baseline: number | undefined,
  measured: number | undefined
): string {
  const b = typeof baseline === "number" ? baseline.toFixed(2) : "onbekend";
  const m = typeof measured === "number" ? measured.toFixed(2) : "onbekend";
  return `${metric} ging van ${b} in het venster voor acceptatie naar ${m} erna; verdict ${verdict}.`;
}

/**
 * De ruisband: hoe groot een verschil tussen twee vensters van n weken door gewone week-op-week-
 * schommeling kan zijn, in DEZELFDE eenheid als de vergelijking in judge(). Robuuste spreiding per
 * week (1,4826 x MAD) uit de weken voor acceptatie, maal de 95%-grens (zie onder):
 *
 * - Een somgrootheid (conversies, klikken, kosten) vergelijkt de SOM over n weken met de som over
 *   n weken. Het verschil van twee sommen spreidt met sigma x wortel(2n).
 * - Een ratio (CPA, CTR) is over n weken ongeveer een gemiddelde van weekwaarden; het verschil van
 *   twee gemiddelden spreidt met sigma x wortel(2/n).
 *
 * De eerste versie rekende voor alles met wortel(2/n). Bij vier weken was de band voor conversies
 * daardoor vier keer te smal, en haalde pure ruis "conversies stijgen" in 34% van de gevallen.
 * Null als er te weinig weken zijn om een spreiding te schatten.
 */
export function ruisbandVoor(metric: string, spreidingsWeken: WeeklyRow[], vensterWeken: number): number | null {
  const waarden = spreidingsWeken
    .map((w) => aggregateWeeks([w])[metric])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (waarden.length < MIN_BASELINE_WEKEN) return null;
  const mad = medianAbsoluteDeviation(waarden);
  if (mad == null) return null;
  const n = Math.max(1, vensterWeken);
  const schaal = SOM_METRIEKEN.has(metric) ? Math.sqrt(2 * n) : Math.sqrt(2 / n);
  // De spreiding is zelf geschat, uit een handvol weken: een MAD uit twaalf waarden is
  // gemiddeld te klein (correctie n/(n-0,8)) en springt op en neer, dus de grens is de
  // t-waarde bij die vrijheidsgraden en niet 1,96. Zonder die twee haalde pure ruis 5 tot 7%.
  const k = waarden.length;
  const madCorrectie = k > 9 ? k / (k - 0.8) : MAD_CORRECTIE_KLEIN[k] ?? 1.2;
  return tWaarde975(k - 1) * 1.4826 * madCorrectie * mad * schaal;
}

// Croux en Rousseeuw: de MAD onderschat de spreiding bij kleine steekproeven.
const MAD_CORRECTIE_KLEIN: Record<number, number> = { 6: 1.2, 7: 1.15, 8: 1.13, 9: 1.11 };

/** 97,5%-kwantiel van de t-verdeling; boven 30 vrijheidsgraden is 1,96 goed genoeg. */
function tWaarde975(df: number): number {
  const tabel: Record<number, number> = { 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 20: 2.086, 25: 2.06, 30: 2.042 };
  if (df >= 30) return 1.96;
  const sleutels = Object.keys(tabel).map(Number).filter((d) => d <= df);
  return tabel[Math.max(5, ...sleutels)];
}

export function evaluateHypothesisRow(opts: {
  row: HypothesisRow;
  /**
   * De weekrijen van HET KANAAL van deze hypothese, op week_start gesorteerd: ads_account_weekly
   * voor Google, de dagtabel van Meta, LinkedIn of Microsoft via weekRijenUitDagen.
   */
  weekly: WeeklyRow[];
  /** De al geclassificeerde wijzigingshistorie van deze klant. */
  changeEvents: ChangeEvent[];
  now: Date;
  defaultWindowDays?: number;
}): RijUitkomst {
  const { row, weekly, changeEvents, now } = opts;
  const acceptedAt = new Date(row.accepted_at as string);
  const kanaal: HypotheseKanaal | null = kanaalVoorBron(row.source);

  const parsed = parseHypothesis({
    expectedResult: row.expected_result,
    measurementMetric: row.measurement_metric,
    timeframe: row.timeframe,
  });

  // Een onparsebare hypothese krijgt geen gegokt verdict maar een eerlijke reden.
  if (!parsed.ok) {
    return {
      soort: "oordeel",
      uitkomst: { verdict: "unmeasurable", resultMet: null, reason: `niet toetsbaar geformuleerd: ${parsed.reason}`, metrics: [] },
    };
  }

  const windowDays = parsed.parsed.windowDays ?? opts.defaultWindowDays ?? DEFAULT_WINDOW_DAYS;
  const windowEnd = addDays(acceptedAt, windowDays);
  if (windowEnd > now) {
    return {
      soort: "overgeslagen",
      reden: `het meetvenster van ${windowDays} dagen loopt nog tot ${windowEnd.toISOString().slice(0, 10)}`,
    };
  }

  const metric = parsed.parsed.predicate.metric;
  if (!isDerivableMetric(metric)) {
    return {
      soort: "oordeel",
      uitkomst: {
        verdict: "unmeasurable",
        resultMet: null,
        reason: `de metric ${metric} zit niet in de weekdata op accountniveau, dus er is niets om tegen te meten`,
        metrics: [],
      },
    };
  }

  // Een voorstel over meer dan een kanaal heeft geen weektabel die het meet; een blended cijfer
  // zou weer een kanaal laten meetellen waar het voorstel niet over ging.
  if (kanaal === null) {
    return {
      soort: "oordeel",
      uitkomst: {
        verdict: "unmeasurable",
        resultMet: null,
        reason: `dit voorstel (bron ${row.source}) gaat over meer dan een kanaal; er is geen weektabel die het afzonderlijk meet`,
        metrics: [],
      },
    };
  }
  const kanaalNaam = KANAAL_NAAM[kanaal];

  // Loopt de data van dit kanaal tot het einde van het venster? Een stilgevallen sync is geen
  // uitkomst: er is niets gemeten, en het voorstel krijgt later een nieuwe kans.
  const laatsteWeek = weekly.reduce<string | null>((m, w) => (m == null || w.week_start > m ? w.week_start : m), null);
  const nodigTot = addDays(windowEnd, -7).toISOString().slice(0, 10);
  if (laatsteWeek == null || laatsteWeek < nodigTot) {
    return {
      soort: "geen_data",
      reden: `niet te beoordelen, geen data: de weekdata van ${kanaalNaam} loopt ${laatsteWeek ? `tot de week van ${laatsteWeek}` : "nergens"}, het meetvenster tot ${windowEnd.toISOString().slice(0, 10)}. Wordt opnieuw geprobeerd zodra de data er is.`,
    };
  }

  const baseline = aggregateWeeks(weeksInWindow(weekly, addDays(acceptedAt, -windowDays), acceptedAt));
  const spreidingsWeken = weeksInWindow(weekly, addDays(acceptedAt, -7 * RUIS_BASELINE_WEKEN), acceptedAt);
  const measured = aggregateWeeks(weeksInWindow(weekly, acceptedAt, windowEnd));
  const vensterWeken = Math.max(1, Math.round(windowDays / 7));

  // De relatieve eis omzetten met de ECHTE baseline: de evaluator leest de drempel als absolute
  // magnitude, dus zonder deze stap zou vijftien procent als 0,15 euro gelden.
  let predicate: Predicate = resolvePredicate(parsed.parsed, baseline);
  let ruisNotitie = "";
  if (predicate.threshold == null && (predicate.direction === "increase" || predicate.direction === "decrease")) {
    // Zonder drempel telde elke beweging: een CPA van 25,00 naar 24,99 was "gehaald". Nu moet de
    // beweging buiten de gewone week-op-week-schommeling van de baseline vallen.
    const ruis = ruisbandVoor(predicate.metric, spreidingsWeken, vensterWeken);
    if (ruis == null) {
      return {
        soort: "oordeel",
        uitkomst: {
          verdict: "unmeasurable",
          resultMet: null,
          reason: `het voorstel noemt geen drempel, en met minder dan ${MIN_BASELINE_WEKEN} weken data van ${kanaalNaam} in de ${RUIS_BASELINE_WEKEN} weken voor acceptatie is ruis niet van een effect te scheiden`,
          metrics: [],
        },
      };
    }
    predicate = { ...predicate, noiseBand: ruis };
    ruisNotitie = ` Geen drempel genoemd: telt pas boven de ruisband van ${ruis.toFixed(2)} (week-op-week-spreiding in de ${RUIS_BASELINE_WEKEN} weken voor acceptatie).`;
  }

  // Minstens een guardrail op volume: een CPA die daalt doordat een kwart van de conversies
  // wegvalt is geen geslaagd voorstel. Gaat het voorstel over conversies zelf, dan bewaken de klikken.
  const volumeMetric = predicate.metric === "conversions" ? "clicks" : "conversions";
  const guardrails: Predicate[] = [];
  const volumeBasis = baseline[volumeMetric];
  if (typeof volumeBasis === "number" && volumeBasis > 0) {
    const volumeRuis = ruisbandVoor(volumeMetric, spreidingsWeken, vensterWeken) ?? 0;
    guardrails.push({ metric: volumeMetric, direction: "no_drop", threshold: Math.max(volumeBasis * VOLUME_MARGE, volumeRuis) });
  }

  const metriekUitkomst = evaluateHypothesisOutcome({
    successPredicates: [predicate],
    guardrailPredicates: guardrails,
    baseline,
    measured,
    windowImpressions: measured.impressions ?? 0,
    entityActive: (measured.cost ?? 0) > 0,
    ageInDays: Math.floor((now.getTime() - acceptedAt.getTime()) / (24 * 3600 * 1000)),
  });

  const geschonden = metriekUitkomst.metrics.find((m) => m.kind === "guardrail" && m.met === false);
  const guardrailNotitie = geschonden
    ? ` Guardrail geschonden: ${geschonden.metric} ging van ${geschonden.baseline?.toFixed(0)} naar ${geschonden.measured?.toFixed(0)}.`
    : "";
  const metriekReden = `${describeOutcome(metriekUitkomst.verdict, predicate.metric, baseline[predicate.metric], measured[predicate.metric])}${ruisNotitie}${guardrailNotitie} Gemeten op de cijfers van ${kanaalNaam}. ${ACCOUNT_SCOPE_NOTE}`;

  let verdict: string = metriekUitkomst.verdict;
  let resultMet: boolean | null = metriekUitkomst.verdict === "accepted" ? true : metriekUitkomst.verdict === "rejected" ? false : null;
  let reason = metriekReden;

  // Uitvoeringsdetectie: alleen zinvol als de metriek zelf al een oordeel opleverde. Bij
  // unmeasurable/expired is er sowieso geen betrouwbaar gemeten effect om aan uitvoering te
  // koppelen, en verandert de uitvoeringsstatus niets aan het verdict.
  if (metriekUitkomst.verdict === "accepted" || metriekUitkomst.verdict === "rejected") {
    const vensterStart = acceptedAt.toISOString().slice(0, 10);
    const vensterEind = windowEnd.toISOString().slice(0, 10);
    const vensterEvents = changeEvents.filter((e) => e.date >= vensterStart && e.date <= vensterEind);
    // ads_change_history is de GOOGLE-wijzigingshistorie: een pauze in Meta kan daar nooit staan,
    // dus voor elk ander kanaal is uitvoering onbekend, nooit "niet uitgevoerd". En een lege
    // historie is geen dekking: dan zegt "niets gevonden" iets over de sync, niet over de specialist
    // (demo-greentech heeft 0 rijen, en elke pauze- of budgethypothese werd daar "niet_uitgevoerd").
    const dekking = kanaal === "google_ads" && changeEvents.length > 0;
    const uitvoering = detectExecutionAccountWide(row.hypothesis, vensterEvents, dekking);

    if (uitvoering.status === "not_executed") {
      // Verworpen maar niet uitgevoerd is een andere les dan uitgevoerd en verworpen (zie de kop
      // van hypothesis-evaluator.ts): het metriekverdict wint hier niet.
      verdict = "niet_uitgevoerd";
      resultMet = null;
      reason = `${metriekReden} Niet uitgevoerd: geen wijziging van het bedoelde type gevonden in ads_change_history in het meetvenster, dus de gemeten beweging kan niet aan deze interventie worden toegeschreven.`;
    } else if (uitvoering.status === "detected") {
      verdict = metriekUitkomst.verdict === "accepted" ? "uitgevoerd_en_gehaald" : "uitgevoerd_en_niet_gehaald";
      reason = `${metriekReden} Uitgevoerd: ${uitvoering.evidence}.`;
    } else {
      reason = dekking
        ? `${metriekReden} Uitvoering niet vast te stellen: de interventietekst bevat geen herkenbaar wijzigingstype (budget, bod, pauze, zoekwoord) om tegen ads_change_history te toetsen.`
        : `${metriekReden} Uitvoering niet vast te stellen: er is geen wijzigingshistorie van ${kanaalNaam} om tegen te toetsen.`;
    }
  }

  return { soort: "oordeel", uitkomst: { verdict, resultMet, reason, metrics: metriekUitkomst.metrics } };
}

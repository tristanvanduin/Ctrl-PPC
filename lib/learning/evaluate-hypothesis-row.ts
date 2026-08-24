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

import { parseHypothesis, resolvePredicate } from "./hypothesis-parser";
import { evaluateHypothesisOutcome, detectExecutionAccountWide, type ChangeEvent } from "./hypothesis-evaluator";
import { aggregateWeeks, weeksInWindow, addDays, isDerivableMetric, type WeeklyRow } from "./weekly-metrics";

/** Als de hypothese zelf geen bruikbaar tijdvenster noemt. */
export const DEFAULT_WINDOW_DAYS = 28;

export const ACCOUNT_SCOPE_NOTE =
  "Gemeten op accountniveau: de hypothese draagt geen entiteit-referentie en er is geen campagne-weekdata, dus een effect op een enkele campagne kan in het accountgemiddelde wegvallen.";

export interface HypothesisRow {
  id: string;
  client_id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  accepted_at: string | null;
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

export function evaluateHypothesisRow(opts: {
  row: HypothesisRow;
  /** Alle accountweekrijen van deze klant, op week_start gesorteerd. */
  weekly: WeeklyRow[];
  /** De al geclassificeerde wijzigingshistorie van deze klant. */
  changeEvents: ChangeEvent[];
  now: Date;
  defaultWindowDays?: number;
}): RijUitkomst {
  const { row, weekly, changeEvents, now } = opts;
  const acceptedAt = new Date(row.accepted_at as string);

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

  const baseline = aggregateWeeks(weeksInWindow(weekly, addDays(acceptedAt, -windowDays), acceptedAt));
  const measured = aggregateWeeks(weeksInWindow(weekly, acceptedAt, windowEnd));

  // De relatieve eis omzetten met de ECHTE baseline: de evaluator leest de drempel als absolute
  // magnitude, dus zonder deze stap zou vijftien procent als 0,15 euro gelden.
  const predicate = resolvePredicate(parsed.parsed, baseline);
  const metriekUitkomst = evaluateHypothesisOutcome({
    successPredicates: [predicate],
    guardrailPredicates: [],
    baseline,
    measured,
    windowImpressions: measured.impressions ?? 0,
    entityActive: (measured.cost ?? 0) > 0,
    ageInDays: Math.floor((now.getTime() - acceptedAt.getTime()) / (24 * 3600 * 1000)),
  });

  const metriekReden = `${describeOutcome(metriekUitkomst.verdict, predicate.metric, baseline[predicate.metric], measured[predicate.metric])} ${ACCOUNT_SCOPE_NOTE}`;

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
    const uitvoering = detectExecutionAccountWide(row.hypothesis, vensterEvents, true);

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
      reason = `${metriekReden} Uitvoering niet vast te stellen: de interventietekst bevat geen herkenbaar wijzigingstype (budget, bod, pauze, zoekwoord) om tegen ads_change_history te toetsen.`;
    }
  }

  return { soort: "oordeel", uitkomst: { verdict, resultMet, reason, metrics: metriekUitkomst.metrics } };
}

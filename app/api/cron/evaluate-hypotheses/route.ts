// =====================================================================
// De H1 cron-evaluator: de stap die de lerende loop sluit. Per klant worden de aangenomen
// hypotheses waarvan het meetvenster verstreken is tegen de realisatie gelegd, en het
// verdict wordt weggeschreven zodat het via de memory-laag terug de prompts in reist.
//
// GEEN SNAPSHOT NODIG: de baseline wordt RETROACTIEF gereconstrueerd uit de weken voor
// accepted_at, en de realisatie uit de weken erna. Dat is beter dan een persist-haak bij
// acceptatie: geen race-condities, en het werkt ook voor hypotheses die eerder zijn
// aangenomen.
//
// EERLIJKE BEPERKING OP DE METRIEK, in elke uitkomst vermeld: sprint_hypotheses draagt geen
// entiteit-referentie en er bestaat geen campagne-weekdata (alleen ads_account_weekly en
// ads_country_weekly). Meten kan daarom UITSLUITEND op accountniveau. Een hypothese over een
// enkele campagne afmeten aan het accountgemiddelde is ruis; dat staat in de reden zodat
// niemand het verdict zwaarder weegt dan het verdient.
//
// UITVOERINGSDETECTIE, apart van de metriek: ads_change_history draagt WEL een campagnenaam
// per wijziging. Dat lost de metriekbeperking hierboven niet op (nog steeds geen
// campagne-weekdata om een effect aan op te hangen), maar het beantwoordt een eerdere, andere
// vraag: is de interventie uberhaupt doorgevoerd, ongeacht wie dat deed (specialist, tool of
// script)? Zonder herkenbaar type in de tekst blijft dit onbekend, nooit een gok. Zie
// lib/learning/hypothesis-evaluator.ts (detectExecutionAccountWide) en
// lib/learning/change-history-classifier.ts. Een hypothese die nooit is aangeraakt levert
// daardoor "niet_uitgevoerd" op in plaats van een verworpen verdict dat suggereert dat de
// interventie is geprobeerd en mislukt: dat is een andere les, en de kop van
// hypothesis-evaluator.ts zei dat al voordat dit bestand het waarmaakte.
//
// LIVE-ONGETEST: vergt migratie 021 en aangenomen hypotheses met een verstreken venster.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { parseHypothesis, resolvePredicate } from "@/lib/learning/hypothesis-parser";
import { evaluateHypothesisOutcome, detectExecutionAccountWide, type ChangeEvent } from "@/lib/learning/hypothesis-evaluator";
import { classificeerChangeHistory, type RawChangeHistoryRow } from "@/lib/learning/change-history-classifier";
import { aggregateWeeks, weeksInWindow, addDays, isDerivableMetric, type WeeklyRow } from "@/lib/learning/weekly-metrics";
import { recordMemoryEvent, memoryEventsForVerdict } from "@/lib/memory/agency-memory-events";

export const maxDuration = 300;

const DEFAULT_WINDOW_DAYS = 28; // als de hypothese geen bruikbaar tijdvenster noemt
const ACCOUNT_SCOPE_NOTE =
  "Gemeten op accountniveau: de hypothese draagt geen entiteit-referentie en er is geen campagne-weekdata, dus een effect op een enkele campagne kan in het accountgemiddelde wegvallen.";

interface HypothesisRow {
  id: string;
  client_id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  accepted_at: string | null;
}

export async function GET(request: NextRequest) {
  // Fail-closed, zoals de andere cron- en eval-routes.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET niet geconfigureerd; de evaluator weigert bewust te draaien" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "niet geautoriseerd" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const clientFilter = url.searchParams.get("client_id");

  // De kandidaten: aangenomen, met een acceptatiemoment, nog niet geevalueerd.
  let query = supabase
    .from("sprint_hypotheses")
    .select("id, client_id, hypothesis, expected_result, measurement_metric, timeframe, accepted_at")
    .eq("status", "accepted")
    .not("accepted_at", "is", null)
    .is("evaluated_at", null);
  if (clientFilter) query = query.eq("client_id", clientFilter);
  const { data: candidates, error: readError } = await query.limit(200);
  if (readError) return Response.json({ error: readError.message }, { status: 500 });

  const rows = (candidates ?? []) as HypothesisRow[];
  const now = new Date();
  const results: Array<{ id: string; verdict: string; reason: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  // Weekdata en changehistory per klant, eenmalig geladen.
  const weeklyByClient = new Map<string, WeeklyRow[]>();
  const changeHistoryByClient = new Map<string, ChangeEvent[]>();
  for (const clientId of new Set(rows.map((r) => r.client_id))) {
    const [{ data: weekly }, { data: changes }] = await Promise.all([
      supabase
        .from("ads_account_weekly")
        .select("week_start, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId)
        .order("week_start"),
      supabase
        .from("ads_change_history")
        .select("resource_type, change_type, campaign_name, change_datetime, old_value, new_value")
        .eq("client_id", clientId)
        .order("change_datetime"),
    ]);
    weeklyByClient.set(clientId, (weekly ?? []) as WeeklyRow[]);
    changeHistoryByClient.set(clientId, classificeerChangeHistory((changes ?? []) as RawChangeHistoryRow[]));
  }

  for (const row of rows) {
    const acceptedAt = new Date(row.accepted_at as string);
    const parsed = parseHypothesis({
      expectedResult: row.expected_result,
      measurementMetric: row.measurement_metric,
      timeframe: row.timeframe,
    });

    // Een onparsebare hypothese krijgt geen gegokt verdict maar een eerlijke reden.
    if (!parsed.ok) {
      const outcome = { verdict: "unmeasurable", resultMet: null, reason: `niet toetsbaar geformuleerd: ${parsed.reason}`, metrics: [] };
      results.push({ id: row.id, verdict: outcome.verdict, reason: outcome.reason });
      if (!dryRun) await writeVerdict(supabase, row.id, row.client_id, outcome, now);
      continue;
    }

    const windowDays = parsed.parsed.windowDays ?? DEFAULT_WINDOW_DAYS;
    const windowEnd = addDays(acceptedAt, windowDays);
    if (windowEnd > now) {
      skipped.push({ id: row.id, reason: `het meetvenster van ${windowDays} dagen loopt nog tot ${windowEnd.toISOString().slice(0, 10)}` });
      continue;
    }

    const metric = parsed.parsed.predicate.metric;
    if (!isDerivableMetric(metric)) {
      const outcome = { verdict: "unmeasurable", resultMet: null, reason: `de metric ${metric} zit niet in de weekdata op accountniveau, dus er is niets om tegen te meten`, metrics: [] };
      results.push({ id: row.id, verdict: outcome.verdict, reason: outcome.reason });
      if (!dryRun) await writeVerdict(supabase, row.id, row.client_id, outcome, now);
      continue;
    }

    const weekly = weeklyByClient.get(row.client_id) ?? [];
    const baseline = aggregateWeeks(weeksInWindow(weekly, addDays(acceptedAt, -windowDays), acceptedAt));
    const measured = aggregateWeeks(weeksInWindow(weekly, acceptedAt, windowEnd));

    // De relatieve eis omzetten met de ECHTE baseline: de evaluator leest de drempel als
    // absolute magnitude, dus zonder deze stap zou vijftien procent als 0,15 euro gelden.
    const predicate = resolvePredicate(parsed.parsed, baseline);
    const metrickUitkomst = evaluateHypothesisOutcome({
      successPredicates: [predicate],
      guardrailPredicates: [],
      baseline,
      measured,
      windowImpressions: measured.impressions ?? 0,
      entityActive: (measured.cost ?? 0) > 0,
      ageInDays: Math.floor((now.getTime() - acceptedAt.getTime()) / (24 * 3600 * 1000)),
    });

    const metrickReden = `${describeOutcome(metrickUitkomst.verdict, predicate.metric, baseline[predicate.metric], measured[predicate.metric])} ${ACCOUNT_SCOPE_NOTE}`;

    // Uitvoeringsdetectie: alleen zinvol als de metriek zelf al een oordeel (accepted/rejected)
    // opleverde. Bij unmeasurable/expired is er sowieso geen betrouwbaar gemeten effect om aan
    // uitvoering te koppelen, en verandert de uitvoeringsstatus niets aan het verdict.
    let verdict: string = metrickUitkomst.verdict;
    let resultMet: boolean | null = metrickUitkomst.verdict === "accepted" ? true : metrickUitkomst.verdict === "rejected" ? false : null;
    let reason = metrickReden;

    if (metrickUitkomst.verdict === "accepted" || metrickUitkomst.verdict === "rejected") {
      const vensterStart = acceptedAt.toISOString().slice(0, 10);
      const vensterEind = windowEnd.toISOString().slice(0, 10);
      const alleEvents = changeHistoryByClient.get(row.client_id) ?? [];
      const vensterEvents = alleEvents.filter((e) => e.date >= vensterStart && e.date <= vensterEind);
      const uitvoering = detectExecutionAccountWide(row.hypothesis, vensterEvents, true);

      if (uitvoering.status === "not_executed") {
        // Verworpen maar niet uitgevoerd is een andere les dan uitgevoerd en verworpen (zie de
        // kop van hypothesis-evaluator.ts): het metriekverdict wint hier niet, want een beweging
        // die niet aan een interventie is toe te schrijven is geen leerpunt over die interventie.
        verdict = "niet_uitgevoerd";
        resultMet = null;
        reason = `${metrickReden} Niet uitgevoerd: geen wijziging van het bedoelde type gevonden in ads_change_history in het meetvenster, dus de gemeten beweging kan niet aan deze interventie worden toegeschreven.`;
      } else if (uitvoering.status === "detected") {
        verdict = metrickUitkomst.verdict === "accepted" ? "uitgevoerd_en_gehaald" : "uitgevoerd_en_niet_gehaald";
        reason = `${metrickReden} Uitgevoerd: ${uitvoering.evidence}.`;
      } else {
        reason = `${metrickReden} Uitvoering niet vast te stellen: de interventietekst bevat geen herkenbaar wijzigingstype (budget, bod, pauze, zoekwoord) om tegen ads_change_history te toetsen.`;
      }
    }

    const outcome = { verdict, resultMet, reason, metrics: metrickUitkomst.metrics };
    results.push({ id: row.id, verdict: outcome.verdict, reason: outcome.reason });
    if (!dryRun) await writeVerdict(supabase, row.id, row.client_id, outcome, now);
  }

  return Response.json({
    dry_run: dryRun,
    kandidaten: rows.length,
    geevalueerd: results.length,
    overgeslagen: skipped.length,
    results,
    skipped,
  });
}

function describeOutcome(verdict: string, metric: string, baseline: number | undefined, measured: number | undefined): string {
  const b = typeof baseline === "number" ? baseline.toFixed(2) : "onbekend";
  const m = typeof measured === "number" ? measured.toFixed(2) : "onbekend";
  return `${metric} ging van ${b} in het venster voor acceptatie naar ${m} erna; verdict ${verdict}.`;
}

async function writeVerdict(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  id: string,
  clientId: string,
  outcome: { verdict: string; resultMet: boolean | null; reason: string; metrics: unknown },
  now: Date
): Promise<void> {
  const { data, error } = await supabase
    .from("sprint_hypotheses")
    .update({
      outcome: outcome.verdict,
      result_met: outcome.resultMet,
      learning: outcome.reason,
      verdict_metrics: outcome.metrics,
      evaluated_at: now.toISOString(),
    })
    .eq("id", id)
    .is("evaluated_at", null) // idempotent: een tweede cron-run overschrijft geen bestaand verdict
    .select("id");
  if (error) {
    console.error(`[evaluate-hypotheses] schrijven van uitkomst voor ${id} mislukt: ${error.message}`);
    return;
  }
  // Fase 4: alleen memory-events schrijven als DEZE aanroep het verdict daadwerkelijk zette --
  // .select() hierboven onderscheidt dat van "een gelijktijdige run was net eerder", wat zonder
  // deze check een dubbel event had opgeleverd voor dezelfde evaluatie.
  if ((data ?? []).length === 0) return;
  const metrics = (outcome.metrics ?? null) as Record<string, unknown> | null;
  await Promise.all(
    memoryEventsForVerdict(outcome.verdict).map((eventType) =>
      recordMemoryEvent(supabase, { clientId, hypothesisId: id, eventType, reason: outcome.reason, metrics })
    )
  );
}

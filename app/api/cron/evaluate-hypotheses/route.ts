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
// TESTSTATUS, per laag verschillend -- dat onderscheid telt.
//
// De BESLISSING is niet langer ongetoetst: hij is verhuisd naar
// lib/learning/evaluate-hypothesis-row.ts en draait daar op fixtures
// (lib/learning/__evaluate_hypothesis_row_test.ts), inclusief de vier manieren waarop er geen
// oordeel komt, de baseline-reconstructie, de omzetting van een relatieve drempel met de echte
// baseline, en de uitvoeringsdetectie die een oordeel kan omdraaien. Ook op de 26 echte weekrijen
// uit de demo-data, zodat het niet alleen op speelgoedgetallen bewezen is.
//
// Wat WEL ongetoetst blijft is deze schil: de supabase-reads hierboven, het wegschrijven in
// writeVerdict en de idempotentie daarvan (.is("evaluated_at", null)). Dat vergt migratie 021 en
// een echte database; het is bewust klein gehouden zodat er weinig overblijft om fout te gaan.
//
// NIET IN vercel.json (17 augustus 2026, op verzoek van de eigenaar: "ik wil geen API-kosten
// maken in de nacht en ik wil zelf testen kunnen draaien"). Stond er kort in, samen met
// evaluate-code-rood -- pas nadat isCronPath() (lib/auth/roles.ts) gefixt was om /api/cron/* te
// herkennen, wat ze voor het eerst daadwerkelijk liet vuren. Beide eruit gehaald voordat de fix
// live ging, om onbewaakt nachtelijk draaien te voorkomen. Handmatig testen:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://www.ctrlppc.com/api/cron/evaluate-hypotheses?dry_run=true"
// Zelfde afweging als lib/scheduler/sop-cadence.ts/trigger-sops: klaargezet, niet actief.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { type ChangeEvent } from "@/lib/learning/hypothesis-evaluator";
import { classificeerChangeHistory, type RawChangeHistoryRow } from "@/lib/learning/change-history-classifier";
import { type WeeklyRow } from "@/lib/learning/weekly-metrics";
// De beslissing per hypothese leeft in lib/learning/evaluate-hypothesis-row.ts, puur en op
// fixtures te draaien -- zelfde opzet als lib/eval/replay-core.ts. Deze route houdt wat een route
// hoort te houden: autoriseren, lezen, schrijven.
import { evaluateHypothesisRow, type HypothesisRow } from "@/lib/learning/evaluate-hypothesis-row";
import { recordMemoryEvent, memoryEventsForVerdict } from "@/lib/memory/agency-memory-events";

export const maxDuration = 300;

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
    const uitkomst = evaluateHypothesisRow({
      row,
      weekly: weeklyByClient.get(row.client_id) ?? [],
      changeEvents: changeHistoryByClient.get(row.client_id) ?? [],
      now,
    });

    if (uitkomst.soort === "overgeslagen") {
      skipped.push({ id: row.id, reason: uitkomst.reden });
      continue;
    }

    results.push({ id: row.id, verdict: uitkomst.uitkomst.verdict, reason: uitkomst.uitkomst.reason });
    if (!dryRun) await writeVerdict(supabase, row.id, row.client_id, uitkomst.uitkomst, now);
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

// Fase 3 (docs/MASTERPLAN.md sectie 9): de werker voor de generation_jobs-action-queue.
//
// Zelfde cron-skelet als evaluate-hypotheses/evaluate-code-rood: fail-closed op CRON_SECRET,
// ?dry_run=true en ?job_type= voor handmatig testen, maxDuration 300, per-item try/catch zodat
// één kapotte job de run niet stopt.
//
// BEWUST NOG GEEN ECHTE SOP-JOBS HIERLANGS: monthly_sop/weekly_sop/biweekly_sop/second_opinion/
// report_generation/pdf_generation blijven vandaag volledig synchroon (route maakt de job-rij EN
// doet het werk in dezelfde request, zie lib/progress/server.ts). Deze route bewijst de
// queue-mechaniek (claim -> llm-router -> uitgavenplafond -> voltooien) met het aparte
// job_type "queue_smoke_test" (migratie 089). Welk echt job_type hier straks doorheen gaat, is
// een aparte beslissing -- dat vergt het herschrijven van de aanroepende route zelf (nu:
// createProgressJob + synchroon uitvoeren; straks: alleen createProgressJob + queued laten staan).
//
// UITGAVENPLAFOND: platformbreed gecontroleerd (geen agency_id), zelfde inperking als
// uitgavenplafond.ts zelf documenteert ("dit is de grens op het geheel, en die is er nu niet"
// voor een per-bureau variant). generation_jobs draagt geen agency_id-kolom; die koppeling zou
// via accounts.client_id moeten en is hier niet gebouwd omdat er nog geen job_type is dat het
// nodig heeft.

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, getOpenRouterKey } from "@/lib/analysis/helpers";
import { callLayer } from "@/lib/analysis/llm-router";
import { controleerPlafond, schatCallKosten } from "@/lib/analysis/uitgavenplafond";
import { beslisMislukkingsactie } from "@/lib/analysis/action-queue";
import { updateProgressPhase, markProgressCompleted, markProgressFailed } from "@/lib/progress/server";
import type { GenerationJobRow, GenerationJobType } from "@/lib/progress/types";

export const maxDuration = 300;

// Zelfde beleid als vastgelegd in migratie 004's commentaar op generation_jobs.attempts:
// attempts telt mislukkingen. Eerste mislukking (attempts 0->1): terug naar queued met minimaal
// 30 minuten backoff. Tweede mislukking (attempts >=1): definitief failed.
const BACKOFF_MINUTEN_NA_EERSTE_MISLUKKING = 30;
const MAX_JOBS_PER_INVOCATIE = 25; // ruime marge onder maxDuration bij korte handlers
const TIJDBUDGET_MS = 240_000; // zelfde 240s-marge als de pump uit migratie 004's commentaar

interface JobHandlerResult {
  message: string;
  metadata?: Record<string, unknown>;
}

type JobHandler = (opts: { supabase: SupabaseClient; job: GenerationJobRow; apiKey: string }) => Promise<JobHandlerResult>;

// De enige geregistreerde handler vandaag. Nieuwe job_types komen hier pas bij zodra een
// bestaande route daadwerkelijk ontkoppeld wordt van zijn synchrone pad -- zie de kop hierboven.
const HANDLERS: Partial<Record<GenerationJobType, JobHandler>> = {
  queue_smoke_test: async ({ supabase, job, apiKey }) => {
    await updateProgressPhase(supabase, {
      jobId: job.job_id,
      phaseKey: "run",
      message: "Testaanroep via callLayer(\"triage\")...",
    });
    const response = await callLayer("triage", {
      apiKey,
      systemPrompt: "Je bent een testcomponent voor een action queue. Antwoord met precies het woord OK.",
      userMessage: "Bevestig dat de queue-verwerking werkt.",
      maxTokens: 16,
      label: "queue-smoke-test",
    });
    return {
      message: `Smoke-test geslaagd via model ${response.model}.`,
      metadata: { model: response.model, tokensUsed: response.tokensUsed },
    };
  },
};

// Vaste, ruime schatting voor de pre-flight-budgetcheck. schatCallKosten wil promptTokens/
// completionTokens vooraf kennen, en die zijn per handler pas na de aanroep bekend -- dit is
// bewust een bovengrens, geen precisieschatting (uitgavenplafond.ts documenteert zelf al dat de
// schatting nooit exact hoeft te zijn, alleen "wat er nu gaat gebeuren" grofweg meetelt).
const GESCHATTE_PROMPT_TOKENS = 300;
const GESCHATTE_COMPLETION_TOKENS = 200;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET niet geconfigureerd; de queue-werker weigert bewust te draaien" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "niet geautoriseerd" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const jobTypeFilter = url.searchParams.get("job_type");
  const jobTypes = jobTypeFilter ? [jobTypeFilter] : null;

  if (dryRun) {
    let query = supabase.from("generation_jobs").select("job_id, job_type, client_id, attempts, scheduled_for", { count: "exact" }).eq("status", "queued");
    if (jobTypes) query = query.in("job_type", jobTypes);
    const { data, count } = await query.limit(50);
    return Response.json({ dry_run: true, wachtend: count ?? data?.length ?? 0, voorbeeld: data ?? [] });
  }

  const deadline = Date.now() + TIJDBUDGET_MS;
  const verwerkt: Array<{ job_id: string; job_type: string; uitkomst: string }> = [];
  let budgetGeblokkeerd = false;

  for (let i = 0; i < MAX_JOBS_PER_INVOCATIE && Date.now() < deadline; i++) {
    const { data: claimedRaw, error: claimError } = await supabase
      .rpc("claim_generation_job", { p_job_types: jobTypes })
      .maybeSingle();
    if (claimError) {
      return Response.json({ error: `claim mislukt: ${claimError.message}`, verwerkt }, { status: 500 });
    }
    const claimed = claimedRaw as GenerationJobRow | null;
    // Tweede, onafhankelijke check naast de setof-fix in de RPC zelf (migratie 090): een
    // composiet-typed PL/pgSQL-functie die "return null" doet kan via PostgREST een rij-van-
    // nulls teruggeven in plaats van een echte lege result-set -- dat object is in JavaScript
    // truthy, dus !claimed alleen ving die fout niet. Live gevonden: zonder deze regel liep de
    // lus door tot MAX_JOBS_PER_INVOCATIE op een fantoomrij i.p.v. te stoppen bij een lege queue.
    if (!claimed || !claimed.job_id) break;

    const job = claimed;

    // Pre-flight budgetcheck NA het claimen (de status staat al op running en moet dus weer
    // teruggezet worden bij een blokkade -- er is geen "claim zonder committeren" in de RPC,
    // want dat zou de FOR UPDATE-transactie open moeten houden over een netwerk-round-trip heen).
    const schatting = schatCallKosten("google/gemini-2.5-flash-lite", GESCHATTE_PROMPT_TOKENS, GESCHATTE_COMPLETION_TOKENS);
    const oordeel = await controleerPlafond(supabase, schatting);
    if (oordeel.blokkeert) {
      await supabase.from("generation_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("job_id", job.job_id);
      budgetGeblokkeerd = true;
      break;
    }

    const handler = HANDLERS[job.job_type];
    if (!handler) {
      await markProgressFailed(supabase, {
        jobId: job.job_id,
        errorMessage: `Geen handler geregistreerd voor job_type "${job.job_type}".`,
      });
      verwerkt.push({ job_id: job.job_id, job_type: job.job_type, uitkomst: "geen_handler" });
      continue;
    }

    try {
      const result = await handler({ supabase, job, apiKey });
      await markProgressCompleted(supabase, { jobId: job.job_id, message: result.message, metadata: result.metadata });
      verwerkt.push({ job_id: job.job_id, job_type: job.job_type, uitkomst: "voltooid" });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const beslissing = beslisMislukkingsactie(job.attempts, errorMessage, BACKOFF_MINUTEN_NA_EERSTE_MISLUKKING);
      if (beslissing.actie === "opnieuw_inplannen") {
        await supabase
          .from("generation_jobs")
          .update({
            status: "queued",
            attempts: beslissing.attempts,
            scheduled_for: beslissing.scheduledFor,
            message: beslissing.bericht,
            updated_at: new Date().toISOString(),
          })
          .eq("job_id", job.job_id);
        verwerkt.push({ job_id: job.job_id, job_type: job.job_type, uitkomst: "opnieuw_ingepland" });
      } else {
        await markProgressFailed(supabase, { jobId: job.job_id, errorMessage });
        verwerkt.push({ job_id: job.job_id, job_type: job.job_type, uitkomst: "definitief_mislukt" });
      }
    }
  }

  return Response.json({ dry_run: false, verwerkt: verwerkt.length, budget_geblokkeerd: budgetGeblokkeerd, resultaten: verwerkt });
}

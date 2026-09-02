// De consument van de negen kwaliteitspoorten.
//
// Vier draaien op live ads_*-tabellen (Data Quality, Math, Evidence, Causal Chain). Vijf lezen
// -- sinds Fase 2 -- uit sop_analysis_output.structured_monthly_v2, de JSON die de 13-staps-
// route ELKE RUN AL OPSLAAT: ThreadRecommendation[]/ThreadTask[] (Contradiction), StepValidation-
// Result[] (Step Purity), SopCoverage[] (Coverage), NormalizedFinding[] (Sprint Readiness) en het
// al berekende MonthlyQualityGateReport (Publish). Zie de kop van lib/decision/quality-gates.ts
// voor het volledige overzicht per poort.
//
// Diagnostisch en read-only: er wordt niets geschreven, geen legacy-route aangeraakt, geen
// LLM-aanroep. Raakt de 13-staps audit op geen enkele manier -- geen regel in
// app/api/analysis/monthly/route.ts, lib/prompts/monthly-v2.ts of lib/scheduler/pump-plan.ts is
// hiervoor gewijzigd. Deze route leest alleen tabellen die de audit toch al vulde.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { klantVanId } from "@/lib/tenancy/klanten";
import { runGates, gewogenRankLostIs, type GateInput } from "@/lib/decision/quality-gates";
import type { KeywordQsRow } from "@/lib/analysis/metric-cross-checks";
import type { RecommendationLike, TaskLike } from "@/lib/analysis/contradiction-resolver";
import type { StepValidationResult } from "@/lib/analysis/step-validator";
import type { SopCoverage } from "@/lib/analysis/canonicalize";
import type { Finding, Recommendation } from "@/lib/schema/analysis-schema";

function adminUnavailable(): Response {
  return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
}

/** "Campagne: Fit-fysiotherapie - NL" → "Fit-fysiotherapie - NL". Ongewijzigd als er geen label voor staat. */
function zonderLabel(entity: string): string {
  const m = /^[A-Za-z]+:\s*(.+)$/.exec(entity);
  return m ? m[1] : entity;
}

function alsEntityType(waarde: string): Finding["entity_type"] {
  // sop_insights.affected_entity_type is vrije tekst uit oudere analyses; validateFindingClaims
  // kijkt toch alleen naar "campaign" en "account", dus alles anders mag ongewijzigd door -- de
  // gate slaat het dan zelf over in plaats van dat wij hier gokken wat het zou moeten zijn.
  return waarde as Finding["entity_type"];
}

export async function GET(request: Request) {
  const auth = await requireCapability("system:ops");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const klant = await klantVanId(admin, clientId);
  if (!klant) return Response.json({ error: "onbekende klant" }, { status: 404 });

  let analysisDate = url.searchParams.get("analysisDate");
  if (!analysisDate) {
    const { data } = await admin
      .from("sop_insights").select("analysis_date")
      .eq("client_id", clientId).order("analysis_date", { ascending: false }).limit(1).maybeSingle();
    analysisDate = (data?.analysis_date as string | undefined) ?? null;
  }

  const [{ data: accountMonthly }, { data: campaignMonthly }, { data: impressionShare }, { data: keywords }, { data: settings }, { data: insights }, { data: structuredRun }] =
    await Promise.all([
      admin.from("ads_account_monthly")
        .select("month, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId).order("month", { ascending: false }).limit(3),
      admin.from("ads_campaign_monthly")
        .select("campaign_name, month, cost, conversions, conversions_value")
        .eq("client_id", clientId).order("month", { ascending: false }).limit(200),
      admin.from("ads_campaign_impression_share")
        .select("month, search_rank_lost_is")
        .eq("client_id", clientId).order("month", { ascending: false }).limit(50),
      admin.from("ads_keyword_performance_monthly")
        .select("cost, quality_score, month")
        .eq("client_id", clientId).order("month", { ascending: false }).limit(500),
      admin.from("client_settings").select("kpi_targets").eq("client_id", clientId).maybeSingle(),
      analysisDate
        ? admin.from("sop_insights")
            .select("affected_entity, affected_entity_type, metric, current_value")
            .eq("client_id", clientId).eq("analysis_date", analysisDate)
        : Promise.resolve({ data: [] as unknown[] }),
      // De rijke bron voor de vijf poorten die Fase 1 nog niet kon voeden: dezelfde JSON die de
      // 13-staps-route elke run al opslaat. Zie de kop van dit bestand.
      analysisDate
        ? admin.from("sop_analysis_output")
            .select("output")
            .eq("client_id", clientId).eq("analysis_date", analysisDate).eq("section", "structured_monthly_v2")
            .maybeSingle()
        : Promise.resolve({ data: null as { output: string } | null }),
    ]);

  // De JSON kan qua vorm afwijken tussen oudere en nieuwere runs (nieuwe velden komen erbij,
  // ontbrekende velden zijn hier al eerder als "input ontbreekt" behandeld). Vandaar parsen in
  // een try/catch die nooit de hele route laat vallen -- een kapotte of oude blob levert gewoon
  // vijf poorten met "input ontbreekt" op, net als vóór Fase 2.
  interface StructuredRun {
    recommendations?: unknown[];
    tasks?: unknown[];
    findings?: unknown[];
    coverage?: unknown[];
    step_validations?: unknown[];
    quality_gate?: { passed: boolean; state: string; blocking_reasons: string[] };
  }
  let structured: StructuredRun | null = null;
  if (structuredRun?.output) {
    try {
      structured = JSON.parse(structuredRun.output) as StructuredRun;
    } catch {
      structured = null;
    }
  }

  const accountRijen = (accountMonthly ?? []).slice().reverse(); // oud → nieuw voor de KPI-chain
  const laatsteMaand = impressionShare?.[0]?.month as string | undefined;
  const isRijenLaatsteMaand = (impressionShare ?? []).filter((r) => r.month === laatsteMaand);
  // Gewogen naar impressies, dezelfde helper als de live maandrun (quality-gates.ts).
  const gemiddeldRankLostIs = gewogenRankLostIs(isRijenLaatsteMaand as Record<string, unknown>[]) ?? 0;
  const qsLaatsteMaand = (keywords ?? []).filter((k) => k.month === keywords?.[0]?.month);

  const gateInput: GateInput = {
    runId: crypto.randomUUID(),
    agencyId: klant.agencyId ?? "onbekend",
    accountId: clientId,
    analysisDate: analysisDate ?? "onbekend",

    dataQuality: accountRijen.length > 0 ? {
      accountMonthly: accountRijen.map((r) => ({
        month: String(r.month), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
        cost: Number(r.cost ?? 0), conversions: Number(r.conversions ?? 0), conversions_value: Number(r.conversions_value ?? 0),
      })),
      campaignMonthly: (campaignMonthly ?? []).map((r) => ({
        campaign_name: String(r.campaign_name ?? ""), month: String(r.month),
        cost: Number(r.cost ?? 0), conversions: Number(r.conversions ?? 0), conversions_value: Number(r.conversions_value ?? 0),
      })),
      conversionLagDays: 3,
      lastCompleteMonth: accountRijen.length > 0 ? new Date(String(accountRijen[accountRijen.length - 1].month)).getUTCMonth() + 1 : 0,
      hasKpiTargets: Boolean(settings?.kpi_targets && Object.keys(settings.kpi_targets as Record<string, unknown>).length > 0),
    } : undefined,

    rankLoss: isRijenLaatsteMaand.length > 0 ? {
      keywords: qsLaatsteMaand.map((k): KeywordQsRow => ({ cost: Number(k.cost ?? 0), quality_score: k.quality_score == null ? null : Number(k.quality_score) })),
      rankLostIs: gemiddeldRankLostIs,
    } : undefined,

    claimCheck: (insights && (insights as unknown[]).length > 0 && campaignMonthly) ? {
      stepNumber: 1,
      findings: (insights as Array<{ affected_entity: string; affected_entity_type: string; metric: string; current_value: string | number | null }>).map((i) => ({
        entity_name: zonderLabel(i.affected_entity),
        entity_type: alsEntityType(i.affected_entity_type),
        metric: i.metric,
        current_value: i.current_value == null ? null : Number(i.current_value),
      })),
      campaignRows: campaignMonthly ?? [],
      accountRows: accountMonthly ?? [],
      periodStart: analysisDate ?? "",
      periodEnd: analysisDate ?? "",
    } : undefined,

    kpiChain: accountRijen.length >= 2 ? {
      previousMonth: accountRijen[accountRijen.length - 2] as unknown as Record<string, number>,
      currentMonth: accountRijen[accountRijen.length - 1] as unknown as Record<string, number>,
      resultMetric: "conversions",
    } : undefined,

    // De vijf poorten uit Fase 2: allemaal uit dezelfde structured_monthly_v2-rij, geen van
    // allen herberekend -- ThreadRecommendation/ThreadTask/NormalizedFinding voldoen structureel
    // aan RecommendationLike/TaskLike/Finding (geverifieerd tegen de echte database, zie de
    // commit-boodschap), dus een simpele cast volstaat.
    contradiction: (structured?.recommendations && structured.tasks) ? {
      recommendations: structured.recommendations as RecommendationLike[],
      tasks: structured.tasks as TaskLike[],
    } : undefined,

    stepValidationsReport: structured?.step_validations as StepValidationResult[] | undefined,

    coverageReport: structured?.coverage as SopCoverage[] | undefined,

    actionGating: (structured?.findings && structured.recommendations) ? {
      findings: structured.findings as Finding[],
      recommendations: structured.recommendations as Recommendation[],
    } : undefined,

    publishReport: structured?.quality_gate ? {
      passed: structured.quality_gate.passed,
      state: structured.quality_gate.state,
      blockingReasons: structured.quality_gate.blocking_reasons,
    } : undefined,
  };

  const resultaten = runGates(gateInput);
  return Response.json({
    clientId, agencyId: gateInput.agencyId, analysisDate: gateInput.analysisDate,
    gevoedeInvoer: {
      dataQuality: Boolean(gateInput.dataQuality),
      rankLoss: Boolean(gateInput.rankLoss),
      claimCheck: Boolean(gateInput.claimCheck),
      kpiChain: Boolean(gateInput.kpiChain),
      contradiction: Boolean(gateInput.contradiction),
      stepValidationsReport: Boolean(gateInput.stepValidationsReport),
      coverageReport: Boolean(gateInput.coverageReport),
      actionGating: Boolean(gateInput.actionGating),
      publishReport: Boolean(gateInput.publishReport),
    },
    resultaten,
  });
}

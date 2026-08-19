import { NextRequest, after } from "next/server";
import { buildWeeklyPrompt, WEEKLY_FINDINGS_SYSTEM, WEEKLY_RECS_SYSTEM } from "@/lib/prompts/sop-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runAnalysis,
  daysAgo,
  fmt,
} from "@/lib/analysis/helpers";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { computeMetaReliability, computeLinkedinReliability } from "@/lib/analysis/channel-reliability";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { extractStructuredData } from "@/lib/analysis/extract-structured";
import { today } from "@/lib/reporting-date";
import { toPromptTable } from "@/lib/analysis/prompt-table";
import { fetchNameMap, fetchDaily as fetchMetaDaily } from "@/lib/meta/analysis-data";
import type { SupabaseClient } from "@supabase/supabase-js";

const amsterdamseMaand = () => Number(today().slice(5, 7));
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import { triggerLiteCrossChannelSynthesisIfReady } from "@/lib/analysis/auto-cross-channel-trigger";

// Zelfde reden als app/api/analysis/monthly/route.ts: zonder dit valt de route terug op Vercel's
// (veel kortere) platformdefault en breekt een lange analyse af met een platte foutpagina i.p.v.
// JSON, wat de client als "Unexpected token... is not valid JSON" laat zien in plaats van een
// bruikbare foutmelding.
// 600s sinds de upgrade naar Vercel Pro (mag in code tot 1800s) -- zelfde marge-redenering
// als app/api/analysis/monthly/route.ts, waar de kale Google-hoofdanalyse al 284-313s bleek
// te duren op de oude 300s-grens.
export const maxDuration = 600;

async function runGoogleWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "weekly_sop",
    initialMessage: "Wekelijkse analyse wordt voorbereid...",
    metadata: { sop_type: "weekly" },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_data",
    message: "Wekelijkse performance- en waste-data ophalen...",
  });
  const periodStart = daysAgo(14);
  const periodEnd = fmt(new Date());

  // Phase 1: Fetch data + client context + forecast targets in parallel
  const [
    weeklyResult, searchResult, campaignResult, accountMonthlyResult,
    clientCtx, targetResult,
  ] = await Promise.all([
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", periodStart).order("week_start"),
    supabase.from("ads_search_terms_wasteful").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", daysAgo(60)).order("month"),
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", daysAgo(90)).order("month"),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId),
  ]);

  const { goalsSection, accountType } = clientCtx;

  const weeklyData = weeklyResult.data ?? [];
  if (weeklyData.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId, ["ads_account_weekly"]);
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: freshness.message,
    });
    return Response.json({
      error: freshness.message,
      freshnessStatus: freshness.freshnessStatus,
      lastSyncAt: freshness.lastSyncAt,
      action: "Sync de data via POST /api/sync",
    }, { status: 404 });
  }

  // Phase 2: Build enrichment context via matrix (parallel)
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "enrich_context",
    message: "Enrichment en databetrouwbaarheid opbouwen...",
  });
  const enrichment = await buildEnrichmentContext({
    supabase,
    clientId,
    accountType,
    sopType: "weekly",
    analysisDate: periodEnd,
  });

  // Format monthly targets from forecast engine
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = targetResult
    ? `\n\n## Maandtargets (berekend door forecast engine)
Huidige maand (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][currentMonth - 1]}): verwacht ${targetResult.monthlyExpected[currentMonth - 1]?.conversions ?? "?"} conversies, €${targetResult.monthlyExpected[currentMonth - 1]?.revenue ?? "?"} omzet
BELANGRIJK: Gebruik dit maandtarget als benchmark, NIET het jaardoel.`
    : "";

  // Compute data reliability using CORRECT account monthly data
  const { data: lagSettings } = await supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle();
  const accountMonthlyData = accountMonthlyResult.data ?? [];
  const weeklyReliability = computeDataReliability({
    accountMonthly: accountMonthlyData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>,
    campaignMonthly: (campaignResult.data ?? []) as Array<{ campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number }>,
    conversionLagDays: (lagSettings?.conversion_lag_days as number) ?? 3,
    // De Amsterdamse maand, niet new Date().getMonth(): dat is de LOKALE maand van het
    // serverproces, en dat draait in UTC. Op de laatste dag van een maand na 23:00
    // Amsterdamse tijd zou hier een andere maand uitkomen dan in computeAnalysisWindow.
    lastCompleteMonth: amsterdamseMaand() === 1 ? 12 : amsterdamseMaand() - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${weeklyReliability.promptContext}`;

  const systemPrompt = buildWeeklyPrompt(goalsSection, accountType);

  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";

  const userMessage = `Voer een wekelijkse health check uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}

## Account Performance (wekelijks, laatste 14 dagen)
\`\`\`
${toPromptTable(weeklyData)}
\`\`\`

## Wasteful Search Terms (laatste 30 dagen, top 30 op cost)
\`\`\`
${toPromptTable(searchResult.data ?? [])}
\`\`\`

## Campaign Performance (laatste 2 maanden, voor budget/spend check)
\`\`\`
${toPromptTable(campaignResult.data ?? [])}
\`\`\`${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}

Voer nu de wekelijkse health check uit. Focus alleen op anomalies en bleeders die directe actie vereisen.`;

  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "run_analysis",
    message: "Wekelijkse SOP-analyse uitvoeren...",
  });
  const result = await runAnalysis({
    supabase,
    apiKey,
    clientId,
    sopType: "weekly",
    systemPrompt,
    userMessage,
    periodStart,
    periodEnd,
  });

  // Sanitize final output (heading dedup + whitespace cleanup)
  result.output = sanitizeOutput(result.output);

  // ── Structured extraction (findings + recommendations + tasks) ──
  const extraction = await extractStructuredData({
    supabase,
    apiKey,
    clientId,
    sopType: "weekly",
    analysisDate: result.analysisDate,
    periodStart,
    periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: WEEKLY_RECS_SYSTEM,
    stepOffset: 1, // findings = step 2, recs = step 3
    analysisId: null, // weekly uses runAnalysis, not tracked by analysis_id
    reliability: weeklyReliability,
    onPhase: async (phaseKey, message) => {
      await updateProgressPhase(supabase, { jobId, phaseKey, message });
    },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Wekelijkse SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate,
      sop_type: "weekly",
      findings: extraction.findings.length,
      recommendations: extraction.recommendations.length,
      tasks: extraction.tasks.length,
    },
  });

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "weekly", periodStart, periodEnd);
  });

  return Response.json({
    jobId,
    ...result,
    structured: {
      findings: extraction.findings.length,
      recommendations: extraction.recommendations.length,
      tasks: extraction.tasks.length,
      saved: extraction.saved,
      findingsParseOk: extraction.findingsParseOk,
      recsParseOk: extraction.recsParseOk,
    },
  });
}

// Bijschrijft een entity_id (kolom in de meta_*_daily-tabellen) op de naam uit de bijbehorende
// entiteit-tabel, zodat de LLM in de bleeder-stap namen ziet in plaats van kale ID's.
function withMetaNames(rows: Array<Record<string, unknown>>, names: Map<string, string>): Array<Record<string, unknown>> {
  return rows.map((row) => ({ ...row, entity_name: names.get(String(row.entity_id ?? "")) ?? row.entity_id }));
}

async function runMetaWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "weekly_sop",
    initialMessage: "Wekelijkse Meta-analyse wordt voorbereid...",
    metadata: { sop_type: "meta_weekly" },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_data",
    message: "Wekelijkse Meta-data ophalen...",
  });

  const periodStart = daysAgo(14);
  const periodBleederStart = daysAgo(7);
  const periodSpendStart = daysAgo(60);
  const periodEnd = fmt(new Date());

  const periodReliabilityStart = daysAgo(90);

  const [
    accountResult, adsetResult, adResult, campaignResult,
    campaignNames, adsetNames, adNames,
    clientCtx, targetResult, reliabilityAccountResult, lagSettingsResult,
  ] = await Promise.all([
    fetchMetaDaily(supabase, clientId, "meta_account_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_adset_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_ad_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_campaign_daily", periodSpendStart, periodEnd),
    fetchNameMap(supabase, clientId, "meta_campaigns", "campaign_id", "name"),
    fetchNameMap(supabase, clientId, "meta_adsets", "adset_id", "name"),
    fetchNameMap(supabase, clientId, "meta_ads", "ad_id", "name"),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "meta"),
    // F5 fase1.1: apart, langer venster puur voor de betrouwbaarheidscheck -- de 14-daagse
    // accountResult hierboven is te kort om in maanden te aggregeren.
    fetchMetaDaily(supabase, clientId, "meta_account_daily", periodReliabilityStart, periodEnd),
    supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle(),
  ]);

  const { goalsSection, accountType } = clientCtx;

  if (accountResult.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId, ["meta_account_daily"]);
    await markProgressFailed(supabase, { jobId, errorMessage: freshness.message });
    return Response.json({
      error: freshness.message,
      freshnessStatus: freshness.freshnessStatus,
      lastSyncAt: freshness.lastSyncAt,
      action: "Sync de data via POST /api/sync",
    }, { status: 404 });
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = targetResult
    ? `\n\n## Maandtargets (berekend door forecast engine)
Huidige maand (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][currentMonth - 1]}): verwacht ${targetResult.monthlyExpected[currentMonth - 1]?.conversions ?? "?"} conversies, €${targetResult.monthlyExpected[currentMonth - 1]?.revenue ?? "?"} omzet
BELANGRIJK: Gebruik dit maandtarget als benchmark, NIET het jaardoel.`
    : "";

  const systemPrompt = buildWeeklyPrompt(goalsSection, accountType, "meta_ads");

  // F5 fase1.1: reliability-gating parity met Google -- zelfde functie, genormaliseerd naar
  // Meta's spend/link_clicks-kolomnamen via computeMetaReliability().
  const metaReliability = computeMetaReliability({
    accountDaily: reliabilityAccountResult,
    campaignDaily: campaignResult,
    conversionLagDays: (lagSettingsResult.data?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: amsterdamseMaand() === 1 ? 12 : amsterdamseMaand() - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${metaReliability.promptContext}`;

  const adsetRows = withMetaNames(adsetResult.filter((r) => new Date(String(r.date)) >= new Date(periodBleederStart)), adsetNames);
  const adRows = withMetaNames(adResult.filter((r) => new Date(String(r.date)) >= new Date(periodBleederStart)), adNames);
  const campaignRows = withMetaNames(campaignResult, campaignNames);

  const userMessage = `Voer een wekelijkse health check uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${targetText}${reliabilityText}

## Account Performance (dagelijks, laatste 14 dagen -- gebruik voor WoW-vergelijking)
\`\`\`
${toPromptTable(accountResult)}
\`\`\`

## Ad Set Performance (laatste 7 dagen + frequency/hook rate trend uit de 14-dagen ophaal, voor bleeders en creative fatigue)
\`\`\`
${toPromptTable(adsetRows)}
\`\`\`

## Ad/Creative Performance (laatste 7 dagen, voor bleeders en creative fatigue)
\`\`\`
${toPromptTable(adRows)}
\`\`\`

## Campaign Performance (laatste 60 dagen, voor spend-anomalie WoW-check)
\`\`\`
${toPromptTable(campaignRows)}
\`\`\`

Voer nu de wekelijkse health check uit. Focus alleen op anomalies en bleeders die directe actie vereisen.`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_analysis", message: "Wekelijkse Meta SOP-analyse uitvoeren..." });
  const result = await runAnalysis({
    supabase, apiKey, clientId, sopType: "meta_weekly", systemPrompt, userMessage, periodStart, periodEnd,
  });
  result.output = sanitizeOutput(result.output);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "meta_weekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: WEEKLY_RECS_SYSTEM,
    stepOffset: 1,
    analysisId: null,
    reliability: metaReliability,
    onPhase: async (phaseKey, message) => { await updateProgressPhase(supabase, { jobId, phaseKey, message }); },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Wekelijkse Meta SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate, sop_type: "meta_weekly",
      findings: extraction.findings.length, recommendations: extraction.recommendations.length, tasks: extraction.tasks.length,
    },
  });

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "weekly", periodStart, periodEnd);
  });

  return Response.json({
    jobId,
    ...result,
    structured: {
      findings: extraction.findings.length,
      recommendations: extraction.recommendations.length,
      tasks: extraction.tasks.length,
      saved: extraction.saved,
      findingsParseOk: extraction.findingsParseOk,
      recsParseOk: extraction.recsParseOk,
    },
  });
}

async function fetchLinkedinNameMap(supabase: SupabaseClient, clientId: string, table: string, idColumn: string, nameColumn: string): Promise<Map<string, string>> {
  const { data } = await supabase.from(table).select(`${idColumn}, ${nameColumn}`).eq("client_id", clientId);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const id = String(row[idColumn] ?? "");
    const name = String(row[nameColumn] ?? "");
    if (id && name) map.set(id, name);
  }
  return map;
}

function withLinkedinNames(rows: Array<Record<string, unknown>>, names: Map<string, string>): Array<Record<string, unknown>> {
  return rows.map((row) => ({ ...row, entity_name: names.get(String(row.entity_urn ?? "")) ?? row.entity_urn }));
}

async function runLinkedinWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "weekly_sop",
    initialMessage: "Wekelijkse LinkedIn-analyse wordt voorbereid...",
    metadata: { sop_type: "linkedin_weekly" },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_data",
    message: "Wekelijkse LinkedIn-data ophalen...",
  });

  const periodStart = daysAgo(14);
  const periodBleederStart = daysAgo(7);
  const periodSpendStart = daysAgo(60);
  const periodEnd = fmt(new Date());

  const fetchLinkedinDaily = async (table: string, start: string): Promise<Array<Record<string, unknown>>> => {
    const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("date", start).lte("date", periodEnd);
    return (data ?? []) as Array<Record<string, unknown>>;
  };

  const periodReliabilityStart = daysAgo(90);

  const [
    accountRows, campaignRowsRaw, creativeRowsRaw, campaignSpendRows,
    campaignNames, creativeFormats,
    clientCtx, targetResult, reliabilityAccountRows, lagSettingsResult,
  ] = await Promise.all([
    fetchLinkedinDaily("linkedin_account_daily", periodStart),
    fetchLinkedinDaily("linkedin_campaign_daily", periodBleederStart),
    fetchLinkedinDaily("linkedin_creative_daily", periodBleederStart),
    fetchLinkedinDaily("linkedin_campaign_daily", periodSpendStart),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_campaigns", "campaign_urn", "name"),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_creatives", "creative_urn", "format"),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "linkedin"),
    // F5 fase1.1: apart, langer venster puur voor de betrouwbaarheidscheck.
    fetchLinkedinDaily("linkedin_account_daily", periodReliabilityStart),
    supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle(),
  ]);

  const { goalsSection, accountType } = clientCtx;

  if (accountRows.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId, ["linkedin_account_daily"]);
    await markProgressFailed(supabase, { jobId, errorMessage: freshness.message });
    return Response.json({
      error: freshness.message,
      freshnessStatus: freshness.freshnessStatus,
      lastSyncAt: freshness.lastSyncAt,
      action: "Sync de data via POST /api/sync",
    }, { status: 404 });
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = targetResult
    ? `\n\n## Maandtargets (berekend door forecast engine)
Huidige maand (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][currentMonth - 1]}): verwacht ${targetResult.monthlyExpected[currentMonth - 1]?.conversions ?? "?"} conversies, €${targetResult.monthlyExpected[currentMonth - 1]?.revenue ?? "?"} omzet
BELANGRIJK: Gebruik dit maandtarget als benchmark, NIET het jaardoel.`
    : "";

  const systemPrompt = buildWeeklyPrompt(goalsSection, accountType, "linkedin_ads");

  // F5 fase1.1: reliability-gating parity met Google -- genormaliseerd naar LinkedIn's
  // spend/leads-kolomnamen via computeLinkedinReliability().
  const linkedinReliability = computeLinkedinReliability({
    accountDaily: reliabilityAccountRows,
    campaignDaily: campaignSpendRows,
    conversionLagDays: (lagSettingsResult.data?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: amsterdamseMaand() === 1 ? 12 : amsterdamseMaand() - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${linkedinReliability.promptContext}`;

  const campaignRows = withLinkedinNames(campaignRowsRaw, campaignNames);
  const creativeRows = withLinkedinNames(creativeRowsRaw, creativeFormats);
  const campaignSpendRowsNamed = withLinkedinNames(campaignSpendRows, campaignNames);

  const userMessage = `Voer een wekelijkse health check uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${targetText}${reliabilityText}

## Account Performance (dagelijks, laatste 14 dagen -- gebruik voor WoW-vergelijking)
\`\`\`
${toPromptTable(accountRows)}
\`\`\`

## Campaign Performance (laatste 7 dagen, voor bleeders)
\`\`\`
${toPromptTable(campaignRows)}
\`\`\`

## Creative Performance (laatste 7 dagen, entity_name is het formaat -- LinkedIn-creatives hebben geen eigen naam)
\`\`\`
${toPromptTable(creativeRows)}
\`\`\`

## Campaign Performance (laatste 60 dagen, voor spend-anomalie WoW-check)
\`\`\`
${toPromptTable(campaignSpendRowsNamed)}
\`\`\`

Voer nu de wekelijkse health check uit. Focus alleen op anomalies en bleeders die directe actie vereisen.`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_analysis", message: "Wekelijkse LinkedIn SOP-analyse uitvoeren..." });
  const result = await runAnalysis({
    supabase, apiKey, clientId, sopType: "linkedin_weekly", systemPrompt, userMessage, periodStart, periodEnd,
  });
  result.output = sanitizeOutput(result.output);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "linkedin_weekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: WEEKLY_RECS_SYSTEM,
    stepOffset: 1,
    analysisId: null,
    reliability: linkedinReliability,
    onPhase: async (phaseKey, message) => { await updateProgressPhase(supabase, { jobId, phaseKey, message }); },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Wekelijkse LinkedIn SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate, sop_type: "linkedin_weekly",
      findings: extraction.findings.length, recommendations: extraction.recommendations.length, tasks: extraction.tasks.length,
    },
  });

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "weekly", periodStart, periodEnd);
  });

  return Response.json({
    jobId,
    ...result,
    structured: {
      findings: extraction.findings.length,
      recommendations: extraction.recommendations.length,
      tasks: extraction.tasks.length,
      saved: extraction.saved,
      findingsParseOk: extraction.findingsParseOk,
      recsParseOk: extraction.recsParseOk,
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let jobId = crypto.randomUUID();
  let channel = "google_ads";
  try {
    const body = await request.json();
    clientId = body.client_id;
    jobId = body.job_id || crypto.randomUUID();
    channel = body.channel || "google_ads";
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  if (!(await magSopDraaien(supabase, clientId))) {
    return Response.json({ error: "SOP's zijn uitgeschakeld voor dit account." }, { status: 403 });
  }

  try {
    if (channel === "meta_ads") {
      return await runMetaWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    if (channel === "linkedin_ads") {
      return await runLinkedinWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    return await runGoogleWeeklyAnalysis(supabase, apiKey, clientId, jobId);
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Onbekende fout",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}

import { NextRequest, after } from "next/server";
import { buildWeeklyStep1Prompt, buildWeeklyStep2Prompt, buildWeeklyStep3Prompt, WEEKLY_FINDINGS_SYSTEM, WEEKLY_RECS_SYSTEM } from "@/lib/prompts/sop-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runStep,
  daysAgo,
  fmt,
  saveAnalysisOutputSection,
  type AnalysisResult,
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

// cross-channel-synthesis-lite.ts leest section="full" puur als bestaanscheck ("is deze cyclus
// voor dit kanaal afgerond"), niet voor de inhoud -- zie de toelichting daar. Vóór de opsplitsing
// in losse runStep-calls (masterplan 17.11x) schreef runAnalysis() die rij vanzelf; runStep()
// slaat elke stap apart op (section = stepName), dus zonder deze extra rij verdwijnt dat signaal.
async function saveFullOutputMarker(supabase: SupabaseClient, result: AnalysisResult): Promise<void> {
  await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: result.clientId, sop_type: result.sopType, analysis_date: result.analysisDate,
      period_start: result.periodStart, period_end: result.periodEnd,
      section: "full", output: result.output, model_used: result.model, tokens_used: result.tokensUsed,
    },
  });
}

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

  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";

  // Alle context die de ongesplitste versie eenmalig onderaan de userMessage meegaf, gaat nu naar
  // ELKE stap-call -- geen enkele stap hoort minder te weten dan de vorige, ongesplitste versie
  // altijd had.
  const sharedContext = `${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

  // Drie losse calls i.p.v. één grote (masterplan 17.11x): elke stap is nu apart routeerbaar
  // (STEP_TIER, per "weekly-step-N") en apart gelogd in llm_usage.
  //
  // MODELKEUZE PER STAP (masterplan 17.111). De ongesplitste versie draaide alles op Claude
  // Sonnet 5 ($2/$10 per 1M) via runAnalysis' callLayer("narrative"). Dat is de duurste plek in
  // de hele pijplijn: weekly draait ~52x per jaar per kanaal tegen monthly's ~12x, dus 4x het
  // volume op een model met 5,3x de uitvoerprijs van Gemini 3.7 Flash -- en het werd nooit gelogd,
  // dus het stond in geen enkel kostenoverzicht.
  //
  // Stap 1 en 2 zijn signaleringswerk: tabellen lezen, afwijkingen benoemen, bleeders aanwijzen.
  // Ze geven daarom GEEN expliciete laag mee en vallen terug op callRouted's heavy-tier
  // (Gemini 3.7 Flash) -- exact hetzelfde model dat monthly's twaalf, inhoudelijk zwaardere
  // analysestappen al draait. Geen sprong naar iets onbewezen, wel gelijktrekken met wat werkt.
  //
  // Stap 3 HOUDT `layer: "narrative"` (Claude): daar zit het Weekoverzicht, de synthese die de
  // hele week samenvat in acties per urgentieniveau. Dat is formuleerwerk, en dat is precies waar
  // Sonnet 5 zijn meerprijs verdient.
  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Health Check & Tracking Verificatie..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "weekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Health Check",
    runKey: jobId,
    systemPrompt: buildWeeklyStep1Prompt(goalsSection, accountType),
    userMessage: `Voer stap 1 (Account Health Check & Tracking Verificatie) uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (wekelijks, laatste 14 dagen)
\`\`\`
${toPromptTable(weeklyData)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: Keyword & zoekterm bleeders..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "weekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Keyword Zoekterm Bleeders",
    runKey: jobId,
    systemPrompt: buildWeeklyStep2Prompt(goalsSection, accountType),
    userMessage: `Voer stap 2 (${"Keyword & Zoekterm Bleeders"}) uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Wasteful Search Terms (laatste 30 dagen, top 30 op cost)
\`\`\`
${toPromptTable(searchResult.data ?? [])}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: Budget & spend anomalieën, weekoverzicht..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "weekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Budget Spend Anomalies",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildWeeklyStep3Prompt(goalsSection, accountType),
    userMessage: `Voer stap 3 (Budget & Spend Anomalies) en het afsluitende Weekoverzicht uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Conclusie stap 2 (Keyword & Zoekterm Bleeders)
${step2.output}

## Campaign Performance (laatste 2 maanden, voor budget/spend check)
\`\`\`
${toPromptTable(campaignResult.data ?? [])}
\`\`\`

Focus alleen op anomalies en bleeders die directe actie vereisen.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "weekly", analysisDate: today(), periodStart, periodEnd,
    model: step3.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Health Check & Tracking Verificatie

${step1.output}

---

## Stap 2: Keyword & Zoekterm Bleeders

${step2.output}

---

## Stap 3: Budget & Spend Anomalies

${step3.output}`),
    saved: step1.saved && step2.saved && step3.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs,
    retries: step1.retries + step2.retries + step3.retries,
  };
  await saveFullOutputMarker(supabase, result);

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
    stepOffset: 3, // 3 analyse-stappen (masterplan 17.11x); findings = step 4, recs = step 5
    analysisId: null, // weekly is losse runStep-calls, niet gekoppeld aan een analysis_id
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

  const sharedContext = `${targetText}${reliabilityText}`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Health Check (Meta)..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_weekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Health Check",
    runKey: jobId,
    systemPrompt: buildWeeklyStep1Prompt(goalsSection, accountType, "meta_ads"),
    userMessage: `Voer stap 1 (Account Health Check & Tracking Verificatie) uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (dagelijks, laatste 14 dagen -- gebruik voor WoW-vergelijking)
\`\`\`
${toPromptTable(accountResult)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: bleeders en creative fatigue (Meta)..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_weekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Ad Set en Ad Bleeders",
    runKey: jobId,
    systemPrompt: buildWeeklyStep2Prompt(goalsSection, accountType, "meta_ads"),
    userMessage: `Voer stap 2 uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Ad Set Performance (laatste 7 dagen + frequency/hook rate trend uit de 14-dagen ophaal, voor bleeders en creative fatigue)
\`\`\`
${toPromptTable(adsetRows)}
\`\`\`

## Ad/Creative Performance (laatste 7 dagen, voor bleeders en creative fatigue)
\`\`\`
${toPromptTable(adRows)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: budget & spend anomalieën, weekoverzicht (Meta)..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_weekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Budget Spend Anomalies",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildWeeklyStep3Prompt(goalsSection, accountType, "meta_ads"),
    userMessage: `Voer stap 3 (Budget & Spend Anomalies) en het afsluitende Weekoverzicht uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Conclusie stap 2 (Ad Set en Ad Bleeders)
${step2.output}

## Campaign Performance (laatste 60 dagen, voor spend-anomalie WoW-check)
\`\`\`
${toPromptTable(campaignRows)}
\`\`\`

Focus alleen op anomalies en bleeders die directe actie vereisen.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "meta_weekly", analysisDate: today(), periodStart, periodEnd,
    model: step3.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Health Check & Tracking Verificatie

${step1.output}

---

## Stap 2: Ad Set en Ad Bleeders

${step2.output}

---

## Stap 3: Budget & Spend Anomalies

${step3.output}`),
    saved: step1.saved && step2.saved && step3.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs,
    retries: step1.retries + step2.retries + step3.retries,
  };
  await saveFullOutputMarker(supabase, result);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "meta_weekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: WEEKLY_RECS_SYSTEM,
    stepOffset: 3, // 3 analyse-stappen; findings = step 4, recs = step 5
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

  const sharedContext = `${targetText}${reliabilityText}`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Health Check (LinkedIn)..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_weekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Health Check",
    runKey: jobId,
    systemPrompt: buildWeeklyStep1Prompt(goalsSection, accountType, "linkedin_ads"),
    userMessage: `Voer stap 1 (Account Health Check & Tracking Verificatie) uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (dagelijks, laatste 14 dagen -- gebruik voor WoW-vergelijking)
\`\`\`
${toPromptTable(accountRows)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: bleeders (LinkedIn)..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_weekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Campagne en Creative Bleeders",
    runKey: jobId,
    systemPrompt: buildWeeklyStep2Prompt(goalsSection, accountType, "linkedin_ads"),
    userMessage: `Voer stap 2 uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Campaign Performance (laatste 7 dagen, voor bleeders)
\`\`\`
${toPromptTable(campaignRows)}
\`\`\`

## Creative Performance (laatste 7 dagen, entity_name is het formaat -- LinkedIn-creatives hebben geen eigen naam)
\`\`\`
${toPromptTable(creativeRows)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: budget & spend anomalieën, weekoverzicht (LinkedIn)..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_weekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Budget Spend Anomalies",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildWeeklyStep3Prompt(goalsSection, accountType, "linkedin_ads"),
    userMessage: `Voer stap 3 (Budget & Spend Anomalies) en het afsluitende Weekoverzicht uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Conclusie stap 2 (Campagne en Creative Bleeders)
${step2.output}

## Campaign Performance (laatste 60 dagen, voor spend-anomalie WoW-check)
\`\`\`
${toPromptTable(campaignSpendRowsNamed)}
\`\`\`

Focus alleen op anomalies en bleeders die directe actie vereisen.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "linkedin_weekly", analysisDate: today(), periodStart, periodEnd,
    model: step3.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Health Check & Tracking Verificatie

${step1.output}

---

## Stap 2: Campagne en Creative Bleeders

${step2.output}

---

## Stap 3: Budget & Spend Anomalies

${step3.output}`),
    saved: step1.saved && step2.saved && step3.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs,
    retries: step1.retries + step2.retries + step3.retries,
  };
  await saveFullOutputMarker(supabase, result);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "linkedin_weekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: WEEKLY_RECS_SYSTEM,
    stepOffset: 3, // 3 analyse-stappen; findings = step 4, recs = step 5
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

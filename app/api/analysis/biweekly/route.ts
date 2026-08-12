import { NextRequest } from "next/server";
import { buildBiWeeklyPrompt, BIWEEKLY_FINDINGS_SYSTEM, BIWEEKLY_RECS_SYSTEM } from "@/lib/prompts/sop-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runAnalysis,
  monthsAgo,
  fmt,
} from "@/lib/analysis/helpers";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { computeComparisonFacts, formatComparisonFacts } from "@/lib/analysis/comparison-facts";
import { extractStructuredData } from "@/lib/analysis/extract-structured";
import { toPromptTable } from "@/lib/analysis/prompt-table";
import { fetchNameMap, fetchDaily as fetchMetaDaily } from "@/lib/meta/analysis-data";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import type { SupabaseClient } from "@supabase/supabase-js";

// Gedeeld door alle drie de kanalen: elke stap sluit af met "TOP 3 BEVINDINGEN STAP N: ...",
// en die worden als beknopte samenvatting doorgegeven aan de extractie-stap (i.p.v. de volledige
// narratieve tekst nog eens te laten lezen).
function extractTopFindings(output: string): string[] {
  const topFindings: string[] = [];
  const stepMatches = output.matchAll(/TOP 3 BEVINDINGEN STAP (\d+):\s*([\s\S]*?)(?:\n\n|\n---|$)/g);
  for (const match of stepMatches) {
    topFindings.push(`Stap ${match[1]}: ${match[2].trim()}`);
  }
  return topFindings;
}

function monthText(currentMonth: number, targetResult: Awaited<ReturnType<typeof computeAnalysisTargets>>): string {
  return targetResult
    ? `\n\n## Maandtargets (berekend door forecast engine)
${targetResult.monthlyExpected.map((t) => `- Maand ${t.month}: verwacht ${t.conversions} conversies, €${t.revenue} omzet, €${t.adSpend} spend`).join("\n")}
Huidige maand: ${currentMonth} (${["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"][currentMonth - 1]})
Verwacht deze maand: ${targetResult.monthlyExpected[currentMonth - 1]?.conversions ?? "?"} conversies
BELANGRIJK: Gebruik deze maandtargets als benchmark, NIET het jaardoel.`
    : "";
}

async function runGoogleBiWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "biweekly_sop",
    initialMessage: "Bi-weekly analyse wordt voorbereid...",
    metadata: { sop_type: "biweekly" },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_data",
    message: "Account-, campagne- en weekdata ophalen...",
  });
  const periodStart = monthsAgo(3);
  const periodEnd = fmt(new Date());

  // Phase 1: Fetch data + client context + forecast targets in parallel
  const [
    accountResult, campaignResult, weeklyResult, adgroupResult,
    monthlyOutputResult, clientCtx, targetResult,
  ] = await Promise.all([
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", monthsAgo(1)).order("week_start"),
    supabase.from("ads_adgroup_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
    supabase.from("sop_analysis_output").select("output, analysis_date").eq("client_id", clientId).eq("sop_type", "monthly").eq("section", "full").order("analysis_date", { ascending: false }).limit(1).maybeSingle(),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId),
  ]);

  const { goalsSection, accountType } = clientCtx;

  const accountData = accountResult.data ?? [];
  if (accountData.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId);
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
    message: "Context, benchmarks en change history verrijken...",
  });
  const enrichment = await buildEnrichmentContext({
    supabase,
    clientId,
    accountType,
    sopType: "biweekly",
    analysisDate: periodEnd,
  });

  const previousMonthlyOutput = monthlyOutputResult.data?.output
    ?? "Geen eerdere maandelijkse analyse beschikbaar. Voer de analyse uit op basis van de data zonder referentie aan eerdere bevindingen.";

  // Format monthly targets from forecast engine (same as monthly route)
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = monthText(currentMonth, targetResult);

  // Compute data reliability
  const { data: lagSettings } = await supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle();
  const biweeklyReliability = computeDataReliability({
    accountMonthly: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>,
    campaignMonthly: (campaignResult.data ?? []) as Array<{ campaign_name: string; month: string; cost: number; conversions: number; conversions_value: number }>,
    conversionLagDays: (lagSettings?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: currentMonth === 1 ? 12 : currentMonth - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${biweeklyReliability.promptContext}`;

  // Compute comparison facts for biweekly (same as monthly — uses account monthly data)
  const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const { data: bwClientSector } = await supabase.from("client_settings").select("sector, aov_segment, kpi_targets").eq("client_id", clientId).maybeSingle();
  const bwSectorKey = bwClientSector?.sector || (accountType.startsWith("ecommerce") ? "ecommerce_mid_ticket" : accountType.startsWith("leadgen") ? "leadgen_generiek" : null);
  let bwBenchmarkRows: Array<{ metric: string; low: number; median: number; high: number; top10: number }> = [];
  if (bwSectorKey) {
    const { data: bmData } = await supabase.from("benchmark_sectors").select("metric, low, median, high, top10").eq("sector", bwSectorKey);
    bwBenchmarkRows = (bmData ?? []) as typeof bwBenchmarkRows;
  }
  const kpiRaw = bwClientSector?.kpi_targets as Record<string, number> | null;
  const bwComparisonFacts = computeComparisonFacts({
    accountData: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number; cost_per_conversion: number; roas?: number }>,
    monthlyTargets: targetResult?.monthlyExpected ?? null,
    kpiTargets: kpiRaw ? { roasTarget: kpiRaw.roasTarget ?? 0, cpaTarget: kpiRaw.cpaTarget ?? 0 } : null,
    sectorBenchmarks: bwBenchmarkRows,
    lastCompleteMonth: lastMonth,
  });
  const bwComparisonText = formatComparisonFacts(bwComparisonFacts);

  const systemPrompt = buildBiWeeklyPrompt(goalsSection, accountType, previousMonthlyOutput);

  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";

  const userMessage = `Voer een bi-weekly check-in uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}

${bwComparisonText}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountData)}
\`\`\`

## Account Performance (wekelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(weeklyResult.data ?? [])}
\`\`\`

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(campaignResult.data ?? [])}
\`\`\`

## Ad Group Performance (laatste 3 maanden)
\`\`\`
${toPromptTable(adgroupResult.data ?? [])}
\`\`\`${enrichment.hypothesisTracking}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}

Voer nu de bi-weekly check-in uit volgens alle stappen. Koppel bevindingen terug aan de maandanalyse.
${enrichment.hypothesisTracking ? "\nAls er uitgevoerde hypotheses zijn die nog niet gemeten zijn, beoordeel dan in stap 2 of het verwachte effect al zichtbaar is. Formuleer: 'Hypothese [X] toont [wel/geen/te vroeg] meetbaar effect: [KPI] [steeg/daalde] met X% sinds implementatie op [datum].'" : ""}`;

  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "run_analysis",
    message: "Bi-weekly SOP-analyse uitvoeren...",
  });
  const result = await runAnalysis({
    supabase,
    apiKey,
    clientId,
    sopType: "biweekly",
    systemPrompt,
    userMessage,
    periodStart,
    periodEnd,
  });

  result.output = sanitizeOutput(result.output);

  const extraction = await extractStructuredData({
    supabase,
    apiKey,
    clientId,
    sopType: "biweekly",
    analysisDate: result.analysisDate,
    periodStart,
    periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
    stepOffset: 4, // biweekly has 4 text steps, findings = step 5, recs = step 6
    analysisId: null,
    reliability: biweeklyReliability,
    topFindings: extractTopFindings(result.output).join("\n") || undefined,
    onPhase: async (phaseKey, message) => {
      await updateProgressPhase(supabase, { jobId, phaseKey, message });
    },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Bi-weekly SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate,
      sop_type: "biweekly",
      findings: extraction.findings.length,
      recommendations: extraction.recommendations.length,
      tasks: extraction.tasks.length,
    },
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

// Sommeert dagrijen per maand (YYYY-MM) op de opgegeven numerieke velden. Geen afgeleide ratio's
// (CTR/CPA/ROAS/CPL) -- de LLM rekent die uit de sommen zelf uit, zelfde vertrouwen als weekly al
// geeft bij ruwe dagdata.
function aggregateDailyToMonthly(rows: Array<Record<string, unknown>>, sumFields: string[]): Array<Record<string, unknown>> {
  const buckets = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const month = String(row.date ?? "").slice(0, 7);
    if (!month) continue;
    const bucket = buckets.get(month) ?? Object.fromEntries(sumFields.map((f) => [f, 0]));
    for (const field of sumFields) bucket[field] = (bucket[field] ?? 0) + Number(row[field] ?? 0);
    buckets.set(month, bucket);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, sums]) => ({ month, ...sums }));
}

function withMetaNames(rows: Array<Record<string, unknown>>, names: Map<string, string>): Array<Record<string, unknown>> {
  return rows.map((row) => ({ ...row, entity_name: names.get(String(row.entity_id ?? "")) ?? row.entity_id }));
}

const META_SUM_FIELDS = ["impressions", "spend", "link_clicks", "conversions", "conversion_value"];

async function runMetaBiWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "biweekly_sop",
    initialMessage: "Bi-weekly Meta-analyse wordt voorbereid...",
    metadata: { sop_type: "meta_biweekly" },
  });
  await updateProgressPhase(supabase, { jobId, phaseKey: "fetch_data", message: "Meta-data ophalen..." });

  const periodStart = monthsAgo(3);
  const period30Start = monthsAgo(1);
  const periodEnd = fmt(new Date());

  const [
    accountRows, campaignRows, adsetRows,
    campaignNames, adsetNames,
    monthlyOutputResult, clientCtx, targetResult,
  ] = await Promise.all([
    fetchMetaDaily(supabase, clientId, "meta_account_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_campaign_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_adset_daily", periodStart, periodEnd),
    fetchNameMap(supabase, clientId, "meta_campaigns", "campaign_id", "name"),
    fetchNameMap(supabase, clientId, "meta_adsets", "adset_id", "name"),
    supabase.from("sop_analysis_output").select("output, analysis_date").eq("client_id", clientId).eq("sop_type", "meta_monthly").eq("section", "full").order("analysis_date", { ascending: false }).limit(1).maybeSingle(),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "meta"),
  ]);

  const { goalsSection, accountType } = clientCtx;

  if (accountRows.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId, ["meta_account_daily"]);
    await markProgressFailed(supabase, { jobId, errorMessage: freshness.message });
    return Response.json({
      error: freshness.message,
      freshnessStatus: freshness.freshnessStatus,
      lastSyncAt: freshness.lastSyncAt,
      action: "Sync de data via POST /api/sync",
    }, { status: 404 });
  }

  const previousMonthlyOutput = monthlyOutputResult.data?.output
    ?? "Geen eerdere maandelijkse analyse beschikbaar. Voer de analyse uit op basis van de data zonder referentie aan eerdere bevindingen.";

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = monthText(currentMonth, targetResult);

  const systemPrompt = buildBiWeeklyPrompt(goalsSection, accountType, previousMonthlyOutput, "meta_ads");

  const accountMonthly = aggregateDailyToMonthly(accountRows, META_SUM_FIELDS);
  const accountLast30 = accountRows.filter((r) => String(r.date) >= period30Start);
  const campaignMonthly = withMetaNames(aggregateMonthlyPerEntity(campaignRows, META_SUM_FIELDS), campaignNames);
  const adsetMonthly = withMetaNames(aggregateMonthlyPerEntity(adsetRows, META_SUM_FIELDS), adsetNames);
  const adsetRecent = withMetaNames(adsetRows.filter((r) => String(r.date) >= monthsAgo(1)).slice(-500), adsetNames);

  const userMessage = `Voer een bi-weekly check-in uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${targetText}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountMonthly)}
\`\`\`

## Account Performance (dagelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(accountLast30)}
\`\`\`

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(campaignMonthly)}
\`\`\`

## Ad Set Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(adsetMonthly)}
\`\`\`

## Ad Set Frequency (dagelijks, laatste maand -- voor de verzadigingscheck in stap 4)
\`\`\`
${toPromptTable(adsetRecent)}
\`\`\`

Voer nu de bi-weekly check-in uit volgens alle stappen. Koppel bevindingen terug aan de maandanalyse.`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_analysis", message: "Bi-weekly Meta SOP-analyse uitvoeren..." });
  const result = await runAnalysis({
    supabase, apiKey, clientId, sopType: "meta_biweekly", systemPrompt, userMessage, periodStart, periodEnd,
  });
  result.output = sanitizeOutput(result.output);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "meta_biweekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
    stepOffset: 4,
    analysisId: null,
    topFindings: extractTopFindings(result.output).join("\n") || undefined,
    onPhase: async (phaseKey, message) => { await updateProgressPhase(supabase, { jobId, phaseKey, message }); },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Bi-weekly Meta SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate, sop_type: "meta_biweekly",
      findings: extraction.findings.length, recommendations: extraction.recommendations.length, tasks: extraction.tasks.length,
    },
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

// Sommeert per entiteit (entity_id) EN per maand, i.p.v. alles plat te slaan tot een account-cijfer
// -- nodig voor campagne-/ad set-niveau waar elke entiteit zijn eigen maandreeks moet behouden.
function aggregateMonthlyPerEntity(rows: Array<Record<string, unknown>>, sumFields: string[]): Array<Record<string, unknown>> {
  const buckets = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const month = String(row.date ?? "").slice(0, 7);
    const entityId = String(row.entity_id ?? row.entity_urn ?? "");
    if (!month || !entityId) continue;
    const key = `${entityId}::${month}`;
    const bucket = (buckets.get(key) as Record<string, number> & { entity_id: string; month: string }) ?? {
      entity_id: entityId, month, ...Object.fromEntries(sumFields.map((f) => [f, 0])),
    };
    for (const field of sumFields) (bucket as Record<string, number>)[field] = ((bucket as Record<string, number>)[field] ?? 0) + Number(row[field] ?? 0);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
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

const LINKEDIN_SUM_FIELDS = ["impressions", "clicks", "spend", "one_click_leads", "external_website_conversions", "conversion_value"];

async function runLinkedinBiWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "biweekly_sop",
    initialMessage: "Bi-weekly LinkedIn-analyse wordt voorbereid...",
    metadata: { sop_type: "linkedin_biweekly" },
  });
  await updateProgressPhase(supabase, { jobId, phaseKey: "fetch_data", message: "LinkedIn-data ophalen..." });

  const periodStart = monthsAgo(3);
  const period30Start = monthsAgo(1);
  const periodEnd = fmt(new Date());

  const fetchLinkedinDaily = async (table: string): Promise<Array<Record<string, unknown>>> => {
    const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("date", periodStart).lte("date", periodEnd);
    return (data ?? []) as Array<Record<string, unknown>>;
  };

  const [
    accountRows, campaignRows, creativeRows,
    campaignNames, creativeFormats,
    monthlyOutputResult, clientCtx, targetResult,
  ] = await Promise.all([
    fetchLinkedinDaily("linkedin_account_daily"),
    fetchLinkedinDaily("linkedin_campaign_daily"),
    fetchLinkedinDaily("linkedin_creative_daily"),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_campaigns", "campaign_urn", "name"),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_creatives", "creative_urn", "format"),
    supabase.from("sop_analysis_output").select("output, analysis_date").eq("client_id", clientId).eq("sop_type", "linkedin_monthly").eq("section", "full").order("analysis_date", { ascending: false }).limit(1).maybeSingle(),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "linkedin"),
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

  const previousMonthlyOutput = monthlyOutputResult.data?.output
    ?? "Geen eerdere maandelijkse analyse beschikbaar. Voer de analyse uit op basis van de data zonder referentie aan eerdere bevindingen.";

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = monthText(currentMonth, targetResult);

  const systemPrompt = buildBiWeeklyPrompt(goalsSection, accountType, previousMonthlyOutput, "linkedin_ads");

  const accountMonthly = aggregateDailyToMonthly(accountRows, LINKEDIN_SUM_FIELDS);
  const accountLast30 = accountRows.filter((r) => String(r.date) >= period30Start);
  const campaignMonthly = withLinkedinNames(aggregateMonthlyPerEntity(campaignRows, LINKEDIN_SUM_FIELDS), campaignNames);
  const creativeMonthly = withLinkedinNames(aggregateMonthlyPerEntity(creativeRows, LINKEDIN_SUM_FIELDS), creativeFormats);

  const userMessage = `Voer een bi-weekly check-in uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${targetText}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountMonthly)}
\`\`\`

## Account Performance (dagelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(accountLast30)}
\`\`\`

## Campaign Performance (maandelijks, laatste 3 maanden -- gebruik ook voor de pacing-check in stap 4)
\`\`\`
${toPromptTable(campaignMonthly)}
\`\`\`

## Creative Performance (maandelijks, laatste 3 maanden; entity_name is het formaat -- LinkedIn-creatives hebben geen eigen naam)
\`\`\`
${toPromptTable(creativeMonthly)}
\`\`\`

Voer nu de bi-weekly check-in uit volgens alle stappen. Koppel bevindingen terug aan de maandanalyse.`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_analysis", message: "Bi-weekly LinkedIn SOP-analyse uitvoeren..." });
  const result = await runAnalysis({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly", systemPrompt, userMessage, periodStart, periodEnd,
  });
  result.output = sanitizeOutput(result.output);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
    stepOffset: 4,
    analysisId: null,
    topFindings: extractTopFindings(result.output).join("\n") || undefined,
    onPhase: async (phaseKey, message) => { await updateProgressPhase(supabase, { jobId, phaseKey, message }); },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Bi-weekly LinkedIn SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate, sop_type: "linkedin_biweekly",
      findings: extraction.findings.length, recommendations: extraction.recommendations.length, tasks: extraction.tasks.length,
    },
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
      return await runMetaBiWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    if (channel === "linkedin_ads") {
      return await runLinkedinBiWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    return await runGoogleBiWeeklyAnalysis(supabase, apiKey, clientId, jobId);
  } catch (err) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "Onbekende fout",
    });
    return Response.json({ error: err instanceof Error ? err.message : "Onbekende fout" }, { status: 500 });
  }
}

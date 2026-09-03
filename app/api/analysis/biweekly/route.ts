import { NextRequest, after } from "next/server";
import { buildBiWeeklyStep1Prompt, buildBiWeeklyStep2Prompt, buildBiWeeklyStep3Prompt, buildBiWeeklyStep4Prompt, BIWEEKLY_FINDINGS_SYSTEM, BIWEEKLY_RECS_SYSTEM } from "@/lib/prompts/sop-prompts";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  runStep,
  monthsAgo,
  fmt,
  today,
  saveAnalysisOutputSection,
  type AnalysisResult,
} from "@/lib/analysis/helpers";
import { buildEnrichmentContext } from "@/lib/analysis/enrichment";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { computeMetaReliability, computeLinkedinReliability, computeMicrosoftReliability } from "@/lib/analysis/channel-reliability";
import { sanitizeOutput } from "@/lib/analysis/sanitize";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { datastandVoorKlant, datastandBlokkade } from "@/lib/sync/datastand";
import { computeComparisonFacts, formatComparisonFacts, computePacingFacts, formatPacingFacts } from "@/lib/analysis/comparison-facts";
import { buildMonthlyHandoff } from "@/lib/analysis/monthly-handoff";
import { extractStructuredData } from "@/lib/analysis/extract-structured";
import { toPromptTable } from "@/lib/analysis/prompt-table";
import { fetchNameMap, fetchDaily as fetchMetaDaily } from "@/lib/meta/analysis-data";
import { fetchMicrosoftDaily, fetchMicrosoftNameMap } from "@/lib/microsoft/analysis-data";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import { buildGeheugenMetTaken, alsContextBlok } from "@/lib/analysis/geheugen-grounding";
import { ALLE_SOP_CHANNELS, type SopChannel } from "@/lib/analysis/sop-channel-config";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { controleerPlafond, schatSopRunKosten } from "@/lib/analysis/uitgavenplafond";
import { klantVanId } from "@/lib/tenancy/klanten";
import { logger } from "@/lib/logger";
import { resolveTargets, type TargetRow } from "@/lib/analysis/o2-targets-cost";
import { triggerLiteCrossChannelSynthesisIfReady } from "@/lib/analysis/auto-cross-channel-trigger";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    monthlyOutputResult, clientCtx, targetResult, deviceResult,
  ] = await Promise.all([
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", monthsAgo(1)).order("week_start"),
    supabase.from("ads_adgroup_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
    // Beide secties, nieuwste eerst: structured_monthly_v2 draagt de hypotheses en de diagnose als
    // VELDEN, "full" is het narratieve document. buildMonthlyHandoff kiest de gestructureerde als
    // die er is en valt anders zichtbaar terug -- zie lib/analysis/monthly-handoff.ts.
    supabase.from("sop_analysis_output").select("output, analysis_date, section").eq("client_id", clientId).eq("sop_type", "monthly").in("section", ["structured_monthly_v2", "full"]).order("analysis_date", { ascending: false }).limit(6),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId),
    // Stap 4 heet "Device & Engagement" en het output-format eist waarden voor en na
    // ("[metric] steeg van [waarde] naar [waarde]"), maar de userMessage bevatte alleen de
    // conclusies van stap 1 t/m 3 -- geen enkele device-rij. Onder NUMBER_DISCIPLINE kon het model
    // daar dus alleen mee weigeren of getallen verzinnen. De monthly-route haalt deze tabel al op
    // (monthly/route.ts, ads_device_performance_monthly); de bi-weekly bevroeg hem niet.
    supabase.from("ads_device_performance_monthly").select("*").eq("client_id", clientId).gte("month", periodStart).order("month"),
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

  // Datastand-poort: rijen in het venster zijn niet genoeg, de laatste afgesloten maand moet
  // erin staan -- anders vergelijkt de bi-weekly een oude maand met zichzelf (zie
  // lib/sync/datastand.ts voor de stilstand van 2026 die dit blootlegde).
  const datastand = await datastandVoorKlant(supabase, clientId);
  const datastandFout = datastandBlokkade(datastand);
  if (datastandFout) {
    await markProgressFailed(supabase, { jobId, errorMessage: datastandFout });
    return Response.json({ error: datastandFout, datastand, action: "Sync de data via POST /api/sync, of herstel de Google Ads-koppeling van het bureau." }, { status: 409 });
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
    channel: "google_ads",
  });

  // De overdracht uit de maandanalyse. Ging voorheen als het volledige narratieve document
  // ongetruncateerd de system prompt van alle VIER de stappen in; nu de gestructureerde vorm, met
  // de hypotheses en hun succescriteria als losse punten om tegen te toetsen.
  const monthlySecties = (monthlyOutputResult.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const monthlyStructured = monthlySecties.find((r) => r.section === "structured_monthly_v2");
  const monthlyNarratief = monthlySecties.find((r) => r.section === "full");
  const monthlyHandoff = buildMonthlyHandoff({
    structured: monthlyStructured?.output ?? null,
    narratief: monthlyNarratief?.output ?? null,
    analysisDate: (monthlyStructured ?? monthlyNarratief)?.analysis_date ?? null,
    cadans: "biweekly",
  });
  const previousMonthlyOutput = monthlyHandoff.tekst;

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
  const [{ data: bwClientSector }, { data: bwTargetRows }] = await Promise.all([
    supabase.from("client_settings").select("sector, aov_segment").eq("client_id", clientId).maybeSingle(),
    supabase.from("client_targets").select("channel, metric, target_value, valid_from, valid_to").eq("client_id", clientId).eq("channel", "google_ads"),
  ]);
  const bwSectorKey = bwClientSector?.sector || (accountType.startsWith("ecommerce") ? "ecommerce_mid_ticket" : accountType.startsWith("leadgen") ? "leadgen_generiek" : null);
  let bwBenchmarkRows: Array<{ metric: string; low: number; median: number; high: number; top10: number }> = [];
  if (bwSectorKey) {
    const { data: bmData } = await supabase.from("benchmark_sectors").select("metric, low, median, high, top10").eq("sector", bwSectorKey);
    bwBenchmarkRows = (bmData ?? []) as typeof bwBenchmarkRows;
  }
  // client_targets in plaats van kpi_targets (fase 2, docs/MASTERPLAN.md): zelfde bron als
  // monthly/route.ts sinds migratie 082, zodat er geen tweede lezing van hetzelfde getal bestaat.
  const bwResolvedTargets = resolveTargets(
    (bwTargetRows ?? []).map((row): TargetRow => ({
      channel: String(row.channel),
      metric: String(row.metric),
      targetValue: Number(row.target_value),
      validFrom: String(row.valid_from),
      validTo: row.valid_to == null ? null : String(row.valid_to),
    })),
    "google_ads",
    periodEnd
  );
  const bwComparisonFacts = computeComparisonFacts({
    accountData: accountData as Array<{ month: string; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number; cost_per_conversion: number; roas?: number }>,
    monthlyTargets: targetResult?.monthlyExpected ?? null,
    kpiTargets: { roasTarget: bwResolvedTargets.roas ?? 0, cpaTarget: bwResolvedTargets.cpa ?? 0 },
    sectorBenchmarks: bwBenchmarkRows,
    lastCompleteMonth: lastMonth,
  });
  // De maandnaam van het blok expliciet meegeven: dit gaat over de laatste AFGESLOTEN maand,
  // terwijl de bi-weekly over de lopende maand gaat. Maand ÉN jaar uit dezelfde klok (`now`,
  // waar lastMonth ook uit komt): het jaar kwam hier eerst uit today() (Amsterdam) naast de
  // maand uit de serverklok, wat in het uur rond de jaarwisseling een niet-bestaande maand
  // opleverde ("2027-11") -- precies in het blok waarvan de promptregel eist dat de periode
  // letterlijk wordt overgenomen.
  const afgeslotenMaand = `${lastMonth === 12 ? now.getFullYear() - 1 : now.getFullYear()}-${String(lastMonth).padStart(2, "0")}`;
  const bwComparisonText = formatComparisonFacts(bwComparisonFacts, `${afgeslotenMaand} (de laatste afgesloten maand)`);

  // De maandpacing: waar komt de LOPENDE maand uit? Voorberekend, want de preambule liet dit tot nu
  // toe door het model doen met een rechte lijn die hij twee regels later zelf moest nuanceren.
  // De MTD-stand komt uit de rij van de lopende maand in ads_account_monthly.
  const huidigeMaandSleutel = today().slice(0, 7);
  const huidigeMaandRij = (accountData as Array<Record<string, unknown>>)
    .find((r) => String(r.month ?? "").slice(0, 7) === huidigeMaandSleutel);
  const bwPacingText = huidigeMaandRij
    ? formatPacingFacts(computePacingFacts({
        mtd: {
          spend: Number(huidigeMaandRij.cost ?? 0),
          conversies: Number(huidigeMaandRij.conversions ?? 0),
          conversiewaarde: Number(huidigeMaandRij.conversions_value ?? 0),
        },
        today: today(),
        targets: targetResult?.monthlyExpected?.[Number(huidigeMaandSleutel.slice(5, 7)) - 1]
          ? {
              conversies: Number(targetResult.monthlyExpected[Number(huidigeMaandSleutel.slice(5, 7)) - 1]?.conversions ?? 0),
              conversiewaarde: Number(targetResult.monthlyExpected[Number(huidigeMaandSleutel.slice(5, 7)) - 1]?.revenue ?? 0),
            }
          : null,
      }))
    : "";

  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";

  // Alle context die de ongesplitste versie eenmalig meegaf, gaat nu naar ELKE stap-call (masterplan
  // 17.11x) -- zie de toelichting bij weekly/route.ts voor dezelfde redenering.
  //
  // MODELKEUZE PER STAP (masterplan 17.111), zelfde afweging als weekly: stap 1 t/m 3 zijn
  // signaleringswerk en draaien op callRouted's heavy-tier (Gemini 3.7 Flash, hetzelfde model als
  // monthly's analysestappen). Stap 4 houdt `layer: "narrative"` (Claude Sonnet 5), want daar zit
  // de Eindconclusie met maandprognose, directe acties, sprintplanning-update en twee hypotheses --
  // formuleerwerk waar nuance telt.
  // E1-wiring voor weekly/bi-weekly: het klantgeheugen zat alleen in de monthly, terwijl juist de
  // vaakst draaiende cadans er baat bij heeft -- een weekly die niet weet wat er eerder over deze
  // klant is vastgelegd, begint 52 keer per jaar blanco. Kanaalneutraal: client_memory gaat over de
  // klant, niet over een advertentieplatform, dus alle drie de kanalen krijgen hetzelfde.
  //
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS: twintig taken, begrensd tot dit kanaal.
  // De bi-weekly beoordeelt in stap 2 of uitgevoerde hypotheses al effect tonen -- zonder te weten
  // welke taken werkelijk zijn afgerond is dat een vraag zonder antwoord.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "biweekly", cadans: "biweekly",
  }));
  const sharedContext = `${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}

${bwComparisonText}${bwPacingText}${enrichment.hypothesisTracking}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

  // De hypothese-tracking-instructie hoort specifiek bij stap 2 (zo stond het ook in de
  // ongesplitste versie: "beoordeel dan in stap 2 of het verwachte effect al zichtbaar is").
  const hypothesisInstructionForStep2 = enrichment.hypothesisTracking
    ? "\n\nAls er uitgevoerde hypotheses zijn die nog niet gemeten zijn, beoordeel dan of het verwachte effect al zichtbaar is. Formuleer: 'Hypothese [X] toont [wel/geen/te vroeg] meetbaar effect: [KPI] [steeg/daalde] met X% sinds implementatie op [datum].'"
    : "";

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Performance..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "biweekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep1Prompt(goalsSection, accountType, previousMonthlyOutput),
    userMessage: `Voer stap 1 (Account Performance) uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountData)}
\`\`\`

## Account Performance (wekelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(weeklyResult.data ?? [])}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: Campagne Performance..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "biweekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Campagne Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep2Prompt(goalsSection, accountType, previousMonthlyOutput),
    userMessage: `Voer stap 2 (Campagne Performance) uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(campaignResult.data ?? [])}
\`\`\`${hypothesisInstructionForStep2}`,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: Ad Group Performance..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "biweekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Ad Group Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep3Prompt(goalsSection, accountType, previousMonthlyOutput),
    userMessage: `Voer stap 3 (Ad Group Performance) uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Ad Group Performance (laatste 3 maanden)
\`\`\`
${toPromptTable(adgroupResult.data ?? [])}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_4", message: "Stap 4: Device & Engagement, eindconclusie..." });
  const step4 = await runStep({
    supabase, apiKey, clientId, sopType: "biweekly", periodStart, periodEnd,
    stepNumber: 4, stepName: "Device Engagement",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildBiWeeklyStep4Prompt(goalsSection, accountType, previousMonthlyOutput),
    userMessage: `Voer stap 4 (Device & Engagement) en de afsluitende Eindconclusie uit voor client "${clientId}".
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Conclusie stap 3 (Ad Group Performance)
${step3.output}

## Device Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(deviceResult.data ?? [])}
\`\`\`

Koppel bevindingen terug aan de maandanalyse.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "biweekly", analysisDate: today(), periodStart, periodEnd,
    model: step4.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed + step4.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Performance

${step1.output}

---

## Stap 2: Campagne Performance

${step2.output}

---

## Stap 3: Ad Group Performance

${step3.output}

---

## Stap 4: Device & Engagement

${step4.output}`),
    saved: step1.saved && step2.saved && step3.saved && step4.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs + step4.latencyMs,
    retries: step1.retries + step2.retries + step3.retries + step4.retries,
  };
  await saveFullOutputMarker(supabase, result);

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
    stepOffset: 4, // biweekly heeft 4 analyse-stappen, findings = step 5, recs = step 6
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

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "biweekly", periodStart, periodEnd);
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

// De maandpacing voor de kanalen met DAGRIJEN (Meta en LinkedIn). Zij kunnen de stand tot nu toe
// exact optellen, waar de Google-tak het uit de maandrij van de lopende maand haalt. Zelfde
// voorberekende blok, andere bron -- de prompt kent maar één vorm.
function pacingUitDagrijen(
  dagrijen: Array<Record<string, unknown>>,
  velden: Record<string, string>,
  targets: Record<string, number> | null
): string {
  const maandSleutel = today().slice(0, 7);
  const dezeMaand = dagrijen.filter((r) => String(r.date ?? "").slice(0, 7) === maandSleutel);
  if (dezeMaand.length === 0) return "";
  const mtd: Record<string, number> = {};
  for (const [label, kolom] of Object.entries(velden)) {
    mtd[label] = dezeMaand.reduce((som, r) => som + Number(r[kolom] ?? 0), 0);
  }
  return formatPacingFacts(computePacingFacts({ mtd, today: today(), targets }));
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
    monthlyOutputResult, clientCtx, targetResult, lagSettingsResult,
  ] = await Promise.all([
    fetchMetaDaily(supabase, clientId, "meta_account_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_campaign_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_adset_daily", periodStart, periodEnd),
    fetchNameMap(supabase, clientId, "meta_campaigns", "campaign_id", "name"),
    fetchNameMap(supabase, clientId, "meta_adsets", "adset_id", "name"),
    // Beide secties, nieuwste eerst: structured_monthly_v2 draagt de hypotheses en de diagnose als
    // VELDEN, "full" is het narratieve document. buildMonthlyHandoff kiest de gestructureerde als
    // die er is en valt anders zichtbaar terug -- zie lib/analysis/monthly-handoff.ts.
    supabase.from("sop_analysis_output").select("output, analysis_date, section").eq("client_id", clientId).eq("sop_type", "meta_monthly").in("section", ["structured_monthly_v2", "full"]).order("analysis_date", { ascending: false }).limit(6),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "meta"),
    supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle(),
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

  // De overdracht uit de maandanalyse. Ging voorheen als het volledige narratieve document
  // ongetruncateerd de system prompt van alle VIER de stappen in; nu de gestructureerde vorm, met
  // de hypotheses en hun succescriteria als losse punten om tegen te toetsen.
  const monthlySecties = (monthlyOutputResult.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const monthlyStructured = monthlySecties.find((r) => r.section === "structured_monthly_v2");
  const monthlyNarratief = monthlySecties.find((r) => r.section === "full");
  const monthlyHandoff = buildMonthlyHandoff({
    structured: monthlyStructured?.output ?? null,
    narratief: monthlyNarratief?.output ?? null,
    analysisDate: (monthlyStructured ?? monthlyNarratief)?.analysis_date ?? null,
    cadans: "biweekly",
  });
  const previousMonthlyOutput = monthlyHandoff.tekst;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = monthText(currentMonth, targetResult);

  // F5 fase1.1: reliability-gating parity met Google.
  const metaReliability = computeMetaReliability({
    accountDaily: accountRows,
    campaignDaily: campaignRows,
    conversionLagDays: (lagSettingsResult.data?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: currentMonth === 1 ? 12 : currentMonth - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${metaReliability.promptContext}`;

  const accountMonthly = aggregateDailyToMonthly(accountRows, META_SUM_FIELDS);
  const accountLast30 = accountRows.filter((r) => String(r.date) >= period30Start);
  const campaignMonthly = withMetaNames(aggregateMonthlyPerEntity(campaignRows, META_SUM_FIELDS), campaignNames);
  const adsetMonthly = withMetaNames(aggregateMonthlyPerEntity(adsetRows, META_SUM_FIELDS), adsetNames);
  const adsetRecent = withMetaNames(adsetRows.filter((r) => String(r.date) >= monthsAgo(1)).slice(-500), adsetNames);

  const metaPacingText = pacingUitDagrijen(
    accountRows,
    { spend: "spend", conversies: "conversions", conversiewaarde: "conversion_value" },
    targetResult?.monthlyExpected?.[Number(today().slice(5, 7)) - 1]
      ? {
          conversies: Number(targetResult.monthlyExpected[Number(today().slice(5, 7)) - 1]?.conversions ?? 0),
          conversiewaarde: Number(targetResult.monthlyExpected[Number(today().slice(5, 7)) - 1]?.revenue ?? 0),
        }
      : null
  );
  // Zelfde verrijkingslaag als het Google-pad, nu kanaalbewust (zie ALLEEN_GOOGLE in
  // lib/analysis/enrichment.ts). Voor de bi-weekly is hypothesisTracking de laag die er het meest
  // toe doet: die is echt kanaalneutraal (sop_hypothesis_tracking draagt geen kanaalkolom) en het
  // is precies wat deze cadans hoort te doen -- toetsen of doorgevoerde hypotheses effect tonen.
  //
  // De hypothese-instructie bij stap 2 hing tot nu toe alleen in de Google-tak; hij hoort bij de
  // laag, niet bij het kanaal.
  const enrichment = await buildEnrichmentContext({
    supabase, clientId, accountType, sopType: "biweekly", analysisDate: periodEnd, channel: "meta_ads",
  });
  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
  const hypothesisInstructionForStep2 = enrichment.hypothesisTracking
    ? "\n\nAls er uitgevoerde hypotheses zijn die nog niet gemeten zijn, beoordeel dan of het verwachte effect al zichtbaar is. Formuleer: 'Hypothese [X] toont [wel/geen/te vroeg] meetbaar effect: [KPI] [steeg/daalde] met X% sinds implementatie op [datum].'"
    : "";
  // E1-wiring voor weekly/bi-weekly: het klantgeheugen zat alleen in de monthly, terwijl juist de
  // vaakst draaiende cadans er baat bij heeft -- een weekly die niet weet wat er eerder over deze
  // klant is vastgelegd, begint 52 keer per jaar blanco. Kanaalneutraal: client_memory gaat over de
  // klant, niet over een advertentieplatform, dus alle drie de kanalen krijgen hetzelfde.
  //
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS: twintig taken, begrensd tot dit kanaal.
  // De bi-weekly beoordeelt in stap 2 of uitgevoerde hypotheses al effect tonen -- zonder te weten
  // welke taken werkelijk zijn afgerond is dat een vraag zonder antwoord.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "meta_biweekly", cadans: "biweekly",
  }));
  const sharedContext = `${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${metaPacingText}${enrichment.hypothesisTracking}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Performance (Meta)..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_biweekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep1Prompt(goalsSection, accountType, previousMonthlyOutput, "meta_ads"),
    userMessage: `Voer stap 1 (Account Performance) uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountMonthly)}
\`\`\`

## Account Performance (dagelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(accountLast30)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: Campagne Performance (Meta)..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_biweekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Campagne Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep2Prompt(goalsSection, accountType, previousMonthlyOutput, "meta_ads"),
    userMessage: `Voer stap 2 (Campagne Performance) uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(campaignMonthly)}
\`\`\`${hypothesisInstructionForStep2}`,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: Ad Set & Doelgroep Performance (Meta)..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_biweekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Ad Set en Doelgroep Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep3Prompt(goalsSection, accountType, previousMonthlyOutput, "meta_ads"),
    userMessage: `Voer stap 3 (Ad Set & Doelgroep Performance) uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Ad Set Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(adsetMonthly)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_4", message: "Stap 4: Frequency & Verzadiging (Meta), eindconclusie..." });
  const step4 = await runStep({
    supabase, apiKey, clientId, sopType: "meta_biweekly", periodStart, periodEnd,
    stepNumber: 4, stepName: "Frequency en Verzadiging",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildBiWeeklyStep4Prompt(goalsSection, accountType, previousMonthlyOutput, "meta_ads"),
    userMessage: `Voer stap 4 (Frequency & Verzadiging) en de afsluitende Eindconclusie uit voor client "${clientId}" (Meta Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Conclusie stap 3 (Ad Set en Doelgroep Performance)
${step3.output}

## Ad Set Frequency (dagelijks, laatste maand -- voor de verzadigingscheck)
\`\`\`
${toPromptTable(adsetRecent)}
\`\`\`

Koppel bevindingen terug aan de maandanalyse.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "meta_biweekly", analysisDate: today(), periodStart, periodEnd,
    model: step4.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed + step4.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Performance

${step1.output}

---

## Stap 2: Campagne Performance

${step2.output}

---

## Stap 3: Ad Set & Doelgroep Performance

${step3.output}

---

## Stap 4: Frequency & Verzadiging

${step4.output}`),
    saved: step1.saved && step2.saved && step3.saved && step4.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs + step4.latencyMs,
    retries: step1.retries + step2.retries + step3.retries + step4.retries,
  };
  await saveFullOutputMarker(supabase, result);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "meta_biweekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
    stepOffset: 4,
    analysisId: null,
    topFindings: extractTopFindings(result.output).join("\n") || undefined,
    reliability: metaReliability,
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

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "biweekly", periodStart, periodEnd);
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
  // De eerste van de LOPENDE maand: stap 4 kijkt naar pacing binnen de maand die nu loopt, en
  // daarvoor zijn dagrijen nodig -- uit een maandtotaal is niet af te lezen of een dagbudget al op
  // de tiende op was.
  //
  // Afgeleid van today() en niet van periodEnd: periodEnd is fmt(new Date()), dus de UTC-datum,
  // terwijl today() de Amsterdamse is. Op 1 augustus om 01:00 Amsterdamse tijd zegt UTC nog
  // 31 juli, en dan zou dit filter een hele maand te vroeg beginnen en de "lopende maand" met de
  // vorige vullen. lib/reporting-date.ts schrijft die regel expliciet voor.
  const huidigeMaandStart = `${today().slice(0, 7)}-01`;

  const fetchLinkedinDaily = async (table: string): Promise<Array<Record<string, unknown>>> => {
    const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("date", periodStart).lte("date", periodEnd);
    return (data ?? []) as Array<Record<string, unknown>>;
  };

  const [
    accountRows, campaignRows, creativeRows,
    campaignNames, creativeFormats,
    monthlyOutputResult, clientCtx, targetResult, lagSettingsResult, campaignMetaResult,
  ] = await Promise.all([
    fetchLinkedinDaily("linkedin_account_daily"),
    fetchLinkedinDaily("linkedin_campaign_daily"),
    fetchLinkedinDaily("linkedin_creative_daily"),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_campaigns", "campaign_urn", "name"),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_creatives", "creative_urn", "format"),
    // Beide secties, nieuwste eerst: structured_monthly_v2 draagt de hypotheses en de diagnose als
    // VELDEN, "full" is het narratieve document. buildMonthlyHandoff kiest de gestructureerde als
    // die er is en valt anders zichtbaar terug -- zie lib/analysis/monthly-handoff.ts.
    supabase.from("sop_analysis_output").select("output, analysis_date, section").eq("client_id", clientId).eq("sop_type", "linkedin_monthly").in("section", ["structured_monthly_v2", "full"]).order("analysis_date", { ascending: false }).limit(6),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "linkedin"),
    supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle(),
    // Stap 4 heet "Bidding & Pacing" en vraagt of een campagne vroeg leegloopt dan wel
    // onderbesteed blijft, en of een CPL-stijging op een te laag bod wijst. Zonder dagbudget,
    // eenheidsprijs en biedstrategie is geen van beide vragen te beantwoorden -- en tot nu toe
    // kreeg de stap alleen maandaggregaten, waaruit een pacingcurve per definitie niet af te
    // lezen is. Deze kolommen bestaan al in linkedin_campaigns (lib/linkedin/entities.ts:107-110
    // vult ze bij elke sync); ze werden alleen nergens geselecteerd.
    supabase.from("linkedin_campaigns").select("campaign_urn, name, daily_budget, unit_cost, bid_strategy, cost_type").eq("client_id", clientId),
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

  // De overdracht uit de maandanalyse. Ging voorheen als het volledige narratieve document
  // ongetruncateerd de system prompt van alle VIER de stappen in; nu de gestructureerde vorm, met
  // de hypotheses en hun succescriteria als losse punten om tegen te toetsen.
  const monthlySecties = (monthlyOutputResult.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const monthlyStructured = monthlySecties.find((r) => r.section === "structured_monthly_v2");
  const monthlyNarratief = monthlySecties.find((r) => r.section === "full");
  const monthlyHandoff = buildMonthlyHandoff({
    structured: monthlyStructured?.output ?? null,
    narratief: monthlyNarratief?.output ?? null,
    analysisDate: (monthlyStructured ?? monthlyNarratief)?.analysis_date ?? null,
    cadans: "biweekly",
  });
  const previousMonthlyOutput = monthlyHandoff.tekst;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = monthText(currentMonth, targetResult);

  // F5 fase1.1: reliability-gating parity met Google.
  const linkedinReliability = computeLinkedinReliability({
    accountDaily: accountRows,
    campaignDaily: campaignRows,
    conversionLagDays: (lagSettingsResult.data?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: currentMonth === 1 ? 12 : currentMonth - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${linkedinReliability.promptContext}`;

  const accountMonthly = aggregateDailyToMonthly(accountRows, LINKEDIN_SUM_FIELDS);
  const accountLast30 = accountRows.filter((r) => String(r.date) >= period30Start);
  const campaignMonthly = withLinkedinNames(aggregateMonthlyPerEntity(campaignRows, LINKEDIN_SUM_FIELDS), campaignNames);
  const creativeMonthly = withLinkedinNames(aggregateMonthlyPerEntity(creativeRows, LINKEDIN_SUM_FIELDS), creativeFormats);

  // LinkedIn rekent in leads, niet in conversiewaarde: CPL leidt (zie LINKEDIN_BENCHMARKS).
  const linkedinPacingText = pacingUitDagrijen(
    accountRows,
    { spend: "spend", leads: "one_click_leads", conversies: "external_website_conversions" },
    targetResult?.monthlyExpected?.[Number(today().slice(5, 7)) - 1]
      ? { conversies: Number(targetResult.monthlyExpected[Number(today().slice(5, 7)) - 1]?.conversions ?? 0) }
      : null
  );
  // Zelfde verrijkingslaag als het Google-pad, nu kanaalbewust (zie ALLEEN_GOOGLE in
  // lib/analysis/enrichment.ts). Voor de bi-weekly is hypothesisTracking de laag die er het meest
  // toe doet: die is echt kanaalneutraal (sop_hypothesis_tracking draagt geen kanaalkolom) en het
  // is precies wat deze cadans hoort te doen -- toetsen of doorgevoerde hypotheses effect tonen.
  //
  // De hypothese-instructie bij stap 2 hing tot nu toe alleen in de Google-tak; hij hoort bij de
  // laag, niet bij het kanaal.
  const enrichment = await buildEnrichmentContext({
    supabase, clientId, accountType, sopType: "biweekly", analysisDate: periodEnd, channel: "linkedin_ads",
  });
  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
  const hypothesisInstructionForStep2 = enrichment.hypothesisTracking
    ? "\n\nAls er uitgevoerde hypotheses zijn die nog niet gemeten zijn, beoordeel dan of het verwachte effect al zichtbaar is. Formuleer: 'Hypothese [X] toont [wel/geen/te vroeg] meetbaar effect: [KPI] [steeg/daalde] met X% sinds implementatie op [datum].'"
    : "";
  // E1-wiring voor weekly/bi-weekly: het klantgeheugen zat alleen in de monthly, terwijl juist de
  // vaakst draaiende cadans er baat bij heeft -- een weekly die niet weet wat er eerder over deze
  // klant is vastgelegd, begint 52 keer per jaar blanco. Kanaalneutraal: client_memory gaat over de
  // klant, niet over een advertentieplatform, dus alle drie de kanalen krijgen hetzelfde.
  //
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS: twintig taken, begrensd tot dit kanaal.
  // De bi-weekly beoordeelt in stap 2 of uitgevoerde hypotheses al effect tonen -- zonder te weten
  // welke taken werkelijk zijn afgerond is dat een vraag zonder antwoord.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "linkedin_biweekly", cadans: "biweekly",
  }));
  const sharedContext = `${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${linkedinPacingText}${enrichment.hypothesisTracking}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Performance (LinkedIn)..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep1Prompt(goalsSection, accountType, previousMonthlyOutput, "linkedin_ads"),
    userMessage: `Voer stap 1 (Account Performance) uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountMonthly)}
\`\`\`

## Account Performance (dagelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(accountLast30)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: Campagne Performance (LinkedIn)..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Campagne Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep2Prompt(goalsSection, accountType, previousMonthlyOutput, "linkedin_ads"),
    userMessage: `Voer stap 2 (Campagne Performance) uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Campaign Performance (maandelijks, laatste 3 maanden -- wordt ook gebruikt voor de pacing-check in stap 4)
\`\`\`
${toPromptTable(campaignMonthly)}
\`\`\`${hypothesisInstructionForStep2}`,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: Creative Performance (LinkedIn)..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Creative Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep3Prompt(goalsSection, accountType, previousMonthlyOutput, "linkedin_ads"),
    userMessage: `Voer stap 3 (Creative Performance) uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Creative Performance (maandelijks, laatste 3 maanden; entity_name is het formaat -- LinkedIn-creatives hebben geen eigen naam)
\`\`\`
${toPromptTable(creativeMonthly)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_4", message: "Stap 4: Bidding & Pacing (LinkedIn), eindconclusie..." });
  const step4 = await runStep({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly", periodStart, periodEnd,
    stepNumber: 4, stepName: "Bidding en Pacing",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildBiWeeklyStep4Prompt(goalsSection, accountType, previousMonthlyOutput, "linkedin_ads"),
    userMessage: `Voer stap 4 (Bidding & Pacing) en de afsluitende Eindconclusie uit voor client "${clientId}" (LinkedIn Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Conclusie stap 3 (Creative Performance)
${step3.output}

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(campaignMonthly)}
\`\`\`

## Campagne-instellingen (dagbudget, biedstrategie, eenheidsprijs)
\`\`\`
${toPromptTable(campaignMetaResult.data ?? [])}
\`\`\`

## Dagelijkse spend per campagne, lopende maand (voor de pacing-curve -- uit maandtotalen is niet te zien of een budget vroeg opraakt)
\`\`\`
${toPromptTable(withLinkedinNames(campaignRows.filter((r) => String(r.date ?? "") >= huidigeMaandStart), campaignNames))}
\`\`\`

Koppel bevindingen terug aan de maandanalyse.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "linkedin_biweekly", analysisDate: today(), periodStart, periodEnd,
    model: step4.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed + step4.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Performance

${step1.output}

---

## Stap 2: Campagne Performance

${step2.output}

---

## Stap 3: Creative Performance

${step3.output}

---

## Stap 4: Bidding & Pacing

${step4.output}`),
    saved: step1.saved && step2.saved && step3.saved && step4.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs + step4.latencyMs,
    retries: step1.retries + step2.retries + step3.retries + step4.retries,
  };
  await saveFullOutputMarker(supabase, result);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "linkedin_biweekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
    stepOffset: 4,
    analysisId: null,
    topFindings: extractTopFindings(result.output).join("\n") || undefined,
    reliability: linkedinReliability,
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

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "biweekly", periodStart, periodEnd);
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

// Microsoft-daily's dragen entity_id net als Meta -- zelfde naamverrijking, ander kanaal.
const withMicrosoftNames = withMetaNames;

const MICROSOFT_SUM_FIELDS = ["impressions", "clicks", "spend", "conversions", "conversion_value"];

// Microsoft bi-weekly (Bing): dezelfde vierstappenvorm als Meta/LinkedIn, met de search-inhoud uit
// MICROSOFT_BIWEEKLY (lib/prompts/biweekly-channel-content.ts): stap 3 toetst de keywords en ad
// groups uit de maandanalyse, stap 4 de netwerk/device-assen en het impressieaandeel -- de twee
// plekken waar dit kanaal structureel lekt (Audience Network) of klem zit (budget- vs.
// positieverlies). LIVE-ONGETEST: pas met een echt Microsoft-account te verifieren.
async function runMicrosoftBiWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "biweekly_sop",
    initialMessage: "Bi-weekly Microsoft Ads-analyse wordt voorbereid...",
    metadata: { sop_type: "microsoft_biweekly" },
  });
  await updateProgressPhase(supabase, { jobId, phaseKey: "fetch_data", message: "Microsoft-data ophalen..." });

  const periodStart = monthsAgo(3);
  const period30Start = monthsAgo(1);
  const periodEnd = fmt(new Date());

  const [
    accountRows, campaignRows, adgroupRows, breakdownRows,
    campaignNames, adgroupNames, keywordResult, impressionShareResult, campaignMetaResult,
    monthlyOutputResult, clientCtx, targetResult, lagSettingsResult,
  ] = await Promise.all([
    fetchMicrosoftDaily(supabase, clientId, "microsoft_account_daily", periodStart, periodEnd),
    fetchMicrosoftDaily(supabase, clientId, "microsoft_campaign_daily", periodStart, periodEnd),
    fetchMicrosoftDaily(supabase, clientId, "microsoft_adgroup_daily", periodStart, periodEnd),
    // De netwerk- en device-splitsing voor stap 4 -- long format, per dag; hieronder per maand en
    // per segment samengevat.
    fetchMicrosoftDaily(supabase, clientId, "microsoft_breakdown_daily", periodStart, periodEnd),
    fetchMicrosoftNameMap(supabase, clientId, "microsoft_campaigns", "campaign_id"),
    fetchMicrosoftNameMap(supabase, clientId, "microsoft_adgroups", "adgroup_id"),
    // Keywords zijn maandkorrel (hoge kardinaliteit): de duurste 120 over de analyseperiode is
    // genoeg om de maandanalyse-keywords terug te vinden zonder de prompt te verdrinken.
    supabase.from("microsoft_keyword_monthly").select("keyword_text, match_type, campaign_name, ad_group_name, month, impressions, clicks, cost, conversions, quality_score").eq("client_id", clientId).gte("month", periodStart).order("cost", { ascending: false }).limit(120),
    // Impressieaandeel met budget- en positieverlies apart: die vragen tegengestelde ingrepen.
    supabase.from("microsoft_campaign_impression_share").select("campaign_name, month, impression_share, budget_lost_is, rank_lost_is, daily_budget, budget_utilization").eq("client_id", clientId).gte("month", periodStart).order("month"),
    // Campagne-instellingen mét import_source: een verschuiving vlak na een verversde import is
    // een eigen wortelooorzaak (import-drift, zie pijler 2 van de maandanalyse).
    supabase.from("microsoft_campaigns").select("campaign_id, name, campaign_type, daily_budget, bid_strategy, import_source, serving_status").eq("client_id", clientId),
    // Beide secties, nieuwste eerst: structured_monthly_v2 draagt de hypotheses en de diagnose als
    // VELDEN, "full" is het narratieve document. buildMonthlyHandoff kiest de gestructureerde als
    // die er is en valt anders zichtbaar terug -- zie lib/analysis/monthly-handoff.ts.
    supabase.from("sop_analysis_output").select("output, analysis_date, section").eq("client_id", clientId).eq("sop_type", "microsoft_monthly").in("section", ["structured_monthly_v2", "full"]).order("analysis_date", { ascending: false }).limit(6),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "microsoft"),
    supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle(),
  ]);

  const { goalsSection, accountType } = clientCtx;

  if (accountRows.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId, ["microsoft_account_daily"]);
    await markProgressFailed(supabase, { jobId, errorMessage: freshness.message });
    return Response.json({
      error: freshness.message,
      freshnessStatus: freshness.freshnessStatus,
      lastSyncAt: freshness.lastSyncAt,
      action: "Sync de data via POST /api/sync",
    }, { status: 404 });
  }

  // De overdracht uit de maandanalyse. Zelfde gestructureerde vorm als Meta/LinkedIn, met de
  // hypotheses en hun succescriteria als losse punten om tegen te toetsen.
  const monthlySecties = (monthlyOutputResult.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const monthlyStructured = monthlySecties.find((r) => r.section === "structured_monthly_v2");
  const monthlyNarratief = monthlySecties.find((r) => r.section === "full");
  const monthlyHandoff = buildMonthlyHandoff({
    structured: monthlyStructured?.output ?? null,
    narratief: monthlyNarratief?.output ?? null,
    analysisDate: (monthlyStructured ?? monthlyNarratief)?.analysis_date ?? null,
    cadans: "biweekly",
  });
  const previousMonthlyOutput = monthlyHandoff.tekst;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetText = monthText(currentMonth, targetResult);

  // Zelfde reliability-gating als de andere kanalen, genormaliseerd naar de Microsoft-kolomnamen
  // (clicks/spend/conversions) via computeMicrosoftReliability().
  const microsoftReliability = computeMicrosoftReliability({
    accountDaily: accountRows,
    campaignDaily: campaignRows,
    conversionLagDays: (lagSettingsResult.data?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: currentMonth === 1 ? 12 : currentMonth - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${microsoftReliability.promptContext}`;

  const accountMonthly = aggregateDailyToMonthly(accountRows, MICROSOFT_SUM_FIELDS);
  const accountLast30 = accountRows.filter((r) => String(r.date) >= period30Start);
  const campaignMonthly = withMicrosoftNames(aggregateMonthlyPerEntity(campaignRows, MICROSOFT_SUM_FIELDS), campaignNames);
  const adgroupMonthly = withMicrosoftNames(aggregateMonthlyPerEntity(adgroupRows, MICROSOFT_SUM_FIELDS), adgroupNames);
  // Netwerk- en device-segmenten per maand: hergebruik van aggregateMonthlyPerEntity via een
  // samengestelde sleutel, zodat "network=Audience" en "device=Desktop" elk hun eigen maandreeks
  // houden -- stap 4 vergelijkt aandelen over de maanden heen.
  // level="account": zonder dit filter telt de som dubbel zodra een sync ook campagne-level
  // breakdowns schrijft (de unieke sleutel van de tabel draagt een level-kolom).
  const netwerkDeviceMonthly = aggregateMonthlyPerEntity(
    breakdownRows.filter((r) => String(r.level) === "account")
      .map((r) => ({ ...r, entity_id: `${r.breakdown_type}=${r.breakdown_value}` })),
    MICROSOFT_SUM_FIELDS
  ).map(({ entity_id, ...rest }) => ({ segment: entity_id, ...rest }));

  const microsoftPacingText = pacingUitDagrijen(
    accountRows,
    { spend: "spend", conversies: "conversions", conversiewaarde: "conversion_value" },
    targetResult?.monthlyExpected?.[Number(today().slice(5, 7)) - 1]
      ? {
          conversies: Number(targetResult.monthlyExpected[Number(today().slice(5, 7)) - 1]?.conversions ?? 0),
          conversiewaarde: Number(targetResult.monthlyExpected[Number(today().slice(5, 7)) - 1]?.revenue ?? 0),
        }
      : null
  );
  // Zelfde verrijkingslaag als de andere kanalen; hypothesisTracking is voor de bi-weekly de laag
  // die er het meest toe doet -- toetsen of doorgevoerde hypotheses effect tonen.
  const enrichment = await buildEnrichmentContext({
    supabase, clientId, accountType, sopType: "biweekly", analysisDate: periodEnd, channel: "microsoft_ads",
  });
  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
  const hypothesisInstructionForStep2 = enrichment.hypothesisTracking
    ? "\n\nAls er uitgevoerde hypotheses zijn die nog niet gemeten zijn, beoordeel dan of het verwachte effect al zichtbaar is. Formuleer: 'Hypothese [X] toont [wel/geen/te vroeg] meetbaar effect: [KPI] [steeg/daalde] met X% sinds implementatie op [datum].'"
    : "";
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS: twintig taken, begrensd tot dit kanaal --
  // zonder te weten welke taken werkelijk zijn afgerond is "toont hypothese X al effect" een vraag
  // zonder antwoord.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "microsoft_biweekly", cadans: "biweekly",
  }));
  const sharedContext = `${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${microsoftPacingText}${enrichment.hypothesisTracking}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Performance (Microsoft)..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_biweekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep1Prompt(goalsSection, accountType, previousMonthlyOutput, "microsoft_ads"),
    userMessage: `Voer stap 1 (Account Performance) uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(accountMonthly)}
\`\`\`

## Account Performance (dagelijks, laatste 30 dagen)
\`\`\`
${toPromptTable(accountLast30)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: Campagne Performance (Microsoft)..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_biweekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Campagne Performance",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep2Prompt(goalsSection, accountType, previousMonthlyOutput, "microsoft_ads"),
    userMessage: `Voer stap 2 (Campagne Performance) uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Campaign Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(campaignMonthly)}
\`\`\`

## Campagne-instellingen (dagbudget, biedstrategie, import_source -- een verschuiving vlak na een verversde import is een eigen wortelooorzaak)
\`\`\`
${toPromptTable(campaignMetaResult.data ?? [])}
\`\`\`${hypothesisInstructionForStep2}`,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: Keyword & Ad Group-ontwikkeling (Microsoft)..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_biweekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Keyword en Ad Group-ontwikkeling",
    runKey: jobId,
    systemPrompt: buildBiWeeklyStep3Prompt(goalsSection, accountType, previousMonthlyOutput, "microsoft_ads"),
    userMessage: `Voer stap 3 (Keyword & Ad Group-ontwikkeling) uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Ad Group Performance (maandelijks, laatste 3 maanden)
\`\`\`
${toPromptTable(adgroupMonthly)}
\`\`\`

## Keyword Performance (maandkorrel, duurste 120 -- noem bij elk oordeel de absolute aantallen: op dit volume is twee weken vaak te kort voor een hard oordeel)
\`\`\`
${toPromptTable((keywordResult.data ?? []) as Array<Record<string, unknown>>)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_4", message: "Stap 4: Netwerk & Device (Microsoft), eindconclusie..." });
  const step4 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_biweekly", periodStart, periodEnd,
    stepNumber: 4, stepName: "Netwerk en Device",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildBiWeeklyStep4Prompt(goalsSection, accountType, previousMonthlyOutput, "microsoft_ads"),
    userMessage: `Voer stap 4 (Netwerk & Device) en de afsluitende Eindconclusie uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Performance)
${step1.output}

## Conclusie stap 2 (Campagne Performance)
${step2.output}

## Conclusie stap 3 (Keyword & Ad Group-ontwikkeling)
${step3.output}

## Netwerk- en device-segmenten (per maand, laatste 3 maanden -- Audience Network-aandeel en desktop/mobile-verhouding)
\`\`\`
${toPromptTable(netwerkDeviceMonthly)}
\`\`\`

## Impressieaandeel per campagne (per maand; budget_lost_is en rank_lost_is apart -- die vragen tegengestelde ingrepen)
\`\`\`
${toPromptTable((impressionShareResult.data ?? []) as Array<Record<string, unknown>>)}
\`\`\`

Koppel bevindingen terug aan de maandanalyse.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "microsoft_biweekly", analysisDate: today(), periodStart, periodEnd,
    model: step4.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed + step4.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Performance

${step1.output}

---

## Stap 2: Campagne Performance

${step2.output}

---

## Stap 3: Keyword & Ad Group-ontwikkeling

${step3.output}

---

## Stap 4: Netwerk & Device

${step4.output}`),
    saved: step1.saved && step2.saved && step3.saved && step4.saved,
    latencyMs: step1.latencyMs + step2.latencyMs + step3.latencyMs + step4.latencyMs,
    retries: step1.retries + step2.retries + step3.retries + step4.retries,
  };
  await saveFullOutputMarker(supabase, result);

  const extraction = await extractStructuredData({
    supabase, apiKey, clientId, sopType: "microsoft_biweekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: BIWEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: BIWEEKLY_RECS_SYSTEM,
    stepOffset: 4,
    analysisId: null,
    topFindings: extractTopFindings(result.output).join("\n") || undefined,
    reliability: microsoftReliability,
    onPhase: async (phaseKey, message) => { await updateProgressPhase(supabase, { jobId, phaseKey, message }); },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Bi-weekly Microsoft SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate, sop_type: "microsoft_biweekly",
      findings: extraction.findings.length, recommendations: extraction.recommendations.length, tasks: extraction.tasks.length,
    },
  });

  // Faalt zacht, blokkeert nooit deze respons -- zie lib/analysis/auto-cross-channel-trigger.ts.
  // Via after(): draait NA het versturen van de respons, telt dus niet meer mee in de tijd die de
  // client op dit fetch-antwoord wacht -- zelfde reden als de after()-wijziging in
  // app/api/analysis/monthly/route.ts.
  after(async () => {
    await triggerLiteCrossChannelSynthesisIfReady(supabase, clientId, "biweekly", periodStart, periodEnd);
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

  // Alleen de cron (app/api/cron/trigger-sops) zet deze vlag; de handmatige knop laat 'm weg.
  let automatisch = false;
  let clientId: string;
  let jobId = crypto.randomUUID();
  let channel = "google_ads";
  try {
    const body = await request.json();
    automatisch = body.automatisch === true;
    clientId = body.client_id;
    jobId = body.job_id || crypto.randomUUID();
    channel = body.channel || "google_ads";
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  // Een onbekend kanaal viel stilzwijgend terug op de volledige Google-analyse, op Google-tabellen.
  // Een typefout in body.channel gaf dus geen fout maar een verkeerd antwoord, en de monthly-route
  // doet dit al wél streng via getAdapter(). ALLE_SOP_CHANNELS is de ene lijst die ook de knoppen
  // en de cron gebruiken.
  if (!ALLE_SOP_CHANNELS.includes(channel as SopChannel)) {
    return Response.json(
      { error: `Onbekend kanaal "${channel}". Geldig: ${ALLE_SOP_CHANNELS.join(", ")}.` },
      { status: 400 }
    );
  }

  // Alleen AUTOMATISCHE runs zijn dekkingsgebonden. sops_enabled is de licentievlag voor
  // automatische SOP's (zie de kop van lib/tenancy/sop-dekking.ts); handmatig triggeren is testen en
  // hoort altijd te kunnen. Vóór deze scheiding blokkeerde een dekkingskeuze -- "SOP's uitzetten voor
  // de accounts die niet meer passen" -- ook de knop in de UI, op 66 van de 74 accounts.

  // Toegang: het beurs-id zit in de body, dus de middleware kan de scope niet zien; dit is
  // het route-eigen slot dat samen met O1_AUTH_ENFORCED aangaat (zie vereisKlantToegangUitBody
  // in lib/auth/server.ts -- interne cron-aanroepen passeren op het CRON_SECRET).
  const toegang = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (toegang) return toegang;

  // Het uitgavenplafond, VOOR er ook maar een LLM-call de deur uit gaat: een run is
  // meerdere calls, en de duurste plek om een plafond te ontdekken is halverwege. Geteld
  // per bureau (zie leesMaandverbruik); zonder ingesteld plafond blokkeert dit nooit.
  const plafond = await controleerPlafond(supabase, schatSopRunKosten("biweekly"), new Date(), (await klantVanId(supabase, clientId))?.agencyId ?? null);
  if (plafond.blokkeert) return Response.json({ error: plafond.tekst }, { status: 429 });
  if (plafond.toestand === "bijna") logger.warn(`[plafond] ${plafond.tekst}`);

  if (automatisch && !(await magSopDraaien(supabase, clientId))) {
    return Response.json({ error: "Automatische SOP's staan uit voor dit account (dekking). Handmatig triggeren kan wel." }, { status: 403 });
  }

  try {
    if (channel === "meta_ads") {
      return await runMetaBiWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    if (channel === "linkedin_ads") {
      return await runLinkedinBiWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    if (channel === "microsoft_ads") {
      return await runMicrosoftBiWeeklyAnalysis(supabase, apiKey, clientId, jobId);
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

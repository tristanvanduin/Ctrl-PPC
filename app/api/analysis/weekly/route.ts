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
import { computeMetaReliability, computeLinkedinReliability, computeMicrosoftReliability } from "@/lib/analysis/channel-reliability";
import { fetchMicrosoftDaily, fetchMicrosoftNameMap } from "@/lib/microsoft/analysis-data";
import { checkDataFreshness } from "@/lib/sync/freshness";
import { extractStructuredData } from "@/lib/analysis/extract-structured";
import { today, addDays } from "@/lib/reporting-date";
import { buildMonthlyHandoff, buildOpenPointsBlock } from "@/lib/analysis/monthly-handoff";
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
import { buildGeheugenMetTaken, alsContextBlok } from "@/lib/analysis/geheugen-grounding";
import { ALLE_SOP_CHANNELS, type SopChannel } from "@/lib/analysis/sop-channel-config";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { controleerPlafond, schatSopRunKosten } from "@/lib/analysis/uitgavenplafond";
import { klantVanId } from "@/lib/tenancy/klanten";
import { logger } from "@/lib/logger";
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
    clientCtx, targetResult, campaignMetaResult, impressionShareResult,
  ] = await Promise.all([
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).gte("week_start", periodStart).order("week_start"),
    supabase.from("ads_search_terms_wasteful").select("*").eq("client_id", clientId).order("cost", { ascending: false }).limit(500),
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).gte("month", daysAgo(60)).order("month"),
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).gte("month", daysAgo(90)).order("month"),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId),
    // De "Budget vs. Vraag"-tak van stap 3 vraagt om campagnes die minder dan de helft van hun
    // dagbudget opmaken. De prompt noemde dat dagbudget al ("campaign metadata (budget/dag)"),
    // maar de route stuurde het nooit mee: er was dus geen enkele manier om die vraag te
    // beantwoorden zonder te gokken. ads_campaign_metadata draagt budget_amount en budget_type
    // en wordt door de bestaande sync gevuld.
    supabase.from("ads_campaign_metadata").select("campaign_name, campaign_type, budget_amount, budget_type, bidding_strategy, serving_status").eq("client_id", clientId),
    // Impressieaandeel verloren aan budget: het DIRECTE bewijs voor de "Budget vs. Vraag"-vraag uit
    // stap 3. Zonder deze kolom moest het model budgetkrapte afleiden uit spend versus dagbudget --
    // een omweg die niet onderscheidt tussen "budget op" en "te weinig vraag". search_budget_lost_is
    // zegt het rechtstreeks. De tabel bestond al en wordt door de sync gevuld; de weekly bevroeg hem
    // alleen niet (de maand-SOP en de second opinion doen dat wel).
    supabase.from("ads_campaign_impression_share")
      .select("campaign_name, month, search_impression_share, search_budget_lost_is, search_rank_lost_is, daily_budget, budget_utilization")
      .eq("client_id", clientId).order("month", { ascending: false }).limit(60),
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

  // ── De lopende, halve week eruit ────────────────────────────────────────────
  //
  // scripts/migrations/037_rollups.sql groepeert de weekrijen met date_trunc('week', ...) en kent
  // geen volledigheidsfilter: de week die NU loopt krijgt dus gewoon een rij, met de dagen die er
  // tot nu toe zijn. Stap 1 zegt "Vergelijk week-over-week op alle KPI's. Rapporteer alleen bij
  // >20% afwijking" -- en een halve week tegen een hele week is op elke volumemetriek een daling
  // van tientallen procenten. Dat vlagde dus elke run, bij elk account, zonder dat er iets aan de
  // hand was. Erger nog: de prompt biedt "Budgetdaling" als verklaring aan ("spend >25% gedaald EN
  // conversies ook gedaald"), dus het waarschijnlijke antwoord was een zelfverzekerd verkeerd
  // antwoord in plaats van een zichtbare fout.
  //
  // Een week is compleet zodra hij helemaal voorbij is: week_start + 7 dagen <= vandaag. De
  // lopende week gaat niet verloren -- hij gaat als apart, expliciet gelabeld blok mee, zodat het
  // vroege signaal blijft bestaan zonder in de WoW-vergelijking mee te tellen. Dat is precies het
  // onderscheid dat de weekly nodig heeft: signaleren mag op halve data, vergelijken niet.
  const vandaagISO = today();
  const weekIsCompleet = (rij: Record<string, unknown>): boolean =>
    addDays(String(rij.week_start ?? ""), 7) <= vandaagISO;
  const volledigeWeken = weeklyData.filter(weekIsCompleet);
  const lopendeWeek = weeklyData.filter((r) => !weekIsCompleet(r as Record<string, unknown>));
  // Valt er door het filter niets over (een gloednieuw account met alleen deze week), dan is een
  // WoW-vergelijking sowieso niet te maken; dan is de halve week beter dan niets, mits gelabeld.
  // De KOP verandert dan mee: de terugval-tabel onder de kop "alleen AFGESLOTEN weken" zetten
  // zou het model precies de zekerheid geven die de data niet draagt -- het zelfverzekerd
  // verkeerde antwoord waarvoor dit filter juist is gebouwd.
  const weekTabel = volledigeWeken.length > 0 ? volledigeWeken : weeklyData;
  const weekTabelKop = volledigeWeken.length > 0
    ? "## Account Performance (wekelijks, alleen AFGESLOTEN weken -- dit is de basis voor de WoW-vergelijking)"
    : "## Account Performance (wekelijks; LET OP: er is nog GEEN enkele afgesloten week -- deze cijfers dekken alleen de lopende, onvolledige week. Maak geen week-over-week-vergelijking; benoem hooguit acute signalen, met dit voorbehoud erbij)";
  const lopendeWeekBlok = lopendeWeek.length > 0 && volledigeWeken.length > 0
    ? `\n\n## Lopende week (NOG NIET COMPLEET -- niet gebruiken voor de week-over-week-vergelijking)\nDeze week is nog bezig; de cijfers dekken alleen de dagen tot nu toe. Gebruik hem hooguit om een acuut signaal te noemen, nooit als vergelijkingsbasis.\n\`\`\`\n${toPromptTable(lopendeWeek)}\n\`\`\``
    : "";

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
    channel: "google_ads",
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
  // E1-wiring voor weekly/bi-weekly: het klantgeheugen zat alleen in de monthly, terwijl juist de
  // vaakst draaiende cadans er baat bij heeft -- een weekly die niet weet wat er eerder over deze
  // klant is vastgelegd, begint 52 keer per jaar blanco. Kanaalneutraal: client_memory gaat over de
  // klant, niet over een advertentieplatform, dus alle drie de kanalen krijgen hetzelfde.
  //
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS, en dat is voor de weekly het zwaarste
  // deel: het openstaande-punten-blok hieronder toont wat er nog open staat, maar niet wat er
  // AFGEROND is. Zonder dat laatste beveelt een weekly een uitgevoerde taak 52 keer per jaar
  // opnieuw aan. Twaalf taken, begrensd tot dit kanaal; wat er buiten valt wordt gemeld en niet
  // stil weggelaten.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "weekly", cadans: "weekly",
  }));
  // ── De weekly was een eiland ────────────────────────────────────────────────
  //
  // Hij las geen enkele eerdere SOP-output: niet de maandanalyse, en ook niet zijn eigen vorige run.
  // Van de drie cadansen stond de vaakst draaiende (52x per jaar per kanaal) dus volledig los, wat
  // twee dingen kostte. Hij kon niet zien of een acuut signaal botst met de maanddiagnose, en hij
  // kon dezelfde bleeder drie weken achter elkaar als nieuw melden -- terwijl "voor de derde week"
  // precies het verschil is tussen een incident en een patroon.
  //
  // Bewust KLEIN gehouden. De weekly is expliciet "geen diepe analyse": hij krijgt de hoofdlijn van
  // de maand in een paar regels (niet de onderbouwing, niet de succescriteria) en zijn eigen nog
  // openstaande punten. Meer zou hem de maandanalyse laten overdoen.
  const [maandSecties, eigenOpen] = await Promise.all([
    supabase.from("sop_analysis_output").select("output, analysis_date, section")
      .eq("client_id", clientId).eq("sop_type", "monthly")
      .in("section", ["structured_monthly_v2", "full"])
      .order("analysis_date", { ascending: false }).limit(6),
    // sop_recommendations draagt sop_type, dus dit blijft binnen dit kanaal EN deze cadans. Dat
    // gold ooit niet voor sop_tasks; sinds migratie 104 draagt die de kolom ook, en het
    // geheugenblok hierboven gebruikt hem om de taken tot dit kanaal te begrenzen.
    supabase.from("sop_recommendations").select("hypothesis, expected_result, measurement_metric, timeframe, analysis_date, status")
      .eq("client_id", clientId).eq("sop_type", "weekly")
      .order("analysis_date", { ascending: false }).limit(25),
  ]);
  const maandRijen = (maandSecties.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const maandStructured = maandRijen.find((r) => r.section === "structured_monthly_v2");
  const maandNarratief = maandRijen.find((r) => r.section === "full");
  const maandHandoff = buildMonthlyHandoff({
    structured: maandStructured?.output ?? null,
    narratief: maandNarratief?.output ?? null,
    analysisDate: (maandStructured ?? maandNarratief)?.analysis_date ?? null,
    cadans: "weekly",
  });
  const ketenContext = `\n\n${maandHandoff.tekst}${buildOpenPointsBlock((eigenOpen.data ?? []) as Parameters<typeof buildOpenPointsBlock>[0])}`;

  const sharedContext = `${ketenContext}${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

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

${weekTabelKop}
\`\`\`
${toPromptTable(weekTabel)}
\`\`\`${lopendeWeekBlok}`,
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

## Campaign Performance (MAANDELIJKSE korrel, laatste 2 maanden -- er bestaat geen wekelijkse campagnereeks)
\`\`\`
${toPromptTable(campaignResult.data ?? [])}
\`\`\`

## Campagne-instellingen (dagbudget en biedstrategie -- voor de Budget vs. Vraag-analyse)
\`\`\`
${toPromptTable(campaignMetaResult.data ?? [])}
\`\`\`

## Impressieaandeel (search_budget_lost_is = aandeel gemist DOOR budget, search_rank_lost_is = gemist door positie)
\`\`\`
${toPromptTable(impressionShareResult.data ?? [])}
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
    campaignNames, adsetNames, adsetMetaResult, adNames,
    clientCtx, targetResult, reliabilityAccountResult, lagSettingsResult,
  ] = await Promise.all([
    fetchMetaDaily(supabase, clientId, "meta_account_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_adset_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_ad_daily", periodStart, periodEnd),
    fetchMetaDaily(supabase, clientId, "meta_campaign_daily", periodSpendStart, periodEnd),
    fetchNameMap(supabase, clientId, "meta_campaigns", "campaign_id", "name"),
    fetchNameMap(supabase, clientId, "meta_adsets", "adset_id", "name"),
    // Zelfde reden als bij Google hierboven: de "Budget vs. Vraag"-tak van stap 3 vraagt om
    // budgetbenutting, en zonder dagbudget is dat niet te beantwoorden. Bij Meta zit het budget op
    // AD SET-niveau (meta_adsets.daily_budget), niet op de campagne.
    supabase.from("meta_adsets").select("adset_id, name, campaign_id, daily_budget, optimization_goal, learning_stage_info").eq("client_id", clientId),
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

  // Dezelfde verrijkingslaag als het Google-pad. Hij werd hier nooit aangeroepen, waardoor Meta en
  // LinkedIn twee contextblokken kregen waar Google er acht kreeg.
  //
  // De laag is nu kanaalbewust (zie ALLEEN_GOOGLE in lib/analysis/enrichment.ts): de zes lagen die
  // op ads_*-tabellen leunen worden voor dit kanaal overgeslagen én gemeld, in plaats van
  // Google-data als context van dit kanaal te presenteren. Wat overblijft is echt kanaalneutraal:
  // de strategische klantcontext en -- voor de bi-weekly -- de hypothese-tracking.
  //
  // De compositie hieronder is WOORDELIJK gelijk aan die van het Google-pad. Dat is opzet: de
  // Google-only velden komen hier als lege string terug, dus dezelfde regel levert vanzelf de
  // juiste, kortere context op. Eén vorm om te onderhouden in plaats van drie.
  const enrichment = await buildEnrichmentContext({
    supabase, clientId, accountType, sopType: "weekly", analysisDate: periodEnd, channel: "meta_ads",
  });
  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
  // E1-wiring voor weekly/bi-weekly: het klantgeheugen zat alleen in de monthly, terwijl juist de
  // vaakst draaiende cadans er baat bij heeft -- een weekly die niet weet wat er eerder over deze
  // klant is vastgelegd, begint 52 keer per jaar blanco. Kanaalneutraal: client_memory gaat over de
  // klant, niet over een advertentieplatform, dus alle drie de kanalen krijgen hetzelfde.
  //
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS, en dat is voor de weekly het zwaarste
  // deel: het openstaande-punten-blok hieronder toont wat er nog open staat, maar niet wat er
  // AFGEROND is. Zonder dat laatste beveelt een weekly een uitgevoerde taak 52 keer per jaar
  // opnieuw aan. Twaalf taken, begrensd tot dit kanaal; wat er buiten valt wordt gemeld en niet
  // stil weggelaten.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "meta_weekly", cadans: "weekly",
  }));
  // ── De weekly was een eiland ────────────────────────────────────────────────
  //
  // Hij las geen enkele eerdere SOP-output: niet de maandanalyse, en ook niet zijn eigen vorige run.
  // Van de drie cadansen stond de vaakst draaiende (52x per jaar per kanaal) dus volledig los, wat
  // twee dingen kostte. Hij kon niet zien of een acuut signaal botst met de maanddiagnose, en hij
  // kon dezelfde bleeder drie weken achter elkaar als nieuw melden -- terwijl "voor de derde week"
  // precies het verschil is tussen een incident en een patroon.
  //
  // Bewust KLEIN gehouden. De weekly is expliciet "geen diepe analyse": hij krijgt de hoofdlijn van
  // de maand in een paar regels (niet de onderbouwing, niet de succescriteria) en zijn eigen nog
  // openstaande punten. Meer zou hem de maandanalyse laten overdoen.
  const [maandSecties, eigenOpen] = await Promise.all([
    supabase.from("sop_analysis_output").select("output, analysis_date, section")
      .eq("client_id", clientId).eq("sop_type", "meta_monthly")
      .in("section", ["structured_monthly_v2", "full"])
      .order("analysis_date", { ascending: false }).limit(6),
    // sop_recommendations draagt sop_type, dus dit blijft binnen dit kanaal EN deze cadans. Dat
    // gold ooit niet voor sop_tasks; sinds migratie 104 draagt die de kolom ook, en het
    // geheugenblok hierboven gebruikt hem om de taken tot dit kanaal te begrenzen.
    supabase.from("sop_recommendations").select("hypothesis, expected_result, measurement_metric, timeframe, analysis_date, status")
      .eq("client_id", clientId).eq("sop_type", "meta_weekly")
      .order("analysis_date", { ascending: false }).limit(25),
  ]);
  const maandRijen = (maandSecties.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const maandStructured = maandRijen.find((r) => r.section === "structured_monthly_v2");
  const maandNarratief = maandRijen.find((r) => r.section === "full");
  const maandHandoff = buildMonthlyHandoff({
    structured: maandStructured?.output ?? null,
    narratief: maandNarratief?.output ?? null,
    analysisDate: (maandStructured ?? maandNarratief)?.analysis_date ?? null,
    cadans: "weekly",
  });
  const ketenContext = `\n\n${maandHandoff.tekst}${buildOpenPointsBlock((eigenOpen.data ?? []) as Parameters<typeof buildOpenPointsBlock>[0])}`;

  const sharedContext = `${ketenContext}${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

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

## Ad set-instellingen (dagbudget, optimalisatiedoel, learning-status -- voor de Budget vs. Vraag-analyse)
\`\`\`
${toPromptTable(adsetMetaResult.data ?? [])}
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
    campaignNames, creativeFormats, campaignMetaResult,
    clientCtx, targetResult, reliabilityAccountRows, lagSettingsResult,
  ] = await Promise.all([
    fetchLinkedinDaily("linkedin_account_daily", periodStart),
    fetchLinkedinDaily("linkedin_campaign_daily", periodBleederStart),
    fetchLinkedinDaily("linkedin_creative_daily", periodBleederStart),
    fetchLinkedinDaily("linkedin_campaign_daily", periodSpendStart),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_campaigns", "campaign_urn", "name"),
    fetchLinkedinNameMap(supabase, clientId, "linkedin_creatives", "creative_urn", "format"),
    // Zelfde reden als bij Google en Meta: de "Budget vs. Vraag"-tak van stap 3 vraagt om
    // budgetbenutting. Bij LinkedIn zit het dagbudget op de campagne, samen met het biedregime --
    // en dat laatste is bij een B2B-auctie vaak de eigenlijke verklaring van onderbesteding.
    supabase.from("linkedin_campaigns").select("campaign_urn, name, daily_budget, unit_cost, bid_strategy, cost_type").eq("client_id", clientId),
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

  // Dezelfde verrijkingslaag als het Google-pad. Hij werd hier nooit aangeroepen, waardoor Meta en
  // LinkedIn twee contextblokken kregen waar Google er acht kreeg.
  //
  // De laag is nu kanaalbewust (zie ALLEEN_GOOGLE in lib/analysis/enrichment.ts): de zes lagen die
  // op ads_*-tabellen leunen worden voor dit kanaal overgeslagen én gemeld, in plaats van
  // Google-data als context van dit kanaal te presenteren. Wat overblijft is echt kanaalneutraal:
  // de strategische klantcontext en -- voor de bi-weekly -- de hypothese-tracking.
  //
  // De compositie hieronder is WOORDELIJK gelijk aan die van het Google-pad. Dat is opzet: de
  // Google-only velden komen hier als lege string terug, dus dezelfde regel levert vanzelf de
  // juiste, kortere context op. Eén vorm om te onderhouden in plaats van drie.
  const enrichment = await buildEnrichmentContext({
    supabase, clientId, accountType, sopType: "weekly", analysisDate: periodEnd, channel: "linkedin_ads",
  });
  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
  // E1-wiring voor weekly/bi-weekly: het klantgeheugen zat alleen in de monthly, terwijl juist de
  // vaakst draaiende cadans er baat bij heeft -- een weekly die niet weet wat er eerder over deze
  // klant is vastgelegd, begint 52 keer per jaar blanco. Kanaalneutraal: client_memory gaat over de
  // klant, niet over een advertentieplatform, dus alle drie de kanalen krijgen hetzelfde.
  //
  // Sinds migratie 104 draagt dit blok ook de TAAKSTATUS, en dat is voor de weekly het zwaarste
  // deel: het openstaande-punten-blok hieronder toont wat er nog open staat, maar niet wat er
  // AFGEROND is. Zonder dat laatste beveelt een weekly een uitgevoerde taak 52 keer per jaar
  // opnieuw aan. Twaalf taken, begrensd tot dit kanaal; wat er buiten valt wordt gemeld en niet
  // stil weggelaten.
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "linkedin_weekly", cadans: "weekly",
  }));
  // ── De weekly was een eiland ────────────────────────────────────────────────
  //
  // Hij las geen enkele eerdere SOP-output: niet de maandanalyse, en ook niet zijn eigen vorige run.
  // Van de drie cadansen stond de vaakst draaiende (52x per jaar per kanaal) dus volledig los, wat
  // twee dingen kostte. Hij kon niet zien of een acuut signaal botst met de maanddiagnose, en hij
  // kon dezelfde bleeder drie weken achter elkaar als nieuw melden -- terwijl "voor de derde week"
  // precies het verschil is tussen een incident en een patroon.
  //
  // Bewust KLEIN gehouden. De weekly is expliciet "geen diepe analyse": hij krijgt de hoofdlijn van
  // de maand in een paar regels (niet de onderbouwing, niet de succescriteria) en zijn eigen nog
  // openstaande punten. Meer zou hem de maandanalyse laten overdoen.
  const [maandSecties, eigenOpen] = await Promise.all([
    supabase.from("sop_analysis_output").select("output, analysis_date, section")
      .eq("client_id", clientId).eq("sop_type", "linkedin_monthly")
      .in("section", ["structured_monthly_v2", "full"])
      .order("analysis_date", { ascending: false }).limit(6),
    // sop_recommendations draagt sop_type, dus dit blijft binnen dit kanaal EN deze cadans. Dat
    // gold ooit niet voor sop_tasks; sinds migratie 104 draagt die de kolom ook, en het
    // geheugenblok hierboven gebruikt hem om de taken tot dit kanaal te begrenzen.
    supabase.from("sop_recommendations").select("hypothesis, expected_result, measurement_metric, timeframe, analysis_date, status")
      .eq("client_id", clientId).eq("sop_type", "linkedin_weekly")
      .order("analysis_date", { ascending: false }).limit(25),
  ]);
  const maandRijen = (maandSecties.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const maandStructured = maandRijen.find((r) => r.section === "structured_monthly_v2");
  const maandNarratief = maandRijen.find((r) => r.section === "full");
  const maandHandoff = buildMonthlyHandoff({
    structured: maandStructured?.output ?? null,
    narratief: maandNarratief?.output ?? null,
    analysisDate: (maandStructured ?? maandNarratief)?.analysis_date ?? null,
    cadans: "weekly",
  });
  const ketenContext = `\n\n${maandHandoff.tekst}${buildOpenPointsBlock((eigenOpen.data ?? []) as Parameters<typeof buildOpenPointsBlock>[0])}`;

  const sharedContext = `${ketenContext}${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

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

## Campagne-instellingen (dagbudget, biedstrategie, eenheidsprijs -- voor de Budget vs. Vraag-analyse)
\`\`\`
${toPromptTable(campaignMetaResult.data ?? [])}
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

// Microsoft-daily's dragen entity_id net als Meta -- zelfde naamverrijking, ander kanaal.
// Alias en geen eigen kopie (de bi-weekly-route doet hetzelfde): twee identieke lokale
// helpers groeien uit elkaar, de median/safeDiv-les die de hygienepoort bewaakt.
const withMicrosoftNames = withMetaNames;

// Microsoft route-wiring (Bing): de wekelijkse health check als search-variant. Zelfde
// drie-stappenvorm als de andere kanalen, met twee kanaaleigen accenten: de VOLUMEREM in stap 2
// (op een tiende van Google-volumes is 0 conversies bij weinig spend "te vroeg", geen bleeder --
// zie MICROSOFT_WEEKLY in lib/prompts/weekly-channel-content.ts) en het Audience Network als
// aparte bleeder-soort. LIVE-ONGETEST: pas met een echt Microsoft-account te verifieren.
async function runMicrosoftWeeklyAnalysis(supabase: SupabaseClient, apiKey: string, clientId: string, jobId: string): Promise<Response> {
  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "weekly_sop",
    initialMessage: "Wekelijkse Microsoft Ads-analyse wordt voorbereid...",
    metadata: { sop_type: "microsoft_weekly" },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_data",
    message: "Wekelijkse Microsoft-data ophalen...",
  });

  const periodStart = daysAgo(14);
  const periodBleederStart = daysAgo(7);
  const periodSpendStart = daysAgo(60);
  const periodEnd = fmt(new Date());

  const periodReliabilityStart = daysAgo(90);

  const [
    accountResult, adgroupResult, campaignResult, breakdownResult,
    campaignNames, adgroupNames, keywordResult, impressionShareResult, campaignMetaResult,
    clientCtx, targetResult, reliabilityAccountResult, lagSettingsResult,
  ] = await Promise.all([
    fetchMicrosoftDaily(supabase, clientId, "microsoft_account_daily", periodStart, periodEnd),
    fetchMicrosoftDaily(supabase, clientId, "microsoft_adgroup_daily", periodStart, periodEnd),
    fetchMicrosoftDaily(supabase, clientId, "microsoft_campaign_daily", periodSpendStart, periodEnd),
    // De netwerksplitsing (search/syndicated/audience) voor de lek-check in stap 2.
    fetchMicrosoftDaily(supabase, clientId, "microsoft_breakdown_daily", periodStart, periodEnd),
    fetchMicrosoftNameMap(supabase, clientId, "microsoft_campaigns", "campaign_id"),
    fetchMicrosoftNameMap(supabase, clientId, "microsoft_adgroups", "adgroup_id"),
    // Keywords zijn maandkorrel (hoge kardinaliteit); de bleeder-stap krijgt de recentste twee
    // maanden, zodat er ook begin-van-de-maand iets te beoordelen valt.
    supabase.from("microsoft_keyword_monthly").select("keyword_text, match_type, campaign_name, ad_group_name, month, impressions, clicks, cost, conversions, quality_score").eq("client_id", clientId).gte("month", daysAgo(62)).order("cost", { ascending: false }).limit(100),
    // Impressieaandeel: het directe bewijs voor de "Budget vs. Vraag"-vraag in stap 3, met
    // budget- en positieverlies apart -- die vragen tegengestelde ingrepen.
    supabase.from("microsoft_campaign_impression_share")
      .select("campaign_name, month, impression_share, budget_lost_is, rank_lost_is, daily_budget, budget_utilization")
      .eq("client_id", clientId).order("month", { ascending: false }).limit(60),
    // Campagne-instellingen mét import_source: een spend-anomalie na een verversde import is een
    // eigen wortelooorzaak (zie MICROSOFT_WEEKLY.spendAnomalyRootCauses).
    supabase.from("microsoft_campaigns").select("campaign_id, name, campaign_type, daily_budget, bid_strategy, import_source, serving_status").eq("client_id", clientId),
    fetchClientContext(supabase, clientId),
    computeAnalysisTargets(supabase, clientId, "microsoft"),
    fetchMicrosoftDaily(supabase, clientId, "microsoft_account_daily", periodReliabilityStart, periodEnd),
    supabase.from("client_settings").select("conversion_lag_days").eq("client_id", clientId).maybeSingle(),
  ]);

  const { goalsSection, accountType } = clientCtx;

  if (accountResult.length === 0) {
    const freshness = await checkDataFreshness(supabase, clientId, ["microsoft_account_daily"]);
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

  // Zelfde betrouwbaarheidscheck als de andere kanalen, genormaliseerd naar de
  // Microsoft-kolomnamen (clicks/spend/conversions) via computeMicrosoftReliability().
  const microsoftReliability = computeMicrosoftReliability({
    accountDaily: reliabilityAccountResult,
    campaignDaily: campaignResult,
    conversionLagDays: (lagSettingsResult.data?.conversion_lag_days as number) ?? 3,
    lastCompleteMonth: amsterdamseMaand() === 1 ? 12 : amsterdamseMaand() - 1,
    hasKpiTargets: !!goalsSection,
  });
  const reliabilityText = `\n\n${microsoftReliability.promptContext}`;

  const adgroupRows = withMicrosoftNames(adgroupResult.filter((r) => new Date(String(r.date)) >= new Date(periodBleederStart)), adgroupNames);
  const campaignRows = withMicrosoftNames(campaignResult, campaignNames);
  // De netwerk-week: alleen de laatste 7 dagen en alleen de network-dimensie, geaggregeerd per
  // netwerk zodat de lek-check een tabel van drie regels krijgt in plaats van honderd dagrijen.
  const netwerkWeek = (() => {
    // level="account": zonder dit filter telt de som dubbel zodra een sync ook campagne-level
    // breakdowns schrijft (de unieke sleutel van de tabel draagt een level-kolom).
    const rows = breakdownResult.filter((r) => String(r.level) === "account" && String(r.breakdown_type) === "network" && new Date(String(r.date)) >= new Date(periodBleederStart));
    const per = new Map<string, { spend: number; conversions: number; clicks: number }>();
    for (const r of rows) {
      const k = String(r.breakdown_value);
      const v = per.get(k) ?? { spend: 0, conversions: 0, clicks: 0 };
      v.spend += Number(r.spend ?? 0); v.conversions += Number(r.conversions ?? 0); v.clicks += Number(r.clicks ?? 0);
      per.set(k, v);
    }
    return [...per.entries()].map(([network, v]) => ({ network, spend: Math.round(v.spend * 100) / 100, conversions: Math.round(v.conversions * 100) / 100, clicks: v.clicks }));
  })();

  const enrichment = await buildEnrichmentContext({
    supabase, clientId, accountType, sopType: "weekly", analysisDate: periodEnd, channel: "microsoft_ads",
  });
  const dimAvailText = enrichment.dimensionAvailability ? `\n\n${enrichment.dimensionAvailability}` : "";
  const geheugenMetTaken = alsContextBlok(await buildGeheugenMetTaken({
    supabase, clientId, voorDatum: periodEnd, sopType: "microsoft_weekly", cadans: "weekly",
  }));
  const [maandSecties, eigenOpen] = await Promise.all([
    supabase.from("sop_analysis_output").select("output, analysis_date, section")
      .eq("client_id", clientId).eq("sop_type", "microsoft_monthly")
      .in("section", ["structured_monthly_v2", "full"])
      .order("analysis_date", { ascending: false }).limit(6),
    supabase.from("sop_recommendations").select("hypothesis, expected_result, measurement_metric, timeframe, analysis_date, status")
      .eq("client_id", clientId).eq("sop_type", "microsoft_weekly")
      .order("analysis_date", { ascending: false }).limit(25),
  ]);
  const maandRijen = (maandSecties.data ?? []) as Array<{ output?: string; analysis_date?: string; section?: string }>;
  const maandStructured = maandRijen.find((r) => r.section === "structured_monthly_v2");
  const maandNarratief = maandRijen.find((r) => r.section === "full");
  const maandHandoff = buildMonthlyHandoff({
    structured: maandStructured?.output ?? null,
    narratief: maandNarratief?.output ?? null,
    analysisDate: (maandStructured ?? maandNarratief)?.analysis_date ?? null,
    cadans: "weekly",
  });
  const ketenContext = `\n\n${maandHandoff.tekst}${buildOpenPointsBlock((eigenOpen.data ?? []) as Parameters<typeof buildOpenPointsBlock>[0])}`;

  const sharedContext = `${ketenContext}${geheugenMetTaken}${enrichment.strategicContext}${targetText}${dimAvailText}${reliabilityText}${enrichment.leadingIndicators}${enrichment.sectorBenchmarks}${enrichment.changeHistory}${enrichment.geoContext}`;

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_1", message: "Stap 1: Account Health Check (Microsoft)..." });
  const step1 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_weekly", periodStart, periodEnd,
    stepNumber: 1, stepName: "Account Health Check",
    runKey: jobId,
    systemPrompt: buildWeeklyStep1Prompt(goalsSection, accountType, "microsoft_ads"),
    userMessage: `Voer stap 1 (Account Health Check & Tracking Verificatie) uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Account Performance (dagelijks, laatste 14 dagen -- gebruik voor WoW-vergelijking; noem bij elk percentage het absolute aantal)
\`\`\`
${toPromptTable(accountResult)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_2", message: "Stap 2: keyword- en zoektermbleeders (Microsoft)..." });
  const step2 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_weekly", periodStart, periodEnd,
    stepNumber: 2, stepName: "Keyword en Zoekterm Bleeders",
    runKey: jobId,
    systemPrompt: buildWeeklyStep2Prompt(goalsSection, accountType, "microsoft_ads"),
    userMessage: `Voer stap 2 uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Ad Group Performance (laatste 7 dagen, voor bleeders -- let op de volumerem: onder €25 spend is 0 conversies "te vroeg", geen bleeder)
\`\`\`
${toPromptTable(adgroupRows)}
\`\`\`

## Keyword Performance (maandkorrel, recentste maanden, top op cost -- met match type en quality score)
\`\`\`
${toPromptTable(keywordResult.data ?? [])}
\`\`\`

## Netwerkverdeling deze week (search / syndicated / audience -- voor de Audience Network-lekcheck)
\`\`\`
${toPromptTable(netwerkWeek)}
\`\`\``,
  });

  await updateProgressPhase(supabase, { jobId, phaseKey: "run_step_3", message: "Stap 3: budget & spend anomalieën, weekoverzicht (Microsoft)..." });
  const step3 = await runStep({
    supabase, apiKey, clientId, sopType: "microsoft_weekly", periodStart, periodEnd,
    stepNumber: 3, stepName: "Budget Spend Anomalies",
    layer: "narrative", runKey: jobId,
    systemPrompt: buildWeeklyStep3Prompt(goalsSection, accountType, "microsoft_ads"),
    userMessage: `Voer stap 3 (Budget & Spend Anomalies) en het afsluitende Weekoverzicht uit voor client "${clientId}" (Microsoft Ads).
Periode: ${periodStart} t/m ${periodEnd}.${sharedContext}

## Conclusie stap 1 (Account Health Check)
${step1.output}

## Conclusie stap 2 (Keyword en Zoekterm Bleeders)
${step2.output}

## Campaign Performance (laatste 60 dagen, voor spend-anomalie WoW-check)
\`\`\`
${toPromptTable(campaignRows)}
\`\`\`

## Campagne-instellingen (dagbudget, biedstrategie, import_source -- voor de Budget vs. Vraag-analyse en de import-wortelooorzaak)
\`\`\`
${toPromptTable(campaignMetaResult.data ?? [])}
\`\`\`

## Impressieaandeel (budget_lost_is = aandeel gemist DOOR budget, rank_lost_is = gemist door positie)
\`\`\`
${toPromptTable(impressionShareResult.data ?? [])}
\`\`\`

Focus alleen op anomalies en bleeders die directe actie vereisen.`,
  });

  const result: AnalysisResult = {
    clientId, sopType: "microsoft_weekly", analysisDate: today(), periodStart, periodEnd,
    model: step3.model,
    tokensUsed: step1.tokensUsed + step2.tokensUsed + step3.tokensUsed,
    output: sanitizeOutput(`## Stap 1: Account Health Check & Tracking Verificatie

${step1.output}

---

## Stap 2: Keyword en Zoekterm Bleeders

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
    supabase, apiKey, clientId, sopType: "microsoft_weekly",
    analysisDate: result.analysisDate, periodStart, periodEnd,
    analysisOutput: result.output,
    findingsSystemPrompt: WEEKLY_FINDINGS_SYSTEM,
    recsSystemPrompt: WEEKLY_RECS_SYSTEM,
    stepOffset: 3,
    analysisId: null,
    reliability: microsoftReliability,
    onPhase: async (phaseKey, message) => { await updateProgressPhase(supabase, { jobId, phaseKey, message }); },
  });

  await markProgressCompleted(supabase, {
    jobId,
    message: "Wekelijkse Microsoft SOP-analyse gereed.",
    metadata: {
      analysis_date: result.analysisDate, sop_type: "microsoft_weekly",
      findings: extraction.findings.length, recommendations: extraction.recommendations.length, tasks: extraction.tasks.length,
    },
  });

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
  const plafond = await controleerPlafond(supabase, schatSopRunKosten("weekly"), new Date(), (await klantVanId(supabase, clientId))?.agencyId ?? null);
  if (plafond.blokkeert) return Response.json({ error: plafond.tekst }, { status: 429 });
  if (plafond.toestand === "bijna") logger.warn(`[plafond] ${plafond.tekst}`);

  if (automatisch && !(await magSopDraaien(supabase, clientId))) {
    return Response.json({ error: "Automatische SOP's staan uit voor dit account (dekking). Handmatig triggeren kan wel." }, { status: 403 });
  }

  try {
    if (channel === "meta_ads") {
      return await runMetaWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    if (channel === "linkedin_ads") {
      return await runLinkedinWeeklyAnalysis(supabase, apiKey, clientId, jobId);
    }
    if (channel === "microsoft_ads") {
      return await runMicrosoftWeeklyAnalysis(supabase, apiKey, clientId, jobId);
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

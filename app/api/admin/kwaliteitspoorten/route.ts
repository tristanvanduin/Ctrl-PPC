// De consument van de negen kwaliteitspoorten. Voedt de vier die vandaag al op echte data
// kunnen draaien (zie de kop van lib/decision/quality-gates.ts); de andere vijf krijgen eerlijk
// geen invoer mee en komen dus als "warn: input ontbreekt" terug -- dat IS shadow mode, geen
// gebrek eraan.
//
// Diagnostisch en read-only: er wordt niets geschreven, geen legacy-route aangeraakt, geen
// LLM-aanroep. Raakt de 13-staps audit op geen enkele manier -- hij leest alleen dezelfde
// tabellen die de audit ook al vult.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { klantVanId } from "@/lib/tenancy/klanten";
import { runGates, type GateInput } from "@/lib/decision/quality-gates";
import type { KeywordQsRow } from "@/lib/analysis/metric-cross-checks";
import type { Finding } from "@/lib/schema/analysis-schema";

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

  const [{ data: accountMonthly }, { data: campaignMonthly }, { data: impressionShare }, { data: keywords }, { data: settings }, { data: insights }] =
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
    ]);

  const accountRijen = (accountMonthly ?? []).slice().reverse(); // oud → nieuw voor de KPI-chain
  const laatsteMaand = impressionShare?.[0]?.month as string | undefined;
  const isRijenLaatsteMaand = (impressionShare ?? []).filter((r) => r.month === laatsteMaand);
  const gemiddeldRankLostIs = isRijenLaatsteMaand.length > 0
    ? isRijenLaatsteMaand.reduce((som, r) => som + Number(r.search_rank_lost_is ?? 0), 0) / isRijenLaatsteMaand.length
    : 0;
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

    // contradiction, stepPurity, coverage, actionGating, monthlyAcceptance: bewust ongezet. Hun
    // invoer bestaat vandaag niet buiten een levende 13-staps-run -- zie de kop van
    // quality-gates.ts voor de meting per poort.
  };

  const resultaten = runGates(gateInput);
  return Response.json({
    clientId, agencyId: gateInput.agencyId, analysisDate: gateInput.analysisDate,
    gevoedeInvoer: {
      dataQuality: Boolean(gateInput.dataQuality),
      rankLoss: Boolean(gateInput.rankLoss),
      claimCheck: Boolean(gateInput.claimCheck),
      kpiChain: Boolean(gateInput.kpiChain),
    },
    resultaten,
  });
}

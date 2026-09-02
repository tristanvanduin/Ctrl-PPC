// =====================================================================
// LinkedIn-signalen: de deterministische signaal-detectors (lib/signals/linkedin-signals)
// bedraad. Geen LLM. Campagne-dagdata over twee 28-dagen-vensters voedt de form-drop-off-,
// CPL-druk-, engagement- en video-detecties; de getriggerde verhalen landen als voorstel in
// de goedkeuringswachtrij (SI8) en de sectie wordt opgeslagen voor UI en analyse-context.
//
// Herbouwd 1 september 2026 na de sloop-audit:
// - De budget-concentratie telt conversies via de centrale kanaalselectie
//   (channel-conversion-config: leads + website-conversies) in plaats van alleen
//   one_click_leads — een campagne met website-objectief las anders als "converteert
//   niet" en kreeg een vals waste-verhaal met certainty bewezen_binnen_platform.
// - Concentratie over het RECENTE 28-dagen-venster in plaats van de volle 70 dagen.
// - UNKNOWN-pivotwaarden (privacy-onderdrukt restsegment) tellen niet meer mee als
//   waste-segment; drift en velocity ankeren op de laatste datadatum.
// - Gepagineerde, foutgecontroleerde datalaag; analysis:run-slot; demo-bewuste POST.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { buildLinkedInSignals } from "@/lib/signals/linkedin-signals";
import { buildLinkedInDemographicSignals, type LinkedInDemographicRow } from "@/lib/signals/linkedin-demographic";
import { buildBudgetConcentrationSignals, type BudgetEntityRow } from "@/lib/signals/budget-concentration";
import { buildDemographicDriftSignals, type DemographicDriftRow } from "@/lib/signals/demographic-drift";
import { buildSpendVelocitySignals, type SpendDailyRow } from "@/lib/signals/spend-velocity";
import { buildWeekdayEfficiencySignals, type WeekdayRow } from "@/lib/signals/weekday-efficiency";
import { buildTrackingGapSignals, type TrackingGapRow } from "@/lib/signals/tracking-gap";
import { renderSignalSection } from "@/lib/signals/render-section";
import { shapeLinkedInInputs, splitWindows, type LinkedInDailyRow } from "@/lib/analysis/channel-signal-data";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { mergeDetections } from "@/lib/signals/types";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { eis, alleRijen, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";
import { resolveChannelConversionConfig, sumSelectedConversions } from "@/lib/analysis/channel-conversion-config";

// LinkedIn-pivot → leesbare demografische dimensie voor de segment-efficiëntie-detector.
const PIVOT_TO_DIM: Record<string, string> = {
  MEMBER_JOB_FUNCTION: "functie",
  MEMBER_SENIORITY: "seniority",
  MEMBER_INDUSTRY: "industrie",
  MEMBER_COMPANY_SIZE: "bedrijfsgrootte",
  COMPANY_SIZE: "bedrijfsgrootte",
};

const SECTION = "linkedin_signals_v1";
const SOP_TYPE = "linkedin_signals";
const FETCH_DAYS = 70;

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest. Zonder dit gaf deze route in
  // demo-modus een 500 en bleef het bijbehorende tabblad leeg.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date, period_start, period_end")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

export async function POST(request: NextRequest) {
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust, net als de GET.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
  const since = addDays(today(), -FETCH_DAYS);
  const [dailyFetch, namesRes, demoFetch, labelRes, accountRes, configRes] = await Promise.all([
    alleRijen<LinkedInDailyRow & { external_website_conversions?: number | null; post_click_conversions?: number | null }>(
      (van, tot) => supabase
        .from("linkedin_campaign_daily")
        .select("entity_urn, date, impressions, clicks, spend, one_click_leads, one_click_lead_form_opens, external_website_conversions, post_click_conversions, video_completions, video_starts")
        .eq("client_id", clientId)
        .gte("date", since)
        .order("date", { ascending: false })
        .order("entity_urn", { ascending: true })
        .range(van, tot),
      "linkedin_campaign_daily"
    ),
    supabase.from("linkedin_campaigns").select("campaign_urn, name").eq("client_id", clientId).limit(2000),
    alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("linkedin_demographic_daily")
        .select("pivot_type, pivot_value_urn, date, spend, leads")
        .eq("client_id", clientId)
        // CAMPAIGN-level pin: de sync schrijft demografie alleen daar (lib/linkedin/sync.ts); een
        // toekomstige ACCOUNT-level rij zou anders dubbel tellen.
        .eq("level", "CAMPAIGN")
        .gte("date", since)
        .order("date", { ascending: false })
        .order("pivot_type", { ascending: true })
        .order("pivot_value_urn", { ascending: true })
        .range(van, tot),
      "linkedin_demographic_daily"
    ),
    supabase.from("linkedin_urn_labels").select("urn, label").limit(5000),
    supabase.from("linkedin_account_daily").select("date, spend, one_click_leads, external_website_conversions, post_click_conversions, clicks").eq("client_id", clientId).gte("date", since).order("date", { ascending: false }).limit(1000),
    supabase.from("client_settings").select("channel_conversion_config").eq("client_id", clientId).maybeSingle(),
  ]);

  const rows = dailyFetch.rijen;
  if (rows.length === 0) {
    return Response.json({ error: "Geen LinkedIn-dagdata voor deze klant; draai eerst de LinkedIn-sync. Bron: linkedin_campaign_daily." }, { status: 404 });
  }
  const accountRows = eis(accountRes, "linkedin_account_daily");
  const conversieConfig = resolveChannelConversionConfig(
    (configRes.data?.channel_conversion_config ?? null) as Parameters<typeof resolveChannelConversionConfig>[0]
  );
  const conv = (r: Record<string, unknown>): number => sumSelectedConversions(r, "linkedin_ads", conversieConfig);

  const names = new Map((eis(namesRes, "linkedin_campaigns")).map((c) => [c.campaign_urn as string, (c.name as string) ?? (c.campaign_urn as string)]));
  const entities = shapeLinkedInInputs(rows, names);

  // Structuur naast entiteit-signalen: kosten-efficiëntie per demografisch segment (CPL per
  // functie/seniority/industrie/bedrijfsgrootte) — waste + schaalkansen. UNKNOWN is het
  // privacy-onderdrukte restsegment en geen stuurbaar publiek: niet als waste opvoeren.
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const urnLabel = new Map((eis(labelRes, "linkedin_urn_labels")).map((l) => [String(l.urn), String(l.label)]));
  const demoData = demoFetch.rijen;
  const demoRows: LinkedInDemographicRow[] = demoData
    .map((r) => {
      const dimension = PIVOT_TO_DIM[String(r.pivot_type ?? "")];
      const urn = String(r.pivot_value_urn ?? "");
      if (!dimension || !urn || urn === "TOTAL" || urn === "UNKNOWN") return null;
      return { dimension, value: urnLabel.get(urn) ?? urn, spend: num(r.spend), leads: num(r.leads) };
    })
    .filter((r): r is LinkedInDemographicRow => r !== null);

  // Budget-concentratie per campagne over het RECENTE 28-dagen-venster: het signaal gaat
  // over waar het budget nú stapelt. Conversies via de centrale kanaalselectie.
  const { recent: rowsRecent } = splitWindows(rows);
  const liTotals = new Map<string, { spend: number; conversions: number }>();
  for (const r of rowsRecent as unknown as Record<string, unknown>[]) {
    const urn = String(r.entity_urn);
    const t = liTotals.get(urn) ?? { spend: 0, conversions: 0 };
    t.spend += num(r.spend); t.conversions += conv(r);
    liTotals.set(urn, t);
  }
  const liBudgetEntities: BudgetEntityRow[] = [...liTotals.entries()].map(([urn, t]) => ({ name: names.get(urn) ?? urn, spend: t.spend, conversions: t.conversions }));

  // Demografie-drift: verschuift de converterende mix over de tijd? Anker op de laatste
  // DATAdatum — de wandklok verschuift de vensters bij sync-lag naar halflege dagen.
  const driftRows: DemographicDriftRow[] = demoData
    .map((r) => {
      const dimension = PIVOT_TO_DIM[String(r.pivot_type ?? "")];
      const urn = String(r.pivot_value_urn ?? "");
      if (!dimension || !urn || urn === "TOTAL" || urn === "UNKNOWN" || !r.date) return null;
      return { dimension, value: urnLabel.get(urn) ?? urn, date: String(r.date), leads: num(r.leads) };
    })
    .filter((r): r is DemographicDriftRow => r !== null);
  const laatsteDataDatum = (accountRows.length > 0 ? accountRows.map((r) => String(r.date)) : rows.map((r) => r.date)).sort().at(-1)!;

  const liSpendDaily: SpendDailyRow[] = accountRows.map((r) => ({ date: String(r.date), spend: num(r.spend) }));
  const liWeekdayRows: WeekdayRow[] = accountRows.map((r) => ({ date: String(r.date), spend: num(r.spend), conversions: conv(r as Record<string, unknown>) }));
  const liTrackingRows: TrackingGapRow[] = accountRows.map((r) => ({ date: String(r.date), clicks: num(r.clicks), conversions: conv(r as Record<string, unknown>) }));

  const merged = mergeDetections([
    buildLinkedInSignals({ entities }),
    buildLinkedInDemographicSignals(demoRows),
    buildBudgetConcentrationSignals(liBudgetEntities, { channelLabel: "LinkedIn", idPrefix: "linkedin_budget" }),
    buildDemographicDriftSignals(driftRows, laatsteDataDatum),
    buildSpendVelocitySignals(liSpendDaily, { channelLabel: "LinkedIn", idPrefix: "linkedin_budget", vandaag: today() }),
    buildWeekdayEfficiencySignals(liWeekdayRows, { channelLabel: "LinkedIn", idPrefix: "linkedin_budget" }),
    buildTrackingGapSignals(liTrackingRows, { channelLabel: "LinkedIn", idPrefix: "linkedin_budget" }),
  ]);
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, "LinkedIn");

  const output = section || `## LinkedIn-signalen\n\nGeen signalen getriggerd. Gecontroleerd: ${checkedIds.join(", ")}.`;
  const analysisDate = today();
  const dates = rows.map((r) => r.date).sort();

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: dates[0],
      period_end: dates[dates.length - 1],
      section: SECTION,
      output,
      model_used: "deterministisch",
      tokens_used: 0,
      step_number: 1,
      step_name: "LinkedIn-signalen",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, "linkedin_signals", { clientId, analysisId: null });

  return Response.json({
    analysis: output, signals: triggeredCount, checked: checkedIds.length, campaignsAnalysed: entities.length,
    dekking: { laatsteDataDatum, rijenAfgekapt: dailyFetch.afgekapt || demoFetch.afgekapt },
  });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}

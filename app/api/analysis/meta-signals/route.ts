// =====================================================================
// Meta-signalen: de deterministische signaal-detectors (lib/signals/meta-creative) bedraad.
// Geen LLM: de detectors rekenen, de renderer verwoordt in het vaste signaal-format. De dag-
// data van de laatste twee 28-dagen-vensters voedt fatigue/saturatie/ranking/hook-detecties;
// de getriggerde verhalen landen als een voorstel in de goedkeuringswachtrij (SI8) en de
// sectie wordt opgeslagen zodat het maandwerk en de UI dezelfde bevinding zien.
//
// Herbouwd 1 september 2026 na de sloop-audit:
// - De dayparting-detector draait alleen nog als er úúrdata is: meta_hourly_performance is
//   in de hele database leeg en heeft geen schrijver, maar stond wel elke run in
//   "gecontroleerd, niet getriggerd" — alsof er iets gecheckt was.
// - spend-velocity en tracking-gap ankeren op de laatste datadatum (lib-fix); de route
//   geeft "vandaag" mee zodat een sync-achterstand een eigen signaal wordt in plaats van
//   een vals inzakkingsalarm (live gezien: 6 dagen lag gaf -86%).
// - De dagqueries pagineren langs de PostgREST-cap (de demo-breakdown zat al op 780 van de
//   1000) en queryfouten lezen niet langer als "draai eerst de sync".
// - Budget-concentratie telt het recente 28-dagen-venster in plaats van de volle 70 dagen,
//   en de demografie-drift ankert op de data in plaats van op de wandklok.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { buildMetaCreativeSignals } from "@/lib/signals/meta-creative";
import { buildMetaBreakdownSignals, metaBreakdownTypeLabel, type MetaBreakdownRow } from "@/lib/signals/meta-breakdown";
import { buildBudgetConcentrationSignals, type BudgetEntityRow } from "@/lib/signals/budget-concentration";
import { buildDemographicDriftSignals, type DemographicDriftRow } from "@/lib/signals/demographic-drift";
import { buildSpendVelocitySignals, type SpendDailyRow } from "@/lib/signals/spend-velocity";
import { buildWeekdayEfficiencySignals, type WeekdayRow } from "@/lib/signals/weekday-efficiency";
import { buildTrackingGapSignals, type TrackingGapRow } from "@/lib/signals/tracking-gap";
import { buildHourlyDaypartingSignals, type HourlyRow } from "@/lib/signals/hourly-dayparting";
import { renderSignalSection } from "@/lib/signals/render-section";
import { mergeDetections } from "@/lib/signals/types";
import { shapeMetaAdInputs, shapeMetaLevelInputs, splitWindows, type MetaDailyRow } from "@/lib/analysis/channel-signal-data";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { eis, alleRijen, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

const SECTION = "meta_signals_v1";
const SOP_TYPE = "meta_signals";
const FETCH_DAYS = 70; // twee vensters van 28 plus marge voor sync-lag

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest. Zonder dit gaf deze route in
  // demo-modus een 500 en bleef het bijbehorende tabblad leeg.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
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

  // Demo-bewust, net als de GET: mock-writes horen no-ops te zijn.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
  const since = addDays(today(), -FETCH_DAYS);
  const [adFetch, campFetch, adNamesRes, campNamesRes, breakdownFetch, accountRes, hourlyRes] = await Promise.all([
    alleRijen<MetaDailyRow>(
      (van, tot) => supabase
        .from("meta_ad_daily")
        .select("entity_id, date, impressions, link_clicks, spend, conversions, conversion_value, frequency, hook_rate, hold_rate, quality_ranking, engagement_rate_ranking, conversion_rate_ranking")
        .eq("client_id", clientId)
        .gte("date", since)
        .order("date", { ascending: false })
        .order("entity_id", { ascending: true })
        .range(van, tot),
      "meta_ad_daily"
    ),
    alleRijen<MetaDailyRow>(
      (van, tot) => supabase
        .from("meta_campaign_daily")
        .select("entity_id, date, impressions, frequency, spend, conversions")
        .eq("client_id", clientId)
        .gte("date", since)
        .order("date", { ascending: false })
        .order("entity_id", { ascending: true })
        .range(van, tot),
      "meta_campaign_daily"
    ),
    supabase.from("meta_ads").select("ad_id, name, campaign_id").eq("client_id", clientId).limit(2000),
    supabase.from("meta_campaigns").select("campaign_id, name").eq("client_id", clientId).limit(2000),
    alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("meta_breakdown_daily")
        .select("breakdown_type, breakdown_value, date, impressions, link_clicks, spend, conversions")
        .eq("client_id", clientId)
        // Alleen account-level: de unieke sleutel draagt een level-kolom; zonder dit filter tellen
        // de segment-sommen dubbel zodra een sync ook campagne-/adset-level breakdowns schrijft.
        .eq("level", "account")
        .gte("date", since)
        .order("date", { ascending: false })
        .order("breakdown_type", { ascending: true })
        .order("breakdown_value", { ascending: true })
        .range(van, tot),
      "meta_breakdown_daily"
    ),
    supabase
      .from("meta_account_daily")
      .select("date, spend, conversions, link_clicks")
      .eq("client_id", clientId)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(1000),
    supabase
      .from("meta_hourly_performance")
      .select("hour, spend, conversions")
      .eq("client_id", clientId)
      .gte("date", since)
      .limit(1000),
  ]);

  const adRows = adFetch.rijen;
  if (adRows.length === 0) {
    return Response.json({ error: "Geen Meta-dagdata voor deze klant; draai eerst de Meta-sync. Bron: meta_ad_daily." }, { status: 404 });
  }
  const campRows = campFetch.rijen;
  const breakdownData = breakdownFetch.rijen;
  const accountRows = eis(accountRes, "meta_account_daily");
  const hourlyData = eis(hourlyRes, "meta_hourly_performance");

  const campName = new Map((eis(campNamesRes, "meta_campaigns")).map((c) => [c.campaign_id as string, c.name as string]));
  const adNames = new Map(
    (eis(adNamesRes, "meta_ads")).map((a) => [a.ad_id as string, { adName: (a.name as string) ?? (a.ad_id as string), campaignName: campName.get(a.campaign_id as string) ?? null }])
  );
  const levelNames = new Map([...campName.entries()].map(([id, name]) => [id, { adName: name }]));

  const ads = shapeMetaAdInputs(adRows, adNames);
  const levels = shapeMetaLevelInputs(campRows, levelNames);
  // Structuur naast creative: waar landt het budget binnen plaatsing/leeftijd/device en
  // converteert dat mee (segment-waste + schaalkansen).
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const breakdownRows: MetaBreakdownRow[] = breakdownData.map((r) => ({
    breakdownType: String(r.breakdown_type ?? ""),
    breakdownValue: String(r.breakdown_value ?? ""),
    impressions: num(r.impressions),
    clicks: num(r.link_clicks),
    spend: num(r.spend),
    conversions: num(r.conversions),
  }));
  // Budget-concentratie per campagne over het RECENTE 28-dagen-venster: dit signaal gaat
  // over waar het budget nú stapelt, niet over het gemiddelde van tien weken.
  const { recent: campRecent } = splitWindows(campRows);
  const campTotals = new Map<string, { spend: number; conversions: number }>();
  for (const r of campRecent as unknown as Record<string, unknown>[]) {
    const eid = String(r.entity_id);
    const t = campTotals.get(eid) ?? { spend: 0, conversions: 0 };
    t.spend += num(r.spend); t.conversions += num(r.conversions);
    campTotals.set(eid, t);
  }
  const budgetEntities: BudgetEntityRow[] = [...campTotals.entries()].map(([eid, t]) => ({ name: campName.get(eid) ?? eid, spend: t.spend, conversions: t.conversions }));

  // Meta demografie-/segment-drift + spend-velocity op accountniveau. De drift ankert op de
  // laatste DATAdatum: bij sync-lag verschoven de vensters anders stil naar halflege dagen.
  const laatsteDataDatum = accountRows.length > 0
    ? accountRows.map((r) => String(r.date)).sort().at(-1)!
    : adRows.map((r) => r.date).sort().at(-1)!;
  const metaDriftRows: DemographicDriftRow[] = breakdownRows.length > 0
    ? breakdownData
        .filter((r) => r.breakdown_type && r.breakdown_value && r.date)
        .map((r) => ({ dimension: metaBreakdownTypeLabel(String(r.breakdown_type)), value: String(r.breakdown_value), date: String(r.date), leads: num(r.conversions) }))
    : [];
  const metaSpendDaily: SpendDailyRow[] = accountRows.map((r) => ({ date: String(r.date), spend: num(r.spend) }));
  const metaWeekdayRows: WeekdayRow[] = accountRows.map((r) => ({ date: String(r.date), spend: num(r.spend), conversions: num(r.conversions) }));
  const metaTrackingRows: TrackingGapRow[] = accountRows.map((r) => ({ date: String(r.date), clicks: num(r.link_clicks), conversions: num(r.conversions) }));
  const metaHourlyRows: HourlyRow[] = hourlyData.map((r) => ({ hour: num(r.hour), spend: num(r.spend), conversions: num(r.conversions) }));

  const merged = mergeDetections([
    buildMetaCreativeSignals({ ads, levels }),
    buildMetaBreakdownSignals(breakdownRows),
    buildBudgetConcentrationSignals(budgetEntities, { channelLabel: "Meta", idPrefix: "meta_budget" }),
    buildDemographicDriftSignals(metaDriftRows, laatsteDataDatum, { outcomeLabel: "conversie", idPrefix: "meta_demographic_drift" }),
    buildSpendVelocitySignals(metaSpendDaily, { channelLabel: "Meta", idPrefix: "meta_budget", vandaag: today() }),
    buildWeekdayEfficiencySignals(metaWeekdayRows, { channelLabel: "Meta", idPrefix: "meta_budget" }),
    buildTrackingGapSignals(metaTrackingRows, { channelLabel: "Meta", idPrefix: "meta_budget" }),
    // Alleen als er echt uurdata is: meta_hourly_performance heeft (nog) geen schrijver, en
    // een lege tabel als "gecontroleerd" rapporteren wekt de indruk dat er iets gecheckt is.
    ...(metaHourlyRows.length > 0
      ? [buildHourlyDaypartingSignals(metaHourlyRows, { channelLabel: "Meta", idPrefix: "meta_budget" })]
      : []),
  ]);
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, "Meta");

  const output = section || `## Meta-signalen\n\nGeen signalen getriggerd. Gecontroleerd: ${checkedIds.join(", ")}.`;
  const analysisDate = today();
  const dates = adRows.map((r) => r.date).sort();

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
      step_name: "Meta-signalen",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij (vervangt alleen de eigen pending; leeg = verversen).
  await saveSignalHypotheses(supabase, merged.triggered, "meta_signals", { clientId, analysisId: null });

  return Response.json({
    analysis: output,
    signals: triggeredCount,
    checked: checkedIds.length,
    adsAnalysed: ads.length,
    dekking: {
      laatsteDataDatum,
      uurdata: metaHourlyRows.length > 0,
      rijenAfgekapt: adFetch.afgekapt || campFetch.afgekapt || breakdownFetch.afgekapt,
    },
  });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}

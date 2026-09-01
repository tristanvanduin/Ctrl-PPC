// =====================================================================
// KPI-verhoudingen per kanaal: de acht detectors (lib/analysis/kpi-relations) die twee of
// meer KPI's tegen elkaar afzetten (CPA-decompositie, belofte-kloof, verzadiging, bereik-
// verdunning, waarde-mix, herhaling-vs-bereik, dure zichtbaarheid, vanity-engagement).
// Deterministisch, geen LLM. Vensters: Google en Microsoft op de laatste twee AFGESLOTEN
// maanden (maandtotalen + impressie-gewogen impression share), Meta/LinkedIn op twee
// 28-dagen-vensters uit de dagdata. Getriggerde verhalen landen in de wachtrij onder de
// kanaal-eigen bron.
//
// Herbouwd 1 september 2026 na de sloop-audit:
// - De conversie-selectie loopt nu via channel-conversion-config, dezelfde bron als het
//   dashboard — de oude route telde op LinkedIn alléén one_click_leads terwijl de
//   kanaalpagina leads + website-conversies telt, waardoor de CPL hier structureel anders
//   was dan daar.
// - conversionsValue gaat alleen mee wanneer de geselecteerde velden de waarde ook echt
//   dragen; anders was de waarde-per-conversie (K5) een te brede teller op een te smalle
//   noemer en vuurde de mix-detector vals.
// - Microsoft kreeg zijn impression share aangesloten (microsoft_campaign_impression_share
//   bestond al) en draait daarom net als Google op afgesloten maanden, zodat de IS-periode
//   en het venster hetzelfde zijn.
// - "Gecontroleerd" telt alleen detectors waarvan de input er echt was (fix in de lib).
// - Maandgrens via de rapportage-tijdzone in plaats van UTC; queryfouten worden gemeld in
//   plaats van als "geen data" gelezen; period_start/end dragen het echte venster.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import {
  buildKpiRelations, type KpiWindow, type KpiTaal,
  KPI_TAAL_GOOGLE, KPI_TAAL_META, KPI_TAAL_LINKEDIN,
} from "@/lib/analysis/kpi-relations";
import { renderSignalSection } from "@/lib/signals/render-section";
import { splitWindows } from "@/lib/analysis/channel-signal-data";
import { saveSignalHypotheses, type SignalSource } from "@/lib/analysis/signals-to-hypotheses";
import {
  resolveChannelConversionConfig, sumSelectedConversions,
  type ChannelConversionChannel, type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  eis, alleRijen, dataFoutNaarResponse, lopendeMaandStart, maandSleutel,
} from "@/lib/analysis/db-veilig";
import type { SupabaseClient } from "@supabase/supabase-js";

type Kanaal = "google" | "meta" | "linkedin" | "microsoft";
const SOURCES: Record<Kanaal, SignalSource> = { google: "google_kpi", meta: "meta_kpi", linkedin: "linkedin_kpi", microsoft: "microsoft_kpi" };
const LABELS: Record<Kanaal, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn", microsoft: "Microsoft" };
const TAAL: Record<Kanaal, KpiTaal> = {
  google: KPI_TAAL_GOOGLE, meta: KPI_TAAL_META, linkedin: KPI_TAAL_LINKEDIN, microsoft: KPI_TAAL_GOOGLE,
};

const sectionFor = (k: Kanaal) => `kpi_relations_${k}_v1`;
const sopTypeFor = (k: Kanaal) => SOURCES[k];

function parseKanaal(v: string | null): Kanaal | null {
  return v === "google" || v === "meta" || v === "linkedin" || v === "microsoft" ? v : null;
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  const kanaal = parseKanaal(request.nextUrl.searchParams.get("channel"));
  if (!clientId || !kanaal) return Response.json({ error: "client_id en channel (google|meta|linkedin|microsoft) zijn verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", sopTypeFor(kanaal))
    .eq("section", sectionFor(kanaal))
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

interface DayLike { date: string; [k: string]: unknown }

interface VensterUitkomst {
  recent: KpiWindow;
  prior: KpiWindow;
  periodStart: string;
  periodEnd: string;
}

// Twee 28-dagen-vensters uit dagdata naar KpiWindows. De conversie komt uit de centrale
// kanaalselectie; de waarde gaat alleen mee als de selectie de waarde-dragende velden dekt
// (of die velden nul zijn), anders is waarde-per-conversie een scheve breuk.
function windowsFromDaily(
  rows: DayLike[],
  opts: {
    clicks: string;
    kanaal: ChannelConversionChannel;
    config: ChannelConversionConfig;
    waardeDragers: string[];
    engagement?: string;
    frequency?: boolean;
  }
): VensterUitkomst | null {
  const { recent, prior } = splitWindows(rows);
  if (recent.length === 0 || prior.length === 0) return null;

  const selectie = new Set(opts.config[opts.kanaal]);
  const nietGedekteWaarde = opts.waardeDragers.filter((f) => !selectie.has(f));
  const somVeld = (win: DayLike[], veld: string) => win.reduce((acc, r) => acc + n(r[veld]), 0);
  const waardeGeldig = nietGedekteWaarde.every((f) => somVeld([...recent, ...prior], f) === 0);

  const agg = (win: DayLike[], label: string): KpiWindow => {
    const w: KpiWindow = { label, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0, engagement: 0 };
    let freqW = 0; let freqSum = 0;
    for (const r of win) {
      const imp = n(r.impressions);
      w.impressions += imp;
      w.clicks += n(r[opts.clicks]);
      w.cost += n(r.spend);
      w.conversions += sumSelectedConversions(r as Record<string, unknown>, opts.kanaal, opts.config);
      w.conversionsValue = (w.conversionsValue ?? 0) + n(r.conversion_value);
      if (opts.engagement) w.engagement = (w.engagement ?? 0) + n(r[opts.engagement]);
      if (opts.frequency && r.frequency != null && imp > 0) { freqSum += n(r.frequency) * imp; freqW += imp; }
    }
    if (opts.frequency) w.avgFrequency = freqW > 0 ? freqSum / freqW : null;
    if (!opts.engagement) w.engagement = null;
    if (!waardeGeldig) w.conversionsValue = null;
    return w;
  };
  const datums = [...recent, ...prior].map((r) => r.date).sort();
  return {
    recent: agg(recent, "laatste 28 dagen"),
    prior: agg(prior, "de 28 dagen ervoor"),
    periodStart: datums[0],
    periodEnd: datums[datums.length - 1],
  };
}

// Maandtotalen + impressie-gewogen impression share voor de maand-kanalen (Google en
// Microsoft): twee afgesloten maanden, IS uit de campagne-IS-tabel van het kanaal.
async function maandVensters(
  supabase: SupabaseClient,
  clientId: string,
  bron: { maandTabel: string; isTabel: string; isKolom: string }
): Promise<VensterUitkomst | null> {
  const grens = lopendeMaandStart();
  const monthlyRes = await supabase
    .from(bron.maandTabel)
    .select("month, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .lt("month", grens)
    .order("month", { ascending: false })
    .limit(2);
  const months = eis(monthlyRes, bron.maandTabel) as Array<Record<string, unknown>>;
  if (months.length < 2) return null;
  const maandSleutels = months.map((m) => maandSleutel(String(m.month)));

  const isRijen = await alleRijen<{ month: string; impressions: number | null } & Record<string, unknown>>(
    (van, tot) => supabase
      .from(bron.isTabel)
      .select(`month, impressions, ${bron.isKolom}`)
      .eq("client_id", clientId)
      .in("month", months.map((m) => String(m.month)))
      .order("month", { ascending: false })
      .order("id", { ascending: true })
      .range(van, tot),
    bron.isTabel
  );

  const weightedIs = (maand: string): number | null => {
    const rows = isRijen.rijen.filter((r) => maandSleutel(String(r.month)) === maand && r[bron.isKolom] != null);
    const w = rows.reduce((s, r) => s + n(r.impressions), 0);
    if (w <= 0) return null;
    return rows.reduce((s, r) => s + n(r[bron.isKolom]) * n(r.impressions), 0) / w;
  };
  const toWin = (m: Record<string, unknown>): KpiWindow => ({
    label: maandSleutel(String(m.month)),
    impressions: n(m.impressions), clicks: n(m.clicks), cost: n(m.cost), conversions: n(m.conversions),
    conversionsValue: n(m.conversions_value) > 0 ? n(m.conversions_value) : null,
    impressionShare: weightedIs(maandSleutel(String(m.month))),
  });
  return {
    recent: toWin(months[0]),
    prior: toWin(months[1]),
    periodStart: `${maandSleutels[1]}-01`,
    periodEnd: `${maandSleutels[0]}-01`,
  };
}

export async function POST(request: NextRequest) {
  let clientId = ""; let kanaal: Kanaal | null = null;
  try {
    const body = await request.json();
    clientId = String(body.client_id || "");
    kanaal = parseKanaal(String(body.channel || ""));
  } catch { /* onder afgehandeld */ }
  if (!clientId || !kanaal) return Response.json({ error: "client_id en channel (google|meta|linkedin|microsoft) zijn verplicht" }, { status: 400 });

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust, net als de GET.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
    let windows: VensterUitkomst | null = null;

    if (kanaal === "google") {
      windows = await maandVensters(supabase, clientId, {
        maandTabel: "ads_account_monthly",
        isTabel: "ads_campaign_impression_share",
        isKolom: "search_impression_share",
      });
      if (!windows) return Response.json({ error: "Minimaal twee afgesloten maanden Google-data nodig (ads_account_monthly)" }, { status: 404 });
    } else if (kanaal === "microsoft") {
      // Microsoft heeft dezelfde maand-IS-laag als Google; door op afgesloten maanden te
      // rekenen delen venster en impression share exact dezelfde periode.
      const grens = lopendeMaandStart();
      const since = addDays(`${maandSleutel(grens)}-01`, -62); // twee volle maanden terug
      const dagRes = await supabase
        .from("microsoft_account_daily")
        .select("date, impressions, clicks, spend, conversions, conversion_value")
        .eq("client_id", clientId)
        .gte("date", since)
        .lt("date", grens)
        .order("date", { ascending: false })
        .limit(1000);
      const dagen = eis(dagRes, "microsoft_account_daily") as Array<Record<string, unknown> & { date: string }>;

      const perMaand = new Map<string, KpiWindow>();
      for (const r of dagen) {
        const key = maandSleutel(r.date);
        const w = perMaand.get(key) ?? { label: key, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
        w.impressions += n(r.impressions);
        w.clicks += n(r.clicks);
        w.cost += n(r.spend);
        w.conversions += n(r.conversions);
        w.conversionsValue = (w.conversionsValue ?? 0) + n(r.conversion_value);
        perMaand.set(key, w);
      }
      const sleutels = [...perMaand.keys()].sort().reverse();
      if (sleutels.length >= 2) {
        const isRes = await supabase
          .from("microsoft_campaign_impression_share")
          .select("month, impressions, impression_share")
          .eq("client_id", clientId)
          .in("month", [`${sleutels[0]}-01`, `${sleutels[1]}-01`])
          .limit(1000);
        const isRijen = eis(isRes, "microsoft_campaign_impression_share");
        const gewogen = (maand: string): number | null => {
          const rows = isRijen.filter((r) => maandSleutel(String(r.month)) === maand && r.impression_share != null);
          const w = rows.reduce((s, r) => s + n(r.impressions), 0);
          return w > 0 ? rows.reduce((s, r) => s + n(r.impression_share) * n(r.impressions), 0) / w : null;
        };
        const recent = perMaand.get(sleutels[0])!;
        const prior = perMaand.get(sleutels[1])!;
        recent.impressionShare = gewogen(sleutels[0]);
        prior.impressionShare = gewogen(sleutels[1]);
        recent.conversionsValue = (recent.conversionsValue ?? 0) > 0 ? recent.conversionsValue : null;
        prior.conversionsValue = (prior.conversionsValue ?? 0) > 0 ? prior.conversionsValue : null;
        windows = { recent, prior, periodStart: `${sleutels[1]}-01`, periodEnd: `${sleutels[0]}-01` };
      }
      if (!windows) return Response.json({ error: "Minimaal twee afgesloten maanden Microsoft-data nodig (microsoft_account_daily)" }, { status: 404 });
    } else {
      // Meta en LinkedIn: twee 28-dagen-vensters uit de dagdata, met de centrale
      // conversie-selectie van de klant.
      const configRes = await supabase
        .from("client_settings")
        .select("channel_conversion_config")
        .eq("client_id", clientId)
        .maybeSingle();
      const config = resolveChannelConversionConfig(
        (configRes.data?.channel_conversion_config ?? null) as Parameters<typeof resolveChannelConversionConfig>[0]
      );

      const since = addDays(today(), -70);
      if (kanaal === "meta") {
        const res = await supabase
          .from("meta_account_daily")
          .select("date, impressions, link_clicks, spend, conversions, leads, conversion_value, frequency, post_engagement")
          .eq("client_id", clientId)
          .gte("date", since)
          .order("date", { ascending: false })
          .limit(1000);
        windows = windowsFromDaily(eis(res, "meta_account_daily") as DayLike[], {
          clicks: "link_clicks", kanaal: "meta_ads", config,
          waardeDragers: ["conversions"], engagement: "post_engagement", frequency: true,
        });
      } else {
        const res = await supabase
          .from("linkedin_account_daily")
          .select("date, impressions, clicks, spend, one_click_leads, external_website_conversions, post_click_conversions, conversion_value, total_engagements")
          .eq("client_id", clientId)
          .gte("date", since)
          .order("date", { ascending: false })
          .limit(1000);
        windows = windowsFromDaily(eis(res, "linkedin_account_daily") as DayLike[], {
          clicks: "clicks", kanaal: "linkedin_ads", config,
          waardeDragers: ["one_click_leads", "external_website_conversions"], engagement: "total_engagements",
        });
      }
      if (!windows) return Response.json({ error: `Onvoldoende ${LABELS[kanaal]}-data voor twee vergelijkingsvensters` }, { status: 404 });
    }

    const merged = buildKpiRelations(windows.recent, windows.prior, TAAL[kanaal]);
    const { section, triggeredCount, checkedIds } = renderSignalSection(merged, `KPI-verhoudingen ${LABELS[kanaal]}`);
    const output = section || `## KPI-verhoudingen ${LABELS[kanaal]}\n\nGeen opvallende verhoudingen (${windows.prior.label} → ${windows.recent.label}). Gecontroleerd: ${checkedIds.join(", ")}.`;

    const analysisDate = today();
    const { error: saveError } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId, sop_type: sopTypeFor(kanaal), analysis_date: analysisDate,
        period_start: windows.periodStart, period_end: windows.periodEnd, section: sectionFor(kanaal),
        output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: `KPI-verhoudingen ${LABELS[kanaal]}`,
      },
    });
    if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

    await saveSignalHypotheses(supabase, merged.triggered, SOURCES[kanaal], { clientId, analysisId: null });

    return Response.json({ analysis: output, signals: triggeredCount, checked: checkedIds.length, window: `${windows.prior.label} → ${windows.recent.label}` });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}

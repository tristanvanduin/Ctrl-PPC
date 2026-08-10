// Fase 4: live T-minus-pacing voor een generiek event (Black Friday, een sale-periode, een
// beursditie), account-breed -- geen geo-clone-matching per campagne nodig, dus de bron zijn
// de al bestaande, vooraf geaggregeerde account-tabellen. Zelfde vorm als de live-pacing-GET
// van /api/analysis/geo-clone (?live=1): deterministisch, geen LLM, geen opslag. Events komen
// uit dezelfde client_settings.rai_events die de Instellingen-UI al beheert (migratie 024) --
// geen nieuwe tabel nodig, alleen een nieuwe leesrichting.

import { NextRequest } from "next/server";
import { analyzeAccountEvent, type AccountEventChannelInput } from "@/lib/events/account-event-analysis";
import {
  googleMonthlyConversionPoints,
  googleMonthlyCostPoints,
  channelDailyConversionPoints,
  channelDailyCostPoints,
  resolveChannelConversionConfig,
  type GoogleAccountMonthlyRow,
} from "@/lib/events/account-event-points";
import type { Cadence, Edition } from "@/lib/rai/geo-clone-settings";
import { buildEditions, pickCurrentEdition } from "@/lib/rai/geo-clone-analysis";
import { previousEditionFor } from "@/lib/rai/event-comparison";
import type { DailyPoint } from "@/lib/rai/event-time-axis";
import { buildEditionCurves, deriveCpaCurve } from "@/lib/analysis/event-curves";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";

interface RaiEventCfg { id?: string; name?: string; abbrev?: string; cadence?: Cadence | null; editions?: Edition[] | null }

function parseParams(clientId: string | null, eventId: string | null): { clientId: string; eventId: string } | null {
  if (!clientId || !eventId || !eventId.trim()) return null;
  return { clientId, eventId: eventId.trim() };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = parseParams(url.searchParams.get("client_id"), url.searchParams.get("event_id"));
  if (!params) return Response.json({ error: "client_id en event_id zijn verplicht" }, { status: 400 });
  const { clientId, eventId } = params;

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const [settingsRes, googleRes, metaRes, liRes] = await Promise.all([
    supabase.from("client_settings").select("rai_events, kpi_targets, channel_conversion_config").eq("client_id", clientId).maybeSingle(),
    supabase.from("ads_account_monthly").select("month, conversions, cost").eq("client_id", clientId).order("month", { ascending: true }),
    supabase.from("meta_account_daily").select("date, spend, conversions, leads").eq("client_id", clientId).order("date", { ascending: true }),
    supabase.from("linkedin_account_daily").select("date, spend, one_click_leads, external_website_conversions, post_click_conversions").eq("client_id", clientId).order("date", { ascending: true }),
  ]);

  const events = ((settingsRes.data?.rai_events as { events?: RaiEventCfg[] } | null)?.events ?? []);
  const event = events.find((e) => e.id === eventId) ?? null;
  if (!event) return Response.json({ error: `Event ${eventId} niet gevonden bij deze klant` }, { status: 404 });

  const kpi = (settingsRes.data?.kpi_targets ?? null) as Record<string, unknown> | null;
  const conversionsTarget = typeof kpi?.conversionsAbsolute === "number" && kpi.conversionsAbsolute > 0 ? kpi.conversionsAbsolute : null;
  const convConfig = resolveChannelConversionConfig(
    (settingsRes.data?.channel_conversion_config ?? null) as Partial<Record<"meta_ads" | "linkedin_ads", unknown>> | null
  );

  const googleRows = (googleRes.data ?? []) as GoogleAccountMonthlyRow[];
  const metaRows = metaRes.data ?? [];
  const liRows = liRes.data ?? [];

  const channels: AccountEventChannelInput[] = [];
  if (googleRows.length > 0) {
    channels.push({ channel: "google_ads", points: googleMonthlyConversionPoints(googleRows), costPoints: googleMonthlyCostPoints(googleRows) });
  }
  if (metaRows.length > 0) {
    channels.push({
      channel: "meta_ads",
      points: channelDailyConversionPoints(metaRows, "meta_ads", convConfig),
      costPoints: channelDailyCostPoints(metaRows),
    });
  }
  if (liRows.length > 0) {
    channels.push({
      channel: "linkedin_ads",
      points: channelDailyConversionPoints(liRows, "linkedin_ads", convConfig),
      costPoints: channelDailyCostPoints(liRows),
    });
  }
  if (channels.length === 0) return Response.json({ error: "Geen campagnedata voor deze klant" }, { status: 404 });

  const asOfDate = today();
  const cadence = event.cadence ?? "annual";
  const eventEditions = event.editions ?? [];

  const result = analyzeAccountEvent({
    eventId,
    eventName: (event.name ?? event.abbrev ?? eventId).trim(),
    cadence,
    editions: eventEditions,
    conversionsTarget,
    asOfDate,
    channels,
  });

  // Fase 6: de trendlijnen voor de Forecaster-UI. Zelfde editie-resolutie als analyzeAccountEvent
  // hierboven (dezelfde pure functies, dezelfde invoer), maar dan om de VOLLEDIGE curve op te
  // halen in plaats van alleen het huidige punt -- dat geeft cumulativeCurve() al, alleen
  // analyzeAccountEvent vraagt er zelf niet om. Geen tweede berekening, wel een tweede aanroep;
  // zie lib/analysis/event-curves.ts voor waarom dat hier hoort en niet in lib/events.
  const editionsBuilt = buildEditions(eventId, cadence, eventEditions);
  const currentEdition = pickCurrentEdition(editionsBuilt, asOfDate);
  const previousEdition = currentEdition ? previousEditionFor(editionsBuilt, currentEdition.editionId).edition : null;

  type CpaCurves = { current: ReturnType<typeof deriveCpaCurve>; previous: ReturnType<typeof deriveCpaCurve> };
  const perChannelSpendCurves: Record<string, ReturnType<typeof buildEditionCurves>> = {};
  const perChannelConvCurves: Record<string, ReturnType<typeof buildEditionCurves>> = {};
  const perChannelCpaCurves: Record<string, CpaCurves> = {};
  const allConvPoints: DailyPoint[] = [];
  const allCostPoints: DailyPoint[] = [];

  for (const c of channels) {
    const convCurves = buildEditionCurves(c.points, currentEdition, previousEdition);
    const costCurves = buildEditionCurves(c.costPoints, currentEdition, previousEdition);
    perChannelConvCurves[c.channel] = convCurves;
    perChannelSpendCurves[c.channel] = costCurves;
    perChannelCpaCurves[c.channel] = {
      current: deriveCpaCurve(convCurves.current, costCurves.current),
      previous: deriveCpaCurve(convCurves.previous, costCurves.previous),
    };
    allConvPoints.push(...c.points);
    allCostPoints.push(...c.costPoints);
  }
  const blendedConvCurves = buildEditionCurves(allConvPoints, currentEdition, previousEdition);
  const blendedCostCurves = buildEditionCurves(allCostPoints, currentEdition, previousEdition);

  return Response.json({
    channels: channels.map((c) => c.channel),
    curves: {
      conversions: { blended: blendedConvCurves, ...perChannelConvCurves },
      spend: { blended: blendedCostCurves, ...perChannelSpendCurves },
      cpa: {
        blended: { current: deriveCpaCurve(blendedConvCurves.current, blendedCostCurves.current), previous: deriveCpaCurve(blendedConvCurves.previous, blendedCostCurves.previous) },
        ...perChannelCpaCurves,
      },
    },
    perChannelForecast: result.perChannelForecast,
    blendedForecast: result.blendedForecast,
    pacing: {
      eventId,
      eventName: result.eventName,
      daysToFair: result.perChannelForecast.find((c) => c.forecast.daysToFairNow != null)?.forecast.daysToFairNow ?? null,
      currentEditionId: result.currentEditionId,
      previousEditionId: result.previousEditionId,
      comparable: result.conversions?.comparable ?? false,
      currentCumulative: result.conversions?.currentCumulative ?? null,
      previousCumulative: result.conversions?.previousCumulativeAtSameDaysOut ?? null,
      deltaPct: result.conversions?.deltaPct ?? null,
      costDeltaPct: result.cost?.deltaPct ?? null,
      projectedFinal: result.projectedFinal,
      target: result.target,
      projectedVsTargetPct: result.projectedVsTargetPct,
      willHitTarget: result.willHitTarget,
      confidence: result.confidence,
      actionNeeded: result.actionNeeded,
      degradations: result.degradations,
    },
  });
}

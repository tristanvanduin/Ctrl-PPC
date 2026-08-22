import { type ClientHistoricalData } from "./types";
import { getClientSettings } from "./client-settings";

/**
 * Merget de door de gebruiker ingestelde KPI-doelen (Instellingen → doelen) in
 * `targetCurrentYear`. Uitgetrokken uit ClientDataProvider zodat de blended prognosetabel
 * dezelfde doelenlogica kan gebruiken zonder de Google-specifieke context/hook eromheen
 * (die hangt aan useClientData, dat altijd Google Ads bevraagt).
 */
export function mergeKpiTargets(clientId: string, data: ClientHistoricalData): ClientHistoricalData {
  const settings = getClientSettings(clientId);
  const kpi = settings.kpiTargets;
  const originalTarget = data.targetCurrentYear;

  const convTarget = kpi.conversionsMode === "absolute"
    ? kpi.conversionsAbsolute
    : Math.round(originalTarget.conversions * (1 + kpi.conversionsGrowthPct / 100));

  const revTarget = kpi.revenueMode === "absolute"
    ? kpi.revenueAbsolute
    : Math.round(originalTarget.revenue * (1 + kpi.revenueGrowthPct / 100));

  // Derive spend target from KPI goals instead of using the API default:
  // Option 1: conversions × CPA (if both are set)
  // Option 2: revenue / ROAS (if both are set)
  // Fallback: use the API-derived target
  let spendTarget = originalTarget.adSpend;

  const effectiveConv = convTarget > 0 ? convTarget : originalTarget.conversions;
  const effectiveRev = revTarget > 0 ? revTarget : originalTarget.revenue;

  if (kpi.cpaTarget > 0 && effectiveConv > 0) {
    spendTarget = Math.round(effectiveConv * kpi.cpaTarget);
  } else if (kpi.roasTarget > 0 && effectiveRev > 0) {
    spendTarget = Math.round(effectiveRev / kpi.roasTarget);
  }

  const hasUserTargets = convTarget > 0 || revTarget > 0;
  if (!hasUserTargets) return data;

  return {
    ...data,
    targetCurrentYear: {
      conversions: convTarget > 0 ? convTarget : originalTarget.conversions,
      revenue: revTarget > 0 ? revTarget : originalTarget.revenue,
      adSpend: spendTarget,
    },
    conversionOverrides: kpi.conversionOverrides,
  };
}

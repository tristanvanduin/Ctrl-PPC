import { type ClientHistoricalData } from "./types";
import { getClientSettings } from "./client-settings";
import { GROEI_CONVERSIES, GROEI_OMZET } from "./analysis/standaard-jaardoel";

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

  // Het veld in Instellingen heet "% Groei tov vorig jaar", dus het percentage werkt op vorig
  // jaar. Het doel van de route is al vorig jaar +10% (standaardJaardoel); het percentage daar
  // bovenop leggen gaf bij "10%" vorig jaar x 1,21. Vorig jaar is dat doel gedeeld door dezelfde
  // standaardgroei, op afronding na. Groei 0 is "niets ingevoerd": dan blijft het standaarddoel.
  const opGroei = (doel: number, groeiPct: number, standaardGroei: number): number =>
    !groeiPct ? doel : Math.round((doel / standaardGroei) * (1 + groeiPct / 100));

  const convTarget = kpi.conversionsMode === "absolute"
    ? kpi.conversionsAbsolute
    : opGroei(originalTarget.conversions, kpi.conversionsGrowthPct, GROEI_CONVERSIES);

  const revTarget = kpi.revenueMode === "absolute"
    ? kpi.revenueAbsolute
    : opGroei(originalTarget.revenue, kpi.revenueGrowthPct, GROEI_OMZET);

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

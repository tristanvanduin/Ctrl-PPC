import { type ClientHistoricalData, type DoelHerkomst } from "./types";
import { getClientSettings, kpiDoelenIngevoerd, type KpiMode } from "./client-settings";
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
  //
  // Een krimp boven -100% geeft altijd een doel van minstens 1, ook als de afronding hem op 0 zette
  // (-96% op een klein account met een routedoel van 11). Dan valt hij niet terug op het
  // standaarddoel terwijl Instellingen de kaart als "aan" toont (groeiIngevoerd in lib/kpi-kaart.ts
  // gebruikt dezelfde grens). Op -100% of lager is er geen doel: nul of negatief, dus de terugval.
  const opGroei = (doel: number, groeiPct: number, standaardGroei: number): number => {
    if (!groeiPct) return doel;
    const uit = Math.round((doel / standaardGroei) * (1 + groeiPct / 100));
    return groeiPct > -100 && doel > 0 ? Math.max(1, uit) : uit;
  };

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

  // De herkomst gaat met het doel mee, zodat elk scherm kan zeggen wat het is (zie DoelHerkomst in
  // lib/types.ts en jaardoelTekst in lib/analysis/standaard-jaardoel.ts). "Ingevoerd" betekent echt
  // opgeslagen: zonder opgeslagen doel zijn de instellingen DEFAULT_KPI_TARGETS, met een groei van 10
  // die hierboven het standaarddoel oplevert en dus geen doel van iemand is.
  const ingevoerd = kpiDoelenIngevoerd(settings);
  const doelHerkomst = {
    conversions: herkomstVan(ingevoerd, kpi.conversionsMode, kpi.conversionsGrowthPct, convTarget, originalTarget.conversions),
    revenue: herkomstVan(ingevoerd, kpi.revenueMode, kpi.revenueGrowthPct, revTarget, originalTarget.revenue),
  };

  return {
    ...data,
    targetCurrentYear: {
      conversions: convTarget > 0 ? convTarget : originalTarget.conversions,
      revenue: revTarget > 0 ? revTarget : originalTarget.revenue,
      adSpend: spendTarget,
    },
    conversionOverrides: kpi.conversionOverrides,
    doelHerkomst,
  };
}

/**
 * Waar het doel van één metric vandaan komt. Alleen een ingevoerd doel dat ook echt het doel werd,
 * telt: een vast doel van 0, of een groei van 0 ("niets ingevoerd", zie opGroei), valt terug op het
 * standaarddoel, en dan is de herkomst ook de standaard.
 */
function herkomstVan(ingevoerd: boolean, mode: KpiMode, groeiPct: number, doel: number, standaardDoel: number): DoelHerkomst {
  if (!ingevoerd || !(doel > 0)) return { soort: "standaard" };
  if (mode === "absolute") return { soort: "absoluut" };
  // Groei werkt op het standaarddoel; zonder dat (geen vorig jaar) is er geen doel uit de groei.
  return groeiPct && standaardDoel > 0 ? { soort: "groei", groeiPct } : { soort: "standaard" };
}

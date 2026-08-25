// Microsoft data-laag: de canonical metric map voor de claim-consistentie-guard (F4). Levert
// dezelfde Map-vorm als de Google-, Meta- en LinkedIn-varianten (sleutels via canonicalKey, zodat
// dezelfde validateFindingClaims werkt), maar uit de Microsoft-kolommen met de search-KPI's waar
// CPA/ROAS leiden. Aggregeert de daily-rijen naar de laatste accountmaand en ankert alle
// entiteiten op diezelfde maand. Pure functie, op fixtures te testen.

import { canonicalKey, type CanonicalMetricMap } from "@/lib/analysis/claim-consistency";
import { aggregateMonthly, groupBy, type MicrosoftComputeRow, type MonthlyMetrics } from "./prepared-compute";

function setEntityMonth(map: CanonicalMetricMap, name: string, entityType: "account" | "campaign", monthly: MonthlyMetrics | undefined): void {
  if (!monthly) return;
  const set = (metric: string, value: number | null) => {
    if (value !== null && Number.isFinite(value)) map.set(canonicalKey(name, entityType, metric), value);
  };
  set("CPA", monthly.cpa);
  set("ROAS", monthly.roas);
  set("CTR", monthly.ctr_pct);
  set("CPC", monthly.cpc);
  set("CPM", monthly.cpm);
  set("Spend", monthly.spend);
  set("Conversies", monthly.conversions);
  set("CVR", monthly.cvr_pct);
}

export function buildMicrosoftCanonicalMetricMap(campaignRows: MicrosoftComputeRow[], accountRows: MicrosoftComputeRow[]): CanonicalMetricMap {
  const map: CanonicalMetricMap = new Map();

  const accountMonthly = aggregateMonthly(accountRows);
  const analysisMonth = accountMonthly.length ? accountMonthly[accountMonthly.length - 1].month : null;

  // Alle entiteiten ankeren op dezelfde analysemaand (de laatste accountmaand), zodat de canonical
  // waarden bij dezelfde periode horen als de prepared facts.
  const monthFor = (rows: MicrosoftComputeRow[]): MonthlyMetrics | undefined => {
    const monthly = aggregateMonthly(rows);
    if (analysisMonth) return monthly.find((m) => m.month === analysisMonth);
    return monthly.length ? monthly[monthly.length - 1] : undefined;
  };

  setEntityMonth(map, "account", "account", accountMonthly.length ? accountMonthly[accountMonthly.length - 1] : undefined);

  for (const [id, rows] of groupBy(campaignRows, (r) => r.entityId ?? "")) {
    const name = rows.find((r) => r.entityName)?.entityName ?? id ?? "";
    if (!name) continue;
    setEntityMonth(map, name, "campaign", monthFor(rows));
  }

  return map;
}

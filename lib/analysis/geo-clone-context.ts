// Geo-clone-context (masterplan 17.12): sub-accounts (bijv. GreenTech Amsterdam/Americas/North
// America) als UNIEKE, losse eenheden in de analyse, met daarnaast het combinatie-totaal van het
// hele account. Eigenaar, 17 augustus 2026, expliciet: "voor nu mag je [ze] als 3 losse eenheden
// beschouwen (ik wil ze wel bij elkaar krijgen in het totaal overzicht van greentech zelf) maar de
// afkortingen en aparte accounts moeten als uniek gezien worden in deze analyses."
//
// Vóór dit bestand blenden campagnes van meerdere geo-clones stilzwijgend in één account-totaal
// (bevestigd: geen enkele plek in app/api/analysis/monthly/route.ts kent lib/fair/geo-clone-
// catalog.ts). Dit bestand haalt de campagnedata op, splitst 'm via de al-bestaande
// aggregateAllGeoClones() (lib/fair/geo-clone-aggregate.ts) in aparte eenheden + een totaal, en
// levert een promptblok — zelfde rol en vorm als cross-channel-context.ts en god-view-context.ts:
// bij GEEN geo-clones (verreweg de meeste klanten) promptContext = "", nul wijziging.

import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateAllGeoClones, type CampaignMonthlyRow, type GeoCloneSummary } from "@/lib/fair/geo-clone-aggregate";
import { monthsAgo } from "@/lib/reporting-date";

export interface GeoCloneContextBlock {
  available: boolean;
  geoCloneCount: number;
  promptContext: string;
}

const LOOKBACK_MONTHS = 3;

function fmt(s: GeoCloneSummary): string {
  const t = s.totals;
  const cpa = t.cpa !== null ? `€${t.cpa.toFixed(2)}` : "n.v.t.";
  const roas = t.roas !== null ? t.roas.toFixed(2) : "n.v.t.";
  return `${s.campaignCount} campagne${s.campaignCount === 1 ? "" : "s"}, kosten €${t.cost.toFixed(0)}, conversies ${t.conversions}, CPA ${cpa}, ROAS ${roas}`;
}

export async function geoCloneContext(supabase: SupabaseClient, clientId: string): Promise<GeoCloneContextBlock> {
  const { data } = await supabase
    .from("ads_campaign_monthly")
    .select("campaign_name, month, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .gte("month", monthsAgo(LOOKBACK_MONTHS));

  const rows = (data ?? []) as CampaignMonthlyRow[];
  if (rows.length === 0) return { available: false, geoCloneCount: 0, promptContext: "" };

  const breakdown = aggregateAllGeoClones(rows);
  if (breakdown.perGeoClone.length === 0) {
    // Verreweg het normale geval: geen enkele campagnenaam draagt een geo-clone-afkorting.
    return { available: false, geoCloneCount: 0, promptContext: "" };
  }

  const lines: string[] = [
    "## SUB-ACCOUNTS (geo-clones binnen dit account — elk een unieke, losse eenheid)",
    "",
    `Dit account bevat ${breakdown.perGeoClone.length} sub-account${breakdown.perGeoClone.length === 1 ? "" : "s"}, herkend aan de campagnenaam-afkorting. Laatste ${LOOKBACK_MONTHS} maanden:`,
    "",
    ...breakdown.perGeoClone.map((e) => `- **${e.brand} ${e.location} (${e.geoClone})**: ${fmt(e.summary)}`),
  ];
  if (breakdown.unmatched) {
    lines.push(`- **Overig (geen sub-account-afkorting herkend)**: ${fmt(breakdown.unmatched)}`);
  }
  lines.push(
    "",
    `**Totaal van het hele account**: ${fmt(breakdown.total)}`,
    "",
    "INSTRUCTIE:",
    "- Behandel elk sub-account hierboven als een UNIEKE, losse eenheid. Een bevinding of hypothese over één sub-account geldt niet automatisch voor de andere — noem expliciet welk sub-account het betreft.",
    "- Vergelijk sub-accounts gerust met elkaar (bijv. welke presteert beter op CPA), maar meng hun cijfers niet stilzwijgend tot één gemiddelde.",
    "- Het accounttotaal hierboven is de som van alle sub-accounts samen — gebruik dat alleen voor een accountbrede blik, niet als vervanging van de sub-account-specifieke cijfers.",
    "- Campagnes zonder herkende afkorting horen bij geen enkel sub-account; behandel ze als een eigen, apart segment, niet als ruis.",
  );

  return { available: true, geoCloneCount: breakdown.perGeoClone.length, promptContext: lines.join("\n") };
}

// Bewijst computePmaxScorecard() tegen een echte klant -- masterplan sectie 5.4, "klaar wanneer":
// een PMax-scorecard voor de echte klant toont minstens één beoordeelde factor op echte data.
//
// Gebruik: npx tsx scripts/verify-pmax-scorecard.ts [--client=gads-...]

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";
import { computePmaxScorecard, type PmaxCampaignMonthlyRow, type PmaxPlacementRow } from "../lib/pmax-scorecard";
import type { AssetRegel } from "../lib/pmax/assetdekking";
import type { NetworkRow } from "../lib/pmax/network-split";

try { readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }
if (!(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_ACCESS_TOKEN) {
  console.log("verify-pmax-scorecard: overgeslagen (geen SUPABASE_ACCESS_TOKEN of project-URL).");
  process.exit(0);
}

function arg(naam: string, standaard: string | null): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${naam}=`));
  return p ? p.slice(naam.length + 3) : standaard;
}

async function laatsteEchteKlant(): Promise<string> {
  const rows = await sql(
    `select client_id, count(*) as n from ads_campaign_metadata where campaign_type = 'PERFORMANCE_MAX' group by 1 order by 2 desc limit 1`
  );
  if (rows.length === 0) throw new Error("geen PMax-campagnedata gevonden");
  return rows[0].client_id;
}

async function main(): Promise<void> {
  const clientId = arg("client", null) ?? await laatsteEchteKlant();
  const vanaf = new Date();
  vanaf.setUTCMonth(vanaf.getUTCMonth() - 12, 1);
  const vensterStart = vanaf.toISOString().slice(0, 10);
  const negentigDagen = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const pmaxMeta: Array<Record<string, unknown>> = await sql(
    `select campaign_id, campaign_name from ads_campaign_metadata where client_id = '${clientId}' and campaign_type = 'PERFORMANCE_MAX'`
  );
  const pmaxCampaignNames = pmaxMeta.map((r) => String(r.campaign_name));

  const [ruweAssets, ruweNetwork, ruwePlacements, ruweCampMonthly] = await Promise.all([
    sql(`select month, asset_group_name, asset_id, asset_type, performance_label from ads_pmax_asset_performance where client_id = '${clientId}' and month >= '${vensterStart}'`),
    sql(`select network_type, cost, conversions, conversions_value, impressions, clicks from ads_pmax_network_breakdown where client_id = '${clientId}' and month >= '${vensterStart}'`),
    sql(`select placement, cost, conversions, impressions from ads_pmax_placements where client_id = '${clientId}' and month >= '${vensterStart}' limit 2000`),
    sql(`select campaign_name, month, cost, conversions from ads_campaign_monthly where client_id = '${clientId}' and month >= '${negentigDagen}'`),
  ]) as Array<Array<Record<string, unknown>>>;

  const assetRows: AssetRegel[] = ruweAssets.map((r) => ({
    asset_group_name: r.asset_group_name as string | null,
    asset_id: r.asset_id as string | null,
    asset_type: r.asset_type as string | null,
    performance_label: r.performance_label as string | null,
    month: r.month as string | null,
  }));
  const networkRows: NetworkRow[] = ruweNetwork.map((r) => ({
    networkType: String(r.network_type ?? "UNKNOWN"),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversionsValue: Number(r.conversions_value ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
  }));
  const placementRows: PmaxPlacementRow[] = ruwePlacements.map((r) => ({
    placement: String(r.placement ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));
  const campMonthlyRows: PmaxCampaignMonthlyRow[] = ruweCampMonthly.map((r) => ({
    campaign_name: String(r.campaign_name ?? ""),
    month: String(r.month ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
  }));

  console.log(`${clientId}: ${pmaxCampaignNames.length} PMax-campagne(s), ${assetRows.length} assetrijen, ${networkRows.length} netwerkrijen, ${placementRows.length} placementrijen, ${campMonthlyRows.length} campagne-maandrijen\n`);

  const out = computePmaxScorecard({ assetRows, networkRows, placementRows, campMonthlyRows, pmaxCampaignNames });

  console.log(`Totaal: ${out.grade === "?" ? "?" : out.total} (${out.grade})  --  ${out.assessedCount}/5 factoren beoordeeld\n`);
  for (const f of out.factors) {
    console.log(`  ${f.assessed ? `${String(f.score).padStart(2)}/20` : "  — "}  ${f.name.padEnd(32)} ${f.description}`);
  }

  if (out.assessedCount < 5) {
    console.log(`\nLET OP: niet alle vijf factoren beoordeeld (${out.assessedCount}/5) -- Feed Health hoort hier altijd bij te zitten (geen Merchant Center-sync), de rest kan een eerlijk "geen data" zijn.`);
  }
  if (pmaxCampaignNames.length === 0) {
    console.log("\nFOUT: geen PMax-campagnedata gevonden voor deze klant -- de scorecard kon niets tonen.");
    process.exit(1);
  }
  if (out.assessedCount === 0) {
    console.log("\nFOUT: geen enkele factor beoordeeld, ook niet met echte PMax-campagnes.");
    process.exit(1);
  }
  console.log("\nOK  de scorecard draait tegen echte data en toont minstens één beoordeelde factor.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

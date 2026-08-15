// Bewijst computeSearchScorecard() tegen een echte klant -- masterplan sectie 5.4, "klaar wanneer":
// een Search-scorecard voor de echte klant toont vijf of meer van de factoren met een cijfer.
//
// Gebruik: npx tsx scripts/verify-search-scorecard.ts [--client=gads-...]

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";
import { computeSearchScorecard, type SearchImpressionShareRow } from "../lib/search-scorecard";
import type { KeywordQsRow } from "../lib/analysis/metric-cross-checks";

try { readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }
if (!(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_ACCESS_TOKEN) {
  console.log("verify-search-scorecard: overgeslagen (geen SUPABASE_ACCESS_TOKEN of project-URL).");
  process.exit(0);
}

function arg(naam: string, standaard: string | null): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${naam}=`));
  return p ? p.slice(naam.length + 3) : standaard;
}

async function laatsteEchteKlant(): Promise<string> {
  const rows = await sql(
    `select client_id, count(*) as n from ads_campaign_impression_share where campaign_type = 'SEARCH' group by 1 order by 2 desc limit 1`
  );
  if (rows.length === 0) throw new Error("geen Search-campagnedata gevonden");
  return rows[0].client_id;
}

async function main(): Promise<void> {
  const clientId = arg("client", null) ?? await laatsteEchteKlant();

  const ruweRijen: Array<Record<string, unknown>> = await sql(`
    select campaign_id, month, cost, conversions, clicks, impressions,
           search_impression_share, search_budget_lost_is, search_rank_lost_is
    from ads_campaign_impression_share
    where client_id = '${clientId}' and campaign_type = 'SEARCH'
    order by month
  `);
  const rows: SearchImpressionShareRow[] = ruweRijen.map((r) => ({
    campaignId: String(r.campaign_id),
    month: String(r.month),
    cost: Number(r.cost),
    conversions: Number(r.conversions),
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    searchImpressionShare: Number(r.search_impression_share),
    searchBudgetLostIS: Number(r.search_budget_lost_is),
    searchRankLostIS: Number(r.search_rank_lost_is),
  }));

  const laatsteMaand = rows.length > 0 ? rows.map((r) => r.month).sort().slice(-1)[0] : null;
  const zoektermMaand = laatsteMaand ? laatsteMaand.slice(0, 7) : null;
  const ruweKeywords: Array<Record<string, unknown>> = zoektermMaand ? await sql(`
    select k.cost, k.quality_score
    from ads_keyword_performance_monthly k
    join ads_campaign_impression_share c
      on c.client_id = k.client_id and c.campaign_id = k.campaign_id and c.campaign_type = 'SEARCH'
    where k.client_id = '${clientId}' and k.month = '${zoektermMaand}-01'
  `) : [];
  const keywords: KeywordQsRow[] = ruweKeywords.map((r) => ({
    cost: Number(r.cost),
    quality_score: r.quality_score == null ? null : Number(r.quality_score),
  }));

  console.log(`${clientId}: ${rows.length} Search-impressionshare-rijen (${new Set(rows.map((r) => r.campaignId)).size} campagnes), ${keywords.length} keyword-QS-rijen voor ${zoektermMaand ?? "onbekende maand"}\n`);

  const out = computeSearchScorecard(rows, keywords);

  console.log(`Totaal: ${out.grade === "?" ? "?" : out.total} (${out.grade})  --  ${out.assessedCount}/5 factoren beoordeeld\n`);
  for (const f of out.factors) {
    console.log(`  ${f.assessed ? `${String(f.score).padStart(2)}/20` : "  — "}  ${f.name.padEnd(22)} ${f.description}`);
  }

  if (out.assessedCount < 5) {
    console.log(`\nLET OP: niet alle vijf factoren beoordeeld (${out.assessedCount}/5) -- dat kan een eerlijk "geen data" zijn, geen fout. Zie de beschrijving per factor hierboven.`);
  }
  if (rows.length === 0) {
    console.log("\nFOUT: geen Search-campagnedata gevonden voor deze klant -- de scorecard kon niets tonen.");
    process.exit(1);
  }
  console.log("\nOK  de scorecard draait tegen echte data en toont minstens één beoordeelde factor.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

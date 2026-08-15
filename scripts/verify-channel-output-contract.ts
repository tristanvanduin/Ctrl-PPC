// Bewijst mapGoogleMonthlyToSharedOutput() tegen een echte klant en een echte analysedatum --
// exact de eis uit docs/MASTERPLAN.md fase 2: "handmatig nagelopen op een echte maand", niet
// alleen tegen verzonnen fixtures. Zonder --client/--datum pakt hij de meest recente combinatie.
//
// Gebruik:
//   npx tsx scripts/verify-channel-output-contract.ts
//   npx tsx scripts/verify-channel-output-contract.ts --client=gads-3853096192 --datum=2026-04-16

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";
import {
  mapGoogleMonthlyToSharedOutput,
  type SopInsightRow,
  type SopRecommendationRow,
} from "../lib/analysis/channel-output-contract";
import { buildCanonicalMetricMap } from "../lib/analysis/claim-consistency";

try { readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }
if (!(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_ACCESS_TOKEN) {
  console.log("verify-channel-output-contract: overgeslagen (geen SUPABASE_ACCESS_TOKEN of project-URL).");
  process.exit(0);
}

function arg(naam: string, standaard: string | null): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${naam}=`));
  return p ? p.slice(naam.length + 3) : standaard;
}

async function laatsteEchteCombinatie(): Promise<{ clientId: string; datum: string }> {
  const rows = await sql(
    `select client_id, analysis_date from sop_insights group by 1, 2 order by 2 desc limit 1`
  );
  if (rows.length === 0) throw new Error("geen sop_insights-rijen gevonden");
  return { clientId: rows[0].client_id, datum: rows[0].analysis_date };
}

async function main(): Promise<void> {
  const clientIdArg = arg("client", null);
  const datumArg = arg("datum", null);
  const { clientId, datum } = clientIdArg && datumArg
    ? { clientId: clientIdArg, datum: datumArg }
    : await laatsteEchteCombinatie();

  // De Management API geeft numeric-kolommen als JSON-string terug ("151.6", niet 151.6) --
  // anders dan de echte supabase-js-client die de live route gebruikt. Expliciet naar Number
  // hier, anders faalt change_pct stil op de typeof-check in computeConfidenceBreakdown en lijkt
  // effectSize ten onrechte "geen data" terwijl de rijen er echt staan.
  const ruweInsights: Array<Record<string, unknown>> = await sql(`
    select insight_type, title, description, severity, affected_entity, affected_entity_type,
           change_pct, action_required
    from sop_insights where client_id = '${clientId}' and analysis_date = '${datum}'
  `);
  const insights: SopInsightRow[] = ruweInsights.map((r) => ({
    insight_type: String(r.insight_type),
    title: String(r.title),
    description: String(r.description),
    severity: String(r.severity),
    affected_entity: r.affected_entity == null ? null : String(r.affected_entity),
    affected_entity_type: r.affected_entity_type == null ? null : String(r.affected_entity_type),
    action_required: r.action_required as boolean | null,
    change_pct: r.change_pct == null ? null : Number(r.change_pct),
  }));
  const recommendations: SopRecommendationRow[] = await sql(`
    select hypothesis, rationale, measurement_metric, timeframe, ice_total
    from sop_recommendations where client_id = '${clientId}' and analysis_date = '${datum}'
  `);

  // Voor confidenceBreakdown.sampleSize: dezelfde canonicalMetrics-vorm als de Evidence Gate
  // (lib/decision/quality-gates.ts) tegen dezelfde brontabellen bouwt.
  const maand = datum.slice(0, 7);
  const campaignRows = await sql(`
    select campaign_name, month, cost, conversions, conversions_value, clicks
    from ads_campaign_monthly where client_id = '${clientId}' and month = '${maand}-01'
  `);
  const accountRows = await sql(`
    select month, cost, conversions, conversions_value, clicks
    from ads_account_monthly where client_id = '${clientId}' and month = '${maand}-01'
  `);
  const canonicalMetrics = buildCanonicalMetricMap(campaignRows, accountRows, datum, datum);

  console.log(`${clientId} / ${datum}: ${insights.length} insights, ${recommendations.length} recommendations\n`);

  const out = mapGoogleMonthlyToSharedOutput(clientId, datum, insights, recommendations, canonicalMetrics);

  console.log(`signals:       ${out.signals.length}`);
  console.log(`risks:         ${out.risks.length}`);
  console.log(`opportunities: ${out.opportunities.length}`);
  console.log(`patterns:      ${out.patterns.length}  (altijd 0, zie de toelichting in channel-output-contract.ts)`);
  console.log(`hypotheses:    ${out.hypotheses.length}`);
  console.log(`targetStatus:  ${out.targetStatus.status}`);
  console.log(`marketContext: ${out.marketContext.marketRelationType}`);
  console.log(`confidenceBreakdown: ${out.confidenceBreakdown ? JSON.stringify(out.confidenceBreakdown) : "null"}`);

  const totaalIn = insights.length + recommendations.length;
  const totaalUit = out.signals.length + out.risks.length + out.opportunities.length + out.hypotheses.length;
  if (totaalUit !== totaalIn) {
    console.log(`\nFOUT: ${totaalIn} rijen erin, ${totaalUit} eruit -- er is data zoekgeraakt in de mapping.`);
    process.exit(1);
  }
  console.log(`\nOK  alle ${totaalIn} rijen (insights + recommendations) landen ergens in het contract, niets zoekgeraakt.`);

  if (out.signals[0]) {
    console.log("\nVoorbeeld signal:");
    console.log(`  ${out.signals[0].signalType} [${out.signals[0].severity}] ${out.signals[0].title}`);
  }
  if (out.risks[0]) {
    console.log("Voorbeeld risk:");
    console.log(`  [${out.risks[0].severity}] ${out.risks[0].evidence.slice(0, 100)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

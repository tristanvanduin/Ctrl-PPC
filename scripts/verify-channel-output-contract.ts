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

  const insights: SopInsightRow[] = await sql(`
    select insight_type, title, description, severity, affected_entity, action_required
    from sop_insights where client_id = '${clientId}' and analysis_date = '${datum}'
  `);
  const recommendations: SopRecommendationRow[] = await sql(`
    select hypothesis, rationale, measurement_metric, timeframe, ice_total
    from sop_recommendations where client_id = '${clientId}' and analysis_date = '${datum}'
  `);

  console.log(`${clientId} / ${datum}: ${insights.length} insights, ${recommendations.length} recommendations\n`);

  const out = mapGoogleMonthlyToSharedOutput(clientId, datum, insights, recommendations);

  console.log(`signals:       ${out.signals.length}`);
  console.log(`risks:         ${out.risks.length}`);
  console.log(`opportunities: ${out.opportunities.length}`);
  console.log(`patterns:      ${out.patterns.length}  (altijd 0, zie de toelichting in channel-output-contract.ts)`);
  console.log(`hypotheses:    ${out.hypotheses.length}`);
  console.log(`targetStatus:  ${out.targetStatus.status}`);
  console.log(`marketContext: ${out.marketContext.marketRelationType}`);

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

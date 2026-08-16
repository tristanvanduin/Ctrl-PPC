// Regressietest voor de LinkedIn-clusterbug (F5 fase3): IssueClusterEnum was een statische unie
// die Google- en Meta-clusters bevatte (zie __meta_cluster_validation_test.ts, de M2-fix), maar
// LinkedIn's eigen 10 clusters waren daar nooit aan toegevoegd. Gevonden via live verificatie:
// een LinkedIn-finding met issue_cluster "bidding_inefficiency" of "cpl_inflation" faalde stil op
// FindingSchema.safeParse, waardoor het herstelpad precies de meest kanaal-eigen bevindingen
// weggooide en de hele stap-output degradeerde. Deze test dwingt af dat ELK cluster uit
// linkedinAdsAdapter.issueClusters geldig is in de gedeelde enum, zodat een toekomstige
// adapter-uitbreiding die niet naar de schema-enum wordt doorgevoerd hier meteen faalt.
// Draaien: npx tsx lib/analysis/__linkedin_cluster_validation_test.ts

import { canonicalizeFindings } from "./canonicalize";
import { IssueClusterEnum } from "../schema/analysis-schema";
import { linkedinAdsAdapter } from "./adapters/linkedin-ads";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// 1. ELK cluster uit de LinkedIn-adapter is geldig in de gedeelde IssueClusterEnum-unie.
for (const cluster of linkedinAdsAdapter.issueClusters) {
  assert(IssueClusterEnum.safeParse(cluster).success, `LinkedIn-cluster "${cluster}" geldig in IssueClusterEnum`);
}
assert(!IssueClusterEnum.safeParse("totaal_verzonnen_cluster").success, "onzin-cluster faalt nog steeds");

// 2. De tien clusters die de live verificatie miste, expliciet en met naam (geen wildcard-check
// die een hernoemde/verwijderde waarde zou kunnen maskeren).
for (const cluster of [
  "cpl_inflation", "lead_quality_mismatch", "icp_waste", "audience_too_narrow", "audience_saturation",
  "form_dropoff", "format_gap", "budget_pacing_issue", "bidding_inefficiency", "audience_network_leakage",
]) {
  assert(IssueClusterEnum.safeParse(cluster).success, `${cluster} geldig in IssueClusterEnum`);
}

// 3. Pass-through: met LinkedIn validClusters blijft het cluster behouden, net als bij Meta.
const findings = [
  { entity_type: "campaign", entity_name: "Campagne X", metric: "CPL", cause: "test", evidence_level: "confirmed", current_value: 75, previous_value: 60, issue_cluster: "bidding_inefficiency" },
] as unknown as Parameters<typeof canonicalizeFindings>[0];

const withValid = canonicalizeFindings(findings, {}, { validClusters: linkedinAdsAdapter.issueClusters });
assert(withValid.findings[0].issue_cluster === "bidding_inefficiency", "met validClusters blijft bidding_inefficiency behouden");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

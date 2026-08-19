// Regressietest voor deriveDimensionAvailabilityFromClusters() -- de stopgap-fix voor de
// Meta/LinkedIn coverage-leugen: "account": data_unavailable naast findings_surfaced: 7 (echt
// gezien op een live demo-greentech-run, 19 augustus 2026). Zie coverage-enforcer.ts voor de
// volledige uitleg waarom dit alleen een stopgap is, geen echte per-kanaal dimensielijst.
// Draaien: npx tsx lib/analysis/__coverage_enforcer_test.ts

import { deriveDimensionAvailabilityFromClusters, enforceSopCoverage } from "./coverage-enforcer";
import type { IssueCluster } from "./canonicalize";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function mockCluster(overrides: Partial<IssueCluster>): IssueCluster {
  return {
    cluster_id: "test-cluster", issue_cluster: "uncategorized", canonical_entity_name: "test",
    display_label: "test", entity_scope: "account", entity_identity_key: "test",
    canonical_geo_id: null, parent_campaign: null, parent_adgroup: null, canonical_metric: "CPA",
    related_finding_ids: [], dominant_severity: "medium", dominant_confidence: "medium",
    root_cause_summary: "", evidence_summary: "", actionability: "monitor",
    coverage_dimensions: [], findings: [], action_required: false, finding_count: 1, severity_score: 1,
    ...overrides,
  } as IssueCluster;
}

console.log("1. Een cluster op een dimensie maakt die dimensie beschikbaar");
{
  const clusters = [mockCluster({ coverage_dimensions: ["account"] })];
  const availability = deriveDimensionAvailabilityFromClusters(clusters);
  check("account is beschikbaar", availability.account === true);
  check("campaign is niet gezet (geen cluster erop)", availability.campaign === undefined);
}

console.log("\n2. Geen clusters -> lege beschikbaarheid, alles blijft data_unavailable");
{
  const availability = deriveDimensionAvailabilityFromClusters([]);
  check("lege map", Object.keys(availability).length === 0);
  const coverage = enforceSopCoverage([], availability);
  const account = coverage.coverage.find((c) => c.dimension === "account")!;
  check("account blijft data_unavailable zonder clusters", account.status === "data_unavailable");
}

console.log("\n3. De concrete bug: findings_surfaced > 0 mag nooit meer samen met data_unavailable");
{
  // Nabootsing van de echte Meta-run: 7 bevindingen op de 'account'-dimensie, verdeeld over
  // meerdere clusters -- exact het scenario dat met een lege {} "data_unavailable" toonde.
  const clusters = [
    mockCluster({ cluster_id: "c1", coverage_dimensions: ["account"], finding_count: 4 }),
    mockCluster({ cluster_id: "c2", coverage_dimensions: ["account"], finding_count: 3 }),
  ];
  const availability = deriveDimensionAvailabilityFromClusters(clusters);
  const coverage = enforceSopCoverage(clusters, availability);
  const account = coverage.coverage.find((c) => c.dimension === "account")!;
  check("account staat op covered", account.status === "covered", account.status);
  check("data_available is true", account.data_available === true);
  check(
    "geen tegenstrijdigheid: data_unavailable met findings_surfaced > 0 komt niet meer voor",
    !(account.status === "data_unavailable" && account.findings_surfaced > 0)
  );
}

console.log("\n4. Meerdere dimensies tegelijk, elk correct afgeleid");
{
  const clusters = [
    mockCluster({ cluster_id: "c1", coverage_dimensions: ["campaign", "audience"] }),
  ];
  const availability = deriveDimensionAvailabilityFromClusters(clusters);
  check("campaign beschikbaar", availability.campaign === true);
  check("audience beschikbaar", availability.audience === true);
  check("device niet beschikbaar (geen cluster erop)", availability.device === undefined);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

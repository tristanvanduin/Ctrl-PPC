/**
 * Tests for entity scope disambiguation and scope-safe dedup.
 * Run with: npx tsx lib/__tests__/entity-identity.test.ts
 */

import { canonicalizeFindings } from "../analysis/canonicalize";
import { buildDisplayLabel, defaultEntityScope, deriveEntityIdentity } from "../analysis/entity-identity";
import { FindingSchema } from "../schema/analysis-schema";
import type { Finding } from "../schema/analysis-schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    step: 1,
    issue_cluster: "geo_allocation",
    entity_type: "country",
    entity_name: "Duitsland",
    entity_scope: "country",
    parent_campaign: null,
    parent_adgroup: null,
    display_label: undefined,
    metric: "ROAS",
    current_value: 0.89,
    previous_value: 1.4,
    change_pct: -36,
    severity: "high",
    insight_type: "performance",
    is_seasonal: false,
    is_structural: true,
    cause: "Duitsland blijft onder target",
    action_required: true,
    confidence: "high",
    evidence_level: "deterministic",
    benchmark_type: "previous_month",
    ...overrides,
  };
}

console.log("\n=== Entity Identity Tests ===\n");

console.log("1. Country and ad group with same geography must not dedup");
{
  const raw = [
    finding({ entity_type: "country", entity_name: "Duitsland", entity_scope: "country", issue_cluster: "geo_allocation" }),
    finding({ entity_type: "adgroup", entity_name: "DE", entity_scope: "adgroup", parent_campaign: "Shopping-core_RM", issue_cluster: "uncategorized", metric: "CPA" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    adgroup: true,
    hypotheses_sprint_plan: true,
  });

  assert(canonical.findings.length === 2, `should keep both entities separate, got ${canonical.findings.length}`);
  assert(canonical.findings[0].dedup_key !== canonical.findings[1].dedup_key, "dedup keys should differ by scope");
}

console.log("2. Same canonical name across entity types remains separate");
{
  const raw = [
    finding({ entity_type: "country", entity_name: "België", entity_scope: "country" }),
    finding({ entity_type: "campaign", entity_name: "België", entity_scope: "campaign", issue_cluster: "search_budget_cap" }),
    finding({ entity_type: "adgroup", entity_name: "België", entity_scope: "adgroup", parent_campaign: "Search BE", issue_cluster: "uncategorized" }),
  ];

  const canonical = canonicalizeFindings(raw, {
    geography: true,
    campaign: true,
    adgroup: true,
    hypotheses_sprint_plan: true,
  });

  assert(canonical.findings.length === 3, `same label across types should remain separate, got ${canonical.findings.length}`);
}

console.log("3. User-facing labels disambiguate ambiguous entities");
{
  const country = deriveEntityIdentity(finding({ entity_type: "country", entity_name: "Duitsland" }));
  const adgroup = deriveEntityIdentity(finding({ entity_type: "adgroup", entity_name: "DE", parent_campaign: "Shopping-core_RM" }));
  assert(country.display_label === "Land: Duitsland", `expected country label, got ${country.display_label}`);
  assert(adgroup.display_label === "Ad group: DE (Campagne: Shopping-core_RM)", `expected adgroup label, got ${adgroup.display_label}`);
  assert(buildDisplayLabel({ entity_type: "campaign", canonical_entity_name: "Duitsland Prospecting" }) === "Campagne: Duitsland Prospecting", "campaign label explicit");
  assert(country.canonical_geo_id === "de", `country canonical_geo_id should be de, got ${country.canonical_geo_id}`);
  assert(adgroup.canonical_geo_id === "de", `adgroup canonical_geo_id should be de, got ${adgroup.canonical_geo_id}`);
}

console.log("4. Meta/LinkedIn entity types (M2/L2) no longer fail FindingSchema.safeParse");
{
  // Regression test for de bug die live runs raakte: EntityTypeEnum was een Google-only 12-
  // waardenunie, dus elke Meta/LinkedIn-finding met een kanaal-eigen entity_type (bv. "adset",
  // "job_function") faalde stil op FindingSchema.safeParse() en werd door het recovery-pad
  // gedropt -- een sterke kandidaat-oorzaak voor "Verwacht 3 findings, kreeg 1" op live runs.
  const metaFinding = finding({ entity_type: "adset", entity_name: "Prospecting - Lookalike 1%", entity_scope: undefined, issue_cluster: "uncategorized" });
  const linkedinFinding = finding({ entity_type: "job_function", entity_name: "IT Decision Makers", entity_scope: undefined, issue_cluster: "uncategorized" });

  assert(FindingSchema.safeParse(metaFinding).success, "Meta 'adset' finding should pass FindingSchema validation");
  assert(FindingSchema.safeParse(linkedinFinding).success, "LinkedIn 'job_function' finding should pass FindingSchema validation");
}

console.log("5. defaultEntityScope() and buildDisplayLabel() cover all M2/L2 entity types");
{
  const newTypes: Finding["entity_type"][] = [
    "adset", "ad", "placement", "platform", "age_gender",
    "campaign_group", "format", "job_function", "seniority", "industry", "company_size", "region",
  ];
  for (const t of newTypes) {
    const scope = defaultEntityScope(t);
    assert(scope === t, `defaultEntityScope('${t}') should be 1:1, got '${scope}'`);
    const label = buildDisplayLabel({ entity_type: t, canonical_entity_name: "Test" });
    assert(label.includes("Test") && label !== "Test", `buildDisplayLabel('${t}') should produce a labeled string, got '${label}'`);
  }
}

console.log("6. canonicalizeFindings() keeps Meta/LinkedIn findings instead of silently dropping them");
{
  const raw = [
    finding({ entity_type: "adset", entity_name: "Prospecting - Lookalike 1%", entity_scope: undefined, issue_cluster: "uncategorized", metric: "CPA" }),
    finding({ entity_type: "job_function", entity_name: "IT Decision Makers", entity_scope: undefined, issue_cluster: "uncategorized", metric: "CPA" }),
  ];
  const canonical = canonicalizeFindings(raw, {});
  assert(canonical.findings.length === 2, `both channel-specific findings should survive canonicalization, got ${canonical.findings.length}`);
}

console.log("7. Waarde-gebaseerde dedup vangt een mislabelde entity_type (LinkedIn AC-14, live gevonden 19 aug 2026)");
{
  // Live gevonden: LinkedIn stap 4 labelde een "audience"-bevinding per ongeluk als entity_type
  // "account", waardoor de scope-bewuste dedup_key niet matchte met stap 6's correct gelabelde
  // herhaling van diezelfde CPC=88,24-bevinding. AC-14 (monthly-acceptance.ts, entity+metric,
  // scope-onbewust) ving het wel als duplicaat, maar canonicalizeFindings had ze allebei al laten
  // overleven -- blokkeerde de kwaliteitspoort in plaats van gewoon te mergen.
  const raw = [
    finding({ step: 4, entity_type: "account", entity_name: "audience", entity_scope: undefined, metric: "CPC", current_value: 88.24, issue_cluster: "uncategorized" }),
    finding({ step: 6, entity_type: "audience", entity_name: "audience", entity_scope: undefined, metric: "CPC", current_value: 88.24, issue_cluster: "uncategorized" }),
  ];
  const canonical = canonicalizeFindings(raw, {});
  assert(canonical.findings.length === 1, `identical entity_name+metric+current_value across a mislabeled entity_type should merge into 1, got ${canonical.findings.length}`);
  if (canonical.findings.length === 1) {
    assert(/Bevestigd in stap 4, 6/.test(canonical.findings[0].cause || ""), `merged finding should reference both steps, got: ${canonical.findings[0].cause}`);
  }
}

console.log("8. Zelfde naam+metric maar verschillende current_value mergen NIET (regressiewaakhond)");
{
  // Tegenovergestelde controle van test 7: de waarde-gebaseerde pas mag alleen mergen bij een
  // EXACTE current_value-match. Twee verschillende entity_types met dezelfde naam+metric maar
  // een andere waarde zijn waarschijnlijk echt twee verschillende dingen, geen dubbele
  // vermelding van hetzelfde feit -- moeten dus apart blijven, net als de scope-disambiguatie
  // uit test 1/2 al deed.
  const raw = [
    finding({ step: 4, entity_type: "account", entity_name: "audience", entity_scope: undefined, metric: "CPC", current_value: 88.24, issue_cluster: "uncategorized" }),
    finding({ step: 6, entity_type: "audience", entity_name: "audience", entity_scope: undefined, metric: "CPC", current_value: 42.10, issue_cluster: "uncategorized" }),
  ];
  const canonical = canonicalizeFindings(raw, {});
  assert(canonical.findings.length === 2, `same name+metric with different current_value should stay separate, got ${canonical.findings.length}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

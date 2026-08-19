// Verificatie van buildStepOutputJsonSchema() (sop-prompts.ts) -- de structurele afdwinging die
// naast de bestaande prozaïsche buildStepOutputSchema() staat. Bouwt geen mocks van een LLM-call
// (geen netwerk, geen kosten): dit bewijst alleen dat het gegenereerde object een geldig,
// consistent JSON Schema is met de exacte beperkingen die het probleem uit de live runs raken --
// vooral "top_3_findings: EXACT 3 items" als minItems/maxItems, en additionalProperties: false
// zodat een model geen extra wraplaag om het object kan zetten (de "geneste JSON"-klacht).
// Draaien: npx tsx lib/prompts/__step_output_json_schema_test.ts

import { buildStepOutputJsonSchema, GOOGLE_ISSUE_CLUSTER_TEXT, GOOGLE_ENTITY_TYPE_TEXT } from "./sop-prompts";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const issueClusters = GOOGLE_ISSUE_CLUSTER_TEXT.split(", ");
const entityTypes = GOOGLE_ENTITY_TYPE_TEXT.split("|");
const schema = buildStepOutputJsonSchema(issueClusters, entityTypes) as {
  type: string;
  properties: Record<string, { type: unknown; minItems?: number; maxItems?: number; items?: { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } }>;
  required: string[];
  additionalProperties: boolean;
};

console.log("1. Toplevel vorm");
check("type is object", schema.type === "object");
check("additionalProperties is false (geen wraplaag mogelijk)", schema.additionalProperties === false);
check(
  "alle 7 verplichte velden staan in required",
  ["narrative", "log_entries", "top_3_findings", "status", "actions", "step_conclusion", "evidence_basis"]
    .every((k) => schema.required.includes(k))
);

console.log("\n2. top_3_findings: de kern van de fix -- exact 3, geen minder, geen meer");
{
  const findings = schema.properties.top_3_findings;
  check("minItems is 3", findings.minItems === 3, String(findings.minItems));
  check("maxItems is 3", findings.maxItems === 3, String(findings.maxItems));
  check("items heeft additionalProperties: false", findings.items?.additionalProperties === false);
}

console.log("\n3. actions: maximaal 2, geen ondergrens (kan legitiem leeg zijn bij geen-data)");
{
  const actions = schema.properties.actions;
  check("maxItems is 2", actions.maxItems === 2, String(actions.maxItems));
  check("geen minItems gezet", actions.minItems === undefined);
}

console.log("\n4. Kanaalparameterisatie: de enums komen uit de meegegeven lijst, niet hardcoded Google");
{
  const metaClusters = ["creative_fatigue", "hook_dropoff", "uncategorized"];
  const metaEntities = ["account", "campaign", "adset"];
  const metaSchema = buildStepOutputJsonSchema(metaClusters, metaEntities) as typeof schema;
  const findingProps = metaSchema.properties.top_3_findings.items?.properties as
    { issue_cluster?: { enum?: string[] }; entity_type?: { enum?: string[] } } | undefined;
  check("issue_cluster-enum is de Meta-lijst, niet de Google-lijst", JSON.stringify(findingProps?.issue_cluster?.enum) === JSON.stringify(metaClusters));
  check("entity_type-enum is de Meta-lijst", JSON.stringify(findingProps?.entity_type?.enum) === JSON.stringify(metaEntities));
}

console.log("\n5. Geldig als JSON (geen circulaire referenties, geen undefined-lekken)");
{
  let serialized = "";
  let threw = false;
  try { serialized = JSON.stringify(schema); } catch { threw = true; }
  check("serialiseert zonder fout", !threw);
  check("bevat geen 'undefined' string (teken van een lek)", !serialized.includes("undefined"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

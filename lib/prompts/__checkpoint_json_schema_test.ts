// Verificatie van buildCheckpointJsonSchema() (sop-prompts.ts). Regressietest voor de live-
// gevonden bug (19 augustus 2026): checkpoint-calls erfden via ...shared het schema van de
// gewone stappen (monthly_step_output), fundamenteel onverenigbaar met wat een checkpoint
// teruggeeft. Dit bewijst alleen dat het gegenereerde schema een geldig, consistent JSON Schema
// is dat CheckpointOutputSchema (lib/schema/monthly-pipeline-schema.ts) spiegelt -- geen mocks
// van een LLM-call.
// Draaien: npx tsx lib/prompts/__checkpoint_json_schema_test.ts

import { buildCheckpointJsonSchema } from "./sop-prompts";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const schema = buildCheckpointJsonSchema() as {
  type: string;
  properties: Record<string, { type: unknown; items?: { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; enum?: string[] }; minItems?: number; maxItems?: number }>;
  required: string[];
  additionalProperties: boolean;
};

console.log("1. Toplevel vorm spiegelt CheckpointOutputSchema exact");
check("type is object", schema.type === "object");
check("additionalProperties is false", schema.additionalProperties === false);
check(
  "alle 5 velden van CheckpointOutputSchema staan in required",
  ["consolidated_findings", "primary_thread", "confirmed_patterns", "contradictions", "running_context"]
    .every((k) => schema.required.includes(k))
);

console.log("\n2. consolidated_findings-items spiegelen CheckpointFindingSchema");
{
  const items = schema.properties.consolidated_findings.items;
  check("maxItems is 15 (CheckpointOutputSchema: .max(15))", schema.properties.consolidated_findings.maxItems === 15);
  check("items additionalProperties: false", items?.additionalProperties === false);
  check(
    "items heeft alle 5 CheckpointFindingSchema-velden verplicht",
    ["entiteit", "metric", "ernst", "samenvatting", "bevestigd_door"].every((k) => items?.required?.includes(k))
  );
  check("ernst is een enum met de 5 severity-waarden", Boolean(items?.properties?.ernst) && (items?.properties?.ernst as { enum?: string[] }).enum?.length === 5);
}

console.log("\n3. Dit is een fundamenteel ANDERE vorm dan buildStepOutputJsonSchema -- de kern van de bug");
{
  const keys = Object.keys(schema.properties).sort();
  const stepKeys = ["narrative", "log_entries", "top_3_findings", "status", "actions", "step_conclusion", "evidence_basis"].sort();
  check("checkpoint-schema deelt GEEN velden met het stap-schema", keys.every((k) => !stepKeys.includes(k)), JSON.stringify(keys));
}

console.log("\n4. Geldig als JSON, geen undefined-lekken");
{
  let serialized = "";
  let threw = false;
  try { serialized = JSON.stringify(schema); } catch { threw = true; }
  check("serialiseert zonder fout", !threw);
  check("bevat geen 'undefined' string", !serialized.includes("undefined"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

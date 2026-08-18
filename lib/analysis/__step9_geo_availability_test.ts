// Test voor de stap-9-scoping-fix in validateStepOutput (masterplan 17.18, live testrun
// 18 augustus 2026: 4 echte klanten, 100% reproductie, elke maandanalyse geblokkeerd).
// Deterministisch, geen IO. Draaien: npx tsx lib/analysis/__step9_geo_availability_test.ts

import { validateStepOutput } from "./step-validator";
import { checkStepDataAvailability } from "./data-availability";
import type { Finding, StepOutput } from "@/lib/schema/analysis-schema";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function geoFinding(entityName: string, current: number, previous: number): Finding {
  return {
    step: 9,
    issue_cluster: "geo_allocation",
    entity_type: "country",
    entity_name: entityName,
    metric: "ROAS",
    current_value: current,
    previous_value: previous,
    change_pct: ((current - previous) / previous) * 100,
    severity: "high",
    insight_type: "performance",
    is_seasonal: false,
    is_structural: true,
    cause: "Budgetallocatie staat niet in lijn met rendement per land.",
    action_required: true,
    evidence_level: "deterministic",
    confidence: "high",
  };
}

// Exact het echte narratief-patroon uit de live test: audience ontbreekt, geo is er wel, in
// dezelfde stap 9-output (lib/prompts/monthly-v2.ts's verplichte frases).
const STEP9_OUTPUT: StepOutput = {
  narrative:
    "Niveau 1 (Audience): data niet beschikbaar. Binnen Niveau 2 (Geografisch) toont de " +
    "performance een structurele efficiëntiekloof tussen Nederland en België, met een ROAS van " +
    "2.54x in Nederland tegenover 2.14x in België.",
  log_entries: [
    "Niveau 1 (Audience): data niet beschikbaar.",
    "Binnen Account presteert België ondergemiddeld afgelopen maand op ROAS (2.14 vs 2.54 NL).",
  ],
  top_3_findings: [geoFinding("NL", 2.54, 4.01), geoFinding("BE", 2.14, 3.21)],
  status: "NIET OP SCHEMA",
  actions: [],
  step_conclusion: "België trekt budget zonder evenredig rendement; Nederland draagt het account.",
};

console.log("validateStepOutput: stap 9 met audience-unavailable + echte geo-deterministic-findings");
{
  const availability = checkStepDataAvailability({
    audienceData: [], deviceData: [], checkoutData: [], creativeData: [], keywordData: [],
    productData: [], countryData: [{ country: "NL" }, { country: "BE" }], networkData: [],
    scheduleData: [], searchTermData: [],
  });
  const step9Availability = availability.find((a) => a.step === 9)!;

  const result = validateStepOutput(9, STEP9_OUTPUT, "vorige stap conclusie", {
    availability: step9Availability,
  });

  check(
    "geen 'evidence-level deterministic terwijl data niet beschikbaar'-fout voor de geo-findings",
    !result.errors.some((e) => e.includes("terwijl het narratief aangeeft dat data niet beschikbaar is")),
    JSON.stringify(result.errors)
  );
  check("stap is geldig (valid: true)", result.valid === true, JSON.stringify(result));
}

console.log("validateStepOutput: stap 9 met ECHT ontbrekende geo-data blokkeert een geo-finding terecht nog wel");
{
  // Tegenproef: als de stap zelf zegt dat geo-data ontbreekt (Niveau 2), en er staat toch een
  // deterministic geo-finding in, hoort dat WEL een fout te blijven -- de fix mag geo-scope niet
  // blind vrijgeven, alleen de eerder onterecht globale blokkade wegnemen.
  const geoOntbreektOutput: StepOutput = {
    ...STEP9_OUTPUT,
    narrative: "Niveau 1 (Audience): data niet beschikbaar. Niveau 2 (Geografisch): data niet beschikbaar.",
    log_entries: ["Niveau 1 (Audience): data niet beschikbaar.", "Niveau 2 (Geografisch): data niet beschikbaar."],
  };
  const availability = checkStepDataAvailability({
    audienceData: [], deviceData: [], checkoutData: [], creativeData: [], keywordData: [],
    productData: [], countryData: [], networkData: [], scheduleData: [], searchTermData: [],
  });
  const step9Availability = availability.find((a) => a.step === 9)!;

  const result = validateStepOutput(9, geoOntbreektOutput, "vorige stap conclusie", {
    availability: step9Availability,
  });
  check(
    "een deterministic geo-finding bij een echt lege geo-scope blijft afgekeurd",
    result.errors.some((e) => e.includes("terwijl het narratief aangeeft dat data niet beschikbaar is")),
    JSON.stringify(result.errors)
  );
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

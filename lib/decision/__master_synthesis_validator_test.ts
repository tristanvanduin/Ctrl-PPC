// Fixture-test voor validateMasterSynthesisOutput (Master Synthesis, Pijler 6, Fase B).
// Deterministisch, geen IO.
// Draaien: npx tsx lib/decision/__master_synthesis_validator_test.ts

import { validateMasterSynthesisOutput } from "./master-synthesis-validator";
import type { MasterSynthesisOutput } from "./master-synthesis-schema";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function output(overrides: Partial<MasterSynthesisOutput>): MasterSynthesisOutput {
  return {
    narrative: "x".repeat(60),
    log_entries: ['Hypothese: budget verschuift naar Meta - kanalen: google_ads, meta_ads - onderbouwing: x - evidence: deterministic.'],
    hypotheses: [{
      hypothesis: "Budget verschuift van Google naar Meta zonder dat de blended CPA verbetert.",
      expected_result: "CPA daalt 10%", measurement_metric: "CPA", timeframe: "4 weken",
      rationale: "Google-recs melden budgetdruk, Meta-recs melden CPL-daling, cross-channel mix-shift bevestigt.",
      contributing_channels: ["google_ads", "meta_ads"],
      ice_impact: 7, ice_confidence: 6, ice_ease: 5, ice_total: 6,
    }],
    tasks: [],
    step_conclusion: "Budgetverschuiving tussen Google en Meta verklaart de blended CPA-stijging.",
    ...overrides,
  };
}

// 1. Geldige output met kanalen die in het evidence_payload voorkomen: geen errors.
const geldig = validateMasterSynthesisOutput(output({}), ["google_ads", "meta_ads", "linkedin_ads"]);
assert(geldig.valid === true, "geldige output met bekende kanalen is valid");
assert(geldig.errors.length === 0, "geen errors bij bekende kanalen");

// 2. Kanaal in contributing_channels dat niet in het evidence_payload zit: harde fout.
const hallucinatie = validateMasterSynthesisOutput(output({}), ["google_ads"]); // meta_ads ontbreekt
assert(hallucinatie.valid === false, "hallucinatie van een niet-aangeleverd kanaal is invalid");
assert(hallucinatie.errors.some((e) => e.includes("meta_ads")), "foutmelding noemt het gehallucineerde kanaal");

// 3. Zelfde check voor tasks.
const taskHallucinatie = validateMasterSynthesisOutput(
  output({ tasks: [{ title: "x", description: "y", action_type: "budget", contributing_channels: ["linkedin_ads"], hypothesis_index: 0, priority: "high", frequency: "direct", due_date_days: 7 }] }),
  ["google_ads", "meta_ads"]
);
assert(taskHallucinatie.valid === false, "taak met niet-aangeleverd kanaal is invalid");
assert(taskHallucinatie.errors.some((e) => e.includes("linkedin_ads")), "foutmelding noemt het gehallucineerde kanaal in de taak");

// 3b. hypothesis_index buiten bereik (er is maar 1 hypothese, index 0): harde fout.
const indexBuitenBereik = validateMasterSynthesisOutput(
  output({ tasks: [{ title: "x", description: "y", action_type: "budget", contributing_channels: ["google_ads"], hypothesis_index: 3, priority: "high", frequency: "direct", due_date_days: 7 }] }),
  ["google_ads", "meta_ads"]
);
assert(indexBuitenBereik.valid === false, "hypothesis_index buiten bereik is invalid");
assert(indexBuitenBereik.errors.some((e) => e.includes("hypothesis_index")), "foutmelding noemt hypothesis_index");

// 4. Alle hypotheses met precies 1 kanaal: warning, geen harde fout (kan legitiem zijn met cross-channel-onderbouwing).
const enkelKanaal = validateMasterSynthesisOutput(
  output({ hypotheses: [{ ...output({}).hypotheses[0], contributing_channels: ["google_ads"] }] }),
  ["google_ads", "meta_ads"]
);
assert(enkelKanaal.valid === true, "enkel-kanaal-hypothese is geen harde fout");
assert(enkelKanaal.warnings.some((w) => w.includes("kanaaloverstijgend")), "waarschuwt wel dat het mogelijk niet kanaaloverstijgend is");

// 5. Log-format-conformance: een log_entry zonder "Hypothese:" en zonder kanaalnaam geeft een warning.
const slechtFormat = validateMasterSynthesisOutput(output({ log_entries: ["Iets gebeurde ergens."] }), ["google_ads", "meta_ads"]);
assert(slechtFormat.warnings.some((w) => w.toLowerCase().includes("log-format")), "niet-conform log-format geeft een warning");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

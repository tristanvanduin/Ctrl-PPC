// Fixture-test voor het pure deel van master-synthesis-storage.ts (Pijler 6, Fase C). De
// Supabase-writes zelf zijn de LIVE-ONGETESTE grens, zelfde status als elders in deze codebase.
// Draaien: npx tsx lib/decision/__master_synthesis_storage_test.ts

import { renderMasterSynthesisMarkdown } from "./master-synthesis-storage";
import type { MasterSynthesisOutput } from "./master-synthesis-schema";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const output: MasterSynthesisOutput = {
  narrative: "x".repeat(60),
  log_entries: ["Hypothese: x - kanalen: google_ads - onderbouwing: y - evidence: inferred."],
  hypotheses: [{
    hypothesis: "Budgetverschuiving tussen Google en Meta verklaart de blended CPA-stijging.",
    expected_result: "CPA daalt 10%", measurement_metric: "CPA", timeframe: "4 weken",
    rationale: "Google meldt budgetdruk, Meta meldt CPL-daling.",
    contributing_channels: ["google_ads", "meta_ads"],
    ice_impact: 7, ice_confidence: 6, ice_ease: 5, ice_total: 6,
  }],
  tasks: [{
    title: "Verhoog budget Brand NL", description: "Budgetlimiet kost impression share.",
    action_type: "budget", contributing_channels: ["google_ads"], hypothesis_index: 0,
    priority: "high", frequency: "direct", due_date_days: 7,
  }],
  step_conclusion: "Budgetverschuiving verklaart de blended CPA-stijging.",
};

const markdown = renderMasterSynthesisMarkdown(output);
assert(markdown.includes("Master Synthesis"), "markdown heeft een kop");
assert(markdown.includes("Budgetverschuiving tussen Google en Meta"), "markdown bevat de hypothese-tekst");
assert(markdown.includes("google_ads, meta_ads"), "markdown noemt de bijdragende kanalen bij de hypothese");
assert(markdown.includes("Verhoog budget Brand NL"), "markdown bevat de sprinttaak");
assert(markdown.includes(output.step_conclusion), "markdown bevat de conclusie");

const zonderTasks: MasterSynthesisOutput = { ...output, tasks: [] };
const markdownZonderTasks = renderMasterSynthesisMarkdown(zonderTasks);
assert(!markdownZonderTasks.includes("Sprinttaken"), "geen 'Sprinttaken'-kop als er geen taken zijn");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

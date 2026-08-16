// Fixture-test voor de Master Synthesis-promptbouwers (Pijler 6, Fase B). Deterministisch, geen IO.
// Draaien: npx tsx lib/decision/__master_synthesis_prompt_test.ts

import { buildMasterSynthesisSystemPrompt, buildMasterSynthesisUserMessage } from "./master-synthesis-prompt";
import { buildEvidencePayload } from "./evidence/build-payload";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const systemPrompt = buildMasterSynthesisSystemPrompt();
assert(systemPrompt.includes("Master Synthesis"), "system prompt noemt Master Synthesis");
assert(systemPrompt.includes("Step-Purity Contract"), "system prompt bevat het purity-contract");
assert(systemPrompt.includes("Log-formaat"), "system prompt bevat het log-format");
assert(systemPrompt.includes("contributing_channels"), "system prompt legt contributing_channels uit");
assert(/verzin(t)? geen/i.test(systemPrompt), "system prompt verbiedt expliciet het verzinnen van cijfers/kanalen");

const payload = buildEvidencePayload({
  clientId: "client-42",
  periodEnd: "2026-02-28",
  channels: [{ channel: "google_ads", sopType: "monthly", analysisDate: "2026-02-27", recommendations: [], tasks: [], truncated: false }],
  crossChannel: null,
});
const userMessage = buildMasterSynthesisUserMessage(payload);
assert(userMessage.includes("client-42"), "user message bevat de clientId");
assert(userMessage.includes("2026-02-28"), "user message bevat periodEnd");
assert(userMessage.includes("google_ads"), "user message noemt het beschikbare kanaal");
assert(!userMessage.includes("meta_ads"), "user message noemt GEEN kanaal dat niet is aangeleverd");

const legePayload = buildEvidencePayload({ clientId: "c", periodEnd: "2026-02-28", channels: [], crossChannel: null });
const legeMessage = buildMasterSynthesisUserMessage(legePayload);
assert(legeMessage.includes("geen"), "user message meldt expliciet 'geen' kanalen bij een lege payload");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

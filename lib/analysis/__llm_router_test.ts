// Verificatie van O4-kern (model-routing en fallback) met de ECHTE llm-router.
// Draaien: npx tsx lib/analysis/__llm_router_test.ts

import { resolveTier, resolveChain, callRouted, callLayer, MODEL_CATALOG, LAYER_MODEL } from "./llm-router";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}
function fakeResp(model: string): OpenRouterResponse {
  return { output: "ok", model, tokensUsed: 1, promptTokens: 1, completionTokens: 0, latencyMs: 1, retries: 0, cachedPromptTokens: 0, parseStatus: "not_json_mode" };
}

console.log("\n1. Tier-resolutie uit het label");
check("een stap-label zonder override krijgt heavy", resolveTier("monthly-step-3-findings") === "heavy");
check("een -full label krijgt heavy", resolveTier("monthly-full") === "heavy");
check("een als light gemarkeerde stap krijgt light", resolveTier("monthly-step-1-x", { "monthly-step-1": "light" }) === "light");
check("een onbekend label valt terug op heavy", resolveTier("iets-zonder-stap") === "heavy");

console.log("\n1b. Tier-resolutie is per cadans, niet alleen per stapnummer");
{
  // Weekly's stap 2 ("Findings Extractie") en monthly's stap 2 zijn compleet andere stappen die
  // toevallig hetzelfde nummer dragen. Een override voor de een mag de ander niet raken -- dat
  // was precies het gat vóór deze fix (Record<number, Tier>, geen cadans in de sleutel).
  const override = { "weekly-step-2": "light" as const };
  check("de override raakt de bedoelde cadans/stap", resolveTier("weekly-step-2-findings-extractie", override) === "light");
  check("dezelfde stap-NUMMER in een andere cadans blijft ongemoeid", resolveTier("monthly-step-2-x", override) === "heavy");
  check("biweekly's stap 6 en monthly's stap 6 zijn ook onafhankelijk", resolveTier("biweekly-step-6-aanbevelingen-taken", { "monthly-step-6": "light" }) === "heavy");
}

console.log("\n2. Modelketen per tier");
const heavy = resolveChain("monthly-step-3-x");
check("heavy primair is het sterke model", heavy.chain[0] === MODEL_CATALOG.strong);
check("heavy heeft een fallback erachter", heavy.chain.length >= 2 && heavy.chain[1] === MODEL_CATALOG.crossFallback);
const light = resolveChain("monthly-step-1-x", { "monthly-step-1": "light" });
check("light primair is het goedkope model", light.chain[0] === MODEL_CATALOG.cheap);
check("light valt terug op het sterke model", light.chain[1] === MODEL_CATALOG.strong);

console.log("\n3. Fallback-executor");
async function main() {
const calls: string[] = [];
const failFirst = async (req: { model?: string }) => {
  calls.push(req.model!);
  if (req.model === heavy.chain[0]) throw new Error("primair model faalt");
  return fakeResp(req.model!);
};
const r = await callRouted({ apiKey: "x", systemPrompt: "s", userMessage: "u", label: "monthly-step-3-x" }, failFirst as never);
check("probeert eerst het primaire model", calls[0] === heavy.chain[0]);
check("valt bij een fout terug naar het tweede model", r.model === heavy.chain[1]);

console.log("\n4. Happy path gebruikt alleen het primaire model");
const calls2: string[] = [];
let capturedTemp: number | undefined;
const okFirst = async (req: { model?: string; temperature?: number }) => { calls2.push(req.model!); capturedTemp = req.temperature; return fakeResp(req.model!); };
const r2 = await callRouted({ apiKey: "x", systemPrompt: "s", userMessage: "u", label: "monthly-step-3-x" }, okFirst as never);
check("één call, geen fallback", calls2.length === 1 && r2.model === heavy.chain[0]);
check("de router zet temperatuur 0 (deterministisch)", capturedTemp === 0);

console.log("\n5. Determinisme");
check("zelfde label kiest hetzelfde primaire model", resolveChain("monthly-step-3-x").chain[0] === resolveChain("monthly-step-3-x").chain[0]);

console.log("\n6. callLayer: happy path gebruikt het primaire model per laag");
const calls3: string[] = [];
const okAlways = async (req: { model?: string }) => { calls3.push(req.model!); return fakeResp(req.model!); };
const rNarrative = await callLayer("narrative", { apiKey: "x", systemPrompt: "s", userMessage: "u" }, okAlways as never);
check("narrative gebruikt Claude Sonnet 5", rNarrative.model === LAYER_MODEL.narrative.primary);
check("triage-model verschilt van narrative-model (geen kopie van dezelfde keten)", LAYER_MODEL.triage.primary !== LAYER_MODEL.narrative.primary);

console.log("\n7. callLayer: valt terug op het laagspecifieke fallback-model");
const calls4: string[] = [];
const failPrimary = async (req: { model?: string }) => {
  calls4.push(req.model!);
  if (req.model === LAYER_MODEL.reasoning.primary) throw new Error("primair model faalt");
  return fakeResp(req.model!);
};
const rReasoning = await callLayer("reasoning", { apiKey: "x", systemPrompt: "s", userMessage: "u" }, failPrimary as never);
check("probeert eerst Grok 4.6", calls4[0] === LAYER_MODEL.reasoning.primary);
check("valt terug op het fallback-model van de laag", rReasoning.model === LAYER_MODEL.reasoning.fallback);

console.log("\n8. callLayer: vier lagen, vier verschillende primaire modellen (geen kopie van elkaar)");
const primairen = new Set(Object.values(LAYER_MODEL).map((m) => m.primary));
check("elke laag heeft een eigen primair model", primairen.size === 4, [...primairen].join(", "));

console.log("\n9. callLayer: reasoningMaxTokens gaat mee voor het primaire Claude-model, niet voor de Gemini-fallback");
{
  const seen: { model?: string; reasoningMaxTokens?: number }[] = [];
  const failPrimaryCaptures = async (req: { model?: string; reasoningMaxTokens?: number }) => {
    seen.push({ model: req.model, reasoningMaxTokens: req.reasoningMaxTokens });
    if (req.model === LAYER_MODEL.narrative.primary) throw new Error("primair model faalt (geforceerd om de fallback-aanroep te zien)");
    return fakeResp(req.model!);
  };
  await callLayer("narrative", { apiKey: "x", systemPrompt: "s", userMessage: "u" }, failPrimaryCaptures as never);
  check("het primaire Claude-model krijgt het reasoning-budget van de laag mee", seen[0]?.reasoningMaxTokens === LAYER_MODEL.narrative.reasoningMaxTokens, JSON.stringify(seen[0]));
  check("het Gemini-fallback-model krijgt GEEN reasoning-budget mee", seen[1]?.reasoningMaxTokens === undefined, JSON.stringify(seen[1]));
}

console.log("\n10. callLayer: lagen zonder reasoningMaxTokens-config (triage, reasoning) geven nooit een budget door");
{
  const seen: (number | undefined)[] = [];
  const capture = async (req: { model?: string; reasoningMaxTokens?: number }) => { seen.push(req.reasoningMaxTokens); return fakeResp(req.model!); };
  await callLayer("triage", { apiKey: "x", systemPrompt: "s", userMessage: "u" }, capture as never);
  await callLayer("reasoning", { apiKey: "x", systemPrompt: "s", userMessage: "u" }, capture as never);
  check("triage en reasoning (Grok, nog niet bevestigd compatibel) sturen geen reasoning-budget mee", seen.every((v) => v === undefined), JSON.stringify(seen));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
}
main();

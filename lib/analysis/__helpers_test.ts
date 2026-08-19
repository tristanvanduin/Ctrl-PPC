// Test voor getOpenRouterKey() in lib/analysis/helpers.ts. Gevonden n.a.v. een vraag van de
// eigenaar: "ik wil alles via openrouter en niet die gemini key" -- vóór deze fix koos de
// functie GEMINI_API_KEY boven OPENROUTER_API_KEY als beide toevallig gezet waren, wat elke
// aanroep stil buiten OpenRouter om had kunnen sturen zonder dat iemand het zou merken.
// Draaien: npx tsx lib/analysis/__helpers_test.ts

import { getOpenRouterKey } from "./helpers";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const origOpenRouter = process.env.OPENROUTER_API_KEY;
const origGemini = process.env.GEMINI_API_KEY;

console.log("1. Beide sleutels gezet: OPENROUTER_API_KEY wint (nooit stil terugvallen op Gemini)");
{
  process.env.OPENROUTER_API_KEY = "or-sleutel";
  process.env.GEMINI_API_KEY = "gemini-sleutel";
  check("kiest de OpenRouter-sleutel", getOpenRouterKey() === "or-sleutel", String(getOpenRouterKey()));
}

console.log("\n2. Alleen GEMINI_API_KEY gezet: blijft werken als noodgreep");
{
  delete process.env.OPENROUTER_API_KEY;
  process.env.GEMINI_API_KEY = "gemini-sleutel";
  check("valt terug op Gemini zonder OpenRouter-sleutel", getOpenRouterKey() === "gemini-sleutel", String(getOpenRouterKey()));
}

console.log("\n3. Geen van beide gezet: null, geen crash");
{
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
  check("geeft null terug", getOpenRouterKey() === null, String(getOpenRouterKey()));
}

if (origOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = origOpenRouter;
if (origGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = origGemini;

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);

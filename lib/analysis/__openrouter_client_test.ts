// Test voor het lege-antwoord-gat in callOpenRouter (lib/analysis/openrouter-client.ts).
// Gevonden bij de live-test van de wekelijkse LinkedIn-SOP tegen demo-greentech: het model
// verbruikte 54k tokens maar leverde content "" op, en dat werd zonder retry of foutmelding als
// een geslaagde call opgeslagen -- een leeg rapport met "saved: true", geen enkel signaal dat er
// iets misging. Mockt global fetch, geen echte netwerkaanroep of credentials nodig.
// Draaien: npx tsx lib/analysis/__openrouter_client_test.ts

import { callOpenRouter } from "./openrouter-client";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const origFetch = global.fetch;
function mockFetchSequence(contents: string[]): void {
  let call = 0;
  global.fetch = (async () => {
    const content = contents[Math.min(call, contents.length - 1)];
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "x", model: "anthropic/claude-sonnet-5",
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1000, completion_tokens: 8192, total_tokens: 9192 },
      }),
      text: async () => "",
    };
  }) as unknown as typeof fetch;
}

async function run() {
  console.log("\n1. Normaal, niet-leeg antwoord: geen retry, geen fout");
  {
    mockFetchSequence(["# Wekelijkse Health Check\n\nAlles normaal."]);
    const result = await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-normal" });
    check("output komt door", result.output.includes("Health Check"), result.output);
    check("geen retries", result.retries === 0, String(result.retries));
  }

  console.log("\n2. Leeg antwoord, daarna wel content: retry lost het op");
  {
    mockFetchSequence(["", "# Wekelijkse Health Check\n\nHersteld na retry."]);
    const result = await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-retry-herstel" });
    check("uiteindelijke output is niet leeg", result.output.length > 0, result.output);
    check("retries geteld", result.retries === 1, String(result.retries));
  }

  console.log("\n3. Blijvend leeg antwoord: gooit een leesbare fout i.p.v. stil 'saved: true'");
  {
    mockFetchSequence(["", "", ""]);
    let threw = false;
    let message = "";
    try {
      await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-blijvend-leeg" });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("gooit een fout in plaats van een lege string terug te geven", threw);
    check("de foutmelding noemt 'leeg antwoord'", message.includes("leeg antwoord"), message);
    check("de foutmelding noemt het label voor traceerbaarheid", message.includes("test-blijvend-leeg"), message);
  }

  console.log("\n4. JSON-mode met leeg antwoord: bestaand parseStatus-pad blijft ongewijzigd (geen throw, callers checken parseStatus zelf)");
  {
    mockFetchSequence(["", ""]);
    const result = await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-json-leeg", jsonMode: true });
    check("geen throw in JSON-mode (bestaand gedrag: caller leest parseStatus)", result.parseStatus === "failed", result.parseStatus);
  }

  global.fetch = origFetch;
  console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
  if (failed > 0) process.exit(1);
}

run();

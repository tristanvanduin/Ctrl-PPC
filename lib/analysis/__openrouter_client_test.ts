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

  console.log("\n5. reasoningMaxTokens: stuurt OpenRouter's reasoning.max_tokens daadwerkelijk mee in de body");
  {
    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = (async (_url: string, init: { body: string }) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true, status: 200,
        json: async () => ({ id: "x", model: "anthropic/claude-sonnet-5", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;
    await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-reasoning-budget", maxTokens: 16000, reasoningMaxTokens: 6000 });
    check("body.reasoning.max_tokens staat op de gevraagde waarde", (capturedBody as unknown as { reasoning?: { max_tokens?: number } })?.reasoning?.max_tokens === 6000, JSON.stringify(capturedBody));
  }

  console.log("\n6. reasoningMaxTokens >= maxTokens: gooit meteen (geen ruimte over voor het zichtbare antwoord), geen netwerkaanroep");
  {
    let fetchAangeroepen = false;
    global.fetch = (async () => { fetchAangeroepen = true; return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; }) as unknown as typeof fetch;
    let threw = false;
    let message = "";
    try {
      await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-reasoning-te-groot", maxTokens: 4000, reasoningMaxTokens: 4000 });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("gooit voordat er iets over het netwerk gaat", threw && !fetchAangeroepen, `threw=${threw} fetch=${fetchAangeroepen} msg=${message}`);
  }

  // 20 augustus 2026: een AANGRENZEND, maar apart gat in dezelfde functie -- niet leeg, wel
  // afgekapt. finish_reason "length" betekent dat de provider de completion afbrak op max_tokens,
  // geen inhoudelijk einde. Zonder deze check kwam zo'n halve tekst er gewoon doorheen als
  // "success: true": demo-greentech's biweekly-analyse eindigde letterlijk midden in een zin
  // ("...CPA ontwikkelt zich afwijkend... Dit lig[t]") en niets had dat ooit opgemerkt.
  console.log("\n7. finish_reason 'length': gooit door i.p.v. de afgekapte tekst als succes terug te geven");
  {
    function mockFinishReason(content: string, finishReason: string) {
      return {
        ok: true, status: 200,
        json: async () => ({
          id: "x", model: "anthropic/claude-sonnet-5",
          choices: [{ message: { content }, finish_reason: finishReason }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
        text: async () => "",
      };
    }

    global.fetch = (async () => mockFinishReason("Alles compleet.", "stop")) as unknown as typeof fetch;
    const okResult = await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-finish-stop" });
    check("finish_reason 'stop': output komt gewoon door", okResult.output === "Alles compleet.", okResult.output);

    global.fetch = (async () => mockFinishReason("Halverwege afgeka", "length")) as unknown as typeof fetch;
    let threw = false, message = "";
    try {
      await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-finish-length" });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("finish_reason 'length': gooit een fout i.p.v. de afgekapte tekst terug te geven", threw);
    check("de foutmelding noemt de afkapping", /afgekapt|max_tokens/i.test(message), message);

    let call = 0;
    global.fetch = (async () => {
      call += 1;
      return call === 1 ? mockFinishReason("Afgekapt op poging 1", "length") : mockFinishReason("Complete tekst op poging 2.", "stop");
    }) as unknown as typeof fetch;
    const retryResult = await callOpenRouter({ apiKey: "test", systemPrompt: "sys", userMessage: "msg", label: "test-finish-length-retry-herstelt" });
    check("een afgekapte eerste poging herstelt via retry", retryResult.output === "Complete tekst op poging 2.", retryResult.output);
  }

  global.fetch = origFetch;
  console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
  if (failed > 0) process.exit(1);
}

run();

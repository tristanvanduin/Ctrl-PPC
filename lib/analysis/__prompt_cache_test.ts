// Het gedeelde promptbegin, en wat de cache daarmee doet. Geen IO.
// Draaien: npx tsx lib/analysis/__prompt_cache_test.ts
//
// De provider cachet impliciet: deelt een nieuwe call zijn BEGIN met een recente call, dan zijn
// die tokens goedkoper. Er is geen vlag om te zetten en er gaat niets stuk als het misgaat —
// dat is precies het probleem. Zet iemand een datum, een stapnummer of een teller boven in de
// systeemprompt, dan is het gedeelde begin weg en wordt elke stap weer vol afgerekend, zonder
// foutmelding, zonder zichtbaar verschil in de uitvoer.
//
// Gemeten over drie stappen van de maandanalyse: 6394 van de gemiddeld 12720 tekens zijn nu
// gedeeld. Deze test bewaakt dat die 50% niet stilletjes wegzakt.

import { buildMonthlyStepPrompt } from "../prompts/sop-prompts";
import { cacheHitRate, type CallLog } from "./openrouter-client";
import { computeCallCost, CACHED_INPUT_FACTOR } from "./o2-targets-cost";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Hoeveel tekens hebben alle varianten vooraan gemeen? */
function gedeeldBegin(teksten: string[]): number {
  const kortste = Math.min(...teksten.map((t) => t.length));
  let i = 0;
  while (i < kortste && teksten.every((t) => t[i] === teksten[0][i])) i++;
  return i;
}

// ── Het gedeelde begin blijft staan ───────────────────────────────────────

console.log("Het gedeelde begin van de maandprompt");
{
  const doelen = "## Doelen\nConversies omhoog, CPA onder 45 euro.";
  const prompts = [
    buildMonthlyStepPrompt(doelen, "leadgen_cpa", "## Stap 1: Account\nAnalyseer het account."),
    buildMonthlyStepPrompt(doelen, "leadgen_cpa", "## Stap 2: Campagnes\nAnalyseer per campagne.", "Conclusie stap 1..."),
    buildMonthlyStepPrompt(doelen, "leadgen_cpa", "## Stap 3: Advertentiegroepen\nAnalyseer per groep.", "Conclusie stap 1 en 2..."),
  ];
  const gedeeld = gedeeldBegin(prompts);

  // De ondergrens staat bewust ruim onder de gemeten 6394: dit moet een echte breuk vangen,
  // geen normale tekstwijziging in de prompt.
  check("de stappen delen een fors promptbegin", gedeeld > 4000,
    `${gedeeld} tekens gedeeld — als dit is ingestort, staat er iets variabels boven in de prompt`);
  check("het gedeelde deel begint bij de rolomschrijving", gedeeld > 0 && prompts[0].slice(0, 40) === prompts[1].slice(0, 40));

  // Waar het misgaat is als iets per stap verschilt en vooraan staat. Dit is de simulatie
  // daarvan: dan hoort de test die nu slaagt te falen.
  const metDatum = prompts.map((p, i) => `Analyse van 2026-07-2${i}\n\n${p}`);
  check("een variabele regel vooraan sloopt het gedeelde begin", gedeeldBegin(metDatum) < 100,
    `${gedeeldBegin(metDatum)} — dit is het scenario dat de bovenstaande drempel moet vangen`);
}
{
  // Verschillende klanten horen NIET te delen; dat is geen defect maar het verklaart waarom de
  // treffers per run gemeten moeten worden en niet over alle runs heen.
  const a = buildMonthlyStepPrompt("## Doelen\nKlant A", "leadgen_cpa", "## Stap 1\nX");
  const b = buildMonthlyStepPrompt("## Doelen\nKlant B", "leadgen_cpa", "## Stap 1\nX");
  check("twee klanten delen wel de vaste kop", gedeeldBegin([a, b]) > 1000, String(gedeeldBegin([a, b])));
  check("maar niet de hele prompt", a !== b);
}

// ── De treffers zijn af te lezen ──────────────────────────────────────────

console.log("\ncacheHitRate");
{
  const log = (promptTokens: number, cachedPromptTokens: number, success = true): CallLog => ({
    timestamp: "2026-07-28T00:00:00Z", label: "monthly-step-1", model: "gemini-3-flash-preview",
    tokensUsed: promptTokens, promptTokens, cachedPromptTokens,
    latencyMs: 100, retries: 0, parseStatus: "ok", success,
  });

  const r = cacheHitRate([log(1000, 0), log(1000, 800), log(1000, 900)]);
  check("de prompttokens worden opgeteld", r.promptTokens === 3000, String(r.promptTokens));
  check("de gecachte ook", r.cached === 1700, String(r.cached));
  check("het percentage klopt", r.pct === 57, String(r.pct));

  // Een mislukte call heeft geen verbruik en mag het percentage niet vertekenen.
  const m = cacheHitRate([log(1000, 900), log(0, 0, false)]);
  check("mislukte calls tellen niet mee", m.promptTokens === 1000 && m.pct === 90, JSON.stringify(m));

  // Geen calls: dan is er geen percentage. Nul zou "cache werkt niet" suggereren.
  check("zonder calls geen percentage", cacheHitRate([]).pct === null);
  check("een provider die niets meldt geeft 0%", cacheHitRate([log(1000, 0)]).pct === 0);
}

// ── De korting zit in de prijs ────────────────────────────────────────────

console.log("\nDe kostenberekening");
{
  const prijzen = { "test-model": { inputPer1M: 1_000_000, outputPer1M: 2_000_000 } };
  const zonder = computeCallCost("test-model", 1000, 100, prijzen, 0);
  const met = computeCallCost("test-model", 1000, 100, prijzen, 1000);

  check("zonder cache de volle invoerprijs", zonder === 1000 + 200, String(zonder));
  check("volledig gecacht kost een kwart van de invoer",
    met === 1000 * CACHED_INPUT_FACTOR + 200, `${met} bij factor ${CACHED_INPUT_FACTOR}`);
  check("gecacht is goedkoper dan niet", (met ?? 0) < (zonder ?? 0));

  const half = computeCallCost("test-model", 1000, 0, prijzen, 500);
  check("half gecacht zit ertussenin", half === 500 + 500 * CACHED_INPUT_FACTOR, String(half));

  // Een onbekend model levert geen schatting op maar null; dat gedrag blijft.
  check("onbekend model blijft null", computeCallCost("bestaat-niet", 1000, 100, prijzen, 500) === null);

  // Rare meldingen van de provider mogen geen negatieve volle tokens opleveren.
  const raar = computeCallCost("test-model", 100, 0, prijzen, 9999);
  check("meer gecacht dan verstuurd wordt afgekapt", raar === 100 * CACHED_INPUT_FACTOR, String(raar));
  check("een negatief aantal gecachte tokens telt als nul",
    computeCallCost("test-model", 100, 0, prijzen, -50) === 100, String(computeCallCost("test-model", 100, 0, prijzen, -50)));

  // Zonder het argument moet hij zich gedragen als voorheen: alles vol tarief.
  check("weggelaten argument verandert niets aan het oude gedrag",
    computeCallCost("test-model", 1000, 100, prijzen) === 1200);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

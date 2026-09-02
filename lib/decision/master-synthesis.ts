// Master Synthesis, Fase B: de orchestratie die Fase A (evidence_payload) en de LLM-synthese-call
// samenbrengt tot één herbruikbare kernfunctie -- geen route- of Next.js-koppeling hier, zodat
// hij zowel vanuit de route als vanuit een test met een geïnjecteerde callFn draait.
//
// Bewust GEEN persistentie hier: Fase C (master-synthesis-storage.ts) is een aparte stap. Deze
// functie retourneert het gevalideerde resultaat; de aanroeper beslist wat ermee gebeurt.
//
// HERBOUW 2 SEPTEMBER 2026
// - Cijferpoort: de toegestane percentages/bedragen komen uit de prompttekst zelf (dus exact
//   wat het model te zien kreeg) en gaan mee naar de validator; een ongegrond cijfer is een
//   fout die de repair-lus terugkrijgt.
// - maxTokens 4096 → 8192: "minstens 300 woorden" narratief plus vijf hypotheses en vijf taken
//   in JSON-mode werd afgekapt, gaf "Geen geldige JSON", en de repair kreeg dezelfde limiet met
//   een langere prompt -- dezelfde afkapping. Niets logde de ruwe uitvoer, dus dit was niet te
//   zien. Nu is de limiet ruimer en komt de kop van de ruwe uitvoer mee bij een schemafout.
// - pickBetterAttempt woog een schemafout (geen output) als één validatiefout, waardoor een
//   reparatie die geldig JSON met één inhoudsfout opleverde werd weggegooid ten gunste van
//   niets. Een schemafout weegt nu zwaarder dan elke inhoudsfout.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callRouted } from "@/lib/analysis/llm-router";
import type { OpenRouterRequest, OpenRouterResponse } from "@/lib/analysis/openrouter-client";
import { extractGroundedNumbers } from "@/lib/analysis/weekly-number-gate";
import { fetchChannelSynthesis } from "./evidence/channel-synthesis";
import { fetchCrossChannelFacts } from "./evidence/cross-channel-facts";
import { buildEvidencePayload, isEvidencePayloadEmpty, type EvidencePayload } from "./evidence/build-payload";
import { buildMasterSynthesisSystemPrompt, buildMasterSynthesisUserMessage } from "./master-synthesis-prompt";
import { MasterSynthesisOutputSchema, type MasterSynthesisOutput } from "./master-synthesis-schema";
import { validateMasterSynthesisOutput, type MasterSynthesisValidation } from "./master-synthesis-validator";

const MAX_REPAIR_ATTEMPTS = 1;
const MAX_TOKENS = 8192;
// Hoeveel van de ruwe modeluitvoer meekomt bij een schemafout: genoeg om afkapping of een
// verkeerde vorm te herkennen, te weinig om een respons op te blazen.
const RAW_KOP_TEKENS = 400;
// Een schemafout (geen bruikbare output) weegt zwaarder dan welk aantal inhoudsfouten ook.
const SCHEMAFOUT_GEWICHT = 1000;

function extractJsonBlock(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

interface ParseAttempt {
  raw: string;
  output: MasterSynthesisOutput | null;
  schemaError: string | null;
  validation: MasterSynthesisValidation | null;
}

function parseAndValidate(raw: string, availableChannels: readonly string[], toegestaneCijfers: readonly number[]): ParseAttempt {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(raw));
  } catch {
    return { raw, output: null, schemaError: "Geen geldige JSON in de modeloutput", validation: null };
  }
  const result = MasterSynthesisOutputSchema.safeParse(json);
  if (!result.success) {
    const eersteIssue = result.error.issues[0];
    return { raw, output: null, schemaError: `${eersteIssue?.path.join(".")}: ${eersteIssue?.message}`, validation: null };
  }
  return { raw, output: result.data, schemaError: null, validation: validateMasterSynthesisOutput(result.data, availableChannels, toegestaneCijfers) };
}

function foutgewicht(a: ParseAttempt): number {
  if (a.schemaError) return SCHEMAFOUT_GEWICHT;
  return a.validation?.errors.length ?? 0;
}

/** Kiest de betere van twee pogingen: minste fouten wint; bij gelijke fouten blijft het origineel. */
function pickBetterAttempt(original: ParseAttempt, repaired: ParseAttempt): ParseAttempt {
  return foutgewicht(repaired) < foutgewicht(original) ? repaired : original;
}

export interface MasterSynthesisResult {
  evidencePayload: EvidencePayload;
  skipped: boolean;
  skipReason: string | null;
  output: MasterSynthesisOutput | null;
  validation: MasterSynthesisValidation | null;
  schemaError: string | null;
  /** De kop van de ruwe modeluitvoer bij een schemafout, voor diagnose. */
  rawKop: string | null;
  /** Hoeveel percentages/bedragen het evidence_payload droeg (de cijferpoort-set). */
  toegestaneCijfers: number;
  model: string | null;
  tokensUsed: number;
  repaired: boolean;
}

export async function runMasterSynthesis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  periodEnd: string;
  /** Injecteerbaar voor tests, zelfde patroon als callRouted() zelf. Onbenoemd => de echte OpenRouter-keten. */
  callFn?: (req: OpenRouterRequest) => Promise<OpenRouterResponse>;
}): Promise<MasterSynthesisResult> {
  const { supabase, apiKey, clientId, periodEnd, callFn } = opts;

  // Fase A: evidence_payload. Een datalaagfout gooit door (DataLaagFout) -- de route meldt hem
  // als storing; hij mag nooit als "geen_data" lezen.
  const [channels, crossChannel] = await Promise.all([
    fetchChannelSynthesis(supabase, clientId, periodEnd),
    fetchCrossChannelFacts(supabase, clientId, periodEnd),
  ]);
  const evidencePayload = buildEvidencePayload({ clientId, periodEnd, channels, crossChannel });

  const basis = {
    evidencePayload, output: null, validation: null, schemaError: null, rawKop: null,
    toegestaneCijfers: 0, model: null, tokensUsed: 0, repaired: false,
  };

  // Hard-skip: niets om te synthetiseren, geen LLM-call op een lege payload.
  if (isEvidencePayloadEmpty(evidencePayload)) {
    return {
      ...basis, skipped: true,
      skipReason: "Geen kanaal-aanbevelingen/taken en geen getriggerde cross-channel-signalen binnen de periode.",
    };
  }

  // Fase B: de synthese-call, met repair-lus bij een fout.
  const systemPrompt = buildMasterSynthesisSystemPrompt();
  const userMessage = buildMasterSynthesisUserMessage(evidencePayload);
  // De cijferpoort-set uit precies de tekst die het model te zien krijgt.
  const toegestaneCijfers = extractGroundedNumbers(userMessage);

  const first = await callRouted({
    apiKey, systemPrompt, userMessage, jsonMode: true, temperature: 0, maxTokens: MAX_TOKENS,
    label: "master-synthesis",
  }, callFn);
  let attempt = parseAndValidate(first.output, evidencePayload.availableChannels, toegestaneCijfers);
  let model = first.model;
  let tokensUsed = first.tokensUsed;
  let repaired = false;

  const needsRepair = attempt.schemaError !== null || (attempt.validation?.errors.length ?? 0) > 0;
  if (needsRepair) {
    const feedback = attempt.schemaError
      ? [`Schema-fout: ${attempt.schemaError}`]
      : (attempt.validation?.errors ?? []);
    for (let poging = 0; poging < MAX_REPAIR_ATTEMPTS; poging++) {
      const repairMessage = `${userMessage}\n\n## REPAIR FEEDBACK\nJe vorige output is afgekeurd. Los exact deze punten op en lever opnieuw volledig JSON:\n${feedback.map((line) => `- ${line}`).join("\n")}`;
      const repairRes = await callRouted({
        apiKey, systemPrompt, userMessage: repairMessage, jsonMode: true, temperature: 0, maxTokens: MAX_TOKENS,
        label: "master-synthesis-repair",
      }, callFn);
      const repairedAttempt = parseAndValidate(repairRes.output, evidencePayload.availableChannels, toegestaneCijfers);
      const beste = pickBetterAttempt(attempt, repairedAttempt);
      if (beste === repairedAttempt) {
        attempt = repairedAttempt;
        model = repairRes.model;
        tokensUsed += repairRes.tokensUsed;
        repaired = true;
      }
    }
  }

  return {
    ...basis, skipped: false, skipReason: null,
    output: attempt.output, validation: attempt.validation, schemaError: attempt.schemaError,
    rawKop: attempt.schemaError ? attempt.raw.slice(0, RAW_KOP_TEKENS) : null,
    toegestaneCijfers: toegestaneCijfers.length,
    model, tokensUsed, repaired,
  };
}

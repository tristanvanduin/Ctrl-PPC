// Master Synthesis (Pijler 6), Fase B: de orchestratie die Fase A (evidence_payload) en de
// LLM-synthese-call samenbrengt tot één herbruikbare kernfunctie -- run bare, geen route- of
// Next.js-koppeling hier, zodat hij zowel vanuit een toekomstige route (Fase D, nog niet
// geautoriseerd) als vanuit een verificatiescript aan te roepen is.
//
// Bewust GEEN createProgressJob/saveAnalysisOutputSection/persistentie hier: Fase C (opslag naar
// sprint_hypotheses) is een aparte, nog niet geimplementeerde stap. Deze functie retourneert het
// gevalideerde resultaat; de aanroeper beslist wat ermee gebeurt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callRouted } from "@/lib/analysis/llm-router";
import type { OpenRouterRequest, OpenRouterResponse } from "@/lib/analysis/openrouter-client";
import { fetchChannelSynthesis } from "./evidence/channel-synthesis";
import { fetchCrossChannelFacts } from "./evidence/cross-channel-facts";
import { buildEvidencePayload, isEvidencePayloadEmpty, type EvidencePayload } from "./evidence/build-payload";
import { buildMasterSynthesisSystemPrompt, buildMasterSynthesisUserMessage } from "./master-synthesis-prompt";
import { MasterSynthesisOutputSchema, type MasterSynthesisOutput } from "./master-synthesis-schema";
import { validateMasterSynthesisOutput, type MasterSynthesisValidation } from "./master-synthesis-validator";

const MAX_REPAIR_ATTEMPTS = 1;

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

function parseAndValidate(raw: string, availableChannels: readonly string[]): ParseAttempt {
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
  return { raw, output: result.data, schemaError: null, validation: validateMasterSynthesisOutput(result.data, availableChannels) };
}

/** Kiest de betere van twee pogingen: minste fouten wint; bij gelijke fouten blijft het origineel. */
function pickBetterAttempt(original: ParseAttempt, repaired: ParseAttempt): ParseAttempt {
  const origErrors = original.validation?.errors.length ?? (original.schemaError ? 1 : 0);
  const repairErrors = repaired.validation?.errors.length ?? (repaired.schemaError ? 1 : 0);
  return repairErrors < origErrors ? repaired : original;
}

export interface MasterSynthesisResult {
  evidencePayload: EvidencePayload;
  skipped: boolean;
  skipReason: string | null;
  output: MasterSynthesisOutput | null;
  validation: MasterSynthesisValidation | null;
  schemaError: string | null;
  model: string | null;
  tokensUsed: number;
  repaired: boolean;
}

export async function runMasterSynthesis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  periodEnd: string;
  /** Injecteerbaar voor tests, zelfde patroon als callRouted() zelf ("de caller is
   *  injecteerbaar voor tests"). Onbenoemd => de echte OpenRouter-keten. */
  callFn?: (req: OpenRouterRequest) => Promise<OpenRouterResponse>;
}): Promise<MasterSynthesisResult> {
  const { supabase, apiKey, clientId, periodEnd, callFn } = opts;

  // Fase A: evidence_payload.
  const [channels, crossChannel] = await Promise.all([
    fetchChannelSynthesis(supabase, clientId, periodEnd),
    fetchCrossChannelFacts(supabase, clientId, periodEnd),
  ]);
  const evidencePayload = buildEvidencePayload({ clientId, periodEnd, channels, crossChannel });

  // Hard-skip: niets om te synthetiseren, geen LLM-call op een lege payload (zelfde discipline
  // als F5 fase1.4 voor de kanaal-stappen).
  if (isEvidencePayloadEmpty(evidencePayload)) {
    return {
      evidencePayload, skipped: true,
      skipReason: "Geen kanaal-aanbevelingen/taken en geen getriggerde cross-channel-signalen binnen de periode.",
      output: null, validation: null, schemaError: null, model: null, tokensUsed: 0, repaired: false,
    };
  }

  // Fase B: de synthese-call, met repair-lus bij een fout (zelfde patroon als de kanaal-SOP's:
  // shouldRepairStep/buildStepRepairUserMessage/pickBetterStepAttempt in monthly/route.ts, hier
  // lokaal herimplementeerd omdat die functies privé zijn aan die route en een ander
  // validatieresultaat-type hebben dan MasterSynthesisValidation).
  const systemPrompt = buildMasterSynthesisSystemPrompt();
  const userMessage = buildMasterSynthesisUserMessage(evidencePayload);

  const first = await callRouted({
    apiKey, systemPrompt, userMessage, jsonMode: true, temperature: 0, maxTokens: 4096,
    label: "master-synthesis",
  }, callFn);
  let attempt = parseAndValidate(first.output, evidencePayload.availableChannels);
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
        apiKey, systemPrompt, userMessage: repairMessage, jsonMode: true, temperature: 0, maxTokens: 4096,
        label: "master-synthesis-repair",
      }, callFn);
      const repairedAttempt = parseAndValidate(repairRes.output, evidencePayload.availableChannels);
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
    evidencePayload, skipped: false, skipReason: null,
    output: attempt.output, validation: attempt.validation, schemaError: attempt.schemaError,
    model, tokensUsed, repaired,
  };
}

/**
 * Shared OpenRouter client with retries, timeout, logging, and metadata tracking.
 *
 * Replaces the raw fetch calls in helpers.ts with a robust wrapper.
 */

import { fixMojibake } from "./sanitize";
import { sanitizeLLMPayload } from "../security/sanitize-llm-payload";
import { classifyLLMError, type LLMErrorClassification } from "./llm-error";
import { logger } from "@/lib/logger";

// LLM-endpoint. Sinds masterplan Fase 3 (15 augustus) staat LLM_BASE_URL in .env.local op echt
// OpenRouter (https://openrouter.ai/api/v1) -- de terugval hieronder op Google's directe
// OpenAI-compatibele Gemini-endpoint blijft staan als noodgreep voor een omgeving zonder
// OPENROUTER_API_KEY, zelfde chat-completions-formaat dus de client hieronder blijft ongewijzigd.
const OPENROUTER_BASE = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
// Alleen de terugval-waarde als callRouted()/callLayer() geen model meegeeft (zou niet moeten
// gebeuren; beide zetten altijd expliciet een model uit MODEL_CATALOG/LAYER_MODEL).
const DEFAULT_MODEL = "google/gemini-3.7-flash";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface OpenRouterRequest {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  /** Request JSON mode from the model */
  jsonMode?: boolean;
  /**
   * Optioneel: een echt JSON Schema om response_format naar "json_schema" (strict) te tillen
   * i.p.v. het losse "json_object". Alleen actief als jsonMode ook true is -- zonder jsonMode
   * blijft het gedrag exact zoals voorheen. Structurele afdwinging (verplichte velden, vaste
   * enums, array-lengtes zoals "exact 3 findings") in plaats van hopen dat het model de
   * tekstinstructie ("EXACT 3 items") volgt. Bevestigd ondersteund door alle modellen in de
   * bestaande ketens (google/gemini-3.7-flash, gemini-2.5-flash(-lite), x-ai/grok-4.6) via
   * OpenRouter -- zie docs/ARCHITECTURE-MODEL-ROUTING.md. Semantische regels (wiskundige
   * consistentie, evidence-discipline) blijven in de prompttekst staan; die kan een schema niet
   * uitdrukken.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** M3: optionele afbeelding (base64) voor multimodale calls; laat het tekstpad ongemoeid. */
  imageBase64?: string;
  imageMediaType?: string;
  /** Label for logging (e.g. "step-7-findings") */
  label?: string;
  /** Override het model voor deze call (de router zet dit; default DEFAULT_MODEL) */
  model?: string;
  /**
   * Reserveert een apart denkbudget voor redenerende modellen (OpenRouter's `reasoning.max_tokens`,
   * bevestigd voor de Claude-familie). MOET strikt kleiner zijn dan `maxTokens` -- OpenRouter
   * garandeert anders geen ruimte voor het zichtbare antwoord na het denken. Zonder dit veld kan
   * een redenerend model zijn volledige `maxTokens`-budget aan onzichtbare reasoning besteden en
   * content "" teruggeven: precies wat er gebeurde bij de live-test van de LinkedIn weekly-SOP
   * (54k tokens verbruikt, nul zichtbare tekst). callLayer() zet dit per laag, alleen voor lagen
   * met een bevestigd Claude-primair model (narrative, strategic).
   */
  reasoningMaxTokens?: number;
}

export interface OpenRouterResponse {
  output: string;
  model: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  retries: number;
  /**
   * Het deel van promptTokens dat de provider uit zijn cache haalde. Gemini cachet impliciet
   * op een gedeeld promptbegin en rekent die tokens goedkoper af. Zonder dit getal is niet te
   * zien of dat werkt: de prompt lijkt dan even duur als zonder cache, en een wijziging die het
   * gedeelde begin breekt kost stilzwijgend geld zonder dat er iets kapot gaat.
   * 0 als de provider het niet meldt.
   */
  cachedPromptTokens: number;
  /** Whether the response was valid JSON (if jsonMode requested) */
  parseStatus: "ok" | "recovered" | "failed" | "not_json_mode";
}

interface RawApiResponse {
  id: string;
  model: string;
  choices: { message: { content: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** OpenAI-compatibel veld; Gemini vult hier zijn impliciete cachetreffers in. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

// ── Logging ────────────────────────────────────────────────────────────────

export interface CallLog {
  timestamp: string;
  label: string;
  model: string;
  tokensUsed: number;
  /** Alleen bij een geslaagde call ingevuld. */
  promptTokens?: number;
  /** Zie OpenRouterResponse.cachedPromptTokens. */
  cachedPromptTokens?: number;
  latencyMs: number;
  retries: number;
  parseStatus: string;
  success: boolean;
  error?: string;
}

const callLogs: CallLog[] = [];

/**
 * Hoeveel van de prompttokens over een reeks calls uit de cache kwamen.
 *
 * Dit is de enige manier om te zien of het gedeelde promptbegin zijn werk doet. Zakt dit naar
 * nul terwijl er meerdere stappen op dezelfde systeemprompt draaien, dan is er iets veranderds
 * aan het BEGIN van de prompt — een datum, een stapnummer, een teller — en wordt elke stap weer
 * vol afgerekend zonder dat er iets zichtbaar kapot is.
 */
export function cacheHitRate(logs: readonly CallLog[]): { promptTokens: number; cached: number; pct: number | null } {
  let promptTokens = 0, cached = 0;
  for (const l of logs) {
    if (!l.success) continue;
    promptTokens += l.promptTokens ?? 0;
    cached += l.cachedPromptTokens ?? 0;
  }
  return { promptTokens, cached, pct: promptTokens > 0 ? Math.round((cached / promptTokens) * 100) : null };
}

/** Get all logs from this process lifetime (useful for debugging/observability). */
export function getCallLogs(): readonly CallLog[] {
  return callLogs;
}

/** Get logs for the current analysis run (by label prefix). */
export function getRunLogs(prefix: string): CallLog[] {
  return callLogs.filter((l) => l.label.startsWith(prefix));
}

/**
 * Het aantal calls tot nu toe. Neem dit aan het begin van een run en geef het mee aan
 * `logCacheSummary`, dan telt alleen deze run mee. Op label filteren zou niet volstaan: labels
 * zijn niet run-specifiek, dus een tweede analyse in hetzelfde proces zou de eerste meetellen.
 */
export function callLogMark(): number {
  return callLogs.length;
}

/**
 * Schrijft één regel met de cachetreffers van een run. Bewust een logregel en geen exception:
 * dit is een waarneming over kosten, geen fout.
 */
export function logCacheSummary(vanaf: number, label: string): void {
  const run = callLogs.slice(vanaf);
  if (run.length === 0) return;
  const { promptTokens, cached, pct } = cacheHitRate(run);
  if (pct === null) return;
  logger.info(
    `[cache] ${label}: ${run.length} calls, ${promptTokens} prompttokens waarvan ${cached} uit cache (${pct}%).` +
    (pct === 0 ? " Nul treffers — controleer of er iets variabels boven in de prompt is gekomen." : "")
  );
}

// ── Core client ────────────────────────────────────────────────────────────

export async function callOpenRouter(opts: OpenRouterRequest): Promise<OpenRouterResponse> {
  const {
    apiKey,
    systemPrompt,
    userMessage,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0.1,
    jsonMode = false,
    label = "unknown",
    model = DEFAULT_MODEL,
    reasoningMaxTokens,
    jsonSchema,
  } = opts;

  // SEC1: weer secrets en maskeer PII voordat de payload naar de provider gaat.
  // Dit is het ene chokepoint, dus elke LLM-call is gedekt.
  const sysSan = sanitizeLLMPayload(systemPrompt ?? "");
  const userSan = sanitizeLLMPayload(userMessage ?? "");
  if (!sysSan.report.clean || !userSan.report.clean) {
    const secrets = sysSan.report.redactedSecrets + userSan.report.redactedSecrets;
    const emails = sysSan.report.maskedEmails + userSan.report.maskedEmails;
    logger.warn(`[security] LLM-payload gesaneerd (${label}): secrets=${secrets}, emails=${emails}`);
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: sysSan.sanitized },
      {
        role: "user",
        content: opts.imageBase64
          ? [
              { type: "text", text: userSan.sanitized },
              { type: "image_url", image_url: { url: `data:${opts.imageMediaType ?? "image/jpeg"};base64,${opts.imageBase64}` } },
            ]
          : userSan.sanitized,
      },
    ],
  };

  if (jsonMode) {
    body.response_format = jsonSchema
      ? { type: "json_schema", json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } }
      : { type: "json_object" };
  }

  if (reasoningMaxTokens !== undefined) {
    if (reasoningMaxTokens >= maxTokens) {
      throw new Error(`callOpenRouter (${label}): reasoningMaxTokens (${reasoningMaxTokens}) moet strikt kleiner zijn dan maxTokens (${maxTokens}) -- anders blijft er geen ruimte over voor het zichtbare antwoord.`);
    }
    body.reasoning = { max_tokens: reasoningMaxTokens };
  }

  let lastError: Error | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Was een verouderde, publieke pre-rebrand domeinnaam -- een restant van vóór de rebrand
          // naar Ctrl PPC, gevonden 17 augustus 2026 doordat OpenRouter's eigen "Top Apps"-overzicht
          // die naam toonde na een live testrun. Deze header identificeert de aanroepende app bij
          // OpenRouter (Apps-dashboard, geen functionele invloed op de call zelf), en hoorde dus
          // al die tijd de echte merknaam te dragen, niet een oude.
          "HTTP-Referer": "https://www.ctrlppc.com",
          "X-Title": "Ctrl PPC",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${errText}`);
      }

      const data: RawApiResponse = await res.json();
      const rawOutput = data.choices?.[0]?.message?.content ?? "";
      const output = fixMojibake(rawOutput);
      const latencyMs = Date.now() - startTime;
      // "length" = de provider brak de completion af op max_tokens, geen inhoudelijk einde.
      // Ontdekt 20 augustus 2026: demo-greentech's biweekly-analyse ("...CPA ontwikkelt zich
      // afwijkend... Dit lig[t]") stond al maanden zo in de database omdat niets deze waarde ooit
      // controleerde -- een afgekapte respons werd hier stilzwijgend als succesvol behandeld en
      // opgeslagen, precies zoals elke andere complete analyse.
      const finishReason = data.choices?.[0]?.finish_reason;
      // Gooi door i.p.v. hier al iets terug te geven: dit valt in de bestaande catch-hieronder,
      // die "onbekende" fouten (geen match op timeout/4xx/5xx/netwerk) al als retrybaar
      // classificeert (classifyLLMError) en met dezelfde backoff opnieuw probeert. Geen losse
      // retry-tak nodig, en op de laatste poging faalt de call dan ook ECHT -- geen halve
      // analyse die als "success: true" wordt gelogd en opgeslagen.
      if (finishReason === "length") {
        throw new Error(`OpenRouter-respons afgekapt op max_tokens (label: ${label}, ${output.length} tekens ontvangen)`);
      }

      // Determine parse status
      let parseStatus: OpenRouterResponse["parseStatus"] = "not_json_mode";
      if (jsonMode) {
        try {
          JSON.parse(output.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
          parseStatus = "ok";
        } catch {
          parseStatus = "failed";
        }
      }

      const promptTokens = data.usage?.prompt_tokens ?? 0;
      const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;

      const response: OpenRouterResponse = {
        output,
        model: data.model ?? DEFAULT_MODEL,
        tokensUsed: data.usage?.total_tokens ?? 0,
        promptTokens,
        completionTokens: data.usage?.completion_tokens ?? 0,
        latencyMs,
        retries,
        cachedPromptTokens,
        parseStatus,
      };

      // Log success
      callLogs.push({
        timestamp: new Date().toISOString(),
        label,
        model: response.model,
        tokensUsed: response.tokensUsed,
        promptTokens,
        cachedPromptTokens,
        latencyMs,
        retries,
        parseStatus,
        success: true,
      });

      // If JSON mode and parse failed, retry (up to MAX_RETRIES)
      if (jsonMode && parseStatus === "failed" && attempt < MAX_RETRIES) {
        retries++;
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Een leeg antwoord buiten JSON-mode heeft geen eigen signaal zoals parseStatus -- de
      // aanroeper ziet alleen "gelukt" en een leeg rapport. Gevonden bij de live-test van de
      // wekelijkse LinkedIn-SOP: 54k tokens verbruikt (waarschijnlijk vrijwel allemaal in
      // reasoning), content "". Retry eerst zoals hierboven; blijft hij leeg, gooi dan zodat
      // callLayer() automatisch naar het fallback-model omschakelt in plaats van een lege string
      // stil te bewaren als "saved: true".
      if (!jsonMode && output.trim().length === 0) {
        if (attempt < MAX_RETRIES) {
          retries++;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new Error(`OpenRouter (${label}): leeg antwoord na ${MAX_RETRIES + 1} pogingen (model ${response.model}, ${response.tokensUsed} tokens verbruikt).`);
      }

      return response;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      lastError = err instanceof Error ? err : new Error(String(err));

      callLogs.push({
        timestamp: new Date().toISOString(),
        label,
        model: DEFAULT_MODEL,
        tokensUsed: 0,
        latencyMs,
        retries: attempt,
        parseStatus: "failed",
        success: false,
        error: lastError.message,
      });

      if (attempt < MAX_RETRIES) {
        retries++;

        // SEC3: getypeerde retry-beslissing in plaats van string-matching.
        // Niet-retrybaar (auth, permission, bad_request) stopt direct.
        if (!classifyLLMError(lastError).retryable) {
          break;
        }

        await sleep(RETRY_DELAY_MS * (attempt + 1)); // exponential-ish backoff
        continue;
      }
    }
  }

  const finalError = lastError ?? new Error(`OpenRouter call failed after ${MAX_RETRIES + 1} attempts`);
  // SEC3: hang de getypeerde classificatie aan de fout voor een fallback-laag.
  (finalError as Error & { llmError?: LLMErrorClassification }).llmError = classifyLLMError(finalError);
  throw finalError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

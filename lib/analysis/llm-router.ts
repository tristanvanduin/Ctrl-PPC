/**
 * O4: LLM model-routing en fallback (kern, op de bestaande OpenRouter-provider).
 *
 * De call-plek zegt alleen WAT hij nodig heeft via het label; de router kiest het model
 * en een fallback-keten. Productiegedrag is hier ongewijzigd: elke echte stap blijft op het
 * sterke model, met een fallback erachter. Kosten besparen doe je door specifieke stappen in
 * STEP_TIER op "light" te zetten NA verificatie op Minismus.
 *
 * De tweede provider (Copilot of Azure) en de deployment-beschikbaarheid zitten niet in deze
 * kern; die zijn gated op het platform-antwoord (zie O4_llm_model_routing.md).
 *
 * ── SINDS 15 AUGUSTUS: ECHT OPENROUTER, NIET MEER DE DIRECTE GEMINI-ENDPOINT ──────────────
 *
 * `LLM_BASE_URL` (openrouter-client.ts) wijst nu naar https://openrouter.ai/api/v1. Model-ID's
 * dragen daarom het OpenRouter-voorvoegsel (google/, x-ai/, anthropic/, openai/) en zijn
 * geverifieerd tegen de echte catalogus (GET /api/v1/models), niet aangenomen -- zie
 * docs/ARCHITECTURE-MODEL-ROUTING.md voor de volledige onderbouwing en prijzen.
 */

import {
  callOpenRouter,
  type OpenRouterRequest,
  type OpenRouterResponse,
} from "./openrouter-client";

// Model-catalogus voor de bestaande heavy/medium/light-keten. Zelfde rolverdeling en zelfde
// prijsniveau als vóór de overstap naar OpenRouter (zie lib/analysis/o2-targets-cost.ts,
// MODEL_PRICES) -- dit is een endpoint-wissel, geen modelwissel voor de bestaande aanroepers.
// De fallback is bewust OOK een Gemini-model, zodat een fout nooit terugvalt op een betaald
// account bij een andere provider.
export const MODEL_CATALOG = {
  strong: "google/gemini-3.7-flash",
  cheap: "google/gemini-2.5-flash-lite",
  crossFallback: "google/gemini-2.5-flash",
} as const;

export type Tier = "heavy" | "medium" | "light";

// Tier naar modelketen: primair eerst, daarna fallback. De cross-model fallback staat achteraan,
// zodat bij een falen van het primaire model een ander model het overneemt.
const TIER_CHAIN: Record<Tier, string[]> = {
  heavy: [MODEL_CATALOG.strong, MODEL_CATALOG.crossFallback],
  medium: [MODEL_CATALOG.strong, MODEL_CATALOG.crossFallback],
  light: [MODEL_CATALOG.cheap, MODEL_CATALOG.strong],
};

const DEFAULT_TIER: Tier = "heavy";

// Per stapnummer een tier. Leeg betekent: alles heavy, dus geen gedragswijziging. Zet hier
// specifieke stappen op "light" of "medium" om kosten te besparen, pas na verificatie.
const STEP_TIER: Record<number, Tier> = {
  // voorbeeld: 1: "light",
};

/** Leidt de tier af uit het call-label (bv. "monthly-step-3-findings" of "monthly-full"). */
export function resolveTier(
  label: string,
  stepTier: Record<number, Tier> = STEP_TIER
): Tier {
  const m = /step-(\d+)/.exec(label);
  if (m) return stepTier[Number(m[1])] ?? DEFAULT_TIER;
  return DEFAULT_TIER;
}

/** Resolvet de tier plus de modelketen voor een label. */
export function resolveChain(
  label: string,
  stepTier?: Record<number, Tier>
): { tier: Tier; chain: string[] } {
  const tier = resolveTier(label, stepTier);
  return { tier, chain: TIER_CHAIN[tier] };
}

export type RoutedRequest = Omit<OpenRouterRequest, "model">;

/**
 * Voert een LLM-call uit volgens de routing: probeert de modellen in de keten op volgorde en
 * valt bij een fout naar het volgende. Geeft het eerste succes terug; de response meldt welk
 * model bediende. De caller is injecteerbaar voor tests.
 */
export async function callRouted(
  opts: RoutedRequest,
  callFn: (req: OpenRouterRequest) => Promise<OpenRouterResponse> = callOpenRouter
): Promise<OpenRouterResponse> {
  const { chain } = resolveChain(opts.label ?? "unknown");
  let lastError: Error | null = null;
  for (const model of chain) {
    try {
      return await callFn({ ...opts, model, temperature: opts.temperature ?? 0 });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error("callRouted: geen model in de keten");
}

// ── Layers: routeren op WAT VOOR SOORT WERK het is, niet op stapnummer ──────────────────────
//
// Additief naast het bestaande Tier-systeem hierboven, geen vervanging. De vijftien bestaande
// aanroepers van callRouted() blijven ongewijzigd op MODEL_CATALOG/TIER_CHAIN draaien -- een
// stilzwijgende overstap van al die productieroutes naar andere modellen (met andere kosten,
// latency en gedrag) hoort niet in dezelfde wijziging als "het endpoint klopt weer" te zitten.
//
// callLayer() is voor NIEUWE code (te beginnen bij de Fase 3-actiequeue) die per taaksoort een
// model kiest in plaats van per analysestap: Layer 1 (data/validatie) is geen LLM-aanroep en
// heeft dus geen entry -- dat blijft SQL/TypeScript, zie de vertrouwensdoctrine-regel "de LLM
// rekent niet" (EXECUTION_PLAN.md 1.6, ook hier van toepassing).
//
// Modelkeuze en prijzen: zie docs/ARCHITECTURE-MODEL-ROUTING.md.
export type Layer = "triage" | "reasoning" | "narrative" | "strategic";

export const LAYER_MODEL: Record<Layer, { primary: string; fallback: string }> = {
  // Snel, goedkoop filteren en categoriseren. Fallback is het duurdere model, niet andersom:
  // bij een fout op de goedkope route moet de sterkere Gemini het overnemen, niet nog een keer
  // dezelfde kostenklasse.
  triage: { primary: "google/gemini-2.5-flash-lite", fallback: "google/gemini-3.7-flash" },
  // Meerstaps redeneren en hypothesevorming.
  reasoning: { primary: "x-ai/grok-4.6", fallback: "google/gemini-3.7-flash" },
  // Klantgerichte tekst: claim-discipline en nuance wegen hier zwaarder dan snelheid.
  narrative: { primary: "anthropic/claude-sonnet-5", fallback: "google/gemini-3.7-flash" },
  // Alleen voor de zwaarste, zeldzaamste analyses (bv. God View); vandaag zonder consument --
  // God View heeft structureel te weinig bureaus om te draaien (zie MASTERPLAN.md sectie 12).
  strategic: { primary: "anthropic/claude-opus-5", fallback: "openai/gpt-5.6-sol" },
};

/**
 * Voert een LLM-call uit voor een gegeven laag: probeert het primaire model, valt bij een fout
 * terug op het laagspecifieke fallback-model. Zelfde fallback-vorm als callRouted(), maar
 * gekozen op taaksoort in plaats van op stapnummer.
 */
export async function callLayer(
  layer: Layer,
  opts: RoutedRequest,
  callFn: (req: OpenRouterRequest) => Promise<OpenRouterResponse> = callOpenRouter
): Promise<OpenRouterResponse> {
  const { primary, fallback } = LAYER_MODEL[layer];
  let lastError: Error | null = null;
  for (const model of [primary, fallback]) {
    try {
      return await callFn({ ...opts, model, temperature: opts.temperature ?? 0 });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error(`callLayer: geen model beschikbaar voor laag ${layer}`);
}

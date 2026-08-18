// Loop 5 (masterplan sectie 4, "de lus die niemand bouwt"): het daadwerkelijke
// terugkoppelingsstuk dat tot vandaag nergens bestond. Migratie 091 reserveerde het event-type
// `confidence_recalibrated` al met de eigen aantekening "dat vergt een kalibratieberekening die
// nog niet bestaat" -- dit bestand is die berekening.
//
// ── WAT DIT WEL EN NIET DOET ─────────────────────────────────────────────────────────────────
//
// Het stelt de ice_confidence van NIEUWE voorstellen bij op basis van de historische
// trefzekerheid van hun BRON (second_opinion, search_terms, master_synthesis, ... -- de 22
// ProposalSource-waarden uit findings-to-hypotheses.ts). Dat is de enige vandaag bestaande
// structurele proxy voor "signaaltype" uit het masterplan. Elke bron blijft apart -- er wordt
// nooit een gemiddelde over bronnen heen genomen, precies omdat second-opinion, search-terms en
// master-synthesis fundamenteel andere soorten voorstellen zijn met hun eigen betrouwbaarheid.
//
// Het doet NIET: drempels in decision-gating aanpassen, prompts aanpassen, of iets bij client-
// of bureau-specifieke data. De trefzekerheid wordt cross-bureau berekend (zelfde privacygrens
// als het masterplan voor loop 5 stelt: alleen trefzekerheid per signaaltype, geen onderliggende
// klantdata) -- een geaggregeerd percentage per bron is zelf al veilig, er is niets te
// anonimiseren dat een percentage niet al abstraheert.
//
// ── WAAROM EEN NUDGE, GEEN VERVANGING ────────────────────────────────────────────────────────
//
// De aangeleverde ice_confidence komt al ergens vandaan (bijv. confidenceToScore() in
// findings-to-hypotheses.ts, gebaseerd op de evaluator van DIT specifieke voorstel). Historische
// trefzekerheid van de BRON als geheel mag dat niet overschrijven -- het ene voorstel kan een
// uitschieter zijn binnen een verder betrouwbare bron. Vandaar een begrensde bijstelling
// (max ±2 op de 1-10-schaal), die groeit met de hoeveelheid bewijs (MIN_SAMPLE tot FULL_WEIGHT_
// SAMPLE) en bij precies 50% trefzekerheid geen enkel effect heeft -- 50/50 op een
// gehaald/gemist-uitkomst betekent dat de bron geen voorspellende waarde toevoegt boven kansniveau.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Onder deze hoeveelheid uitkomsten wordt een bron niet bijgesteld -- te weinig bewijs om op te
 *  varen, zelfde soort grens als de kwaliteitspoort elders in deze codebase hanteert. */
const MIN_SAMPLE = 5;
/** Vanaf deze hoeveelheid uitkomsten weegt de bijstelling voor 100% mee. */
const FULL_WEIGHT_SAMPLE = 20;
/** Maximale bijstelling in beide richtingen op de 1-10 ICE-confidence-schaal. */
const MAX_ADJUSTMENT = 2;

export interface SourceHitRate {
  source: string;
  totalMet: number;
  totalMissed: number;
  /** totalMet / (totalMet + totalMissed), 0-1. */
  hitRate: number;
  /** totalMet + totalMissed. */
  sampleSize: number;
}

interface OutcomeEventRow {
  event_type: string;
  sprint_hypotheses: { source: string } | { source: string }[] | null;
}

function extractSource(row: OutcomeEventRow): string | null {
  const rel = row.sprint_hypotheses;
  if (!rel) return null;
  const one = Array.isArray(rel) ? rel[0] : rel;
  return one?.source ?? null;
}

/**
 * Leest agency_memory_events + sprint_hypotheses.source (via de FK, zelfde embedded-select-
 * syntax als de rest van de codebase) en telt hypothesis_outcome_met/missed per bron op, cross-
 * bureau. Events zonder gekoppelde hypothese (hypothesis_id is op ON DELETE SET NULL gezet) tellen
 * niet mee -- er is dan geen bron meer aan te herleiden, en gokken zou de kalibratie vervuilen.
 */
export async function computeSourceHitRates(supabase: SupabaseClient): Promise<Map<string, SourceHitRate>> {
  const { data, error } = await supabase
    .from("agency_memory_events")
    .select("event_type, sprint_hypotheses(source)")
    .in("event_type", ["hypothesis_outcome_met", "hypothesis_outcome_missed"]);

  const counts = new Map<string, { met: number; missed: number }>();
  if (error || !data) return new Map();

  for (const row of data as unknown as OutcomeEventRow[]) {
    const source = extractSource(row);
    if (!source) continue;
    const entry = counts.get(source) ?? { met: 0, missed: 0 };
    if (row.event_type === "hypothesis_outcome_met") entry.met += 1;
    else if (row.event_type === "hypothesis_outcome_missed") entry.missed += 1;
    counts.set(source, entry);
  }

  const result = new Map<string, SourceHitRate>();
  for (const [source, { met, missed }] of counts) {
    const sampleSize = met + missed;
    result.set(source, { source, totalMet: met, totalMissed: missed, hitRate: sampleSize > 0 ? met / sampleSize : 0, sampleSize });
  }
  return result;
}

export interface CalibrationResult {
  confidence: number;
  applied: boolean;
  /** Leesbare reden, alleen gezet als applied true is -- voor het confidence_recalibrated-event
   *  en voor een eventuele UI-toelichting. */
  detail: string | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Stelt één ice_confidence-waarde bij op basis van de trefzekerheid van zijn bron. Puur,
 * geen IO -- computeSourceHitRates() haalt de data op, dit bepaalt wat ermee gebeurt.
 *
 * Bij hitRate === 0.5 (of te weinig steekproef): geen effect. Bij hitRate 1.0 met voldoende
 * steekproef: +MAX_ADJUSTMENT. Bij hitRate 0.0: -MAX_ADJUSTMENT. Ertussenin lineair, geschaald
 * naar de hoeveelheid bewijs (sampleSize tussen MIN_SAMPLE en FULL_WEIGHT_SAMPLE).
 */
export function calibrateConfidence(baseConfidence: number, hitRate: SourceHitRate | undefined): CalibrationResult {
  if (!hitRate || hitRate.sampleSize < MIN_SAMPLE) {
    return { confidence: baseConfidence, applied: false, detail: null };
  }
  const weight = Math.min(1, hitRate.sampleSize / FULL_WEIGHT_SAMPLE);
  const delta = (hitRate.hitRate - 0.5) * 2 * MAX_ADJUSTMENT * weight;
  if (delta === 0) return { confidence: baseConfidence, applied: false, detail: null };

  const calibrated = Math.min(10, Math.max(1, round1(baseConfidence + delta)));
  const pct = Math.round(hitRate.hitRate * 100);
  const richting = delta > 0 ? "verhoogd" : "verlaagd";
  return {
    confidence: calibrated,
    applied: calibrated !== baseConfidence,
    detail: `Confidence ${richting} o.b.v. ${hitRate.sampleSize} eerdere uitkomsten van bron "${hitRate.source}" (${pct}% trefzeker).`,
  };
}

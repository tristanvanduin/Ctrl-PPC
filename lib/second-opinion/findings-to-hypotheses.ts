// ============================================================
// SI2: second-opinion-bevindingen -> goedkeuringswachtrij
// ------------------------------------------------------------
// De deterministische second-opinion produceert een audit-scorekaart.
// De andere analyses voeden hun voorstellen in sprint_hypotheses (de
// goedkeuringswachtrij: observeren, voorstellen, goedkeuren, uitvoeren,
// evalueren). Deze mapping laat een Onvoldoende-bevinding daar ook landen,
// als voorgestelde actie met status pending.
//
// De ICE-score is niet arbitrair: impact en complexity staan al per
// controlepunt in het audit-template, en de evaluator levert een confidence.
// Die mappen direct op de ICE-schaal 1-10 (totaal = (I + C + E) / 3).
// Bewust deterministisch: geen LLM-call, zodat de second-opinion
// deterministisch blijft en de mapping volledig testbaar is.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditRowResult } from "./types";
import type { Impact, Complexity } from "./template";
import { logger } from "@/lib/logger";
import { recordMemoryEvent } from "@/lib/memory/agency-memory-events";
import { computeSourceHitRates, calibrateConfidence, type SourceHitRate } from "@/lib/learning/signal-calibration";

export interface SprintHypothesisRow {
  client_id: string;
  analysis_id: string | null;
  hypothesis: string;
  expected_result: string;
  measurement_metric: string;
  timeframe: string;
  rationale: string;
  ice_impact: number;
  ice_confidence: number;
  ice_ease: number;
  ice_total: number;
  status: "pending";
  source: ProposalSource;
  // Migratie 088: structured metadata naast rationale (die de leesbare onderbouwing draagt en
  // dus niet overschreven mag worden). Optioneel: elke bron behalve master_synthesis laat dit
  // weg, dan blijft de kolom null -- geen bestaande schrijfweg hoeft dit veld te kennen.
  metadata?: Record<string, unknown> | null;
}

// Impact/complexity/confidence -> ICE-schaal 1-10.
function impactToScore(impact: Impact): number {
  return impact === "Hoog" ? 8 : impact === "Midden" ? 5 : 2;
}
// Complexer betekent minder makkelijk: Simpel hoog, Complex laag.
function complexityToEase(complexity: Complexity): number {
  return complexity === "Simpel" ? 8 : complexity === "Midden" ? 5 : 2;
}
function confidenceToScore(confidence: AuditRowResult["confidence"]): number {
  return confidence === "high" ? 8 : confidence === "medium" ? 5 : 2;
}
// Complexere fixes krijgen een langer tijdvak.
function complexityToTimeframe(complexity: Complexity): string {
  return complexity === "Simpel" ? "1 week" : complexity === "Midden" ? "2 weken" : "4 weken";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Zet de Onvoldoende-bevindingen om in voorgestelde-actie-rijen.
 * Houdt rekening met handmatige overrides (overrideScore en overrideComments gaan voor).
 * Voldoende- en hogere scores worden bewust niet omgezet: de wachtrij blijft de echte problemen.
 */
export function auditFindingsToHypotheses(
  findings: AuditRowResult[],
  opts: { clientId: string; analysisId: string }
): SprintHypothesisRow[] {
  const rows: SprintHypothesisRow[] = [];

  for (const f of findings) {
    const effectiveScore = f.overrideScore ?? f.score;
    if (effectiveScore !== "Onvoldoende") continue;

    const rationale = (f.overrideComments ?? f.comments ?? "").trim();
    const impact = impactToScore(f.impact);
    const confidence = confidenceToScore(f.confidence);
    const ease = complexityToEase(f.complexity);

    rows.push({
      client_id: opts.clientId,
      analysis_id: opts.analysisId,
      hypothesis: `Second opinion verbeterpunt in ${f.section}: ${f.controlPoint}`,
      expected_result: "Dit controlepunt verbetert van Onvoldoende naar minimaal Voldoende bij de volgende beoordeling.",
      measurement_metric: "Herbeoordeling van dit controlepunt in de second opinion.",
      timeframe: complexityToTimeframe(f.complexity),
      rationale: rationale.length > 0 ? rationale : `Controlepunt scoort Onvoldoende in de ${f.section}-sectie.`,
      ice_impact: impact,
      ice_confidence: confidence,
      ice_ease: ease,
      ice_total: round1((impact + confidence + ease) / 3),
      status: "pending",
      source: "second_opinion",
    });
  }

  // Hoogste ICE bovenaan, gelijk aan de sortering van de overige hypotheses.
  rows.sort((a, b) => b.ice_total - a.ice_total);
  return rows;
}

/**
 * Mapt de bevindingen en schrijft ze als pending voorstellen in sprint_hypotheses.
 * Aanroepen waar een second-opinion-run compleet is (findings, supabase, clientId en
 * de run-id beschikbaar). Geeft het aantal weggeschreven voorstellen terug.
 */
// SI6: "analysis" is de maandpipeline zelf (extract-structured). Alle drie de bronnen
// lopen nu via saveProposalsReplacingPending, zodat er EEN schrijfpad is met dezelfde
// veilige semantiek (insert voor delete, geaccepteerde voorstellen blijven staan).
// SI7: de losse Google-analyses voeden nu ook de wachtrij, elk via een eigen bron zodat de
// "vervang alleen mijn eigen pending"-semantiek per analyse geldt (een nieuwe budget-run
// ververst alleen budget-voorstellen, niet die van de biedstrategie).
export type ProposalSource =
  | "second_opinion"
  | "search_terms"
  | "analysis"
  | "budget_allocation"
  | "bid_strategy"
  | "impression_share"
  | "rsa_insights"
  | "landing_audit"
  | "meta_signals"
  | "linkedin_signals"
  | "cross_channel"
  | "geo_clone"
  | "linkedin_icp"
  | "meta_funnel"
  | "linkedin_funnel"
  | "google_funnel"
  | "quality_score"
  | "google_kpi"
  | "meta_kpi"
  | "linkedin_kpi"
  | "google_video"
  | "geo_markets"
  | "master_synthesis"
  // De zes weekly-/bi-weekly-varianten. Ze schreven alle zes onder "analysis" -- de bron van de
  // MAANDpijplijn -- en saveProposalsReplacingPending verwijdert bij elke schrijfbeurt de bestaande
  // pending-rijen van diezelfde bron. Zes varianten die om beurten elkaars openstaande voorstellen
  // wisten, dus alleen de laatst gedraaide hield iets over. De 22 kleinere deelanalyses hierboven
  // kregen juist élk een eigen bron om precies dat te voorkomen; dit sluit de uitzondering.
  //
  // De namen zijn de sop_type-waarden zelf, conform het patroon dat
  // app/api/insights/monthly-hypotheses/route.ts al hanteert: `sopType === "monthly" ? "analysis" : sopType`.
  | "weekly"
  | "meta_weekly"
  | "linkedin_weekly"
  | "biweekly"
  | "meta_biweekly"
  | "linkedin_biweekly"
  // Het vierde kanaal. Anders dan bij de drie oorspronkelijke kanalen draagt hier OOK de maand
  // zijn eigen sop_type als bron: "analysis" is historisch de GOOGLE-maandbron (zo leest de
  // wachtrij-uitsluiting hem), en een nieuw kanaal hoort daar niet stil onder te schuilen.
  | "microsoft_weekly"
  | "microsoft_biweekly"
  | "microsoft_monthly"
  // De Microsoft-variant van de KPI-verhoudingen-analyse (app/api/analysis/kpi-relations),
  // zelfde patroon als google_kpi/meta_kpi/linkedin_kpi hierboven.
  | "microsoft_kpi";

/**
 * De voorstellenbron van een SOP-variant.
 *
 * Eén definitie, want de regel bestond op twee plekken: app/api/insights/monthly-hypotheses/
 * route.ts had hem al als inline ternary, en lib/analysis/extract-structured.ts kreeg hem er bijna
 * bij. Precies het soort tweede definitie van een gedeeld hulpje dat scripts/check-hygiene.mjs
 * vangt -- en hier telt het extra, want als de twee ooit uiteenlopen schrijft de ene helft van de
 * keten onder een andere bron dan de andere, en dan wist de een de voorstellen van de ander.
 *
 * "analysis" is en blijft de MAANDpijplijn; components/insights/proposal-queue.tsx sluit precies
 * die bron uit omdat de maand zijn eigen workflow-block heeft. Elke andere variant draagt zijn
 * eigen sop_type als bron, en verschijnt dus wél in de wachtrij.
 */
export function proposalSourceForSopType(sopType: string): ProposalSource {
  return (sopType === "monthly" ? "analysis" : sopType) as ProposalSource;
}

/**
 * Schrijft nieuwe pending voorstellen weg en vervangt de oude van dezelfde bron,
 * veilig zonder transactie. De volgorde is cruciaal: eerst de bestaande pending-ids
 * vastleggen, dan de nieuwe inserten, en de oude pas verwijderen als de insert is
 * geslaagd. Een mislukte insert verliest daardoor nooit pending voorstellen; in het
 * ergste geval blijven er dubbelen staan die de volgende run opruimt (zelfherstellend).
 * Geaccepteerde, afgewezen en afgeronde voorstellen blijven altijd staan; dat zijn al
 * genomen beslissingen.
 */
export async function saveProposalsReplacingPending(
  supabase: SupabaseClient,
  clientId: string,
  source: ProposalSource,
  rows: SprintHypothesisRow[]
): Promise<number> {
  // 1. Leg de bestaande pending-ids van deze bron vast voordat we iets wijzigen.
  const existing = await supabase
    .from("sprint_hypotheses")
    .select("id")
    .eq("client_id", clientId)
    .eq("source", source)
    .eq("status", "pending");
  if (existing.error) {
    logger.error("[" + source + "] Kon bestaande voorstellen niet lezen, schrijf overgeslagen:", existing.error.message);
    return 0; // niets gewijzigd, oude pending intact
  }
  const oldIds = ((existing.data ?? []) as { id: string }[]).map((r) => r.id);

  // 2. Geen nieuwe voorstellen: alleen de stale pending opschonen (verversen).
  if (rows.length === 0) {
    if (oldIds.length > 0) {
      const del = await supabase.from("sprint_hypotheses").delete().in("id", oldIds);
      if (del.error) logger.error("[" + source + "] Kon stale voorstellen niet opschonen:", del.error.message);
    }
    return 0;
  }

  // Loop 5 (lib/learning/signal-calibration.ts): dit is de ene, echte schrijfplek voor alle 22
  // bronnen, dus hier en nergens anders wordt de ice_confidence bijgesteld op basis van de
  // historische trefzekerheid van deze bron. Zacht falend: gaat de kalibratie-query mis, dan
  // draait de rest van deze functie gewoon door met de ongewijzigde confidence -- een kapotte
  // kalibratie mag nooit een echt voorstel laten verdwijnen.
  let hitRates: Map<string, SourceHitRate>;
  try {
    hitRates = await computeSourceHitRates(supabase);
  } catch (err) {
    logger.error("[" + source + "] Kalibratie ophalen mislukt, confidence blijft ongewijzigd:", err instanceof Error ? err.message : String(err));
    hitRates = new Map();
  }
  const calibrations = rows.map((row) => calibrateConfidence(row.ice_confidence, hitRates.get(row.source)));
  const calibratedRows = rows.map((row, i) => {
    const cal = calibrations[i];
    if (!cal.applied) return row;
    // metadata is generiek (Record<string, unknown>, migratie 088); mergen i.p.v. overschrijven
    // zodat een bestaande master_synthesis-metadata-sleutel op deze rij intact blijft. De UI
    // (components/insights/proposal-queue.tsx) leest confidence_recalibration rechtstreeks uit
    // deze kolom -- geen extra join met agency_memory_events nodig om het te tonen.
    return {
      ...row,
      ice_confidence: cal.confidence,
      ice_total: round1((row.ice_impact + cal.confidence + row.ice_ease) / 3),
      metadata: { ...(row.metadata ?? {}), confidence_recalibration: { base: row.ice_confidence, calibrated: cal.confidence, detail: cal.detail } },
    };
  });

  // 3. Insert de nieuwe voorstellen. .select("id") is nodig om de gegenereerde ids terug te
  // krijgen voor de memory-events hieronder -- verandert het schrijfgedrag zelf niet.
  const ins = await supabase.from("sprint_hypotheses").insert(calibratedRows).select("id");
  if (ins.error) {
    logger.error("[" + source + "] Kon voorstellen niet opslaan, oude blijven staan:", ins.error.message);
    return 0; // insert mislukt: oude pending intact, geen verlies
  }

  // Fase 4: één hypothesis_proposed-event per nieuw voorstel. Zacht falend (recordMemoryEvent
  // logt zelf), dus een mislukt geheugen-event verliest nooit een echt opgeslagen voorstel.
  // .insert().select() geeft de rijen terug in insert-volgorde (PostgREST, één statement) --
  // zelfde aanname als hierboven al gold, hier ook gebruikt om calibrations[i] bij ins.data[i]
  // te houden voor het confidence_recalibrated-event.
  const insertedIds = (ins.data ?? []) as { id: string }[];
  await Promise.all(
    insertedIds.map((row, i) => {
      const events: Promise<void>[] = [recordMemoryEvent(supabase, { clientId, hypothesisId: row.id, eventType: "hypothesis_proposed" })];
      const cal = calibrations[i];
      if (cal.applied && cal.detail) {
        events.push(recordMemoryEvent(supabase, {
          clientId, hypothesisId: row.id, eventType: "confidence_recalibrated", reason: cal.detail,
          metrics: { source, base_confidence: rows[i].ice_confidence, calibrated_confidence: cal.confidence },
        }));
      }
      return Promise.all(events);
    })
  );

  // 4. Insert geslaagd: verwijder nu pas de oude pending. Faalt dit, dan blijven
  // dubbelen staan die de volgende run opruimt, nog steeds geen verlies.
  if (oldIds.length > 0) {
    const del = await supabase.from("sprint_hypotheses").delete().in("id", oldIds);
    if (del.error) logger.error("[" + source + "] Nieuwe voorstellen opgeslagen, oude opschonen mislukt (volgende run ruimt op):", del.error.message);
  }
  return rows.length;
}

/**
 * Mapt de bevindingen en schrijft ze veilig als pending voorstellen in sprint_hypotheses,
 * en vervangt de vorige pending van second_opinion. Geeft het aantal weggeschreven
 * voorstellen terug.
 */
export async function saveAuditFindingsAsHypotheses(
  supabase: SupabaseClient,
  findings: AuditRowResult[],
  opts: { clientId: string; analysisId: string }
): Promise<number> {
  const rows = auditFindingsToHypotheses(findings, opts);
  return saveProposalsReplacingPending(supabase, opts.clientId, "second_opinion", rows);
}

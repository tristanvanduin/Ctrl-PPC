// Fase 2, Task 4 (Decision Terminal): pure afleidingen op sprint_hypotheses-rijen. Geen IO, geen
// component-code -- alleen wat een hypothese-rij betekent, zodat het board, de attribution view
// en de tests dezelfde ene waarheid gebruiken in plaats van elk hun eigen aanname.
//
// Het Decision Board hergebruikt sprint_hypotheses (de bestaande, persistente tabel) in plaats
// van een nieuwe tabel voor de Decision Core-signalen: die laatste worden vers per request
// berekend (lib/decision/decision-skeleton.ts) en nergens opgeslagen, dus er is geen
// levenscyclus om te tonen. sprint_hypotheses heeft die levenscyclus al, inclusief de
// uitvoerings- en verdictwaarden uit de H1-evaluator.

export interface HypothesisRecord {
  id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  status: string;
  source: string | null;
  ice_total: number | null;
  created_at: string;
  accepted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  outcome: string | null;
  result_met: boolean | null;
  learning: string | null;
  verdict_metrics: unknown;
  evaluated_at: string | null;
}

export type LifecycleStage =
  | "propose"
  | "accepted"
  | "rejected"
  | "executed_gehaald"
  | "executed_niet_gehaald"
  | "niet_uitgevoerd"
  | "evaluated_onbekend"
  | "completed";

export interface LifecycleInfo {
  stage: LifecycleStage;
  label: string;
}

// De vier board-kolommen uit de opdracht (Propose/Accepted/Executed/Evaluated) zijn hier
// verfijnd naar wat de data ECHT onderscheidt: "Executed" splitst in gehaald/niet gehaald (dat
// is precies het onderscheid dat de H1-evaluator net kreeg), en "niet uitgevoerd" is een eigen
// stadium, geen synoniem van afgewezen of geevalueerd. Een board dat dat verschil wegmoffelt
// verliest exact de les waar de attributielus voor gebouwd is.
export function lifecycleOf(h: HypothesisRecord): LifecycleInfo {
  if (h.status === "rejected") return { stage: "rejected", label: "Afgewezen" };
  if (h.status === "completed") return { stage: "completed", label: "Afgerond" };
  if (h.status !== "accepted") return { stage: "propose", label: "Voorstel" };

  if (!h.evaluated_at) return { stage: "accepted", label: "Geaccepteerd, wacht op evaluatie" };

  switch (h.outcome) {
    case "uitgevoerd_en_gehaald":
      return { stage: "executed_gehaald", label: "Uitgevoerd: doel gehaald" };
    case "uitgevoerd_en_niet_gehaald":
      return { stage: "executed_niet_gehaald", label: "Uitgevoerd: doel niet gehaald" };
    case "niet_uitgevoerd":
      return { stage: "niet_uitgevoerd", label: "Niet uitgevoerd" };
    case "expired":
      return { stage: "evaluated_onbekend", label: "Geevalueerd: verlopen zonder oordeel" };
    case "unmeasurable":
      return { stage: "evaluated_onbekend", label: "Geevalueerd: niet meetbaar" };
    default:
      // Oudere of onbekende outcome-waarde: geen gok, terugvallen op result_met als die er is.
      if (h.result_met === true) return { stage: "executed_gehaald", label: "Uitgevoerd: doel gehaald" };
      if (h.result_met === false) return { stage: "executed_niet_gehaald", label: "Uitgevoerd: doel niet gehaald" };
      return { stage: "evaluated_onbekend", label: "Geevalueerd" };
  }
}

export interface Provenance {
  /** "AI (bron)" als de hypothese uit een analysepijplijn komt, anders "Handmatig". Er is geen
   *  aparte created_via-kolom (zie het gesprek over Adlyse's edit-provenance): dit is de
   *  eerlijkste benadering met wat er vandaag bestaat. */
  bedenker: string;
  /** Laatste beslismoment: decided_at (de nieuwe beslislaag) valt terug op accepted_at (het
   *  oudere pad zonder decided_at), en anders created_at. */
  wanneer: string | null;
}

export function provenanceOf(h: HypothesisRecord): Provenance {
  return {
    bedenker: h.source ? `AI (${h.source})` : "Handmatig",
    wanneer: h.decided_at ?? h.accepted_at ?? h.created_at ?? null,
  };
}

export interface MetricSnapshot {
  metric: string;
  baseline: number | null;
  measured: number | null;
  delta: number | null;
  met: boolean | null;
}

/** Puurt de baseline/measured/delta uit verdict_metrics (jsonb, geschreven door de H1-evaluator
 *  als MetricJudgment[]). Onherkenbare of lege inhoud levert een lege lijst, geen crash. */
export function metricSnapshotsOf(verdictMetrics: unknown): MetricSnapshot[] {
  if (!Array.isArray(verdictMetrics)) return [];
  const out: MetricSnapshot[] = [];
  for (const ruw of verdictMetrics) {
    if (!ruw || typeof ruw !== "object") continue;
    const r = ruw as Record<string, unknown>;
    if (typeof r.metric !== "string") continue;
    out.push({
      metric: r.metric,
      baseline: typeof r.baseline === "number" ? r.baseline : null,
      measured: typeof r.measured === "number" ? r.measured : null,
      delta: typeof r.delta === "number" ? r.delta : null,
      met: typeof r.met === "boolean" ? r.met : null,
    });
  }
  return out;
}

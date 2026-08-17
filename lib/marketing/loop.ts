// The Signal -> Hypothesis -> Quality Gate -> Execution -> Attribution -> Agency Memory loop: the
// real product mechanism, not the marketing framing of it. Every claim here is checked against the
// actual pipeline (11 August 2026) rather than written from the AI-generated reference diagrams the
// user shared -- those were explicitly "not to be used literally," and cross-checking against the
// real lib/decision/ code turned up two claims in them that do not hold:
//
// 1. "God View" sits in the reference images' Learning ring. That is a separate, unbuilt,
//    cross-AGENCY concept (lib/marketing/modules.ts marks it gebouwd: false, with its own comment
//    explaining it is materially bigger than what exists). It has nothing to do with this loop,
//    which is per-account, and is left out entirely rather than folded in.
// 2. "Pattern Intelligence" / automatic learning implies the engine applies past outcomes to
//    future hypotheses on its own. Checked lib/decision/hypothesis-discovery.ts and
//    signal-hypothesis-discovery.ts: neither reads the `learning` field lifecycle.ts stores per
//    hypothesis. The outcome and learning ARE recorded, and ARE visible on the Decision Board
//    (components/terminal/hypothesis-board.tsx) for the next decision a person makes -- that is
//    real and worth saying. "The engine learns automatically" is not built yet, same category as
//    Agency Memory's automatic cross-client propagation, and gets the same honest treatment here.
//
// STAGE NAMES (second pass, same day): originally Data/Analyse/Decision/Execution/Evaluation/
// Learning. Flagged as inconsistent with components/marketing/execution-node.tsx, the compact
// homepage teaser for this exact same loop, which already shipped with Signal/Hypothesis/Quality
// gate/Execution/Attribution/Agency memory. Renamed to match rather than inventing a third
// vocabulary -- and it is not a pure relabel: the original six did not segment the same way
// (Decision covered both hypothesis formation and the nine gates as one stage; there was no
// standalone Hypothesis stage). Resegmented to genuinely be the same six steps as ExecutionNode,
// not just six different words wrapped around a different split.

export interface LoopStage {
  id: string;
  stap: string;
  naam: string;
  pitch: string;
  detail: string;
  /** Wat dit stadium ECHT is in de codebase, voor wie doorklikt of het narekent. */
  gegrond: string;
}

export const LOOP_STAGES: LoopStage[] = [
  {
    id: "signal",
    stap: "01",
    naam: "Signal",
    pitch: "Every account, every channel, read automatically.",
    detail:
      "Google Ads, Meta, and LinkedIn sync into a single structure, alongside GA4 where it is connected. Expert layers scan what comes in for the things a standard report does not separate out: impression share lost to budget versus rank, CPA drift by segment, pacing against forecast.",
    gegrond: "lib/api/google-ads.ts, lib/sync/orchestrator.ts, lib/analysis/expert-layers.ts, lib/fair/",
  },
  {
    id: "hypothesis",
    stap: "02",
    naam: "Hypothesis",
    pitch: "A concrete, measurable prediction. Not a vague suggestion.",
    detail:
      "Every hypothesis carries an expected result, a measurement metric, and a timeframe before it goes anywhere else in the loop -- a specific, testable claim, not \"consider raising bids.\"",
    gegrond: "sprint_hypotheses (expected_result, measurement_metric, timeframe), hypothesis-discovery.ts",
  },
  {
    id: "quality-gate",
    stap: "03",
    naam: "Quality Gate",
    pitch: "Every hypothesis clears 9 named gates before it reaches you.",
    detail:
      "Data Quality, Math, Evidence, Causal Chain, Contradiction, Step Purity, Coverage, Sprint Readiness, Publish. One failure is enough to block it. Nothing reaches your inbox as a recommendation without clearing all nine.",
    gegrond: "lib/decision/quality-gates.ts (GATES)",
  },
  {
    id: "execution",
    stap: "04",
    naam: "Execution",
    pitch: "You execute. We never touch your accounts.",
    detail:
      "An accepted hypothesis becomes a sprint task with an expected result and a measurement window. Whoever runs the account makes the actual change themselves, in Google Ads, Meta, or LinkedIn.",
    gegrond: "sprint_hypotheses, sprint_items, task_completions",
  },
  {
    id: "attribution",
    stap: "05",
    naam: "Attribution",
    pitch: "Change history, not a coincidence, confirms what happened.",
    detail:
      "The platform's own change history is matched against the measurement window. Executed and on target, executed and missed, or never executed at all -- three different outcomes, not one blended \"did it work.\"",
    gegrond: "ads_change_history, lib/decision-terminal/lifecycle.ts (outcome)",
  },
  {
    id: "agency-memory",
    stap: "06",
    naam: "Agency Memory",
    pitch: "Every outcome is recorded, for the next decision.",
    detail:
      "What worked and what did not is stored against the hypothesis and stays visible on the Decision Board. That closes the loop back to the next signal -- a person deciding with the last result in view, not a blank slate.",
    gegrond: "lifecycle.ts (learning field), components/terminal/hypothesis-board.tsx",
  },
];

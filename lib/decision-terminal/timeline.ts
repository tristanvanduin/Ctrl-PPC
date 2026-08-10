// Fase 2, Task 4 (Decision Terminal): het Decision Log is een samengevoegde, chronologische feed
// van accountwijzigingen (ads_change_history, via change-history-classifier.ts) en
// hypothese-mijlpalen (geaccepteerd, geevalueerd). Puur samenvoegen en sorteren, geen IO.

import type { ChangeEvent } from "../learning/hypothesis-evaluator";
import { lifecycleOf, type HypothesisRecord } from "./lifecycle";

export type TimelineEntryKind = "change" | "hypothesis_accepted" | "hypothesis_evaluated";

export interface TimelineEntry {
  date: string; // YYYY-MM-DD
  kind: TimelineEntryKind;
  label: string;
  detail: string;
}

/** ISO-datum (met of zonder tijd) naar YYYY-MM-DD. Onbruikbare invoer levert null, geen gok op
 *  een datum die er niet stond. */
function naarDagDatum(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dag = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dag) ? dag : null;
}

export function buildTimeline(changes: ChangeEvent[], hypotheses: HypothesisRecord[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const c of changes) {
    const dag = naarDagDatum(c.date);
    if (!dag) continue;
    entries.push({ date: dag, kind: "change", label: `${c.type} op ${c.entity}`, detail: c.detail ?? "" });
  }

  for (const h of hypotheses) {
    const geaccepteerd = naarDagDatum(h.accepted_at);
    if (geaccepteerd) {
      entries.push({
        date: geaccepteerd,
        kind: "hypothesis_accepted",
        label: `Hypothese geaccepteerd: ${h.hypothesis.slice(0, 60)}`,
        detail: h.hypothesis,
      });
    }
    const geevalueerd = naarDagDatum(h.evaluated_at);
    if (geevalueerd) {
      entries.push({
        date: geevalueerd,
        kind: "hypothesis_evaluated",
        label: `Hypothese geevalueerd: ${lifecycleOf(h).label}`,
        detail: h.learning ?? "",
      });
    }
  }

  // Nieuwste eerst. localeCompare op YYYY-MM-DD-strings sorteert chronologisch correct.
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

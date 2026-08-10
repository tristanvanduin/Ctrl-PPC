"use client";

import { Loader2, GitCommitHorizontal, CheckCircle2, FlaskConical } from "lucide-react";
import type { TimelineEntry, TimelineEntryKind } from "@/lib/decision-terminal/timeline";

// Fase 2, Task 4: het Decision Log. Een chronologische feed die accountwijzigingen
// (ads_change_history) koppelt aan hypothese-mijlpalen (geaccepteerd, geevalueerd). Puur
// weergave; de samenvoeging zelf staat in lib/decision-terminal/timeline.ts.

const KIND_ICON: Record<TimelineEntryKind, React.ReactNode> = {
  change: <GitCommitHorizontal className="h-3.5 w-3.5" />,
  hypothesis_accepted: <FlaskConical className="h-3.5 w-3.5" />,
  hypothesis_evaluated: <CheckCircle2 className="h-3.5 w-3.5" />,
};

const KIND_LABEL: Record<TimelineEntryKind, string> = {
  change: "Accountwijziging",
  hypothesis_accepted: "Hypothese geaccepteerd",
  hypothesis_evaluated: "Hypothese geevalueerd",
};

const KIND_COLOR: Record<TimelineEntryKind, string> = {
  change: "text-rm-gray",
  hypothesis_accepted: "text-blue-600",
  hypothesis_evaluated: "text-emerald-600",
};

function formatDag(dag: string): string {
  return new Date(`${dag}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

export function DecisionLog({ entries, loading }: { entries: TimelineEntry[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-rm-blue-ink" />
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <p className="py-8 text-center text-body text-muted-foreground">Geen wijzigingen of mijlpalen gevonden voor deze klant.</p>;
  }

  return (
    <div className="terminal space-y-1">
      {entries.map((e, i) => (
        <div key={`${e.date}-${i}`} className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <span className={`mt-0.5 shrink-0 ${KIND_COLOR[e.kind]}`}>{KIND_ICON[e.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[e.kind]}</span>
              <span className="teller-waarde text-micro text-muted-foreground">{formatDag(e.date)}</span>
            </div>
            <p className="truncate text-body text-rm-gray">{e.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

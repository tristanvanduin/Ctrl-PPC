"use client";

import { Loader2, ArrowRight } from "lucide-react";
import { lifecycleOf, metricSnapshotsOf, provenanceOf, type HypothesisRecord } from "@/lib/decision-terminal/lifecycle";

// Fase 2, Task 4: de Attribution View. Toont de compounding engine (H1-evaluator) per
// geevalueerde hypothese: wat werd verwacht, wat was de baseline, wat werd gemeten, en of de
// interventie uberhaupt is uitgevoerd (ads_change_history). De delta tussen "voorgesteld" en
// "werkelijk uitgevoerd" is de kern -- niet alleen of het doel gehaald is, maar of de vergelijking
// uberhaupt geldig was.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 }).format(v);

function MetricRij({ metric, baseline, measured, delta, met }: { metric: string; baseline: number | null; measured: number | null; delta: number | null; met: boolean | null }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-body">
      <span className="text-brand-gray">{metric}</span>
      <div className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <span className="teller-waarde">{baseline != null ? eur(baseline) : "onbekend"}</span>
        <ArrowRight className="h-3 w-3" />
        <span className="teller-waarde font-semibold text-brand-gray">{measured != null ? eur(measured) : "onbekend"}</span>
      </div>
      <span className="teller-waarde text-meta text-muted-foreground">{delta != null ? (delta > 0 ? `+${eur(delta)}` : eur(delta)) : ""}</span>
      <span className={`text-micro font-medium ${met === true ? "text-emerald-600" : met === false ? "text-red-600" : "text-muted-foreground"}`}>
        {met === true ? "gehaald" : met === false ? "gemist" : ""}
      </span>
    </div>
  );
}

function AttributionCard({ h }: { h: HypothesisRecord }) {
  const lifecycle = lifecycleOf(h);
  const prov = provenanceOf(h);
  const snapshots = metricSnapshotsOf(h.verdict_metrics);

  return (
    <div className="terminal rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-body font-medium text-brand-gray">{h.hypothesis}</p>
        <span className="shrink-0 text-micro font-medium text-muted-foreground">{lifecycle.label}</span>
      </div>
      {h.expected_result && (
        <p className="mb-2 text-meta text-muted-foreground">Voorgesteld: <span className="text-brand-gray">{h.expected_result}</span></p>
      )}
      {snapshots.length > 0 && (
        <div className="mb-2 space-y-1 border-y border-border py-2">
          {snapshots.map((s) => <MetricRij key={s.metric} {...s} />)}
        </div>
      )}
      {h.learning && <p className="text-meta text-muted-foreground">{h.learning}</p>}
      <p className="mt-1.5 text-micro text-muted-foreground/70">Bedacht door: {prov.bedenker}</p>
    </div>
  );
}

export function AttributionView({ hypotheses, loading }: { hypotheses: HypothesisRecord[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-brand-blue-ink" />
      </div>
    );
  }
  const geevalueerd = (hypotheses ?? []).filter((h) => h.evaluated_at);
  if (geevalueerd.length === 0) {
    return <p className="py-8 text-center text-body text-muted-foreground">Nog geen geevalueerde hypotheses voor deze klant.</p>;
  }
  return (
    <div className="terminal space-y-3">
      {geevalueerd.map((h) => <AttributionCard key={h.id} h={h} />)}
    </div>
  );
}

"use client";

import { Loader2 } from "lucide-react";
import { lifecycleOf, provenanceOf, type HypothesisRecord, type LifecycleStage } from "@/lib/decision-terminal/lifecycle";

// Fase 2, Task 4: het Hypothesis Board. Hergebruikt sprint_hypotheses (de bestaande, persistente
// tabel) in plaats van de Decision Core-signalen: die laatste worden vers per request berekend
// en nergens opgeslagen, dus er is geen levenscyclus om te tonen. sprint_hypotheses heeft die
// levenscyclus al, inclusief de uitvoeringsstatus uit de H1-evaluator.

const STAGE_STYLE: Record<LifecycleStage, string> = {
  propose: "border-blue-200 bg-blue-50 text-blue-700",
  accepted: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-gray-200 bg-gray-50 text-gray-600",
  executed_gehaald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  executed_niet_gehaald: "border-red-200 bg-red-50 text-red-700",
  niet_uitgevoerd: "border-orange-200 bg-orange-50 text-orange-700",
  evaluated_onbekend: "border-gray-200 bg-gray-50 text-gray-600",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function formatWanneer(iso: string | null): string {
  if (!iso) return "onbekend";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function HypothesisCard({ h }: { h: HypothesisRecord }) {
  const lifecycle = lifecycleOf(h);
  const prov = provenanceOf(h);
  return (
    <div className="terminal rounded-lg border border-border bg-card p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-micro font-medium ${STAGE_STYLE[lifecycle.stage]}`}>
          {lifecycle.label}
        </span>
        <span className="teller-waarde text-micro text-muted-foreground">{formatWanneer(prov.wanneer)}</span>
      </div>
      <p className="text-body text-rm-gray leading-snug">{h.hypothesis}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
        <span>Bedacht door: {prov.bedenker}</span>
        {h.measurement_metric && <span>Metric: {h.measurement_metric}</span>}
        {h.expected_result && <span className="truncate">Verwacht: {h.expected_result}</span>}
      </div>
    </div>
  );
}

const KOLOMMEN: { stages: LifecycleStage[]; titel: string }[] = [
  { stages: ["propose"], titel: "Voorstel" },
  { stages: ["accepted"], titel: "Geaccepteerd" },
  { stages: ["executed_gehaald", "executed_niet_gehaald", "niet_uitgevoerd"], titel: "Uitgevoerd" },
  { stages: ["evaluated_onbekend", "rejected", "completed"], titel: "Geevalueerd" },
];

export function HypothesisBoard({ hypotheses, loading }: { hypotheses: HypothesisRecord[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-rm-blue-ink" />
      </div>
    );
  }
  if (!hypotheses || hypotheses.length === 0) {
    return <p className="py-8 text-center text-body text-muted-foreground">Geen hypotheses voor deze klant.</p>;
  }

  return (
    <div className="terminal grid grid-cols-1 gap-4 md:grid-cols-4">
      {KOLOMMEN.map((kolom) => {
        const rijen = hypotheses.filter((h) => kolom.stages.includes(lifecycleOf(h).stage));
        return (
          <div key={kolom.titel} className="min-w-0">
            <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
              {kolom.titel} <span className="teller-waarde">({rijen.length})</span>
            </h3>
            <div className="space-y-2">
              {rijen.map((h) => <HypothesisCard key={h.id} h={h} />)}
              {rijen.length === 0 && <p className="text-micro text-muted-foreground/60">Leeg</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

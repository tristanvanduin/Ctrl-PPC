"use client";

import { useEffect, useState } from "react";
import { Eye, Radar, Loader2, RefreshCw } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { classificeerChangeHistory, type RawChangeHistoryRow } from "@/lib/learning/change-history-classifier";
import { buildTimeline, type TimelineEntry } from "@/lib/decision-terminal/timeline";
import type { HypothesisRecord } from "@/lib/decision-terminal/lifecycle";
import { HypothesisBoard } from "./hypothesis-board";
import { AttributionView } from "./attribution-view";
import { DecisionLog } from "./decision-log";
import { TrackrecordView } from "./trackrecord-view";

// Fase 2, Task 4: de Decision Terminal. Losse, geisoleerde pagina (geen onderdeel van
// analysis-catalog.ts of de bestaande klant-tabs) die read-only laat zien wat de Decision Core
// en de H1-leerlus vandaag weten over een klant. Drie panelen:
//
//   Hypothesis Board   sprint_hypotheses, per levenscyclus-stadium.
//   Attribution View   dezelfde hypotheses, maar geevalueerd: baseline vs. gemeten, uitgevoerd
//                       of niet.
//   Decision Log       ads_change_history + hypothese-mijlpalen, chronologisch.
//
// NO-WRITE-MODE: geen enkele knop hier schrijft iets. De "Observing"-badge is geen decoratie
// maar een expliciete garantie -- deze pagina leest, en verandert nooit iets in een
// advertentieplatform of in de database.

type Tab = "board" | "attribution" | "log" | "trackrecord";

// Zelfde vorm als verzamelHypotheses() in lib/decision/decision-skeleton.ts teruggeeft.
interface LiveSignal { id: string; statement: string; category: string | null }
interface LiveSignalsResult { runType: string; providers: string[]; hypotheses: LiveSignal[] }

const HYPOTHESIS_SELECT =
  "id, hypothesis, expected_result, measurement_metric, timeframe, status, source, ice_total, created_at, accepted_at, decided_at, decided_by, decision_reason, outcome, result_met, learning, verdict_metrics, evaluated_at";

export function DecisionTerminal({ clientId }: { clientId: string }) {
  const [tab, setTab] = useState<Tab>("board");
  const [hypotheses, setHypotheses] = useState<HypothesisRecord[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      dbSelect<HypothesisRecord>("sprint_hypotheses", {
        select: HYPOTHESIS_SELECT,
        clientId,
        order: { column: "created_at", ascending: false },
      }),
      dbSelect<RawChangeHistoryRow>("ads_change_history", {
        select: "resource_type, change_type, campaign_name, change_datetime, old_value, new_value",
        clientId,
        order: { column: "change_datetime", ascending: false },
      }),
    ]).then(([hypRes, changeRes]) => {
      if (cancelled) return;
      if (hypRes.error) { setError(hypRes.error.message); return; }
      const events = classificeerChangeHistory(changeRes.data ?? []);
      setHypotheses(hypRes.data);
      setTimeline(buildTimeline(events, hypRes.data));
    }).catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [clientId]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "board", label: "Hypothesis Board" },
    { id: "attribution", label: "Attribution View" },
    { id: "log", label: "Decision Log" },
    { id: "trackrecord", label: "Trackrecord" },
  ];

  return (
    <div className="terminal space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Radar className="h-5 w-5" style={{ color: "var(--terminal-accent, var(--color-rm-blue-ink))" }} />
        <h1 className="text-page font-bold text-rm-blue-ink">Decision Terminal</h1>
        <span className="text-meta text-muted-foreground">{clientId}</span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-micro font-medium text-muted-foreground">
          <Eye className="h-3 w-3" /> Observing, geen schrijfacties
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>
      )}

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
              tab === t.id ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "board" && <HypothesisBoard hypotheses={hypotheses} loading={loading} />}
      {tab === "attribution" && <AttributionView hypotheses={hypotheses} loading={loading} />}
      {tab === "log" && <DecisionLog entries={timeline} loading={loading} />}
      {tab === "trackrecord" && <TrackrecordView clientId={clientId} />}

      <LiveSignalsPanel clientId={clientId} />
    </div>
  );
}

// Vraagt op verzoek de Decision Core (Fase 2) om zijn actuele signalen: providers/isAvailable +
// signalHypothesisDiscovery, precies wat handleDecisionSkeleton teruggeeft. GEEN automatische
// aanroep bij het laden van de pagina: de route zelf schrijft niets (Stap 4), maar een POST bij
// elke paginabezoek is nog steeds onnodig verkeer voor iets dat de gebruiker misschien niet wil
// zien. Expliciet ONgekoppeld aan het Hypothesis Board hierboven: dit is vers en ongeslagen op,
// het board is de opgeslagen levenscyclus. Twee verschillende dingen, expres niet vermengd.
function LiveSignalsPanel({ clientId }: { clientId: string }) {
  const [result, setResult] = useState<LiveSignalsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function haalOp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/weekly-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as LiveSignalsResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="terminal rounded-lg border border-dashed border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-meta font-semibold text-rm-gray">Live signalen (Decision Core)</h3>
          <p className="text-micro text-muted-foreground">Vers berekend, niet opgeslagen. Los van het Hypothesis Board hierboven.</p>
        </div>
        <button
          onClick={haalOp}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-rm-gray hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Ververs
        </button>
      </div>
      {error && <p className="text-meta text-amber-700">{error}</p>}
      {result && (
        <div className="space-y-1.5">
          <p className="text-micro text-muted-foreground">Beschikbare providers: {result.providers.join(", ") || "geen"}</p>
          {result.hypotheses.length === 0 ? (
            <p className="text-body text-muted-foreground">Geen signalen gevonden in het huidige venster.</p>
          ) : (
            result.hypotheses.map((h) => (
              <div key={h.id} className="rounded-md border border-border px-2.5 py-1.5 text-body text-rm-gray">
                {h.category && (
                  <span className="mr-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">{h.category}</span>
                )}
                {h.statement}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

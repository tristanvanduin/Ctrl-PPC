"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Sparkles, Calendar, AlertCircle, CheckCircle2, Info } from "lucide-react";

// Master Synthesis (Pijler 6): kanaaloverstijgende hypotheses uit de al-berekende
// kanaal-aanbevelingen (Pijler 1-5) plus de cross-channel-feiten (zie CrossChannelAnalyses
// hierboven). Alleen zinvol bij 2+ actieve kanalen -- de aanroeper (client-dashboard.tsx) gate't
// hierop via kanalen.length > 1, zelfde grootheid als "meerdereKanalen" elders in die pagina.

interface SavedAnalysis { output: string; analysis_date: string; period_start: string; period_end: string }

type RunStatus = "geen_data" | "opgeslagen" | "synthese_mislukt" | "validatie_mislukt";
interface RunResponse {
  ok: boolean;
  status: RunStatus;
  message?: string;
  error?: string;
  narrative?: string;
  hypotheses?: number;
  tasks?: number;
  hypothesesSaved?: number;
  tasksSaved?: number;
  evidenceChannels?: string[];
}

const KANAAL_LABEL_KORT: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn" };

export function MasterSynthesisAnalysis({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [lastNarrative, setLastNarrative] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/monthly-decision?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) { setLoaded(true); return; }
      const data = await res.json();
      const analysis = data?.analysis as SavedAnalysis | null;
      if (analysis) {
        setLastDate(analysis.analysis_date);
        setLastNarrative(analysis.output);
      }
    } catch {
      // Geen laatste run is geen fout, zelfde principe als CrossChannelAnalyses.
    } finally {
      setLoaded(true);
    }
  }, [clientId]);

  useEffect(() => {
    setLoaded(false); setError(null); setStatusMessage(null);
    fetchLatest();
  }, [fetchLatest]);

  async function run() {
    setRunning(true); setError(null); setStatusMessage(null);
    try {
      const res = await fetch("/api/analysis/monthly-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = (await res.json()) as RunResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Master Synthesis mislukt");
      }
      if (data.status === "geen_data") {
        setStatusMessage(data.message || "Geen kanaal-aanbevelingen of cross-channel-signalen binnen de periode.");
      } else if (data.status === "opgeslagen") {
        setStatusMessage(
          `${data.hypothesesSaved ?? 0} hypothese(s) en ${data.tasksSaved ?? 0} taak/taken opgeslagen ` +
          `(kanalen: ${(data.evidenceChannels ?? []).map((c) => KANAAL_LABEL_KORT[c] ?? c).join(", ") || "geen"}).`
        );
        setLastNarrative(data.narrative ?? null);
        await fetchLatest();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Sparkles className="w-4.5 h-4.5 text-rm-blue-ink" />
          <div className="flex-1">
            <h3 className="text-title font-semibold text-rm-gray">Master Synthesis</h3>
            <p className="text-micro text-muted-foreground mt-0.5">
              Synthetiseert de laatste kanaal-aanbevelingen en de cross-channel-feiten tot hypotheses die alleen zichtbaar worden door kanalen samen te lezen. Landt in de goedkeuringswachtrij.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="px-3 py-1.5 rounded-md bg-rm-blue text-white text-meta font-medium hover:bg-rm-blue/90 disabled:opacity-50 flex items-center gap-1.5 transition-all"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {running ? "Bezig..." : "Draai Master Synthesis"}
          </button>
        </div>
        <div className="px-5 py-3 flex items-center gap-3 text-meta">
          {lastDate && <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" /> Laatst: {lastDate}</span>}
          {statusMessage && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {statusMessage}</span>}
          {error && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3.5 h-3.5" /> {error}</span>}
          {loaded && !lastDate && !statusMessage && !error && <span className="text-muted-foreground">Nog niet gedraaid.</span>}
        </div>
      </div>

      {lastNarrative && (
        <div className="rounded-md border border-border bg-gray-50 px-4 py-3 text-meta text-rm-gray whitespace-pre-wrap max-h-96 overflow-y-auto">
          {lastNarrative}
        </div>
      )}

      {loaded && !lastDate && !lastNarrative && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-meta text-blue-800 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Nog geen Master Synthesis gedraaid. Vereist minstens één kanaal met een recente monthly-run, of een getriggerd cross-channel-signaal.</span>
        </div>
      )}
    </div>
  );
}

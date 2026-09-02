"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Sparkles, Calendar, AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { isDemoClient } from "@/lib/demo/demo-mode";
import { dekkingUitPeriode, type DekkingRegel } from "@/lib/analysis/dekking-tekst";

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
  /** Wat de route over zijn evidence zegt: rundatums, spreiding, verouderd (lib/decision/evidence/build-payload.ts). */
  dekking?: { runDatums?: { channel: string; analysisDate: string }[]; spreidingDagen?: number; verouderd?: boolean; nieuwsteRun?: string | null };
}

/** De waarschuwingen uit het dekkingsblok van een run: alleen wat de lezer moet weten. */
function dekkingWaarschuwingen(d: RunResponse["dekking"]): string[] {
  if (!d) return [];
  const uit: string[] = [];
  if (d.verouderd) uit.push(`De nieuwste kanaalrun (${d.nieuwsteRun ?? "?"}) ligt vóór het einde van de periode: de synthese gaat over een eerdere maand.`);
  if ((d.spreidingDagen ?? 0) > 10) uit.push(`De kanaalruns liggen ${d.spreidingDagen} dagen uit elkaar; ze zijn niet in dezelfde cyclus geanalyseerd.`);
  return uit;
}

const KANAAL_LABEL_KORT: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn", microsoft_ads: "Microsoft" };

export function MasterSynthesisAnalysis({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [lastNarrative, setLastNarrative] = useState<string | null>(null);
  // De dataperiode van de laatst opgeslagen synthese (uit GET) en wat de laatste run over zijn
  // evidence zei (uit POST). "Laatst:" is de datum van de RUN; dit is de datum van de DATA.
  const [dekking, setDekking] = useState<DekkingRegel | null>(null);
  const [waarschuwingen, setWaarschuwingen] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  // isDemoMode() leest window.location, dus in een effect en niet in de eerste render --
  // anders rendert de server iets anders dan de client en klapt de hydratie eruit (zelfde
  // reden als demoModus in client-dashboard.tsx).
  const [demoModus, setDemoModus] = useState(false);
  useEffect(() => { setDemoModus(isDemoClient(clientId)); }, [clientId]);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/monthly-decision?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) { setLoaded(true); return; }
      const data = await res.json();
      const analysis = data?.analysis as SavedAnalysis | null;
      if (analysis) {
        setLastDate(analysis.analysis_date);
        setLastNarrative(analysis.output);
        setDekking(dekkingUitPeriode(analysis.period_start, analysis.period_end));
      }
    } catch {
      // Geen laatste run is geen fout, zelfde principe als CrossChannelAnalyses.
    } finally {
      setLoaded(true);
    }
  }, [clientId]);

  useEffect(() => {
    setLoaded(false); setError(null); setStatusMessage(null); setDekking(null); setWaarschuwingen([]);
    fetchLatest();
  }, [fetchLatest]);

  async function run() {
    // Master Synthesis roept een echte LLM aan (masterplan Pijler 6) -- geen live analyses
    // starten in demo-modus, ook niet als iemand de knop toch bereikt.
    if (demoModus) return;
    setRunning(true); setError(null); setStatusMessage(null); setWaarschuwingen([]);
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
      setWaarschuwingen(dekkingWaarschuwingen(data.dekking));
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
          <Sparkles className="w-4.5 h-4.5 text-brand-blue-ink" />
          <div className="flex-1">
            <h3 className="text-title font-semibold text-brand-gray">Master Synthesis</h3>
            <p className="text-micro text-muted-foreground mt-0.5">
              Synthetiseert de laatste kanaal-aanbevelingen en de cross-channel-feiten tot hypotheses die alleen zichtbaar worden door kanalen samen te lezen. Landt in de goedkeuringswachtrij.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running || demoModus}
            title={demoModus ? "Niet beschikbaar in demo-modus: dit start een echte LLM-aanroep." : undefined}
            className="px-3 py-1.5 rounded-md bg-brand-blue text-white text-meta font-medium hover:bg-brand-blue/90 disabled:opacity-50 flex items-center gap-1.5 transition-all"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {running ? "Bezig..." : "Draai Master Synthesis"}
          </button>
        </div>
        <div className="px-5 py-3 flex items-center gap-3 text-meta">
          {demoModus && <span className="text-muted-foreground">In demo-modus kun je geen live analyses starten.</span>}
          {lastDate && <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" /> Laatst: {lastDate}</span>}
          {statusMessage && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {statusMessage}</span>}
          {error && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3.5 h-3.5" /> {error}</span>}
          {loaded && !demoModus && !lastDate && !statusMessage && !error && <span className="text-muted-foreground">Nog niet gedraaid.</span>}
        </div>
        {(dekking || waarschuwingen.length > 0) && (
          <div className="px-5 pb-3 space-y-1">
            {dekking && (
              <div className={`flex items-center gap-1 text-micro ${dekking.verouderd ? "text-amber-700" : "text-muted-foreground"}`}>
                {dekking.verouderd && <AlertTriangle className="w-3 h-3 shrink-0" />}
                <span>{dekking.tekst}</span>
              </div>
            )}
            {waarschuwingen.length > 0 && (
              <ul className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-micro text-amber-800 space-y-0.5">
                {waarschuwingen.map((w) => (
                  <li key={w} className="flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {lastNarrative && (
        <div className="rounded-md border border-border bg-gray-50 px-4 py-3 text-meta text-brand-gray whitespace-pre-wrap max-h-96 overflow-y-auto">
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

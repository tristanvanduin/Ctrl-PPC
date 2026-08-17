"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Radar, Sparkles, Calendar, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Laadvlak } from "@/components/ui/laadvlak";

// Cross-channel-analyse als losse sub-analyse-kaarten — net als de kanalen, maar uit ÉÉN
// deterministische run. De route (/api/analysis/cross-channel) levert de groepen (funnel,
// zaai/arbitrage/mix, KPI-verhoudingen, doelgroep-samenhang, GA4-CRO); deze kaart draait de run
// en toont per groep een eigen blok. Geen aparte endpoints, geen dubbele berekening.
//
// Bovenaan (masterplan 17.12): de kanaaloverstijgende SYNTHESE, een apart, LLM-gedreven
// eindresultaat (/api/analysis/cross-channel-synthesis) dat pas verschijnt zodra alle
// beschikbare kanalen hun maandanalyse voor deze cyclus hebben afgerond. Eigen kaart, eigen
// fetch — de sub-analyse-groepen eronder blijven puur deterministisch en draaien onafhankelijk.

interface CrossGroup { key: string; title: string; description: string; section: string; triggered: number; checked: string[] }

interface SynthesizedAction { channel: string; action: string; rationale: string; priority: "hoog" | "midden" | "laag" }
interface Synthesis {
  headline: string;
  narrative: string;
  contradictions: string[];
  synthesized_actions: SynthesizedAction[];
  channels_used: string[];
}

const CHANNEL_LABEL: Record<string, string> = { google_ads: "SEA", meta_ads: "Meta Ads", linkedin_ads: "LinkedIn Ads" };
const PRIORITY_STYLE: Record<SynthesizedAction["priority"], string> = {
  hoog: "bg-red-100 text-red-700",
  midden: "bg-amber-100 text-amber-700",
  laag: "bg-gray-100 text-muted-foreground",
};

function SynthesisCard({ clientId }: { clientId: string }) {
  const [synthesis, setSynthesis] = useState<Synthesis | null | undefined>(undefined); // undefined = laden
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);

  const fetchSynthesis = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/cross-channel-synthesis?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) { setSynthesis(null); return; }
      const data = await res.json();
      setSynthesis(data?.synthesis ?? null);
      setAnalysisDate(data?.analysisDate ?? null);
    } catch {
      setSynthesis(null);
    }
  }, [clientId]);

  useEffect(() => { setSynthesis(undefined); fetchSynthesis(); }, [fetchSynthesis]);

  if (synthesis === undefined) return <Laadvlak vorm="tekst" regels={3} />;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Sparkles className="w-4.5 h-4.5 text-brand-orange-ink" />
        <div className="flex-1">
          <h3 className="text-title font-semibold text-brand-gray">Kanaaloverstijgende synthese</h3>
          <p className="text-micro text-muted-foreground mt-0.5">
            Eén samenhangend verhaal uit de afgeronde maandanalyses van alle gekoppelde kanalen — niet de kanalen los naast elkaar.
          </p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        {!synthesis ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-meta text-blue-800 flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Nog geen synthese. Die verschijnt automatisch zodra alle gekoppelde kanalen hun maandanalyse voor deze cyclus hebben afgerond.</span>
          </div>
        ) : (
          <>
            {analysisDate && <p className="text-micro text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> {analysisDate}</p>}
            <p className="text-lead font-semibold text-brand-gray">{synthesis.headline}</p>
            <p className="text-meta text-muted-foreground leading-relaxed">{synthesis.narrative}</p>

            {synthesis.contradictions.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-micro font-medium text-amber-800 mb-1">Tegenspraak tussen kanalen</p>
                <ul className="list-disc pl-4 space-y-0.5 text-meta text-amber-800">
                  {synthesis.contradictions.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}

            {synthesis.synthesized_actions.length > 0 && (
              <div className="space-y-2">
                {synthesis.synthesized_actions.map((a, i) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2 flex items-start gap-2">
                    <span className={`text-micro font-medium px-2 py-0.5 rounded-full shrink-0 ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>
                    <div className="flex-1">
                      <p className="text-meta text-brand-gray"><span className="font-medium">{CHANNEL_LABEL[a.channel] ?? a.channel}:</span> {a.action}</p>
                      <p className="text-micro text-muted-foreground mt-0.5">{a.rationale}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group }: { group: CrossGroup }) {
  const [expanded, setExpanded] = useState(false);
  const has = group.triggered > 0;
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <div className="flex-1">
          <h4 className="text-lead font-semibold text-brand-gray">{group.title}</h4>
          <p className="text-micro text-muted-foreground mt-0.5">{group.description}</p>
        </div>
        <span className={`text-micro font-medium px-2 py-0.5 rounded-full ${has ? "bg-brand-orange/10 text-brand-orange-ink" : "bg-gray-100 text-muted-foreground"}`}>
          {has ? `${group.triggered} signa${group.triggered === 1 ? "al" : "len"}` : "geen"}
        </span>
      </div>
      <div className="px-5 py-2.5">
        {has ? (
          <>
            <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-1 text-meta text-brand-blue-ink hover:underline">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Verberg bevindingen" : "Bekijk bevindingen"}
            </button>
            {expanded && (
              <div className="mt-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-meta text-brand-gray whitespace-pre-wrap max-h-72 overflow-y-auto">
                {group.section}
              </div>
            )}
          </>
        ) : (
          <p className="text-meta text-muted-foreground">
            Geen signalen getriggerd. Gecontroleerd: {group.checked.length > 0 ? group.checked.join(", ") : "—"}.
          </p>
        )}
      </div>
    </div>
  );
}

export function CrossChannelAnalyses({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [groups, setGroups] = useState<CrossGroup[] | null>(null);
  const [degradations, setDegradations] = useState<string[]>([]);

  // `groups === null` betekende hier drie dingen tegelijk: aan het laden, niets gevonden, en
  // opgehaald-maar-mislukt. De weergave koos er één van — de spinner — en dus bleef een klant die
  // de analyse nooit gedraaid had eindeloos naar een draaiend rondje kijken, terwijl de lege
  // staat ("Nog geen sub-analyses. Draai de cross-channel-analyse…") er twee regels lager gewoon
  // stond en alleen niet bereikbaar was. Elke uitgang zet nu een lijst — desnoods een lege.
  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/cross-channel?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) { setGroups([]); return; }
      const data = await res.json();
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
      if (data?.groupsDate) setLastDate(data.groupsDate);
    } catch {
      // Geen laatste run is geen fout — maar het is wél een uitkomst, en die hoort zichtbaar
      // te worden in plaats van als "nog bezig" te blijven staan.
      setGroups([]);
    }
  }, [clientId]);

  useEffect(() => {
    setGroups(null); setLastDate(null); setError(null); setSuccess(null); setDegradations([]);
    fetchLatest();
  }, [fetchLatest]);

  async function run() {
    setRunning(true); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/analysis/cross-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      if (Array.isArray(data.groups)) setGroups(data.groups);
      setDegradations(Array.isArray(data.degradations) ? data.degradations : []);
      setSuccess(`${data.signals ?? 0} signa${data.signals === 1 ? "al" : "len"} over ${data.groups?.length ?? 0} sub-analyses (${data.checked ?? 0} gecontroleerd)`);
      await fetchLatest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* De synthese staat bovenaan: het eindresultaat dat de sub-analyses eronder voedt. */}
      <SynthesisCard clientId={clientId} />

      {/* Kop met de gedeelde run-knop: één run voedt alle sub-analyses. */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Radar className="w-4.5 h-4.5 text-brand-blue-ink" />
          <div className="flex-1">
            <h3 className="text-title font-semibold text-brand-gray">Cross-channel-analyse</h3>
            <p className="text-micro text-muted-foreground mt-0.5">
              Eén deterministische run; de sub-analyses hieronder komen uit dezelfde detectie. Getriggerde signalen landen in de goedkeuringswachtrij.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="px-3 py-1.5 rounded-md bg-brand-blue text-white text-meta font-medium hover:bg-brand-blue/90 disabled:opacity-50 flex items-center gap-1.5 transition-all"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {running ? "Bezig..." : "Draai cross-channel-analyse"}
          </button>
        </div>
        <div className="px-5 py-3 flex items-center gap-3 text-meta">
          {lastDate && <span className="flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" /> Laatst: {lastDate}</span>}
          {success && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {success}</span>}
          {error && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3.5 h-3.5" /> {error}</span>}
          {!lastDate && !success && !error && <span className="text-muted-foreground">Nog niet gedraaid.</span>}
        </div>
      </div>

      {/* De sub-analyses als losse kaarten. */}
      {groups === null ? (
        <Laadvlak vorm="tekst" regels={3} />
      ) : groups.length === 0 ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-meta text-blue-800 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Nog geen sub-analyses. Draai de cross-channel-analyse om de blokken (funnel, arbitrage/mix, KPI-verhoudingen, doelgroep-samenhang, GA4-CRO) te vullen.</span>
        </div>
      ) : (
        groups.map((g) => <GroupCard key={g.key} group={g} />)
      )}

      {degradations.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-meta text-amber-800">
          <p className="font-medium mb-1">Expliciet gedegradeerd (geen stil gokken)</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {degradations.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Building2, Sparkles, Calendar, Info } from "lucide-react";
import { Counter } from "@/components/ui/counter";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel } from "@/components/dashboard/data-table";
import { segmentLabel, magAlsTrendGelden, MIN_ACCOUNTS_VOOR_TREND } from "@/lib/macro/types";
import { CodeRoodPaneel } from "@/components/adoptie/code-rood-paneel";
import { Laadvlak } from "@/components/ui/laadvlak";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_PORTFOLIO_SYNTHESIS } from "@/lib/demo/god-view-demo";

// Portfolio-synthese (masterplan 17.15): dezelfde soort kaart als SynthesisCard in
// cross-channel-analyses.tsx, maar tussen KLANTEN van het bureau i.p.v. tussen kanalen van 1
// klant. Eigen fetch, eigen route (/api/analysis/portfolio-synthesis) -- de segmentcellen
// hieronder blijven de bestaande, deterministische Macro-aggregatie en draaien onafhankelijk.

interface PortfolioAction { clientId: string; clientName?: string; action: string; rationale: string; priority: "hoog" | "midden" | "laag" }
interface PortfolioSynthesis {
  headline: string;
  narrative: string;
  recurring_patterns: string[];
  outliers: string[];
  synthesized_actions: PortfolioAction[];
}

const PRIORITY_STYLE: Record<PortfolioAction["priority"], string> = {
  hoog: "bg-red-100 text-red-700",
  midden: "bg-amber-100 text-amber-700",
  laag: "bg-gray-100 text-muted-foreground",
};

export function PortfolioSynthesisCard() {
  const [synthesis, setSynthesis] = useState<PortfolioSynthesis | null | undefined>(undefined);
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);

  const fetchSynthesis = useCallback(async () => {
    // Demo-modus: geen echte sessie/bureau, dus /api/analysis/portfolio-synthesis zou altijd
    // 401/403 geven (die route leest echte Supabase-auth-cookies) en roept normaal een echte
    // LLM aan -- geen van beide gewenst voor een demo-bezoeker. Statische, veilige demo-data i.p.v.
    // de fetch, zie lib/demo/god-view-demo.ts voor de reden en het GRT/GRA/GRN-verhaal erachter.
    if (isDemoMode()) {
      setSynthesis(DEMO_PORTFOLIO_SYNTHESIS);
      setAnalysisDate(new Date().toISOString().slice(0, 10));
      return;
    }
    try {
      const res = await fetch("/api/analysis/portfolio-synthesis");
      if (!res.ok) { setSynthesis(null); return; }
      const data = await res.json();
      setSynthesis(data?.synthesis ?? null);
      setAnalysisDate(data?.analysisDate ?? null);
    } catch {
      setSynthesis(null);
    }
  }, []);

  useEffect(() => { fetchSynthesis(); }, [fetchSynthesis]);

  if (synthesis === undefined) return <Laadvlak vorm="tekst" regels={3} />;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Sparkles className="w-4.5 h-4.5 text-brand-orange-ink" />
        <div className="flex-1">
          <h2 className="text-title font-semibold text-brand-gray">Portfolio-synthese</h2>
          <p className="text-micro text-muted-foreground mt-0.5">
            Eén samenhangend verhaal uit de meest recente eindconclusies van je klanten — patronen die bij meerdere klanten terugkomen, niet elke klant los.
          </p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        {isDemoMode() && (
          <div className="flex items-center gap-2 text-xs text-brand-blue-ink bg-brand-blue/10 border border-brand-blue/20 rounded-lg px-3 py-1.5">
            Demodata — GreenTech Amsterdam/Americas/North America, geen live LLM-aanroep
          </div>
        )}
        {!synthesis ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-meta text-blue-800 flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Nog geen portfolio-synthese. Draai 'm via de Portfolio-synthese-actie, of wacht tot minstens 2 klanten deze maand een vers eindverhaal hebben.</span>
          </div>
        ) : (
          <>
            {analysisDate && <p className="text-micro text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> {analysisDate}</p>}
            <p className="text-lead font-semibold text-brand-gray">{synthesis.headline}</p>
            <p className="text-meta text-muted-foreground leading-relaxed">{synthesis.narrative}</p>

            {synthesis.recurring_patterns.length > 0 && (
              <div className="rounded-md border border-border bg-gray-50 px-3 py-2">
                <p className="text-micro font-medium text-brand-gray mb-1">Terugkerende patronen</p>
                <ul className="list-disc pl-4 space-y-0.5 text-meta text-brand-gray">
                  {synthesis.recurring_patterns.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {synthesis.outliers.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-micro font-medium text-amber-800 mb-1">Uitschieters</p>
                <ul className="list-disc pl-4 space-y-0.5 text-meta text-amber-800">
                  {synthesis.outliers.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            )}

            {synthesis.synthesized_actions.length > 0 && (
              <div className="space-y-2">
                {synthesis.synthesized_actions.map((a, i) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2 flex items-start gap-2">
                    <span className={`text-micro font-medium px-2 py-0.5 rounded-full shrink-0 ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>
                    <div className="flex-1">
                      <p className="text-meta text-brand-gray"><span className="font-medium">{a.clientName ?? (a.clientId === "portfolio" ? "Hele portfolio" : a.clientId)}:</span> {a.action}</p>
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

// Fase 5, Task 3: Agency God View -- geaggregeerde macro-data en de eigen portfolio, voor
// performance_marketeer (organisatiebreed maar bureau-gescoped, zie lib/auth/scope.ts). Leunt op
// /api/platform/agency-macrotrends (NIET /api/admin/macrotrends -- die vergt user:manage via de
// middleware, en performance_marketeer heeft dat recht niet; zie de kop van die route voor de
// volledige toelichting). De route beperkt hard tot de eigen bureaus van de aanroeper, dus deze
// view vraagt nooit expliciet een agencyId op. Geen k-anonimiteit nodig (dat is voor CROSS-agency
// vergelijken, lib/benchmark/cel.ts): dit is één bureau dat zijn eigen data ziet, precies zoals
// MacroTrendsPreview dat ook al deed -- deze component is de volwaardige pagina-versie daarvan,
// plus live koptellers.

interface Cel_ {
  sleutel: { agencyId: string; channel: string; bedrijfsmodel: string | null; niche: string | null; maand: string };
  metrics: { spend: number; conversions: number; conversionValue: number };
  accounts: number;
}

interface Antwoord {
  vanaf: string;
  aantalCellen: number;
  aantalKlantenIngelezen: number;
  cellen: Cel_[];
}

export function AgencyGodView() {
  const [data, setData] = useState<Antwoord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/agency-macrotrends")
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.error) setError(d.error); else setData(d as Antwoord); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-blue-ink" />
      </div>
    );
  }
  if (data.cellen.length === 0) {
    return (
      <div className="terminal space-y-4">
        <h1 className="text-page font-bold text-brand-blue-ink">Agency God View</h1>
        <PortfolioSynthesisCard />
        <CodeRoodPaneel />
        <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-body text-muted-foreground">
          Nog geen cellen — geen klant van dit bureau heeft in het venster sinds {data.vanaf} zowel
          spend als een gekoppeld segment.
        </p>
      </div>
    );
  }

  const laatsteMaand = data.cellen.reduce((m, c) => (c.sleutel.maand > m ? c.sleutel.maand : m), data.cellen[0].sleutel.maand);
  const rijenLaatsteMaand = data.cellen.filter((c) => c.sleutel.maand === laatsteMaand);
  const totaalSegment = rijenLaatsteMaand.find((c) => !c.sleutel.bedrijfsmodel && !c.sleutel.niche);
  const gesegmenteerd = rijenLaatsteMaand
    .filter((c) => c.sleutel.bedrijfsmodel || c.sleutel.niche)
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
    .slice(0, 20);

  return (
    <div className="terminal space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5" style={{ color: "var(--terminal-accent, var(--color-brand-blue-ink))" }} />
        <h1 className="text-page font-bold text-brand-blue-ink">Agency God View</h1>
        <span className="text-meta text-muted-foreground">eigen bureau · {laatsteMaand.slice(0, 7)}</span>
      </div>

      <PortfolioSynthesisCard />

      <CodeRoodPaneel />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Counter value={totaalSegment?.metrics.spend ?? 0} label="Spend deze maand" format="currency" isLive />
        <Counter value={totaalSegment?.metrics.conversions ?? 0} label="Conversies" isLive />
        <Counter value={totaalSegment?.accounts ?? 0} label="Klanten met data" />
        <Counter value={data.aantalKlantenIngelezen} label="Klanten in venster" />
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-title font-semibold text-brand-gray">Portfolio per segment</h2>
          <span className="text-meta text-muted-foreground">
            {data.aantalCellen} cellen sinds {data.vanaf}
          </span>
        </div>
        <p className="mb-3 text-meta text-muted-foreground">
          Eigen portfolio, gesegmenteerd op bedrijfsmodel en niche — geen benchmark tussen bureaus,
          wel het verschil tussen &ldquo;dit ene account daalt&rdquo; en &ldquo;heel dit segment
          daalt&rdquo;. Een cel onder {MIN_ACCOUNTS_VOOR_TREND} accounts is eigen data en blijft
          zichtbaar, maar leest niet als een portfoliobeweging.
        </p>
        <Tabel>
          <Kop>
            <KolomKop breed>Segment</KolomKop>
            <KolomKop>Kanaal</KolomKop>
            <KolomKop getal>Accounts</KolomKop>
            <KolomKop getal>Spend</KolomKop>
            <KolomKop getal>Conversies</KolomKop>
          </Kop>
          <Body>
            {gesegmenteerd.map((c, i) => (
              <Rij key={i}>
                <NaamCel sub={magAlsTrendGelden(c.accounts) ? "trend" : "te klein voor een trend"}>{segmentLabel(c.sleutel)}</NaamCel>
                <Cel nowrap zacht>{c.sleutel.channel}</Cel>
                <GetalCel>{c.accounts}</GetalCel>
                <GetalCel>{c.metrics.spend.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</GetalCel>
                <GetalCel>{c.metrics.conversions.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}</GetalCel>
              </Rij>
            ))}
            {gesegmenteerd.length === 0 && (
              <Rij>
                <Cel>Geen gesegmenteerde cellen deze maand — klanten missen nog een bedrijfsmodel/niche in Instellingen.</Cel>
              </Rij>
            )}
          </Body>
        </Tabel>
      </section>
    </div>
  );
}

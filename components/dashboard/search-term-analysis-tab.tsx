"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, Sparkles, ShieldAlert, ShieldCheck, ShieldQuestion, Eye } from "lucide-react";
import { useAnalysis } from "@/lib/analysis-context";
import { Tabel, Kop, KolomKop, SorteerKop, Body, Rij, NaamCel, Cel, GetalCel } from "./data-table";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

export interface SearchTermResult {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  relevanceScore: number;
  verdict: string;
  recommendedAction: string;
  reason: string;
}

type SortKey = "cost" | "clicks" | "score" | "term";
type VerdictFilter = "all" | "relevant" | "irrelevant" | "uncertain" | "partially_relevant";

const verdictLabels: Record<string, string> = {
  relevant: "Relevant",
  irrelevant: "Irrelevant",
  uncertain: "Onzeker",
  partially_relevant: "Deels relevant",
};

const verdictColors: Record<string, string> = {
  relevant: "bg-emerald-50 text-emerald-700 border-emerald-200",
  irrelevant: "bg-red-50 text-red-700 border-red-200",
  uncertain: "bg-amber-50 text-amber-700 border-amber-200",
  partially_relevant: "bg-blue-50 text-blue-700 border-blue-200",
};

const verdictIcons: Record<string, typeof ShieldCheck> = {
  relevant: ShieldCheck,
  irrelevant: ShieldAlert,
  uncertain: ShieldQuestion,
  partially_relevant: Eye,
};

const actionLabels: Record<string, string> = {
  keep: "Houden",
  negative_exact: "Uitsluiten (exact)",
  negative_phrase: "Uitsluiten (phrase)",
  monitor: "Monitoren",
  investigate: "Onderzoeken",
};

const actionColors: Record<string, string> = {
  keep: "text-emerald-600",
  negative_exact: "text-red-600 font-semibold",
  negative_phrase: "text-red-500",
  monitor: "text-amber-600",
  investigate: "text-blue-600",
};

interface Props {
  clientId: string;
}

export function SearchTermAnalysisTab({ clientId }: Props) {
  const [results, setResults] = useState<SearchTermResult[]>([]);
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ totalInput: number; totalAnalyzed: number; totalFailed: number; coveragePct: number } | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const { startJob, isRunning } = useAnalysis();

  const googleAdsCustomerId = clientId.replace("gads-", "");
  const jobId = `search-terms-${clientId}`;
  const bgRunning = isRunning(jobId);

  // Load cached results on mount (and poll while bg job is running)
  useEffect(() => {
    setLoading(true);
    fetch(`/api/analysis/search-terms?client_id=${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        setResults(data.results ?? []);
        setAnalysisDate(data.analysisDate);
      })
      .catch(() => setError("Fout bij laden van gecachte resultaten"))
      .finally(() => setLoading(false));
  }, [clientId]);

  // Reload results when bg job finishes
  useEffect(() => {
    if (bgRunning) {
      setAnalyzing(true);
    } else if (analyzing) {
      // Job just finished — reload cached results
      setAnalyzing(false);
      fetch(`/api/analysis/search-terms?client_id=${clientId}`)
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results ?? []);
          setAnalysisDate(data.analysisDate);
        })
        .catch(() => {});
    }
  }, [bgRunning, clientId, analyzing]);

  // Trigger new analysis (runs in background)
  function runAnalysis() {
    setAnalyzing(true);
    setError(null);

    startJob(jobId, "AI zoektermanalyse", async () => {
      const res = await fetch("/api/analysis/search-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, customerId: googleAdsCustomerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse mislukt");
      if (data.coverage) setCoverage(data.coverage);
    });
  }

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("desc"); }
  }

  const filtered = useMemo(() => {
    let items = results;
    if (verdictFilter !== "all") {
      items = items.filter((r) => r.verdict === verdictFilter);
    }
    return [...items].sort((a, b) => {
      if (sortBy === "term") return sortDir === "asc" ? a.searchTerm.localeCompare(b.searchTerm) : b.searchTerm.localeCompare(a.searchTerm);
      if (sortBy === "clicks") return sortDir === "asc" ? a.clicks - b.clicks : b.clicks - a.clicks;
      if (sortBy === "score") return sortDir === "asc" ? a.relevanceScore - b.relevanceScore : b.relevanceScore - a.relevanceScore;
      return sortDir === "asc" ? a.cost - b.cost : b.cost - a.cost;
    });
  }, [results, verdictFilter, sortBy, sortDir]);

  // Summary stats
  const irrelevantTerms = results.filter((r) => r.verdict === "irrelevant");
  const irrelevantCost = irrelevantTerms.reduce((s, r) => s + r.cost, 0);
  const uncertainTerms = results.filter((r) => r.verdict === "uncertain");

  // SortTh stond hier: een <th> met onClick. Dat is voor een muis een knop en voor een
  // toetsenbord niets — geen focus, geen Enter, en zonder aria-sort weet een schermlezer niet
  // waarop de tabel gesorteerd staat; het pijltje was de enige drager van die informatie.
  // SorteerKop uit data-table lost alle drie op en staat op dertien andere schermen.
  const sorteer = (col: SortKey) => ({
    actief: sortBy === col,
    richting: sortDir as "asc" | "desc",
    onSorteer: () => handleSort(col),
  });

  // Loading state
  if (loading) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
        Gecachte resultaten laden...
      </div>
    );
  }

  // No results yet — show start button
  if (results.length === 0 && !analyzing) {
    return (
      <div className="px-5 py-10 text-center">
        <Sparkles className="w-8 h-8 text-brand-blue-ink mx-auto mb-3 opacity-60" />
        <p className="text-sm text-muted-foreground mb-4">
          {error
            ? error
            : "Nog geen AI-analyse uitgevoerd. Analyseer alle zoektermen op relevantie."}
        </p>
        <button
          onClick={runAnalysis}
          className="px-4 py-2 bg-brand-blue text-white text-sm font-medium rounded-lg hover:bg-brand-blue/90 transition-colors"
        >
          Start Analyse
        </button>
        <p className="text-micro text-muted-foreground mt-2">
          Duurt ca. 30-60 seconden
        </p>
      </div>
    );
  }

  // Analyzing state
  if (analyzing) {
    return (
      <div className="px-5 py-10 text-center">
        <Loader2 className="w-8 h-8 text-brand-blue-ink mx-auto mb-3 animate-spin" />
        <p className="text-sm font-medium text-brand-gray mb-1">Zoektermen analyseren...</p>
        <p className="text-xs text-muted-foreground">
          AI beoordeelt alle zoektermen met clicks op relevantie. Dit duurt ca. 30-120 seconden afhankelijk van het aantal termen.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="px-5 py-3 border-b border-border bg-gray-50/50 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">
            {results.length} zoektermen geanalyseerd
            {coverage && coverage.totalInput > results.length && (
              <span className="ml-1">van {coverage.totalInput} gevonden ({coverage.coveragePct}% dekking)</span>
            )}
            {coverage && coverage.totalFailed > 0 && (
              <span className="ml-1 text-amber-600">| {coverage.totalFailed} gefaald</span>
            )}
            {analysisDate && <span className="ml-1">| {analysisDate}</span>}
            {" "}| Periode: laatste 30 dagen
          </span>
          {irrelevantTerms.length > 0 && (
            <span className="text-red-600 font-semibold">
              {irrelevantTerms.length} irrelevant ({fmt(irrelevantCost)} verspild)
            </span>
          )}
          {uncertainTerms.length > 0 && (
            <span className="text-amber-600">
              {uncertainTerms.length} onzeker
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
            className="text-xs border border-border rounded-md px-2 py-1 bg-card"
          >
            <option value="all">Alle beoordelingen</option>
            <option value="irrelevant">Irrelevant</option>
            <option value="uncertain">Onzeker</option>
            <option value="partially_relevant">Deels relevant</option>
            <option value="relevant">Relevant</option>
          </select>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="px-3 py-1 text-xs font-medium text-brand-blue-ink border border-brand-blue/30 rounded-md hover:bg-brand-blue/5 transition-colors"
          >
            Opnieuw analyseren
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 text-red-600 text-xs border-b border-red-100">
          {error}
        </div>
      )}

      {/* Results table */}
      <Tabel>
        <Kop>
          <SorteerKop breed {...sorteer("term")}>Zoekterm</SorteerKop>
          <KolomKop>Campagne</KolomKop>
          <SorteerKop getal {...sorteer("clicks")}>Clicks</SorteerKop>
          <SorteerKop getal {...sorteer("cost")}>Kosten</SorteerKop>
          <KolomKop getal>Conv.</KolomKop>
          <SorteerKop getal {...sorteer("score")}>Score</SorteerKop>
          <KolomKop>Beoordeling</KolomKop>
          <KolomKop>Actie</KolomKop>
          <KolomKop>Reden</KolomKop>
        </Kop>
        <Body>
          {filtered.map((r, i) => {
            const VerdictIcon = verdictIcons[r.verdict] ?? Search;
            return (
              <Rij key={i} className={r.verdict === "irrelevant" ? "bg-red-50/20" : ""}>
                <NaamCel>{r.searchTerm}</NaamCel>
                {/* Campagne en advertentiegroep horen bij elkaar: de groep is de tweede regel
                    onder de campagne, niet een eigen kolom. */}
                <NaamCel sub={r.adGroupName}>{r.campaignName}</NaamCel>
                <GetalCel>{r.clicks}</GetalCel>
                <GetalCel>{fmt(r.cost)}</GetalCel>
                <GetalCel>{r.conversions}</GetalCel>
                {/* Geen aandeelstreep op de score: dat is een oordeel van 1 tot 5, geen grootheid
                    die optelt. De kleur draagt hier de betekenis, met het cijfer ernaast. */}
                <GetalCel className={
                  r.relevanceScore >= 4 ? "text-emerald-600 font-bold" :
                  r.relevanceScore >= 3 ? "text-amber-600 font-bold" :
                  "text-red-600 font-bold"
                }>{r.relevanceScore}</GetalCel>
                <Cel nowrap>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-micro font-medium rounded-full border ${verdictColors[r.verdict] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                    <VerdictIcon className="w-3 h-3" />
                    {verdictLabels[r.verdict] || r.verdict}
                  </span>
                </Cel>
                <Cel nowrap>
                  <span className={`text-xs font-medium ${actionColors[r.recommendedAction] || "text-gray-600"}`}>
                    {actionLabels[r.recommendedAction] || r.recommendedAction}
                  </span>
                </Cel>
                <Cel zacht className="max-w-[250px]">{r.reason}</Cel>
              </Rij>
            );
          })}
        </Body>
      </Tabel>

      {filtered.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Geen zoektermen gevonden voor dit filter.
        </div>
      )}
    </div>
  );
}

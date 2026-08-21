"use client";

import { useState } from "react";
import { Calculator, ArrowRight, Info } from "lucide-react";
import { useChannelRunRateModel, type ChannelKind } from "@/lib/analysis/use-channel-run-rate";
import { Laadvlak } from "@/components/ui/laadvlak";

// Budgetscenario-equivalent van BudgetScenario.tsx (Google), voor Meta/LinkedIn. Zelfde UX
// (slider, presets, before/after-kaarten, constante-CPA-aanname), maar op de run-rate-basis in
// plaats van Google's kalenderjaar-YoY-model: er is geen jaarprognose om tegen af te zetten (geen
// meerjarige historie), dus de baseline hier is de VOLGENDE VOLLE MAAND-projectie uit
// lib/analysis/use-channel-run-rate.ts -- dezelfde data die ChannelForecast al toont, niet een
// tweede, eigen berekening.

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

export function ChannelBudgetScenario({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const { cfg, error, loading, model } = useChannelRunRateModel(clientId, channel);
  const [budgetChange, setBudgetChange] = useState(0);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  if (loading) return <Laadvlak vorm="tekst" regels={4} />;
  if (!model) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">Nog geen {cfg.label}-dagdata — een budgetscenario kan pas zodra er een run-rate-prognose is.</div>;
  }

  // Baseline: de volgende-volle-maand-projectie (dezelfde als in ChannelForecast), niet een
  // jaartotaal -- dat bestaat hier niet zonder seizoenscorrectie.
  const baseSpend = model.spendF.nextMonthProjected;
  const baseConv = model.convF.nextMonthProjected;
  const scenarioTeRekenen = baseSpend != null && baseSpend > 0 && baseConv != null && baseConv > 0;
  const currentCpa = scenarioTeRekenen ? baseSpend! / baseConv! : 0;

  const factor = 1 + budgetChange / 100;
  const newSpend = scenarioTeRekenen ? baseSpend! * factor : 0;
  const additionalSpend = newSpend - (baseSpend ?? 0);
  const additionalConv = scenarioTeRekenen ? additionalSpend / currentCpa : 0;
  const newConv = scenarioTeRekenen ? (baseConv ?? 0) + additionalConv : 0;

  const presets = [-25, 0, 25, 50, 75, 100];

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="w-5 h-5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-blue-ink">Budgetscenario — {cfg.label}</h3>
      </div>
      <p className="text-body text-muted-foreground mb-5">
        Wat levert een budgetwijziging op voor de volgende volle maand? Berekend met constante CPA
        {scenarioTeRekenen ? ` (${fmt(currentCpa)})` : ""} — geen seizoenscorrectie, dezelfde run-rate-basis als hierboven.
      </p>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Budget wijziging</span>
          <span className={`text-sm font-bold ${budgetChange > 0 ? "text-green-600" : budgetChange < 0 ? "text-red-500" : "text-brand-gray"}`}>
            {budgetChange > 0 ? "+" : ""}{budgetChange}%
          </span>
        </div>
        <input
          type="range"
          min={-50}
          max={100}
          step={5}
          value={budgetChange}
          onChange={(e) => setBudgetChange(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-blue"
        />
        <div className="flex justify-between text-micro text-muted-foreground mt-1">
          <span>-50%</span><span>0%</span><span>+50%</span><span>+100%</span>
        </div>
        <div className="flex gap-1.5 mt-3">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setBudgetChange(p)}
              className={`px-3 py-1 text-meta font-medium rounded-md transition-colors ${
                budgetChange === p ? "bg-brand-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-brand-gray"
              }`}
            >
              {p > 0 ? "+" : ""}{p}%
            </button>
          ))}
        </div>
      </div>

      {budgetChange !== 0 && !scenarioTeRekenen && (
        <div className="px-4 py-3 rounded-lg border bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-800">
            <span className="font-medium">Nog niet te berekenen.</span> Er is nog geen betrouwbare
            volgende-maand-projectie voor spend én {cfg.convLabel.toLowerCase()} tegelijk.
          </p>
        </div>
      )}

      {budgetChange !== 0 && scenarioTeRekenen && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <ResultCard label="Maandbudget" before={fmt(baseSpend!)} after={fmt(newSpend)} diff={`${budgetChange > 0 ? "+" : ""}${fmt(additionalSpend)}`} />
          <ResultCard label={`${cfg.convLabel} verwacht`} before={num(baseConv!)} after={num(newConv)} diff={`${additionalConv > 0 ? "+" : ""}${num(additionalConv)}`} />
          <ResultCard label="CPA" before={fmt(currentCpa)} after={fmt(currentCpa)} diff="Constant" neutral />
        </div>
      )}

      {budgetChange === 0 && (
        <div className="text-center py-4 text-body text-muted-foreground">Verschuif de slider om een scenario te berekenen</div>
      )}

      <div className="mt-4 flex items-start gap-2 text-meta text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Aanname: CPA blijft constant bij budgetwijziging. Extra {cfg.convLabel.toLowerCase()} = extra spend ÷ huidige CPA
          {scenarioTeRekenen ? ` (${fmt(currentCpa)})` : ""}. Baseline is de volgende-maand-trend, geen jaardoel — daarvoor
          ontbreekt de meerjarige historie die Google's kalenderjaar-prognose wel heeft.
        </span>
      </div>
    </div>
  );
}

function ResultCard({ label, before, after, diff, neutral }: { label: string; before: string; after: string; diff: string; neutral?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-body text-muted-foreground">{before}</span>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
        <span className="text-sm font-bold text-brand-blue-ink">{after}</span>
      </div>
      <p className={`text-micro font-medium ${neutral ? "text-muted-foreground" : diff.startsWith("+") ? "text-green-600" : diff.startsWith("-") ? "text-red-500" : "text-muted-foreground"}`}>
        {diff}
      </p>
    </div>
  );
}

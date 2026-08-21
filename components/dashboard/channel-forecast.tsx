"use client";

import { Info } from "lucide-react";
import { MonthlyTrendChart } from "./monthly-trend-chart";
import { useChannelRunRateModel, type ChannelKind } from "@/lib/analysis/use-channel-run-rate";
import { Laadvlak } from "@/components/ui/laadvlak";

// Run-rate-prognose voor Meta/LinkedIn: lopende maand op tempo + volgende maand via een lichte
// trend. Eerlijk over de beperking (geen meerjarige historie, dus geen seizoenscorrectie). De
// conversie is de som van de per kanaal geselecteerde conversievelden (conversie-selectie).
//
// Data + model zitten in lib/analysis/use-channel-run-rate.ts, gedeeld met ChannelBudgetScenario
// (zelfde run-rate, niet twee keer los berekend).

export type { ChannelKind };

const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const fmt = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v));

export function ChannelForecast({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const { cfg, error, loading, model } = useChannelRunRateModel(clientId, channel);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  if (loading) return <Laadvlak vorm="grafiek" hoogte={200} />;
  if (!model) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">Nog geen {cfg.label}-dagdata voor een prognose. Zodra de sync draait, verschijnt hier de run-rate-prognose.</div>;
  }

  const { spendF, convF, dayOfMonth, daysInMonth, curMtd, monthsCount } = model;
  const chartData = spendF.fullMonths.map((m, i) => ({ maand: m.month, spend: m.value, lijn: convF.fullMonths[i]?.value ?? 0 }));

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-meta text-blue-800 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Run-rate-prognose: de lopende maand geprojecteerd op het tempo tot nu (dag {dayOfMonth} van {daysInMonth}),
          de volgende maand via een lichte trend over {monthsCount} volle maand{monthsCount === 1 ? "" : "en"}.
          Geen meerjarige historie, dus <strong>geen seizoenscorrectie</strong> — dit is een tempo-indicatie, geen doelprognose.
          {channel === "blended" && " Meta + LinkedIn samen; Google staat apart met zijn kalender-YoY-prognose."}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Lopende maand */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide mb-2">Lopende maand (projectie)</div>
          <div className="space-y-1.5 text-lead">
            <Row label="Spend tot nu" value={eur(curMtd.spend)} />
            <Row label="Spend geprojecteerd" value={eur(spendF.currentMonthProjected)} strong warn={!spendF.currentMonthReliable} />
            <Row label={`${cfg.convLabel} tot nu`} value={fmt(curMtd.conv)} />
            <Row label={`${cfg.convLabel} geprojecteerd`} value={fmt(convF.currentMonthProjected)} strong warn={!convF.currentMonthReliable} />
          </div>
          {!spendF.currentMonthReliable && <p className="text-micro text-amber-600 mt-2">Nog weinig dagen deze maand — de projectie is grof.</p>}
        </div>

        {/* Volgende maand */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide mb-2">Volgende volle maand (trend)</div>
          <div className="space-y-1.5 text-lead">
            <Row label="Spend verwacht" value={eur(spendF.nextMonthProjected)} strong />
            <Row label={`${cfg.convLabel} verwacht`} value={fmt(convF.nextMonthProjected)} strong />
          </div>
          <p className="text-micro text-muted-foreground mt-2">
            {spendF.nextMonthMethod === "trend" ? "Lineaire trend over de recente maanden, geklemd tegen wilde uitschieters." : spendF.nextMonthMethod === "laatste" ? "Te weinig maanden voor een trend — gelijk aan de laatste volle maand." : "Onvoldoende data."}
          </p>
        </div>
      </div>

      {chartData.length >= 2 && (
        <MonthlyTrendChart title={`Volle maanden — spend & ${cfg.convLabel.toLowerCase()}`} data={chartData} lineLabel={cfg.convLabel} />
      )}
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${strong ? "font-semibold" : ""} ${warn ? "text-amber-600" : "text-brand-gray"}`}>{value}</span>
    </div>
  );
}

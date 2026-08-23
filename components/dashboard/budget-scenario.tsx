"use client";

import { useState, useMemo } from "react";
import { Calculator, ArrowRight, DollarSign, Target, AlertTriangle, Info } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";
import { formatDeltaPercent, formatRoas } from "@/lib/forecast-format";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

export function BudgetScenario({ clientId }: { clientId: string }) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = useMemo(() => computeForecast(data), [data]);
  const [budgetChange, setBudgetChange] = useState(0);

  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;
  const budget = forecast.budgetRecommendation;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null).length;
  const remainingMonths = Math.max(1, 12 - realizedMonths);

  // Current actuals — ALL on annual projected basis for consistency
  const currentAnnualConv = conv.adjustedAnnual;
  const currentAnnualRev = forecast.revenue.kpi.adjustedAnnual;
  const currentAnnualSpend = spend.adjustedAnnual;
  // Zelfde basis als hierboven ("ALL on annual projected basis for consistency"): deze rekende
  // bij een ingesteld doel met doel/12 i.p.v. de geprojecteerde jaartotaal/12, terwijl
  // currentAnnualSpend/Conv/Rev al op de PROJECTIE staan. Bij een account dat achter- of
  // voorloopt op zijn doel (heel gewoon, zie computeBudgetRecommendation's behindTarget) gaf dat
  // twee verschillende "huidige" cijfers door elkaar in dezelfde berekening: het scenario schaalt
  // dan vanaf een maandbedrag dat niet bij currentAnnualSpend hoort, en newAnnualSpend
  // (currentAnnualSpend + de opgetelde toename) klopt dan niet meer intern.
  const currentMonthlySpend = currentAnnualSpend / 12;
  // CPA on ANNUAL basis (not YTD) so before/after are comparable
  const currentCpa = currentAnnualConv > 0 ? currentAnnualSpend / currentAnnualConv : 0;
  const currentRoas = currentAnnualSpend > 0 ? currentAnnualRev / currentAnnualSpend : 0;
  const aov = currentAnnualConv > 0 ? currentAnnualRev / currentAnnualConv : 0;

  // IS Lost (Budget) headroom — how much can we scale before diminishing returns?
  const impressionShare = dataState?.impressionShare ?? [];
  const avgBudgetLostIS = impressionShare.length > 0
    ? impressionShare.reduce((s, is) => s + is.searchBudgetLostIS * is.cost, 0) /
      Math.max(impressionShare.reduce((s, is) => s + is.cost, 0), 1)
    : 0;
  // Headroom: if we lose 30% IS to budget, we can grow ~30% at same efficiency
  const headroomPct = Math.round(avgBudgetLostIS * 100);

  // Zonder conversies bestaat er geen CPA, en zonder CPA is dit scenario niet te rekenen.
  //
  // Eerder viel dat stil terug op nul: `currentCpa > 0 ? spend / cpa : 0` gaf bij nul conversies
  // nul extra conversies, en de kaarten toonden dan bij +100% budget doodleuk "0 extra
  // conversies, CPA € 0, constant". Dat leest als "meer budget levert niets op" terwijl het
  // betekent "hier valt niets over te zeggen" — en dat is precies het verschil waar een
  // budgetbeslissing op hangt.
  const scenarioTeRekenen = currentCpa > 0 && currentMonthlySpend > 0;

  // Scenario: budget verandert, CPA blijft gelijk
  // Dit is de correcte aanname bij tCPA bidding of stabiele efficiency
  const factor = 1 + budgetChange / 100;
  const newMonthlySpend = currentMonthlySpend * factor;
  const additionalMonthlySpend = newMonthlySpend - currentMonthlySpend;
  const additionalTotalSpend = additionalMonthlySpend * remainingMonths;

  // Conversies: extra spend / CPA = extra conversies (CPA constant)
  const additionalConversions = currentCpa > 0 ? additionalTotalSpend / currentCpa : 0;
  const newAnnualConv = Math.round(currentAnnualConv + additionalConversions);
  const newAnnualRev = Math.round(newAnnualConv * aov);
  const newAnnualSpend = Math.round(currentAnnualSpend + additionalTotalSpend);

  // ROAS en CPA: bij constante CPA en constante AOV
  // ROAS = omzet / spend = (conv × AOV) / spend = AOV / CPA → blijft gelijk
  // CPA = spend / conv → blijft gelijk (dat is de hele aanname)
  const newRoas = newAnnualSpend > 0 ? newAnnualRev / newAnnualSpend : 0;
  const newCpa = newAnnualConv > 0 ? newAnnualSpend / newAnnualConv : 0;

  // Target check
  const convTarget = conv.annualTarget;
  const hitsTarget = newAnnualConv >= convTarget && convTarget > 0;
  const convGap = convTarget - newAnnualConv;

  // Is the budget increase within IS headroom?
  const withinHeadroom = budgetChange <= headroomPct;

  const presets = [-25, 0, 25, 50, 75, 100];

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="w-5 h-5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-blue-ink">Budget Scenario Builder</h3>
      </div>
      <p className="text-body text-muted-foreground mb-5">
        Wat levert een budgetwijziging op? Berekend met constante CPA ({fmt(currentCpa)}) — de prijs per conversie verandert niet.
      </p>

      {/* Slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Budget wijziging</span>
          <span className={`text-sm font-bold ${budgetChange > 0 ? "text-green-600" : budgetChange < 0 ? "text-red-500" : "text-brand-gray"}`}>
            {budgetChange > 0 ? "+" : ""}{budgetChange}%
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={-50}
            max={100}
            step={5}
            value={budgetChange}
            onChange={(e) => setBudgetChange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-blue"
          />
          {/* Headroom indicator */}
          {headroomPct > 0 && (
            <div
              className="absolute top-0 h-2 bg-green-200 rounded-l-lg pointer-events-none"
              style={{ left: "33.3%", width: `${Math.min(headroomPct, 100) * 0.667}%` }}
              title={`IS headroom: +${headroomPct}%`}
            />
          )}
        </div>
        <div className="flex justify-between text-micro text-muted-foreground mt-1">
          <span>-50%</span>
          <span>0%</span>
          <span>+50%</span>
          <span>+100%</span>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setBudgetChange(p)}
              className={`px-3 py-1 text-meta font-medium rounded-md transition-colors ${
                budgetChange === p
                  ? "bg-brand-blue text-white"
                  : "bg-gray-100 text-muted-foreground hover:text-brand-gray"
              }`}
            >
              {p > 0 ? "+" : ""}{p}%
            </button>
          ))}
        </div>
      </div>

      {/* Geen CPA, geen scenario */}
      {budgetChange !== 0 && !scenarioTeRekenen && (
        <div className="px-4 py-3 rounded-lg border bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-800">
            <span className="font-medium">Nog niet te berekenen.</span> Dit scenario rekent met de
            huidige kosten per conversie, en die is er nog niet: er zijn dit jaar
            {currentAnnualConv > 0 ? " nog geen kosten geregistreerd" : " nog geen conversies gemeten"}.
            Een budgetwijziging levert dus geen voorspelling op — dat is iets anders dan een
            voorspelling van nul.
          </p>
        </div>
      )}

      {/* Results */}
      {budgetChange !== 0 && scenarioTeRekenen && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <ResultCard
              label="Maandbudget"
              before={fmt(currentMonthlySpend)}
              after={fmt(newMonthlySpend)}
              diff={`${budgetChange > 0 ? "+" : ""}${fmt(additionalMonthlySpend)}/mnd`}
            />
            <ResultCard
              label="Jaarprognose conversies"
              before={num(currentAnnualConv)}
              after={num(newAnnualConv)}
              diff={`${additionalConversions > 0 ? "+" : ""}${num(additionalConversions)}`}
              highlight={hitsTarget && currentAnnualConv < convTarget}
            />
            <ResultCard
              label="CPA"
              before={fmt(currentCpa)}
              after={fmt(newCpa)}
              diff="Constant"
              neutral
            />
            <ResultCard
              label="ROAS"
              before={formatRoas(currentRoas)}
              after={formatRoas(newRoas)}
              diff={currentRoas > 0 ? formatDeltaPercent((newRoas / currentRoas - 1) * 100) : "—"}
              neutral={Math.abs(newRoas - currentRoas) < 0.05}
            />
          </div>

          {/* IS Headroom info */}
          {budgetChange > 0 && headroomPct > 0 && (
            <div className={`px-4 py-3 rounded-lg border mb-3 ${
              withinHeadroom
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
            }`}>
              {withinHeadroom ? (
                <p className="text-sm text-green-800">
                  <span className="font-medium">Binnen IS headroom.</span> Het account verliest gemiddeld {headroomPct}% Impression Share door budget — een verhoging van {budgetChange}% zit daar ruim binnen. Verwachte CPA blijft stabiel.
                </p>
              ) : (
                <p className="text-sm text-amber-800">
                  <span className="font-medium">Voorbij IS headroom.</span> De beschikbare IS headroom is ~{headroomPct}%, maar je verhoogt met {budgetChange}%. Boven de {headroomPct}% kan Google breder targeten met mogelijk hogere CPA. Overweeg ook zoekwoorden uitbreiden of nieuwe campagnetypes.
                </p>
              )}
            </div>
          )}

          {/* Target status */}
          {convTarget > 0 && (
            <div className={`px-4 py-3 rounded-lg border ${
              hitsTarget ? "bg-green-50 border-green-200" : "bg-gray-50 border-border"
            }`}>
              {hitsTarget ? (
                <p className="text-sm text-green-800 font-medium">
                  ✓ Jaardoel van {num(convTarget)} conversies wordt gehaald ({num(newAnnualConv)} prognose).
                </p>
              ) : convGap > 0 ? (
                <p className="text-sm text-brand-gray">
                  Nog {num(convGap)} conversies tekort. Verhoog het budget verder of verbeter de campagne-efficiency.
                </p>
              ) : null}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {budgetChange === 0 && (
        <div className="text-center py-4 text-body text-muted-foreground">
          Verschuif de slider om een scenario te berekenen
        </div>
      )}

      {/* Methodology note */}
      <div className="mt-4 flex items-start gap-2 text-meta text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Aanname: CPA blijft constant bij budgetwijziging (tCPA biedstrategie).
          Extra conversies = extra spend ÷ huidige CPA ({scenarioTeRekenen ? fmt(currentCpa) : "nog niet bekend"}).
          ROAS = omzet ÷ spend, verschuift minimaal bij constante AOV ({aov > 0 ? fmt(aov) : "n.v.t."}).
          {headroomPct > 0 && ` IS headroom: ${headroomPct}% van impressies wordt nu gemist door budget.`}
        </span>
      </div>
    </div>
  );
}

function ResultCard({
  label, before, after, diff, highlight, neutral,
}: {
  label: string;
  before: string;
  after: string;
  diff: string;
  highlight?: boolean;
  neutral?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${
      highlight ? "border-green-300 bg-green-50" : "border-border"
    }`}>
      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-body text-muted-foreground">{before}</span>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
        <span className={`text-sm font-bold ${highlight ? "text-green-700" : "text-brand-blue-ink"}`}>{after}</span>
      </div>
      <p className={`text-micro font-medium ${
        neutral ? "text-muted-foreground" :
        diff.startsWith("+") ? "text-green-600" :
        diff.startsWith("-") ? "text-red-500" :
        "text-muted-foreground"
      }`}>
        {diff}
      </p>
    </div>
  );
}

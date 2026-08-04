"use client";

import { useMemo } from "react";
import { Clock, Target, Zap, AlertTriangle, TrendingUp, Calendar } from "lucide-react";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { weeksToFair, type UpcomingEdition } from "@/lib/rai/fair-weeks";
import { today } from "@/lib/reporting-date";
import { berekenLanding, seizoensduiding } from "@/lib/pacing/landing";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(v);
}

function PacingRing({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct / 100, 1) * circ;

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E1E5F2" strokeWidth="5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
      />
    </svg>
  );
}

export function PacingMonitor({ clientId, countryFilter, edition }: { clientId: string; countryFilter?: string | null; edition?: UpcomingEdition | null }) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const forecast = useMemo(() => computeForecast(data), [data]);

  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;
  const rev = forecast.revenue.kpi;

  const now = new Date();

  // Year progress
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const yearProgressPct = (dayOfYear / 365) * 100;

  // Stuurt de klant op een beurs, dan is "dag 209 van 365" geen ijkpunt maar ruis: het jaar
  // loopt door, de beurs is een deadline. De doelen blijven jaardoelen — daarom blijft het
  // jaarverloop erbij staan; alleen de kop leidt met de afstand die er wél toe doet.
  const wekenTotBeurs = edition ? weeksToFair(edition.fairDate, today()) : null;

  // Year pacing: compare realized vs EXPECTED for this period (not linear annual %)
  // This accounts for seasonality — Q1 might only be 15% of the annual target, not 25%
  const convExpectedYtd = conv.ytdExpected;
  const spendExpectedYtd = spend.ytdExpected;

  // Pacing %: how far are we toward annual target
  const convPacingPct = conv.annualTarget > 0 ? (conv.ytdRealized / conv.annualTarget) * 100 : 0;
  const spendPacingPct = spend.annualTarget > 0 ? (spend.ytdRealized / spend.annualTarget) * 100 : 0;
  const revPacingPct = rev.annualTarget > 0 ? (rev.ytdRealized / rev.annualTarget) * 100 : 0;

  // On pace? Compare realized vs what was EXPECTED for this period (season-aware)
  const convPaceRatio = convExpectedYtd > 0 ? conv.ytdRealized / convExpectedYtd : 1;
  const spendPaceRatio = spendExpectedYtd > 0 ? spend.ytdRealized / spendExpectedYtd : 1;

  // Daily run rate
  const daysElapsed = Math.max(dayOfYear, 1);
  const dailyConvRate = conv.ytdRealized / daysElapsed;
  const dailySpendRate = spend.ytdRealized / daysElapsed;
  const remainingDays = 365 - dayOfYear;
  // "Nodig per dag" based on remaining target gap (target - realized so far)
  const convGap = Math.max(0, conv.annualTarget - conv.ytdRealized);
  const spendGap = Math.max(0, spend.annualTarget - spend.ytdRealized);
  const convNeededPerDay = remainingDays > 0 ? convGap / remainingDays : 0;
  const spendNeededPerDay = remainingDays > 0 ? spendGap / remainingDays : 0;

  // ── Waar land je? ──────────────────────────────────────────────────────
  //
  // De kaart zei hoe hard je gaat en wat er nodig is, maar niet waar je dan uitkomt -- terwijl dat
  // de vraag is die er meteen op volgt. Twee antwoorden, want een rechte lijn en de prognose zijn
  // niet hetzelfde: zie lib/pacing/landing.ts.
  const convLanding = berekenLanding({
    gerealiseerd: conv.ytdRealized,
    tempoPerDag: dailyConvRate,
    dagenResterend: remainingDays,
    prognose: conv.adjustedAnnual,
    doel: conv.annualTarget,
  });
  const convSeizoen = seizoensduiding(convLanding);

  // Status colors & labels
  // Conversions: straightforward pace check
  const convColor = convPaceRatio >= 0.9 ? "#22c55e" : convPaceRatio >= 0.7 ? "#f59e0b" : "#ef4444";
  const convStatus = convPaceRatio >= 0.9 ? "Op schema" : convPaceRatio >= 0.7 ? "Achterlopend" : "Sterk achter";

  // Budget: also consider whether spend is translating into results
  // If spend is "on track" but conversions are far behind, the spend is inefficient
  const spendIsOnPace = spendPaceRatio >= 0.9;
  const convIsWayBehind = convPaceRatio < 0.7;
  const spendColor = spendIsOnPace && convIsWayBehind
    ? "#f59e0b"  // amber: spending enough but not getting results
    : spendPaceRatio >= 0.9 ? "#22c55e" : spendPaceRatio >= 0.7 ? "#f59e0b" : "#ef4444";
  const spendStatus = spendIsOnPace && convIsWayBehind
    ? "Inefficiënt"
    : spendPaceRatio >= 0.9 ? "Op schema" : spendPaceRatio >= 0.7 ? "Achterlopend" : "Sterk achter";

  return (
    <div className="@container bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4.5 h-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-blue-ink uppercase tracking-wide">Pacing</h3>
        <span className="text-micro text-muted-foreground ml-auto">
          {wekenTotBeurs != null && wekenTotBeurs >= 0 && (
            <span className="font-semibold text-rm-blue-ink mr-1.5">
              Nog {wekenTotBeurs} {wekenTotBeurs === 1 ? "week" : "weken"} tot {edition!.label} ·
            </span>
          )}
          Dag {dayOfYear} van 365 · {Math.round(yearProgressPct)}% van het jaar
        </span>
      </div>

      {/* @2xl en niet lg: deze kaart kan nu in een bentokolom van 400px staan, en dan zijn vier
          tegels naast elkaar 100px breed. lg: kijkt naar het venster en ziet dat verschil niet. */}
      <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
        {/* Conversions pacing */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <PacingRing pct={convPacingPct} color={convColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-micro font-bold" style={{ color: convColor }}>
                {Math.round(convPacingPct)}%
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-rm-gray">Conversies</p>
            <p className="text-micro text-muted-foreground">{num(conv.ytdRealized)} / {num(conv.annualTarget)}</p>
            <p className="text-micro font-medium" style={{ color: convColor }}>{convStatus}</p>
          </div>
        </div>

        {/* Spend pacing */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <PacingRing pct={spendPacingPct} color={spendColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-micro font-bold" style={{ color: spendColor }}>
                {Math.round(spendPacingPct)}%
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-rm-gray">Budget</p>
            <p className="text-micro text-muted-foreground">{fmt(spend.ytdRealized)} / {fmt(spend.annualTarget)}</p>
            <p className="text-micro font-medium" style={{ color: spendColor }}>{spendStatus}</p>
          </div>
        </div>

        {/* Daily run rate — conversions */}
        <div className="border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo conversies</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-rm-gray">{num(dailyConvRate)}</span>
            <span className="text-micro text-muted-foreground">/dag</span>
          </div>
          {convNeededPerDay > 0 && (
            <p className={`text-micro mt-1 ${dailyConvRate >= convNeededPerDay ? "text-green-600" : "text-red-500"}`}>
              {dailyConvRate >= convNeededPerDay ? "✓" : "✗"} Nodig: {num(convNeededPerDay)}/dag
            </p>
          )}
        </div>

        {/* Daily run rate — spend */}
        <div className="border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo spend</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-rm-gray">{fmt(dailySpendRate)}</span>
            <span className="text-micro text-muted-foreground">/dag</span>
          </div>
          {spendNeededPerDay > 0 && (
            <p className={`text-micro mt-1 ${dailySpendRate >= spendNeededPerDay * 0.9 ? "text-green-600" : "text-red-500"}`}>
              {dailySpendRate >= spendNeededPerDay * 0.9 ? "✓" : "✗"} Nodig: {fmt(spendNeededPerDay)}/dag
            </p>
          )}
        </div>
      </div>

      {/* De landing. Dit stond er niet, en het was de vraag die na "3 per dag, nodig 6,8" meteen
          komt: en waar kom ik dan uit?

          Twee getallen naast elkaar en niet een. "Op dit tempo" is een rechte lijn en met de hand
          na te rekenen; de prognose weet dat november niet op juli lijkt. Alleen het eerste tonen
          zou de prognosegrafiek elders op het scherm tegenspreken -- twee getallen die allebei
          "het jaar" heten en niet hetzelfde zeggen. Het VERSCHIL is de boodschap.

          "geschat jaardoel" en niet "jaardoel": dat getal is vorig jaar x 1,10 uit
          client-data/route.ts, want er is nog geen scherm om een doel in te voeren. */}
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          Waar je op uitkomt
        </p>
        <div className="mt-2 flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <p className="text-micro text-muted-foreground">Op dit tempo</p>
            <p className="text-lg font-bold text-rm-gray">{num(convLanding.opTempo)}</p>
            {convLanding.deelVanDoel !== null && (
              <p className="text-micro text-muted-foreground">
                {Math.round(convLanding.deelVanDoel * 100)}% van geschat jaardoel
              </p>
            )}
          </div>
          {convLanding.volgensPrognose !== null && (
            <div>
              <p className="text-micro text-muted-foreground">Volgens de prognose</p>
              <p className="text-lg font-bold text-rm-gray">{num(convLanding.volgensPrognose)}</p>
              <p className="text-micro text-muted-foreground">seizoen meegerekend</p>
            </div>
          )}
        </div>
        {/* Alleen bij een verschil dat ertoe doet. Een zin over elke afwijking leert de lezer hem
            over te slaan, en dan mist hij hem op de dag dat er wél iets aan de hand is. */}
        {convSeizoen && (
          <p className="mt-2 text-meta leading-snug text-muted-foreground">{convSeizoen}</p>
        )}
      </div>
    </div>
  );
}

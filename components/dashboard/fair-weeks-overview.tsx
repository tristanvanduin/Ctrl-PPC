"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, CheckCircle2, Clock, ArrowRight, CalendarClock, Info } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast, type ForecastMetric } from "@/lib/forecast";
import { METRIC_LABELS, formatDeltaPercent, formatPercent, formatterFor, isLowerBetter } from "@/lib/forecast-format";
import { toFairWeeks, currentWeekIndex, type FairWeek, type UpcomingEdition } from "@/lib/rai/fair-weeks";
import { today } from "@/lib/reporting-date";

// De beursvariant van de prestatiekaart. Zelfde cijfers als de maandweergave, andere as: niet
// "vorige, huidige en volgende maand" maar "nog zoveel weken tot de beurs". Voor een
// beursorganisatie is dat de enige as die stuurt — een maandgrens betekent niets, de beursdag
// alles. De rekenkern staat in lib/rai/fair-weeks; dit is puur de uitlezing.

// Hoeveel weken de strip laat zien rond de huidige week. Zestien kolommen is ongeveer wat de
// twaalf-maanden-strip innam; meer wordt onleesbaar smal, minder verliest de aanloop.
const STRIP_TERUG = 8;
const STRIP_VOORUIT = 8;

function WeekCard({
  week,
  format,
  variant,
  inverted,
}: {
  week: FairWeek;
  format: (v: number) => string;
  variant: "previous" | "current" | "next";
  inverted: boolean;
}) {
  const value = week.realized ?? week.forecast ?? 0;
  const diff = week.expected > 0 ? ((value - week.expected) / week.expected) * 100 : 0;
  const ratio = week.expected > 0 ? value / week.expected : 0;
  const isPositive = inverted ? diff <= 0 : diff >= 0;
  const isRealized = week.realized !== null;

  const diffColor = isPositive ? "text-green-600" : "text-red-500";
  const borderColors = {
    previous: isPositive ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50",
    current: "border-rm-blue/30 bg-rm-blue/5",
    next: "border-border bg-gray-50/50",
  };
  const labels = { previous: "Vorige week", current: "Deze week", next: "Volgende week" };
  const statusIcons = {
    previous: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
    current: <Clock className="w-3.5 h-3.5 text-rm-blue" />,
    next: <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />,
  };

  // De kop is de afstand tot de beurs; de kalenderweek staat eronder als bijschrift, zodat
  // niemand hoeft te rekenen om te weten wélke week dit is.
  const afstand = week.weeksOut > 0
    ? `nog ${week.weeksOut} ${week.weeksOut === 1 ? "week" : "weken"}`
    : week.weeksOut === 0
      ? "beursweek"
      : `${-week.weeksOut} ${week.weeksOut === -1 ? "week" : "weken"} na de beurs`;

  return (
    <div className={`rounded-lg border p-4 ${borderColors[variant]}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {statusIcons[variant]}
          <div>
            <span className="text-sm font-semibold text-rm-gray">{afstand}</span>
            <span className="text-micro text-muted-foreground ml-1.5">{labels[variant]}</span>
            <p className="text-micro text-muted-foreground">
              {week.label} · week van {week.weekStart.slice(8, 10)} {week.monthLabel.toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isPositive
            ? <TrendingUp className="w-3.5 h-3.5 text-green-600" />
            : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
          <span className={`text-xs font-bold ${diffColor}`}>
            {formatDeltaPercent(diff)}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <span className="text-meta text-muted-foreground">{isRealized ? "Gerealiseerd" : "Prognose"}</span>
          <span className={`text-base font-bold ${variant === "current" ? "text-rm-blue" : "text-rm-gray"}`}>
            {format(value)}
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-meta text-muted-foreground">Verwacht</span>
          <span className="text-xs text-muted-foreground">{format(week.expected)}</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-micro mb-1">
          <span className="text-muted-foreground">Ratio</span>
          <span className={`font-semibold ${diffColor}`}>{formatPercent(ratio, 1)}</span>
        </div>
        <div className="h-1.5 bg-white/80 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isPositive ? "bg-green-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(ratio * 100, 120)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function FairWeeksOverview({
  clientId,
  countryFilter,
  edition,
}: {
  clientId: string;
  countryFilter?: string | null;
  edition: UpcomingEdition;
}) {
  const [metric, setMetric] = useState<ForecastMetric>("conversions");

  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(data);
  const result = forecast[metric];
  const format = formatterFor(metric);
  const inverted = isLowerBetter(metric);

  const vandaag = today();
  const { weken, nu } = useMemo(() => {
    const w = toFairWeeks(result.weeklyPoints, data.currentYear, edition.fairDate);
    return { weken: w, nu: currentWeekIndex(w, vandaag) };
  }, [result.weeklyPoints, data.currentYear, edition.fairDate, vandaag]);

  if (nu < 0) return null;

  const vorige = weken[nu - 1];
  const huidige = weken[nu];
  const volgende = weken[nu + 1];

  const strip = weken.slice(Math.max(0, nu - STRIP_TERUG), nu + STRIP_VOORUIT + 1);
  const wekenTotBeurs = huidige?.weeksOut ?? null;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide flex items-center gap-2">
            <CalendarClock className="w-4 h-4" />
            Weken tot {edition.eventName}
          </h3>
          <p className="text-meta text-muted-foreground mt-0.5">
            {wekenTotBeurs != null && wekenTotBeurs >= 0
              ? <>Nog <strong className="text-rm-gray">{wekenTotBeurs} {wekenTotBeurs === 1 ? "week" : "weken"}</strong> tot {edition.label} ({edition.fairDate})</>
              : <>{edition.label} ({edition.fairDate}) is geweest</>}
            {" · ratio geeft aan of je boven of onder verwachting zit"}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 shrink-0">
          {(["conversions", "revenue", "roas", "cpa"] as ForecastMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === m ? "bg-rm-blue text-white" : "text-muted-foreground hover:text-rm-blue"
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {edition.afgeleid && (
        <div className="mx-5 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-800 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            De datum van {edition.label} staat nog niet in de instellingen; hij is doorgerekend uit de
            cadans na {edition.previousLabel ?? "de vorige editie"}. Zet de echte beursdatum bij
            Instellingen → Beurzen, dan klopt de aftelling exact.
          </span>
        </div>
      )}

      <div className="px-5 pb-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {vorige && <WeekCard week={vorige} format={format} variant="previous" inverted={inverted} />}
          {huidige && <WeekCard week={huidige} format={format} variant="current" inverted={inverted} />}
          {volgende && <WeekCard week={volgende} format={format} variant="next" inverted={inverted} />}
        </div>
      </div>

      <div className="mt-2 border-t border-border">
        <div className="px-5 py-3">
          <div className="flex gap-0.5 overflow-x-auto">
            {strip.map((w) => {
              const value = w.realized ?? w.forecast ?? 0;
              const ratio = w.expected > 0 ? value / w.expected : 0;
              const isFocus = w.weekStart === huidige?.weekStart;
              const isRealized = w.realized !== null;
              const isBeursweek = w.weeksOut === 0;
              const isPositive = inverted ? ratio <= 1 : ratio >= 1;
              const ratioColor = isPositive ? "text-green-600" : "text-red-500";
              const barColor = isPositive ? "bg-green-400" : "bg-red-400";

              return (
                <div
                  key={w.weekStart}
                  className={`flex-1 min-w-[52px] rounded-md px-1.5 py-2 text-center transition-colors ${
                    isBeursweek
                      ? "bg-rm-orange/10 ring-1 ring-rm-orange/40"
                      : isFocus
                        ? "bg-rm-blue/8 ring-1 ring-rm-blue/20"
                        : isRealized
                          ? "bg-gray-50"
                          : ""
                  }`}
                >
                  <p className={`text-micro font-medium mb-1 ${
                    isBeursweek ? "text-rm-orange font-semibold" : isFocus ? "text-rm-blue font-semibold" : isRealized ? "text-rm-gray" : "text-muted-foreground"
                  }`}>
                    {w.label}
                  </p>
                  <p className={`text-meta font-semibold ${isFocus ? "text-rm-blue" : "text-rm-gray"}`}>
                    {format(value)}
                  </p>
                  <div className="mt-1.5 mx-auto w-full max-w-[36px]">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(ratio * 100, 120)}%` }} />
                    </div>
                  </div>
                  <p className={`text-micro font-bold mt-0.5 ${ratioColor}`}>{formatPercent(ratio, 0)}</p>
                </div>
              );
            })}
          </div>
          <p className="text-micro text-muted-foreground mt-2">
            Elke kolom is een week, aflopend naar de beursweek toe: W-8 is acht weken voor {edition.label}.
            De oranje kolom is de beursweek zelf.
          </p>
        </div>
      </div>
    </div>
  );
}

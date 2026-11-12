"use client";

// De vier metrics van één maand, in het paneel dat opent als je in "CPA per maand" of "Conversies
// per maand" op een punt of een staaf klikt.
//
// Waarom dit een eigen bestand is. De twee grafieken droegen elk een letterlijke kopie van dit
// paneel, en beide lazen de maand op via een index in de prognose van het lopende jaar. Sinds de
// grafieken de gekozen periode volgen (bouwplan fase 2) kan een maand ook in een eerder jaar
// liggen, en daar heeft de prognose geen punt voor. Eén paneel dus, met twee eerlijke vormen:
//
// - een maand van het lopende jaar: gerealiseerd of prognose, tegen wat er verwacht werd, met de
//   verhouding erbij; precies wat er stond;
// - een maand uit een eerder jaar: wat er gemeten is. Geen "verwacht" en geen percentage: de
//   prognose gaat over dit jaar, en een verhouding tegen een verwachting die niet bestaat zou een
//   getal zijn dat niets meet.

import { ALLE_FORECAST_METRICS, type ClientForecast } from "@/lib/forecast";
import { METRIC_LABELS, formatPercent, formatterFor, geenWaardeLabel, isLowerBetter, zonderData } from "@/lib/forecast-format";
import { formatMonth } from "@/lib/period/period-range";
import type { DatedMonth } from "@/lib/period/apply-period";
import { PeriodPopover } from "@/components/ui/period-popover";

/** De gemeten waarde van een metric in één maand, of null als hij niet bestaat (geen noemer). */
function gemeten(maand: DatedMonth, metric: (typeof ALLE_FORECAST_METRICS)[number]): number | null {
  if (metric === "conversions") return maand.conversions;
  if (metric === "revenue") return maand.revenue;
  if (metric === "roas") return maand.adSpend > 0 ? maand.revenue / maand.adSpend : null;
  return maand.conversions > 0 ? maand.adSpend / maand.conversions : null;
}

export function MaandMetriekenPopover({ maand, forecast, prognoseJaar, onClose }: {
  maand: DatedMonth;
  forecast: ClientForecast;
  /** Het jaar waar `forecast` over gaat; alleen voor maanden van dat jaar heeft hij een punt. */
  prognoseJaar: number;
  onClose: () => void;
}) {
  const inPrognoseJaar = maand.year === prognoseJaar;
  return (
    <PeriodPopover
      title={formatMonth(maand.key)}
      subtitle={inPrognoseJaar ? "Alle vier de metrics voor deze maand" : "Alle vier de metrics voor deze maand, zoals gemeten"}
      onClose={onClose}
    >
      <div className="space-y-3">
        {ALLE_FORECAST_METRICS.map((m) => {
          const mFormat = formatterFor(m);
          const p = inPrognoseJaar ? forecast[m].points[maand.month - 1] : undefined;
          if (!p) {
            const waarde = gemeten(maand, m);
            return (
              <div key={m} className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-body font-semibold text-brand-gray">{METRIC_LABELS[m]}</p>
                  <p className="text-micro text-muted-foreground">Gerealiseerd</p>
                </div>
                <p className="text-lead font-bold text-brand-gray">{waarde === null ? "—" : mFormat(waarde)}</p>
              </div>
            );
          }
          // Een maand zonder realisatie en zonder prognose stond hier als "Prognose", waarde 0 en
          // een gekleurde ratio die niets meet.
          const mGeenData = zonderData(p);
          const mVal = p.realized ?? p.forecast ?? 0;
          const mInverted = isLowerBetter(m);
          const mPositive = mInverted ? p.monthRatio <= 1 : p.monthRatio >= 1;
          return (
            <div key={m} className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
              <div>
                <p className="text-body font-semibold text-brand-gray">{METRIC_LABELS[m]}</p>
                <p className="text-micro text-muted-foreground">
                  {mGeenData ? geenWaardeLabel(p, m) : p.realized !== null ? "Gerealiseerd" : "Prognose"} · verwacht {mFormat(p.expected)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lead font-bold text-brand-gray">{mGeenData ? "—" : mFormat(mVal)}</p>
                {!mGeenData && (
                  <p className={`text-micro font-semibold ${mPositive ? "text-green-600" : "text-red-500"}`}>
                    {formatPercent(p.monthRatio, 0)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PeriodPopover>
  );
}

"use client";

import { TrendingUp, TrendingDown, Target, DollarSign, BarChart3, Wallet } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { actieveMetrics, computeForecast, jaarKaartCijfers, MONTH_LABELS, type ClientForecast, type ForecastMetric, type JaarKaartCijfers } from "@/lib/forecast";
import { formatCurrency, formatDeltaPercent, formatNumber, formatRoas, isLowerBetter } from "@/lib/forecast-format";
import { Kerncijfer } from "@/components/ui/kerncijfer";
import { KlikbareKaart } from "@/components/ui/klikbare-kaart";

interface KpiCardProps {
  label: string;
  icon: React.ReactNode;
  /** Uit jaarKaartCijfers (lib/forecast.ts): doel, YTD, prognose, verschil en verwachtingsstreep. */
  cijfers: JaarKaartCijfers;
  format: (v: number) => string;
  /** Subtitle shown below the label */
  subtitle?: string;
  /** Feedback: "jaaroverzicht-kaartjes klikbaar, laat de maandresultaten van die metric zien."
   *  Optioneel zodat een kale <KpiCard> zonder klik-gedrag blijft werken als dat ooit nodig is. */
  metricKey?: ForecastMetric;
  selected?: boolean;
  onSelect?: (metric: ForecastMetric) => void;
}

function KpiCard({ label, icon, cijfers, format, subtitle, metricKey, selected, onSelect }: KpiCardProps) {
  const { annualTarget, adjusted, realized, diffPct, realizedPct, verwachtPct, laatsteMaand } = cijfers;
  // De streep en het label stonden hier vast op 25% met "Q1" erbij: het hele jaar op eind maart,
  // ook in augustus. Nu de seizoensverwachting t/m de laatste gerealiseerde maand, per metric
  // (zie jaarKaartCijfers).
  const verwachtLinks = verwachtPct === null ? null : Math.min(Math.max(verwachtPct, 0), 100);
  const verwachtTot = laatsteMaand >= 0 ? MONTH_LABELS[laatsteMaand].toLowerCase() : null;

  // Het teken van diffPct blijft eerlijk (+ = prognose boven doel); alleen het oordeel draait om
  // bij een metric waar lager beter is (CPA), zoals op de maand- en weekkaarten.
  const isPositive = metricKey && isLowerBetter(metricKey) ? diffPct <= 0 : diffPct >= 0;
  const StatusIcon = isPositive ? TrendingUp : TrendingDown;
  const statusColor = isPositive ? "text-green-600" : "text-red-500";
  const statusBg = isPositive ? "bg-green-50" : "bg-red-50";
  return (
    <KlikbareKaart waarde={metricKey} geselecteerd={selected} onKies={onSelect}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-blue/10 flex items-center justify-center">
            {icon}
          </div>
          <div>
            <h3 className="text-title font-semibold text-brand-blue-ink">{label}</h3>
            {subtitle && <p className="text-micro text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className={`w-7 h-7 rounded-full ${statusBg} flex items-center justify-center`}>
          <StatusIcon className={`w-3.5 h-3.5 ${statusColor}`} />
        </div>
      </div>

      {/* Het cijfer waar deze kaart om draait, in de gedeelde maat. Stond op text-2xl terwijl
          hetzelfde soort getal in de periodeband op text-figure staat; dat verschil had geen
          reden. De rest van de kaart (doel, prognose, voortgang) blijft eigen opbouw. */}
      <div className="mb-4">
        {/* Null voor een CPA zonder één conversie (ytdGerealiseerd): dat is geen € 0. */}
        <Kerncijfer label="Gerealiseerd YTD" waarde={realized === null ? "—" : format(realized)} />
      </div>

      {/* Target + Forecast */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Jaardoel</span>
          <span className="text-xs font-semibold text-brand-gray">{format(annualTarget)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Jaarprognose</span>
          <span className="text-xs font-semibold text-brand-blue-ink">{format(adjusted)}</span>
        </div>
      </div>

      {/* Voortgangsbalk. Alleen voor optelbare metrics (realizedPct !== null): "141% van een
          doel-CPA gerealiseerd" betekent niets. Zelfde keuze als KpiTegel in
          channel-forecast-overview.tsx (Meta/LinkedIn/Microsoft). Zonder doel geen blok: dan is
          er geen verschil om te tonen, en een "+0,0%" in het groen is een oordeel zonder grond. */}
      {annualTarget > 0 && (
        <div>
          <div className="flex justify-between text-micro mb-1.5">
            <span className="text-muted-foreground">
              {realizedPct !== null ? `${Math.round(realizedPct)}% gerealiseerd` : "t.o.v. doel"}
            </span>
            <span className={`font-bold ${statusColor}`}>
              {formatDeltaPercent(diffPct)}
            </span>
          </div>
          {realizedPct !== null && (
            <>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden relative">
                {/* Waar je volgens het seizoen nu had moeten staan */}
                {verwachtLinks !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-brand-blue/30 z-10"
                    style={{ left: `${verwachtLinks}%` }}
                  />
                )}
                <div
                  className={`h-full rounded-full transition-all ${
                    isPositive ? "bg-gradient-to-r from-green-400 to-green-500" : "bg-gradient-to-r from-red-400 to-red-500"
                  }`}
                  style={{ width: `${Math.min(realizedPct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-micro text-muted-foreground mt-1">
                <span>0%</span>
                <span>{verwachtPct !== null && verwachtTot ? `Verwacht t/m ${verwachtTot} (${Math.round(verwachtPct)}%)` : ""}</span>
                <span>100%</span>
              </div>
            </>
          )}
        </div>
      )}
    </KlikbareKaart>
  );
}

/**
 * De Google-ingang: haalt data en forecast uit ClientDataProvider en geeft ze door aan de weergave.
 *
 * Gesplitst om dezelfde reden als FairWeeksOverview (zie fair-weeks-overview.tsx): "Alle kanalen"
 * hoort dezelfde kaartjes te krijgen, en die heeft de Google-only provider niet. De blended
 * historie levert exact dezelfde ClientHistoricalData + ClientForecast.
 */
export function MetricCards({ clientId, countryFilter, selected, onSelect }: {
  clientId: string;
  countryFilter?: string | null;
  /** Optioneel: welk kaartje visueel als actief toont en waar een klik op landt. Zonder deze
   *  props zijn de kaartjes niet klikbaar, zoals voorheen. */
  selected?: ForecastMetric;
  onSelect?: (metric: ForecastMetric) => void;
}) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  // Uit de provider: eerder rekende dit component de forecast bij elke render opnieuw uit
  // (0,566 ms per keer, twaalf componenten). Nu een keer per klant.
  //
  // Bekend en nog open: met een landfilter is `gedeeld` de forecast van het hele account, terwijl
  // de kop een land noemt. Dat gold al voor drie van de vier kaartjes; nu de CPA-kaart ook uit de
  // forecast komt, geldt het voor alle vier.
  const gedeeld = useForecast();
  return <MetricCardsView forecast={gedeeld ?? computeForecast(data)} selected={selected} onSelect={onSelect} />;
}

export function MetricCardsView({ forecast, selected, onSelect }: {
  forecast: ClientForecast;
  selected?: ForecastMetric;
  onSelect?: (metric: ForecastMetric) => void;
}) {
  // Alle vier de kaartjes uit dezelfde forecast. De CPA rekende hier eerder eigen cijfers uit
  // (Q1-kosten gedeeld door YTD-conversies; doelbudget gedeeld door geprognotiseerde conversies) --
  // zie jaarKaartCijfers in lib/forecast.ts voor wat dat opleverde.
  // Feedback #27: alleen de KPI's tonen die deze klant een doel heeft gegeven (client-
  // settings.tsx's "activeer deze KPI"), niet altijd alle vier -- een lege "ROAS: €0"-kaart voor
  // een klant die nooit op ROAS stuurt is ruis, geen inzicht.
  const actief = actieveMetrics(forecast);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {actief.includes("conversions") && (
        <KpiCard
          label="Conversies"
          icon={<Target className="w-4 h-4 text-brand-blue-ink" />}
          cijfers={jaarKaartCijfers(forecast, "conversions")}
          format={formatNumber}
          subtitle="Totaal aantal"
          metricKey="conversions"
          selected={selected === "conversions"}
          onSelect={onSelect}
        />
      )}
      {actief.includes("revenue") && (
        <KpiCard
          label="Omzet"
          icon={<DollarSign className="w-4 h-4 text-brand-blue-ink" />}
          cijfers={jaarKaartCijfers(forecast, "revenue")}
          format={formatCurrency}
          subtitle="Conversiewaarde"
          metricKey="revenue"
          selected={selected === "revenue"}
          onSelect={onSelect}
        />
      )}
      {actief.includes("roas") && (
        <KpiCard
          label="ROAS"
          icon={<BarChart3 className="w-4 h-4 text-brand-blue-ink" />}
          cijfers={jaarKaartCijfers(forecast, "roas")}
          format={formatRoas}
          subtitle="Return on ad spend"
          metricKey="roas"
          selected={selected === "roas"}
          onSelect={onSelect}
        />
      )}
      {actief.includes("cpa") && (
        <KpiCard
          label="CPA"
          icon={<Wallet className="w-4 h-4 text-brand-blue-ink" />}
          cijfers={jaarKaartCijfers(forecast, "cpa")}
          // Was `€${v.toFixed(2)}`: "€76.00", zonder spatie en met een punt, terwijl de kaart
          // ernaast "€ 143.520" schrijft. Dezelfde grootheid hoort er hetzelfde uit te zien.
          format={formatCurrency}
          subtitle="Kosten per conversie"
          metricKey="cpa"
          selected={selected === "cpa"}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

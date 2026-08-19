"use client";

import { Globe2, Loader2, ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { MapErrorBoundary } from "./map-error-boundary";
import { CHANNEL_LABEL, type GeoBreakdownState } from "@/lib/geo/use-geo-breakdown";
import { Laadvlak } from "@/components/ui/laadvlak";
import type { ReactNode } from "react";

const WorldMap = dynamic(() => import("./world-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-blue-ink" /></div>,
});
const UsStatesMap = dynamic(() => import("./us-states-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-blue-ink" /></div>,
});

// De kaart-helft van GeoBreakdown, apart (17.36): "deze moet eronder, dan kan de geo kaart
// groter" gevolgd door "kan dit stuk groter binnen het blok" -- de ranglijst deelde nog steeds de
// kaartbreedte, ook toen hij eronder stond. Geen ranglijst, geen tabel: alleen de kop, de kaart en
// de klik-op-VS-hint, zodat de kaart de volle kolombreedte krijgt. Krijgt state van
// useGeoBreakdown() mee als prop in plaats van hem zelf aan te roepen -- zelfde hook-instantie als
// GeoRanglijstCard ernaast, anders lopen metric-keuze en VS-drilldown uit elkaar.
export function GeoMapCard({ state, channel = "google", verdieping }: {
  state: GeoBreakdownState;
  channel?: "google" | "meta" | "linkedin" | "blended";
  verdieping?: ReactNode;
}) {
  const { metricKey, setMetricKey, metric, focus, setFocus, countries, laden, canDrillUs, geoWord, values, ranked, eenLandOfMinder } = state;

  if (laden) return <Laadvlak vorm="grafiek" hoogte={220} titel="Waar komt het vandaan" />;
  if (eenLandOfMinder) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Globe2 className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">
          Waar komt het vandaan{focus === "US" ? " — Verenigde Staten" : ""}
        </h3>
        <span className="text-micro font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{CHANNEL_LABEL[channel]}</span>
        {focus === "US" && (
          <button
            onClick={() => setFocus(null)}
            className="flex items-center gap-0.5 text-meta font-medium text-brand-blue-ink hover:underline"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Wereld
          </button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-meta text-muted-foreground">
          Toon
          <select
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value as typeof metricKey)}
            className="rounded-md border border-border bg-card px-2 py-1 text-body font-medium text-brand-gray focus:outline-none focus:ring-1 focus:ring-brand-blue"
          >
            {[
              { key: "conversions", label: "Conversies" },
              { key: "impressions", label: "Vertoningen" },
              { key: "clicks", label: "Klikken" },
              { key: "ctr", label: "CTR" },
              { key: "conversionRate", label: "Conversieratio" },
              { key: "cpa", label: "CPA" },
            ].map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          per {geoWord}
        </label>
      </div>

      <div className="px-3 py-3">
        {ranked.length === 0 ? (
          <p className="text-body text-muted-foreground py-4 text-center">Geen {geoWord}-data voor deze metric.</p>
        ) : (
          <MapErrorBoundary>
            {focus === "US" ? (
              <UsStatesMap values={values} format={metric.fmt} metricLabel={metric.label} />
            ) : (
              <WorldMap values={values} format={metric.fmt} metricLabel={metric.label} onCountryClick={canDrillUs ? (a) => a === "US" && setFocus("US") : undefined} />
            )}
          </MapErrorBoundary>
        )}
        {focus == null && canDrillUs && (
          <p className="text-center text-meta text-muted-foreground pt-1">Klik op de <strong>Verenigde Staten</strong> om de staten te zien.</p>
        )}
        {focus == null && !canDrillUs && countries.some((c) => c.code === "US") && (
          <p className="text-center text-meta text-muted-foreground pt-1">
            Voor de <strong>Verenigde Staten</strong> is geen staten-uitsplitsing beschikbaar: die data is
            voor dit account nog niet gesynct.
          </p>
        )}
      </div>

      {verdieping}
    </div>
  );
}

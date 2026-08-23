"use client";

import { Globe2, Loader2, ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { MapErrorBoundary } from "./map-error-boundary";
import { CHANNEL_LABEL, type GeoBreakdownState } from "@/lib/geo/use-geo-breakdown";
import { GeoEnkelLandKaart } from "./geo-empty-state";
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
  // Was tot 20 augustus 2026 een stille `return null` -- zie geo-empty-state.tsx voor waarom dat
  // de verkeerde uitvoering was van een verder juiste aanname. Precies deze kaart, in precies de
  // nieuwe 2x2-opener (17.36-17.43), was waar "ik mis de geo-kaart in al mijn overzichten" op
  // sloeg: voor een single-country klant (de norm, niet de uitzondering) verdween hij hier het
  // vaakst.
  if (eenLandOfMinder) return <GeoEnkelLandKaart channel={channel} land={countries[0] ?? null} />;

  return (
    // `flex h-full flex-col` met het kaartvlak als `flex-1`: deze kaart deelt een rasterrij met
    // Account Health, en welke van de twee de hoogste is wisselt met de schermbreedte. Wie de
    // laagste is kreeg het verschil als wit onderin. Nu vangt het kaartvlak het op -- de projectie
    // blijft even groot (hij is gecapt), maar staat gecentreerd in de ruimte die overblijft.
    <div className="bg-card flex h-full flex-col rounded-xl border border-border shadow-sm overflow-hidden">
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

      <div className="flex flex-1 flex-col justify-center px-3 py-3">
        {ranked.length === 0 ? (
          <p className="text-body text-muted-foreground py-4 text-center">Geen {geoWord}-data voor deze metric.</p>
        ) : (
          // De kaart-SVG is `w-full h-auto` op een viewBox van 760x380, dus zijn hoogte groeit
          // LINEAIR mee met de kolombreedte -- als enige kaart op het scherm. Alle andere kaarten
          // zijn inhoudsgestuurd en blijven even hoog. Op 1600px viel dat toevallig samen (beide
          // 682px), maar op 1920/2200/2560 stond er 509/579/669px wit onder Account Health, en dat
          // is precies wat de eigenaar zag. Een raster kan dat niet oplossen: de rij wordt zo hoog
          // als zijn hoogste cel, en die cel groeide onbegrensd.
          //
          // De cap staat op de eigen tekengrootte van de kaart (760px). Daarboven werd er alleen
          // opgeschaald: geen enkel land wordt zichtbaarder van een projectie van 1200px breed, de
          // kaart werd alleen groter. Hij centreert nu binnen de kolom en houdt op met groeien.
          <MapErrorBoundary>
            <div className="mx-auto w-full max-w-[760px]">
              {focus === "US" ? (
                <UsStatesMap values={values} format={metric.fmt} metricLabel={metric.label} />
              ) : (
                <WorldMap values={values} format={metric.fmt} metricLabel={metric.label} onCountryClick={canDrillUs ? (a) => a === "US" && setFocus("US") : undefined} />
              )}
            </div>
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

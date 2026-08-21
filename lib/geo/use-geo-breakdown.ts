"use client";

import { useEffect, useMemo, useState } from "react";
import { countryLabel } from "@/lib/countries";
import { stateLabel } from "@/lib/geo/us-fips";
import { type GeoAgg } from "@/lib/demo/geo-demo";

// De gedeelde state achter GeoBreakdown, uitgelicht (17.36) zodat de opener op Google Overzicht de
// kaart en de ranglijst in TWEE aparte kolommen kan zetten zonder de data twee keer op te halen of
// twee losse metric-keuzes te laten ontstaan. GeoBreakdown zelf blijft dit gewoon intern aanroepen
// voor de drie andere plekken (cross-channel, Meta, LinkedIn) waar kaart en lijst nog in één kaart
// staan -- puur een verhuizing van bestaande logica, geen gedragswijziging.

export type Channel = "google" | "meta" | "linkedin" | "blended";
export type MetricKey = "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate" | "cpa";
export interface MetricDef { key: MetricKey; label: string; higherIsBetter: boolean; value: (a: GeoAgg) => number | null; fmt: (v: number | null) => string }

const nf = (d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d });
const eur = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const int = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : nf(0).format(v));

export const METRICS: MetricDef[] = [
  { key: "impressions", label: "Vertoningen", higherIsBetter: true, value: (a) => a.impressions, fmt: int },
  { key: "clicks", label: "Klikken", higherIsBetter: true, value: (a) => a.clicks, fmt: int },
  { key: "ctr", label: "CTR", higherIsBetter: true, value: (a) => (a.impressions > 0 ? a.clicks / a.impressions : null), fmt: pct },
  { key: "conversions", label: "Conversies", higherIsBetter: true, value: (a) => a.conversions, fmt: (v) => (v == null ? "—" : nf(1).format(v)) },
  { key: "conversionRate", label: "Conversieratio", higherIsBetter: true, value: (a) => (a.clicks > 0 ? a.conversions / a.clicks : null), fmt: pct },
  { key: "cpa", label: "CPA", higherIsBetter: false, value: (a) => (a.conversions > 0 ? a.cost / a.conversions : null), fmt: eur },
];

export const CHANNEL_LABEL: Record<Channel, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn", blended: "Alle kanalen" };

export function useGeoBreakdown({ clientId, channel = "google", enabled = true }: {
  clientId: string;
  channel?: Channel;
  /** Fetch overslaan zolang er niets met het resultaat gebeurt (bv. de geo-kloon-weergave op
   *  Google Overzicht, die deze hook niet gebruikt maar de aanroepende component wel altijd
   *  rendert). */
  enabled?: boolean;
}) {
  const [metricKey, setMetricKey] = useState<MetricKey>("conversions");
  const [focus, setFocus] = useState<"US" | null>(null);
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const [countries, setCountries] = useState<GeoAgg[]>([]);
  const [states, setStates] = useState<GeoAgg[]>([]);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLaden(true);
    // /api/geo bepaalt demo vs. echt zelf aan de hand van clientId (lib/geo/geo-source.ts), dus
    // hier is geen aparte demo-vlag meer nodig.
    const haal = (level: "country" | "region") =>
      fetch(`/api/geo?clientId=${encodeURIComponent(clientId)}&channel=${channel}&level=${level}`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d) => (Array.isArray(d?.rows) ? (d.rows as GeoAgg[]) : []))
        .catch(() => [] as GeoAgg[]);

    Promise.all([haal("country"), haal("region")]).then(([land, staat]) => {
      if (cancelled) return;
      setCountries(land);
      setStates(staat);
      setLaden(false);
    });
    return () => { cancelled = true; };
  }, [clientId, channel, enabled]);

  const canDrillUs = states.length > 0 && countries.some((c) => c.code === "US");
  const active = focus === "US" ? states : countries;
  const labelOf = focus === "US" ? stateLabel : countryLabel;
  const geoWord = focus === "US" ? "staat" : "land";

  const ranked = useMemo(() => {
    return active
      .map((c) => ({ c, v: metric.value(c) }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
      .sort((a, b) => (metric.higherIsBetter ? (b.v! - a.v!) : (a.v! - b.v!)));
  }, [active, metric]);

  const values = useMemo(() => {
    const m = new Map<string, number>();
    for (const { c, v } of ranked) if (v != null && Number.isFinite(v)) m.set(c.code, v);
    return m;
  }, [ranked]);

  const totaal = useMemo(() => {
    const t = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    for (const { c } of ranked) {
      t.impressions += c.impressions; t.clicks += c.clicks;
      t.cost += c.cost; t.conversions += c.conversions;
    }
    return t;
  }, [ranked]);

  return {
    metricKey, setMetricKey, metric, focus, setFocus,
    countries, states, laden, canDrillUs, labelOf, geoWord, ranked, values, totaal,
    eenLandOfMinder: countries.length <= 1,
  };
}

export type GeoBreakdownState = ReturnType<typeof useGeoBreakdown>;
export { int, eur, pct, nf };

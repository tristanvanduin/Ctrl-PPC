"use client";

import { useEffect, useState } from "react";
import { type ClientHistoricalData } from "./types";
import { buildClientDataFromApi, type ApiMonthlyData, type YearDataInput } from "./api/adapter";
import { mergeKpiTargets } from "./kpi-target-merge";

interface BlendedApiResponse {
  currentYear: number;
  realizedThroughMonth: number;
  targetCurrentYear: { conversions: number; revenue: number; adSpend: number };
  historicalYears: YearDataInput[];
  currentYearMonthly: ApiMonthlyData[];
}

export interface BlendedClientDataState {
  data: ClientHistoricalData | null;
  loading: boolean;
  error: string | null;
}

// Zelfde soort cache als use-client-data.ts, geen gedeelde entry: andere route, ander schema.
const cache = new Map<string, { data: ClientHistoricalData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Blended (Google + Meta + LinkedIn) tegenhanger van useClientData -- voor de "Alle kanalen"
 * Prognose-tabel. Zie app/api/blended/client-data/route.ts voor de bron.
 */
export function useBlendedClientData(clientId: string): BlendedClientDataState {
  const [state, setState] = useState<BlendedClientDataState>(() => {
    const cached = cache.get(clientId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { data: cached.data, loading: false, error: null };
    }
    return { data: null, loading: true, error: null };
  });

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(clientId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setState({ data: cached.data, loading: false, error: null });
      return;
    }

    setState({ data: null, loading: true, error: null });
    fetch(`/api/blended/client-data?clientId=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((apiData: BlendedApiResponse & { error?: string }) => {
        if (cancelled) return;
        if (apiData.error) {
          setState({ data: null, loading: false, error: apiData.error });
          return;
        }
        const built = buildClientDataFromApi(
          clientId,
          apiData.historicalYears,
          apiData.currentYearMonthly,
          [],
          apiData.targetCurrentYear,
          apiData.currentYear,
          apiData.realizedThroughMonth,
        );
        const enriched = mergeKpiTargets(clientId, built);
        cache.set(clientId, { data: enriched, timestamp: Date.now() });
        setState({ data: enriched, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Onbekende fout" });
      });

    return () => { cancelled = true; };
  }, [clientId]);

  return state;
}

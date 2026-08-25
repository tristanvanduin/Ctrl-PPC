"use client";

import { useEffect, useState } from "react";
import type { ClientForecast } from "../forecast";

/** Client-side ophaalhulp voor /api/analysis/channel-forecast -- de Meta/LinkedIn-tegenhanger
 *  van wat ClientDataProvider/ForecastContext voor Google al doet. */
export function useChannelForecast(clientId: string, channel: "meta" | "linkedin" | "microsoft"): {
  forecast: ClientForecast | null;
  loading: boolean;
} {
  const [forecast, setForecast] = useState<ClientForecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/analysis/channel-forecast?clientId=${encodeURIComponent(clientId)}&channel=${channel}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setForecast(d.forecast ?? null); })
      .catch(() => { if (!cancelled) setForecast(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  return { forecast, loading };
}

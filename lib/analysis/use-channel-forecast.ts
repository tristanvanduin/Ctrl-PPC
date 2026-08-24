"use client";

import { useEffect, useState } from "react";
import type { ClientForecast } from "../forecast";
import type { Kanaal } from "../kanalen/beschikbaar";

/** Client-side ophaalhulp voor /api/analysis/channel-forecast -- de Meta/LinkedIn-tegenhanger
 *  van wat ClientDataProvider/ForecastContext voor Google al doet. */
export function useChannelForecast(
  clientId: string,
  // Elk kanaal, Google inbegrepen: de route erachter kent alle drie (computeAnalysisTargets).
  // In de praktijk leest Google via ClientDataProvider -- die heeft de live API-call al gedaan --
  // maar de beperking hoorde niet in het TYPE te staan, want dan kost een vierde kanaal hier een
  // bewerking die niets met dit bestand te maken heeft.
  channel: Kanaal,
  /** False = niet ophalen. Voor een klant zonder dit kanaal is de call zinloos, en een hook mag
   *  niet voorwaardelijk worden aangeroepen -- dus zit de voorwaarde erin in plaats van eromheen.
   *  (kanaal-health-ranking.tsx roept hem voor elk kanaal aan, ook de kanalen die er niet zijn.) */
  enabled = true,
): {
  forecast: ClientForecast | null;
  loading: boolean;
} {
  const [forecast, setForecast] = useState<ClientForecast | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) { setForecast(null); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/analysis/channel-forecast?clientId=${encodeURIComponent(clientId)}&channel=${channel}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setForecast(d.forecast ?? null); })
      .catch(() => { if (!cancelled) setForecast(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, channel, enabled]);

  return { forecast, loading };
}

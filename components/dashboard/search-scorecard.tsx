"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { HealthBadgeView } from "./health-badge";
import type { HealthScore } from "@/lib/health-score";

/**
 * Masterplan sectie 5.4 (Campaign Type Intelligence): de eerste per-campagnetype scorecard,
 * uitsluitend Google Search -- de enige campagnesoort met genoeg echte data om vandaag te
 * beoordelen (zie de kop van lib/search-scorecard.ts). Hergebruikt HealthBadgeView één-op-één,
 * met een eigen titel/icoon: zelfde opbouw (boog, radar, factorenlijst) als Account Health, geen
 * tweede presentatielaag voor hetzelfde soort getal.
 */
export function SearchScorecard({ clientId }: { clientId: string }) {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [campaignCount, setCampaignCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    setHealth(null);
    setError(null);
    fetch(`/api/analysis/search-scorecard?client_id=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((data: { health?: HealthScore; campaignCount?: number; error?: string }) => {
        if (!actief) return;
        if (data.error) { setError(data.error); return; }
        if (data.health) { setHealth(data.health); setCampaignCount(data.campaignCount ?? 0); }
      })
      .catch((e) => { if (actief) setError(e instanceof Error ? e.message : "onbekende fout"); });
    return () => { actief = false; };
  }, [clientId]);

  if (error) return null; // Zelfde stille degradatie als andere optionele kaarten: geen Search-data is geen crash.
  if (!health) return null;
  // Geen Search-campagnes voor deze klant: geen lege kaart tonen die niets zegt.
  if (campaignCount === 0) return null;

  return <HealthBadgeView health={health} titel="Search Scorecard" Icoon={Search} />;
}

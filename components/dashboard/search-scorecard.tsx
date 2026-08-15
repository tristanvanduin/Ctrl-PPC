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

  // Sinds de verhuizing naar de Campagnes-tab (masterplan sectie 5.4) is dit de enige inhoud van
  // een expliciete, benoemde sectie met een eigen type-kiezer -- stil niets tonen zou hier lezen
  // als kapot, niet als "geen data". Vandaar een boodschap in plaats van null, anders dan toen dit
  // nog een van de vele optionele kaarten op Overzicht was.
  if (error) return <p className="text-meta text-muted-foreground">Scorecard kon niet geladen worden: {error}</p>;
  if (!health) return <p className="text-meta text-muted-foreground">Scorecard laden…</p>;
  if (campaignCount === 0) return <p className="text-meta text-muted-foreground">Geen Search-campagnes gevonden voor deze klant.</p>;

  return <HealthBadgeView health={health} titel="Search Scorecard" Icoon={Search} />;
}

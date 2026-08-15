"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { HealthBadgeView } from "./health-badge";
import type { HealthScore } from "@/lib/health-score";

/**
 * Masterplan sectie 5.4 (Campaign Type Intelligence): de tweede per-campagnetype scorecard, na
 * Search. Eigen opbouw (asset health, netwerkmix, placement-efficiëntie, cannibalisatie met
 * Search/Shopping) i.p.v. Search-logica hergebruikt -- zie de kop van lib/pmax-scorecard.ts.
 * Feed Health staat er als zesde... nee, vijfde factor bij, altijd "niet beoordeeld" tot Merchant
 * Center gesynct is (regel 3 van de vertrouwensdoctrine: eerlijk onbeoordeeld, geen gok). Vijf
 * factoren in totaal, zoals bij Search.
 */
export function PmaxScorecard({ clientId }: { clientId: string }) {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [campaignCount, setCampaignCount] = useState(0);
  const [laden, setLaden] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    setHealth(null);
    setError(null);
    setLaden(true);
    fetch(`/api/analysis/pmax-scorecard?client_id=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((data: { health?: HealthScore | null; campaignCount?: number; error?: string }) => {
        if (!actief) return;
        if (data.error) { setError(data.error); return; }
        setHealth(data.health ?? null);
        setCampaignCount(data.campaignCount ?? 0);
      })
      .catch((e) => { if (actief) setError(e instanceof Error ? e.message : "onbekende fout"); })
      .finally(() => { if (actief) setLaden(false); });
    return () => { actief = false; };
  }, [clientId]);

  if (error) return <p className="text-meta text-muted-foreground">Scorecard kon niet geladen worden: {error}</p>;
  if (laden) return <p className="text-meta text-muted-foreground">Scorecard laden…</p>;
  if (campaignCount === 0 || !health) return <p className="text-meta text-muted-foreground">Geen Performance Max-campagnes gevonden voor deze klant.</p>;

  return <HealthBadgeView health={health} titel="PMax Scorecard" Icoon={Layers} />;
}

"use client";

import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { HealthBadgeView } from "./health-badge";
import type { HealthScore } from "@/lib/health-score";

/**
 * Masterplan sectie 5.4 (Campaign Type Intelligence): de Shopping-scorecard. Eigen opbouw
 * (conversion efficiency, demand capture, auction pressure, product-efficiëntie, feed health)
 * i.p.v. Search- of PMax-logica hergebruikt -- zie de kop van lib/shopping-scorecard.ts. Feed
 * Health staat er als vijfde factor bij, altijd "niet beoordeeld" tot Merchant Center gesynct is
 * (zelfde tabel, zelfde gat als PMax' Feed Health -- regel 3 van de vertrouwensdoctrine).
 */
export function ShoppingScorecard({ clientId }: { clientId: string }) {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [campaignCount, setCampaignCount] = useState(0);
  const [laden, setLaden] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    setHealth(null);
    setError(null);
    setLaden(true);
    fetch(`/api/analysis/shopping-scorecard?client_id=${encodeURIComponent(clientId)}`)
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
  if (campaignCount === 0 || !health) return <p className="text-meta text-muted-foreground">Geen Shopping-campagnes gevonden voor deze klant.</p>;

  return <HealthBadgeView health={health} titel="Shopping Scorecard" Icoon={ShoppingBag} />;
}

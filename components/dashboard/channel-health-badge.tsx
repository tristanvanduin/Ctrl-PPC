"use client";

import { useMemo } from "react";
import { useChannelForecast } from "@/lib/analysis/use-channel-forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene } from "@/lib/health-score";
import { HealthBadgeView } from "./health-badge";

/**
 * Account Health op het Meta- of LinkedIn-tabblad. Zelfde weergave als Google's HealthBadge, met
 * een eigen databron (fase B, 12 aug 2026).
 *
 * Geen impressionShare/wastefulSearchTerms/adGroupBleeders hier -- dat zijn Google Ads-begrippen
 * (Search Impression Share, zoektermen, ad groups) zonder Meta/LinkedIn-equivalent. computeHealthScore
 * zou de Hygiëne-factor zonder die argumenten stilzwijgend de volle score geven zodra er besteding
 * is (bewust Google-gedrag, zie __health_score_test.ts) -- correct voor "geen verspilling
 * gevonden", misleidend voor "nooit naar verspilling gekeken". zonderKanaalSpecifiekeHygiene zet
 * die factor daarom expliciet op "niet beoordeeld" en herschaalt het totaal.
 */
export function ChannelHealthBadge({ clientId, channel }: { clientId: string; channel: "meta" | "linkedin" | "microsoft" }) {
  const { forecast, loading } = useChannelForecast(clientId, channel);
  const health = useMemo(
    () => (forecast ? zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)) : null),
    [forecast],
  );

  if (loading || !health) return null;
  return <HealthBadgeView health={health} />;
}

"use client";

import { useKanaalData } from "./channel-data-provider";
import { HealthBadgeView } from "./health-badge";

/**
 * Account Health op het Meta-, LinkedIn- of Microsoft-tabblad. Zelfde weergave als Google's
 * HealthBadge, met een eigen databron (fase B, 12 aug 2026).
 *
 * De score komt uit het tab-object van ChannelDataProvider (useBlendedClientData.perKanaalTab):
 * dezelfde prognose als het Jaaroverzicht en de beurs-sectie op dit tabblad, en hetzelfde object
 * dat KanaalHealthRanking op "Alle kanalen" voor dit kanaal leest. Tot fase 1, stap 5 vroeg deze
 * badge een TWEEDE prognose aan /api/analysis/channel-forecast (fact_core met de
 * standaardselectie, gerealiseerd t/m vorige kalendermaand): 28,8 kB per tabwissel voor een
 * score die naast het Jaaroverzicht ernaast een ander jaar kon vertellen, en voor Microsoft
 * altijd niets (geen fact_core-projectie).
 *
 * Geen impressionShare/wastefulSearchTerms/adGroupBleeders hier -- dat zijn Google Ads-begrippen
 * (Search Impression Share, zoektermen, ad groups) zonder Meta/LinkedIn-equivalent. computeHealthScore
 * zou de Hygiëne-factor zonder die argumenten stilzwijgend de volle score geven zodra er besteding
 * is (bewust Google-gedrag, zie __health_score_test.ts) -- correct voor "geen verspilling
 * gevonden", misleidend voor "nooit naar verspilling gekeken". De hook zet die factor daarom met
 * zonderKanaalSpecifiekeHygiene op "niet beoordeeld" en herschaalt het totaal (KanaalTab.health).
 *
 * De props blijven zoals de views ze meegeven; de data komt uit de provider die eromheen staat.
 */
export function ChannelHealthBadge(_props: { clientId: string; channel: "meta" | "linkedin" | "microsoft" }) {
  const { forecast } = useKanaalData();
  // Laden (null) en "leeg" (geen dagcijfers): geen kaart, zoals voorheen zonder score.
  if (!forecast || forecast === "leeg") return null;
  return <HealthBadgeView health={forecast.health} />;
}

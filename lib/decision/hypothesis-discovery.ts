// EXECUTION_PLAN.md Stap 6: Hypothesis Discovery en Classification, bewust gescheiden.
//
// Discovery is OPEN: een implementatie mag een hypothese opleveren die in geen enkele vaste
// categorie past, en hoort dat ook te mogen (het HypothesisDiscovery-contract hieronder heeft
// nog geen implementatie, net als ContextEngine uit Stap 5).
//
// Classificatie is GESLOTEN en draait NA discovery. classify() mag nooit een hypothese
// weggooien of aanpassen (zie de test): een hypothese die niet past krijgt null, geen gegokte
// categorie en geen fout. Dat is de blueprint-regel "classificatie mag nooit blokkeren".
//
// classify() is een echte, werkende implementatie (trefwoorden in het statement tegen elke
// categorie), geen fake-happy-path die altijd hetzelfde teruggeeft. custom_pattern is daarbij
// een uitzondering met opzet: dat is de "past nergens anders"-categorie, en die heeft geen eigen
// trefwoordenveld om op te matchen. classify() kent hem alleen toe als discovery een hypothese
// al expliciet zo getagd heeft, nooit als tekstgok.

import type { CandidateCause, ContextAnalysis, Hypothesis, Signal } from "./types";

/** Open. Mag hypotheses opleveren die in geen enkele categorie passen. */
export interface HypothesisDiscovery {
  discover(input: {
    signals: Signal[];
    causes: CandidateCause[];
    context?: ContextAnalysis;
  }): Hypothesis[];
}

/** Gesloten. Draait NA discovery en mag nooit iets weggooien. */
export const HYPOTHESIS_CATEGORIES = [
  "creative", "audience", "budget", "funnel", "search", "tracking",
  "commerce", "revenue", "seasonality", "event", "opportunity", "custom_pattern",
] as const;

export type HypothesisCategory = (typeof HYPOTHESIS_CATEGORIES)[number];

type MatchbareCategorie = Exclude<HypothesisCategory, "custom_pattern">;

// Trefwoorden per categorie, tegen h.statement gematcht (kleine letters, deelstring). Nederlands
// en Engels door elkaar: de hypotheses in deze codebase zijn Nederlands, de categorienamen uit de
// blueprint zijn Engels.
const TREFWOORDEN: Record<MatchbareCategorie, readonly string[]> = {
  creative: ["creative", "creatief", "advertentietekst", "ad copy", "visual", "banner"],
  audience: ["doelgroep", "audience", "targeting", "segment"],
  budget: ["budget", "uitgave", "spend", "bod", "bidding", "bieding"],
  funnel: ["funnel", "trechter", "conversiepad"],
  search: ["zoekterm", "search", "keyword", "zoekopdracht", "zoekwoord"],
  tracking: ["tracking", "attributie", "meting", "pixel", "conversion tracking"],
  commerce: ["product", "voorraad", "merchant", "shop", "feed"],
  revenue: ["omzet", "revenue", "roas", "waarde"],
  seasonality: ["seizoen", "seasonality", "seizoensgebonden"],
  event: ["beurs", "event", "editie", "black friday"],
  opportunity: ["kans", "opportunity", "upsell", "groeikans"],
};

/** Geeft null terug als niets past. Dat is een geldige uitkomst, geen fout. Muteert h niet. */
export function classify(h: Hypothesis): HypothesisCategory | null {
  if (h.category === "custom_pattern") return "custom_pattern";

  const tekst = h.statement.toLowerCase();
  for (const categorie of HYPOTHESIS_CATEGORIES) {
    if (categorie === "custom_pattern") continue;
    if (TREFWOORDEN[categorie].some((woord) => tekst.includes(woord))) return categorie;
  }
  return null;
}

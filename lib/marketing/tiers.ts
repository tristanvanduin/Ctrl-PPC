// De 5-tier ladder voor de pricing-storefront. Combineert wat de v2.0-blueprint al vastlegt met
// wat nog een placeholder is -- zie de bronvermelding per veld hieronder, zodat een latere lezer
// niet hoeft te raden welk getal al besloten was en welk getal hier voor het eerst verzonnen is.
//
// VASTGELEGD (elders in de codebase, niet hier verzonnen):
//   - namen + volgorde: agencies.licentie, migratie 071 (basis/core/growth/scale/professional/
//     enterprise), lib/chat/toegang.ts (LICENTIES).
//   - creditpools: lib/analysis/credit-costs.ts regel 42 (10.000/25.000/50.000/100.000) en
//     lib/tenancy/sop-dekking.ts regel 30 ("blueprint noemt 500k CREDITS voor Enterprise"). De
//     toewijzing welk getal bij welke tier hoort volgt de oplopende volgorde van de tiers zelf --
//     dat is de enige logische lezing, maar was nooit letterlijk zo genoteerd.
//   - SOP-dekking (accounts met automatische SOP's): lib/tenancy/sop-dekking.ts, SOP_DEKKING.
//
// PLACEHOLDER (hier voor het eerst ingevuld, expliciet als "indicative" op de pagina):
//   - prijs per maand. Er staat nergens een afgesproken bedrag vast. Rond en oplopend met de
//     creditpool, zodat de verhouding niet willekeurig oogt, maar het bedrag zelf is een gok.
//   - featurelijst per tier. De blueprint noemt drie tier-exclusieve functies (Custom Playbook
//     Engine, BI Connect, MCP-sandbox, migratie 071) zonder te zeggen welke tier welke
//     ontgrendelt. Die drie staan daarom NIET in de tier-featurelijsten hieronder -- ze op een
//     tier plakken zou een beslissing verzinnen die niemand heeft genomen.

import type { Licentie } from "@/lib/chat/toegang";
import { SOP_DEKKING } from "@/lib/tenancy/sop-dekking";

export interface TierDefinitie {
  licentie: Licentie;
  naam: string;
  vanafPerMaand: number | null; // null = "Custom", geen indicatief bedrag te tonen
  creditsPerMaand: number;
  features: string[];
}

export const TIERS: readonly TierDefinitie[] = [
  {
    licentie: "core",
    naam: "Core",
    vanafPerMaand: 250,
    creditsPerMaand: 10_000,
    features: [
      "Cross-channel account reads: Google, Meta, LinkedIn",
      "Automatic SOP runs for connected accounts",
      "The full 6-step Decision Framework",
    ],
  },
  {
    licentie: "growth",
    naam: "Growth",
    vanafPerMaand: 500,
    creditsPerMaand: 25_000,
    features: [
      "Everything in Core",
      "Cross-account insights, not just per-client",
      "Chat access to the decision assistant",
    ],
  },
  {
    licentie: "scale",
    naam: "Scale",
    vanafPerMaand: 1_000,
    creditsPerMaand: 50_000,
    features: [
      "Everything in Growth",
      "Higher deep-dive credit pool for larger portfolios",
    ],
  },
  {
    licentie: "professional",
    naam: "Professional",
    vanafPerMaand: 2_000,
    creditsPerMaand: 100_000,
    features: [
      "Everything in Scale",
      "Priority credit pool for high-volume agencies",
    ],
  },
  {
    licentie: "enterprise",
    naam: "Enterprise",
    vanafPerMaand: null,
    creditsPerMaand: 500_000,
    features: [
      "Everything in Professional",
      "Custom credit pool and account coverage",
      "Dedicated onboarding",
    ],
  },
];

export function sopDekkingVoor(licentie: Licentie): number {
  return SOP_DEKKING[licentie];
}

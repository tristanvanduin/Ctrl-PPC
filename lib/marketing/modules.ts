// The Intelligence Store: individual module add-ons and bundles, shown below the tier grid on
// /pricing. Same integrity rule as lib/marketing/tiers.ts - `gebouwd` marks whether the
// underlying capability is real today, checked against the codebase before publishing:
//
// Built: Second Opinion Module (app/api/second-opinion/, real routes with a working PDF export),
// Whitelabel Portal (agencies.whitelabel_actief, migration 068, an admin-toggled real column),
// Volume Compute (the credit ledger mechanism itself is real, migration 070 - only the per-tier
// self-serve purchase flow is simulated here, same as everything else on this page).
//
// Not built: God View as described here (anonymized market data ACROSS AGENCIES) is a materially
// bigger feature than what exists - components/terminal/god-mode.tsx and agency-god-view.tsx are
// single-agency or platform-admin views, not a cross-tenant benchmark product. AI Council,
// SEO & Organic Synergy, and Case Study Module have no trace in the codebase at all.

export interface ModulePriceTier {
  naam: string;
  prijsPerMaand: number;
}

export interface StoreModule {
  id: string;
  naam: string;
  omschrijving: string;
  gebouwd: boolean;
  /** Een enkele prijs, of meerdere keuzebare varianten (zoals God View). */
  prijs: number | ModulePriceTier[];
}

export const MODULES: readonly StoreModule[] = [
  {
    id: "god-view",
    naam: "God View",
    omschrijving: "Anonymized market data across all agencies.",
    gebouwd: false,
    prijs: [
      { naam: "Standard", prijsPerMaand: 750 },
      { naam: "Tactical", prijsPerMaand: 1_250 },
      { naam: "Real-Time", prijsPerMaand: 2_500 },
    ],
  },
  {
    id: "whitelabel",
    naam: "Whitelabel Portal",
    omschrijving: "Custom branding over tier templates.",
    gebouwd: true,
    prijs: 500,
  },
  {
    id: "ai-council",
    naam: "The AI Council",
    omschrijving: "Multi-LLM debate engine.",
    gebouwd: false,
    prijs: 300,
  },
  {
    id: "second-opinion",
    naam: "Second Opinion Module",
    omschrijving: "Independent account-level validation.",
    gebouwd: true,
    prijs: 250,
  },
  {
    id: "seo-synergy",
    naam: "SEO & Organic Synergy",
    omschrijving: "Search Console integration for synergy and cannibalization checks.",
    gebouwd: false,
    prijs: 250,
  },
  {
    id: "case-study",
    naam: "Case Study Module",
    omschrijving: "Automated success story generation for sales.",
    gebouwd: false,
    prijs: 150,
  },
  {
    id: "volume-compute",
    naam: "Volume Compute",
    omschrijving: "Dynamically priced blocks of extra compute (Credit Packs).",
    gebouwd: true,
    prijs: 0, // dynamisch: geen vast bedrag, zie de weergave in intelligence-store.tsx
  },
];

export interface StoreBundle {
  id: string;
  naam: string;
  focus: string;
  moduleIds: string[];
  prijsPerMaand: number;
}

export const BUNDLES: readonly StoreBundle[] = [
  {
    id: "agency-growth",
    naam: "The Agency Growth Bundle",
    focus: "Sales and social proof.",
    moduleIds: ["second-opinion", "case-study"],
    prijsPerMaand: 325,
  },
  {
    id: "deep-intelligence",
    naam: "The Deep Intelligence Bundle",
    focus: "Hardcore strategy and absolute retention.",
    moduleIds: ["ai-council", "seo-synergy"],
    prijsPerMaand: 450,
  },
];

export function moduleById(id: string): StoreModule | undefined {
  return MODULES.find((m) => m.id === id);
}

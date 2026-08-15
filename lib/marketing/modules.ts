// The Intelligence Store: individual module add-ons and bundles, shown below the tier grid on
// /pricing. Same integrity rule as lib/marketing/tiers.ts - `gebouwd` marks whether the
// underlying capability is real today, checked against the codebase before publishing:
//
// Built: Second Opinion (app/api/second-opinion/, real routes with a working PDF export),
// Whitelabel Portal (agencies.whitelabel_actief, migration 068, an admin-toggled real column),
// Volume Compute (the credit ledger mechanism itself is real, migration 070 - only the per-tier
// self-serve purchase flow is simulated here, same as everything else on this page).
//
// Not built: God View as described here (anonymized market data ACROSS AGENCIES) is a materially
// bigger feature than what exists - components/terminal/god-mode.tsx and agency-god-view.tsx are
// single-agency or platform-admin views, not a cross-tenant benchmark product. AI Council,
// Demand Intelligence, and Proof Engine have no trace in the codebase at all.
//
// Demand Flow Intelligence (added 12 August 2026, from the positioning strategy doc): distinct
// from Demand Intelligence above. That module is Search Console-specific (organic vs paid
// cannibalization). This one is ad-channel halo effects (Meta spend lifting Search Brand two days
// later, that kind of pattern) across Google/Meta/LinkedIn/Bing. No trace in the codebase - the
// strategy doc itself calls this "largely future architecture."
//
// NAMING AND COPY (15 August 2026, from Ctrl PPC Module Scorecard v2): renamed three modules to
// their definitive names - Second Opinion Module -> Second Opinion, SEO & Organic Synergy ->
// Demand Intelligence, Cross Channel Intelligence -> Demand Flow Intelligence, Case Study Module
// -> Proof Engine, and the God View "Real-Time" tier -> "Pulse". `detail` is new: the longer,
// benefit-framed paragraph shown in the read-more panel in intelligence-store.tsx. It is written
// as customer-facing copy, not a restatement of the scorecard's internal positioning notes (e.g.
// "sell this as sales enablement, not an audit" informed the wording but isn't quoted directly).
// God View keeps its single-card, three-variant shape (kept deliberately, not split into three
// cards per the scorecard's per-tier sections) - each tier's `tagline` carries the scorecard's
// differentiation (see the market / act on it / move first) without the added component cost.

export interface ModulePriceTier {
  naam: string;
  prijsPerMaand: number;
  /** Korte kwalificatie die het verschil met de andere tiers laat zien, bv. "See the market". */
  tagline: string;
}

export interface StoreModule {
  id: string;
  naam: string;
  omschrijving: string;
  /** Langere, klantgerichte alinea voor het read-more-paneel. */
  detail: string;
  gebouwd: boolean;
  /** Een enkele prijs, of meerdere keuzebare varianten (zoals God View). */
  prijs: number | ModulePriceTier[];
}

export const MODULES: readonly StoreModule[] = [
  {
    id: "god-view",
    naam: "God View",
    omschrijving: "Anonymized market data across all agencies.",
    detail:
      "Benchmarks, niche trends, churn risk, and opportunity patterns pooled anonymously across every connected agency - market intelligence no single account can see on its own. Standard shows what the market is doing. Tactical turns that into prioritized actions. Pulse flags high-frequency shifts the moment they happen, for agencies who want to move first.",
    gebouwd: false,
    prijs: [
      { naam: "Standard", prijsPerMaand: 750, tagline: "See the market" },
      { naam: "Tactical", prijsPerMaand: 1_250, tagline: "Act on it" },
      { naam: "Pulse", prijsPerMaand: 2_500, tagline: "Move first" },
    ],
  },
  {
    id: "whitelabel",
    naam: "Whitelabel Portal",
    omschrijving: "Custom branding over tier templates.",
    detail:
      "A fully branded client environment that feels like your own software - branded portal, branded reports, and branded Second Opinions. Built for agencies that sell on professionalism as much as performance.",
    gebouwd: true,
    prijs: 500,
  },
  {
    id: "ai-council",
    naam: "The AI Council",
    omschrijving: "Multi-LLM debate engine.",
    detail:
      "Multiple AI models challenge a recommendation before it reaches your team. Reserved for high-impact outputs only, not every routine suggestion.",
    gebouwd: false,
    prijs: 300,
  },
  {
    id: "second-opinion",
    naam: "Second Opinion",
    omschrijving: "Independent account-level validation.",
    detail:
      "An independent read on where the biggest opportunities, mistakes, and growth potential sit inside an account - built as a sales tool, not an audit. Pairs automatically with God View to become market-aware once that's active.",
    gebouwd: true,
    prijs: 250,
  },
  {
    id: "demand-intelligence",
    naam: "Demand Intelligence",
    omschrijving: "Demand context and false-positive prevention for paid performance.",
    detail:
      "Explains whether a change in results comes from demand, SEO, paid search, or the market itself - not a standalone SEO checker. Example: paid traffic drops, organic rises, total demand stays flat. That's cannibalization, not an account problem.",
    gebouwd: false,
    prijs: 250,
  },
  {
    id: "demand-flow-intelligence",
    naam: "Demand Flow Intelligence",
    omschrijving: "Shows which channel creates demand and which one just harvests it.",
    detail:
      "Foundation shows channels in isolation. Demand Flow Intelligence shows how they influence each other, so credit lands on the channel that created the demand - not just the one that captured the last click.",
    gebouwd: false,
    prijs: 350,
  },
  {
    id: "proof-engine",
    naam: "Proof Engine",
    omschrijving: "Sales-ready proof, built from market risk and your own client data.",
    detail:
      "Automatically builds the case for why your agency is the right choice for a prospect or vertical - grounded in market problems and real account outcomes, not a generic case-study template. Pairs with Second Opinion in the Agency Growth Bundle.",
    gebouwd: false,
    prijs: 150,
  },
  {
    id: "volume-compute",
    naam: "Volume Compute",
    omschrijving: "Dynamically priced blocks of extra compute (Credit Packs).",
    detail:
      "Extra processing capacity for agencies running an unusually high volume of analyses or accounts. Infrastructure and fair-use scaling, not a strategic feature.",
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
    moduleIds: ["second-opinion", "proof-engine"],
    prijsPerMaand: 325,
  },
  {
    id: "deep-intelligence",
    naam: "The Deep Intelligence Bundle",
    focus: "Hardcore strategy and absolute retention.",
    moduleIds: ["ai-council", "demand-intelligence"],
    prijsPerMaand: 450,
  },
];

export function moduleById(id: string): StoreModule | undefined {
  return MODULES.find((m) => m.id === id);
}

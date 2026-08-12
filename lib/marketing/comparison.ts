// Data for /vs: the kill-shot comparison table plus the pricing-structure evidence backing the
// "Success Tax" observation.
//
// SOURCE: user-supplied competitive intelligence (Manus_Critical_Vulnerability_Brief.pdf,
// Manus_Competitive_Teardown_Analysis.pdf, 11 August 2026).
//
// LEGAL/TONE PASS (11 August 2026): the first draft of this file quoted the source brief's exact
// dollar figures and percentage jumps per competitor (e.g. "$299/mo -> $499/mo, a 67% increase").
// Flagged by the user as too aggressive and legally exposed: those numbers are unverified by this
// codebase, could be stale or wrong at any given moment, and comparative advertising law (EU
// Comparative Advertising Directive in particular) requires claims to be objectively verifiable
// and not primarily disparaging. Reworked to describe each platform's PRICING STRUCTURE (tiered
// by spend/GMV, cost increases as clients scale) instead of specific current amounts -- the
// structural claim is stable and verifiable from each platform's own published pricing page,
// while the exact numbers are not something this codebase can keep current. Tone softened
// throughout: no more "punishes", "taxes", "traps" as verbs describing what a named competitor
// does to its customers.
//
// ROW 3/4 INTEGRITY NOTE: the source brief frames Ctrl PPC's whole edge as "autonomous execution"
// and "zero manual handoffs" -- language that directly contradicts the FAQ (Ctrl PPC never
// executes changes in an ad platform itself, the marketer does) and the real Decision Framework,
// where step 4 is explicitly "observed, not automated." Rows 3 and 4 below are reworded to keep
// the same competitive edge -- Ctrl PPC does the diagnosis and hypothesis work, the legacy
// platforms make you do that manually too -- without claiming a capability that does not exist.
// Flagged and confirmed before writing this file; see the PR discussion.

export interface KillShotRow {
  label: string;
  legacy: string;
  legacyDetail: string;
  ctrlPpc: string;
  ctrlPpcDetail: string;
  /** true = this Ctrl PPC capability is real and built today, checked against the codebase. */
  gebouwd: boolean;
}

export const KILL_SHOT_ROWS: readonly KillShotRow[] = [
  {
    label: "The Business Model",
    legacy: "The Success Tax",
    legacyDetail: "Pricing tied to ad spend or GMV rather than to value delivered, so the bill grows as your accounts grow.",
    ctrlPpc: "Predictable Infrastructure",
    ctrlPpcDetail: "A flat tier rate, plus optional Volume Compute for high-volume accounts. Our price does not move when your spend does.",
    gebouwd: true,
  },
  {
    label: "Agency Memory",
    legacy: "Isolated Account Silos",
    legacyDetail: "A pattern solved for one client typically stays with that account and the person who found it, not shared automatically with the rest of the portfolio.",
    ctrlPpc: "Agency Memory",
    ctrlPpcDetail: "What worked is remembered, not lost when an account manager moves on. Automatic cross-client propagation is on the roadmap.",
    gebouwd: false,
  },
  {
    label: "The End Product",
    legacy: "Passive Dashboards and Insights",
    legacyDetail: "A chart, a trend line, a chat assistant that summarizes what happened. You still have to figure out what to do about it.",
    ctrlPpc: "A Quality-Gated Hypothesis, Ready to Execute",
    ctrlPpcDetail: "The diagnosis, the hypothesis, and the quality gate are already done. You get one concrete recommendation, not a dashboard to interpret.",
    gebouwd: true,
  },
  {
    label: "The Handoff",
    legacy: "Manual Diagnosis and Manual Execution",
    legacyDetail: "The marketer has to find the problem themselves, then manually execute the fix across every platform, one at a time.",
    ctrlPpc: "One Handoff: You Execute",
    ctrlPpcDetail: "Zero manual handoffs for diagnosis, prioritization, or attribution. The one thing left is pressing the button in your ad platform yourself.",
    gebouwd: true,
  },
];

export interface SuccessTaxExample {
  platform: string;
  mechanism: string;
  example: string;
}

// Structural claims only, not the source brief's exact dollar figures and percentage jumps -- see
// the file header. Each of these describes the published TIER STRUCTURE, which is stable and
// checkable against each platform's own pricing page, not a specific current amount this codebase
// would need to keep up to date to stay accurate.
//
// EXPANDED (12 augustus 2026, "zijn dit uberhaupt alle en de beste concurrenten"): stond eerst op
// 4 platformen. Elk hieronder toegevoegd is geverifieerd via een live websearch tegen de eigen
// pricing-pagina van dat platform op de datum hierboven -- niet uit trainingsdata overgenomen,
// want prijsmodellen veranderen. Supermetrics blijft bewust BUITEN deze lijst: het is wel genoemd
// als concurrent in de pagina-intro, maar de pricing is getierd op databronnen/gebruikers, niet op
// spend of GMV -- geen Success Tax-voorbeeld, dus geen plek hier. Adalysis is het scherpste
// voorbeeld van de acht: de tier herberekent zichzelf elke maand op basis van werkelijke spend.
export const SUCCESS_TAX_EXAMPLES: readonly SuccessTaxExample[] = [
  {
    platform: "Optmyzr",
    mechanism: "Tiered by trailing 30-day ad spend",
    example: "Crossing into a higher spend tier moves the account to a higher-priced plan automatically.",
  },
  {
    platform: "Triple Whale",
    mechanism: "Tiered by 12-month GMV",
    example: "The subscription tier is set by trailing GMV, so a growing brand is moved to higher tiers over time.",
  },
  {
    platform: "Madgicx",
    mechanism: "Tiered by monthly Meta spend",
    example: "Meta spend growth pushes the account into a higher tier, independent of any change in the service itself.",
  },
  {
    platform: "Skai",
    mechanism: "Tiered by annual ad spend",
    example: "Enterprise pricing scales with annual spend across a wide range, reaching well into seven figures at the highest tiers.",
  },
  {
    platform: "Revealbot",
    mechanism: "Tiered by monthly ad spend across connected accounts",
    example: "Combined spend crossing a tier's ceiling triggers an upgrade or an overage charge, independent of how the automation itself is used.",
  },
  {
    platform: "Northbeam",
    mechanism: "Tiered by media spend and pageview volume",
    example: "Growth past the entry tier's spend threshold moves the account to a materially higher-priced plan, with the top tier priced individually.",
  },
  {
    platform: "Adalysis",
    mechanism: "Tiered by trailing monthly ad spend, recalculated automatically",
    example: "The plan tier is recalculated each month against actual spend, moving the account up or down without a manual upgrade.",
  },
  {
    platform: "Opteo",
    mechanism: "Tiered by account count and monthly ad spend ceiling",
    example: "Crossing either the account-count or the spend ceiling on a plan requires moving to the next tier up.",
  },
];

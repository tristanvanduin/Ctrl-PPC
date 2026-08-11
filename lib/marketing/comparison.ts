// Data for /vs: the kill-shot comparison table plus the concrete pricing evidence backing the
// "Success Tax" claim.
//
// SOURCE: user-supplied competitive intelligence (Manus_Critical_Vulnerability_Brief.pdf,
// Manus_Competitive_Teardown_Analysis.pdf, 11 August 2026). The pricing figures per platform are
// taken directly from that research, not independently re-verified here -- treat them as the
// commissioned intelligence they are, not as claims this codebase can check against a live
// source. If a competitor's public pricing changes, this file is the one place to update it.
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
    legacyDetail: "Punishes growth by taxing ad spend or GMV. The more you succeed, the more the tool costs.",
    ctrlPpc: "Predictable Infrastructure",
    ctrlPpcDetail: "A flat tier rate, plus optional Volume Compute for high-volume accounts. We do not profit more when you scale.",
    gebouwd: true,
  },
  {
    label: "Agency Memory",
    legacy: "Isolated Account Silos",
    legacyDetail: "Solve a problem for Client A, and that insight dies with the account manager. Client B waits weeks for the same fix.",
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

export const SUCCESS_TAX_EXAMPLES: readonly SuccessTaxExample[] = [
  {
    platform: "Optmyzr",
    mechanism: "Tiered by trailing 30-day ad spend",
    example: "$299/mo at $25K spend -> $499/mo at $50K spend. A 67% price jump for scaling one account.",
  },
  {
    platform: "Triple Whale",
    mechanism: "Tiered by 12-month GMV",
    example: "$179/mo at $1M GMV -> $259/mo at $3M GMV. Scale to $50M GMV and it is a 28x increase for the same core platform.",
  },
  {
    platform: "Madgicx",
    mechanism: "Tiered by monthly Meta spend",
    example: "$45/mo under $1K spend -> $99/mo at $1K-2.5K spend. A 120% jump for the first tier of growth.",
  },
  {
    platform: "Skai",
    mechanism: "Tiered by annual ad spend",
    example: "$114K/yr at $4M spend -> $504K/yr at $20M spend. A 4.4x price increase for the same platform.",
  },
];

// The Deliverable: same terminal-diagnostics styling as QualityGateMatrix, illustrating a
// different real fix (12 August 2026) -- the specialist-facing output used to be the 13 raw
// monthly step outputs concatenated ("Stap 1: ..., Stap 2: ..."), because the trigger button
// discarded the synthesized executive summary the engine already computed. Fixed so the saved
// file uses that synthesis (deliverable_markdown / threads / prioritized recommendations)
// instead. This example shows the shape of that fix, not a live client report -- same
// "representative example data" treatment as QualityGateMatrix's CHECKS.
//
// REFRAME (12 August 2026, owner correction, two rounds): first round dropped the "13 steps run
// in the background" headline for a fixed "6 pillars" list -- but that list (Account Performance,
// Campaign Performance, Ad Group & Search Terms, ...) came from docs/ANALYSE-LOGICA.md #5.1, which
// only documents the Google Ads path. Second round, same day: "dit is weer extreem google minded
// ... we doen veel meer dan alleen die google campagnes" -- correct. app/api/analysis/monthly/
// route.ts runs a genuinely different step sequence per channel (Google, Meta, and LinkedIn adapters
// in lib/analysis/adapters/), each shaped around what that channel actually is: search intent and
// auction dynamics for Google, creative and audience fatigue for Meta, ICP-fit and lead funnel for
// LinkedIn. Naming those channel-specific focus areas is the honest version of "6 pillars" -- not
// the exact ordered step list or step count for any channel, which would hand a competitor the
// blueprint to rebuild the SOP structure themselves (see: "niet dat we teveel weggeven dat ze zelf
// de sop gaan nabouwen met onze structuur"). What IS genuinely shared across every channel, and
// safe to say plainly: every channel's reasoning ends in hypothesis validation, and every finding
// clears the same quality gates (see QualityGateMatrix) before synthesis -- confirmed in code via
// finalizeChannelMonthlySynthesis, the shared synthesis layer all three channels run through.
const CHANNEL_FOCUS = [
  { kanaal: "Google Ads", focus: "Search intent, auction dynamics, account & campaign performance" },
  { kanaal: "Meta", focus: "Creative & audience performance, frequency and fatigue" },
  { kanaal: "LinkedIn", focus: "ICP-fit, lead funnel, account & campaign performance" },
];

interface PriorityRow {
  naam: string;
  why: string;
  impact: string;
  action: string;
}

const PRIORITIES: PriorityRow[] = [
  {
    naam: "Priority 1",
    why: "Search Brand CPA rose 34% MoM while impression share held steady.",
    impact: "~EUR 4,200/mo in avoidable spend at current pace.",
    action: "Split Brand from Generic, cap Generic tROAS.",
  },
  {
    naam: "Priority 2",
    why: "Three ad sets show frequency above 3.5 with hook rate falling.",
    impact: "CTR decay compounding week over week.",
    action: "Refresh creative on the two oldest ad sets.",
  },
];

export function DeliverableExample() {
  return (
    // SPACING FIX (12 augustus 2026, same root cause as quality-gate-matrix.tsx): pb-16 here
    // stacked against the "Ultimate Positioning" paragraph's own mt-16 further down
    // how-it-works/page.tsx, doubling to 128px. Removed; the next element's own top spacing owns
    // the gap now, same convention as the rest of the page.
    <section className="mx-auto max-w-3xl px-6">
      <div
        className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/70 p-6"
        style={{ boxShadow: "0 0 40px rgba(0, 0, 0, 0.3)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">
          The Deliverable: Structured Per Channel, One Document
        </h2>
        <p className="mt-1.5 text-xs text-off-white/40">
          Illustrative example. Each channel gets reasoning shaped around how it actually works, not a generic template.
        </p>

        <div className="mt-5 space-y-2" style={{ fontFamily: "var(--font-marketing-mono)" }}>
          {CHANNEL_FOCUS.map((c) => (
            <div key={c.kanaal} className="flex flex-col gap-1 text-[11px] sm:flex-row sm:items-baseline sm:gap-3">
              <span className="shrink-0 uppercase tracking-wide text-off-white/40 sm:w-24">{c.kanaal}</span>
              <span className="leading-relaxed text-off-white/25">{c.focus}</span>
            </div>
          ))}
          <p className="mt-2 text-[10px] leading-relaxed text-off-white/20">
            Every channel's reasoning ends in hypothesis validation, and every finding clears the same quality gates before it reaches you.
          </p>
        </div>

        <div className="my-5 flex items-center gap-3 text-off-white/20">
          <span className="h-px flex-1 bg-off-white/10" />
          <span className="text-[10px] uppercase tracking-[0.2em]">synthesized into</span>
          <span className="h-px flex-1 bg-off-white/10" />
        </div>

        <div className="space-y-2.5" style={{ fontFamily: "var(--font-marketing-mono)" }}>
          {PRIORITIES.map((p) => (
            <div
              key={p.naam}
              className="rounded-[6px] border border-neon-indigo/30 bg-neon-indigo/5 px-3 py-2.5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neon-indigo">{p.naam}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-off-white/80">{p.why}</p>
              <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-off-white/50 sm:flex-row sm:gap-4">
                <span><span className="text-off-white/30">Impact:</span> {p.impact}</span>
                <span><span className="text-off-white/30">Action:</span> {p.action}</span>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-off-white/40">
          What you get is the summary. What you can click into, if you want it, is the full
          reasoning behind it -- not the other way around.
        </p>
      </div>
    </section>
  );
}

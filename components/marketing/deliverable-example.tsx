// The Deliverable: same terminal-diagnostics styling as QualityGateMatrix, illustrating a
// different real fix (12 August 2026) -- the specialist-facing output used to be the 13 raw
// monthly step outputs concatenated ("Stap 1: ..., Stap 2: ..."), because the trigger button
// discarded the synthesized executive summary the engine already computed. Fixed so the saved
// file uses that synthesis (deliverable_markdown / threads / prioritized recommendations)
// instead. This example shows the shape of that fix, not a live client report -- same
// "representative example data" treatment as QualityGateMatrix's CHECKS.
//
// Step names are the real 13 (app/api/analysis/monthly/route.ts, runNarrativeStep calls), not
// invented labels -- same discipline as QualityGateMatrix's gate names.

const RAW_STEPS = [
  "Account Performance", "Campaign Performance", "Ad Group Performance",
  "Competitor & Auction Insights", "Keyword Performance", "Product Performance",
  "Search Term Performance", "Creative Performance", "Audience Performance",
  "Device & Engagement Performance", "Geografische Performance",
  "Checkout, Schedule & Network Performance", "Hypotheses & Sprintplanning",
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
    <section className="mx-auto max-w-3xl px-6 pb-20">
      <div
        className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/70 p-6"
        style={{ boxShadow: "0 0 40px rgba(0, 0, 0, 0.3)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">
          The Deliverable: One Document, Not Thirteen
        </h2>
        <p className="mt-1.5 text-xs text-off-white/40">
          Illustrative example. The 13 steps run every month, but they are reasoning, not the report.
        </p>

        <div className="mt-5" style={{ fontFamily: "var(--font-marketing-mono)" }}>
          <p className="text-[11px] uppercase tracking-wide text-off-white/30">
            13 steps run in the background
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-off-white/25">
            {RAW_STEPS.join(" -- ")}
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

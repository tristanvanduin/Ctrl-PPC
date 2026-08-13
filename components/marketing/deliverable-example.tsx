"use client";

import { useState } from "react";

// The Deliverable: same terminal-diagnostics styling as QualityGateMatrix, illustrating a
// different real fix (12 August 2026) -- the specialist-facing output used to be the 13 raw
// monthly step outputs concatenated ("Stap 1: ..., Stap 2: ..."), because the trigger button
// discarded the synthesized executive summary the engine already computed. Fixed so the saved
// file uses that synthesis (deliverable_markdown / threads / prioritized recommendations)
// instead. This example shows the shape of that fix, not a live client report -- same
// "representative example data" treatment as QualityGateMatrix's CHECKS.
//
// REFRAME (12 August 2026, owner correction, three rounds): round 1 dropped the "13 steps run in
// the background" headline for a fixed "6 pillars" list -- but that list (Account Performance,
// Campaign Performance, Ad Group & Search Terms, ...) came from docs/ANALYSE-LOGICA.md #5.1, which
// only documents the Google Ads path. Round 2, same day: "dit is weer extreem google minded ...
// we doen veel meer dan alleen die google campagnes" -- correct, so round 2 collapsed every
// channel to one summary line each. Round 3, same day: "moeten we voor de andere kanalen ook de
// marketing termen over de echte sop stappen doen" -- Google shouldn't be the only channel that
// gets real depth; Meta and LinkedIn earn the same treatment.
//
// Round 4 (same day, standing rule now): "nooit de echte werking, alleen impact en voordelen" --
// the 6 "pillar" labels (Account Performance, Campaign & Budget Structure, ...) were themselves a
// methodology outline dressed as marketing copy: they told the reader HOW the analysis is
// organized, not what they get from it. Even though no literal step order or count was exposed
// (that boundary was already respected), a named 6-part taxonomy still reads as "here is our
// process." Rewritten to pure outcome language: what you know or can see after the analysis, not
// the shape of how it got there. Content grounded the same way as before (verified against
// lib/analysis/adapters/{meta-ads,linkedin-ads}.ts and app/api/analysis/monthly/route.ts's Google
// path), just phrased as what the reader receives instead of a labeled category list.
const CHANNEL_OUTCOMES = [
  {
    kanaal: "Google Ads",
    outcomes: [
      "Know exactly why a Search or PMax metric moved, not just that it did",
      "See where you are actually winning the auction, not just spending more",
      "Creative and audience calls backed by evidence, not a hunch",
    ],
  },
  {
    kanaal: "Meta",
    outcomes: [
      "Catch creative fatigue before it quietly drains performance",
      "Know which audience segment is actually converting, not just spending",
      "Placement and budget calls backed by evidence, not a hunch",
    ],
  },
  {
    kanaal: "LinkedIn",
    outcomes: [
      "Know whether budget is actually reaching the right decision-makers",
      "See how leads move through the funnel, not just how many arrive",
      "Bidding and targeting calls backed by evidence, not a hunch",
    ],
  },
] as const;

interface PriorityRow {
  naam: string;
  why: string;
  impact: string;
  action: string;
}

// PRIORITIES-PER-KANAAL (12 augustus 2026, "je verwacht dat ook de blokken eronder mee
// veranderen"): stond eerst als 1 vaste array voor alle 3 tabs -- een Search-CPA-bevinding en een
// Meta ad-set-frequency-bevinding, allebei zichtbaar ongeacht welk kanaal je koos. Nu per kanaal,
// met vocabulaire dat bij dat kanaal hoort (ad set/hook rate/frequency voor Meta, lead
// form/senioriteitstargeting voor LinkedIn) -- zelfde "illustrative example"-behandeling als
// hierboven, niet een live klantrapport.
const PRIORITIES_PER_KANAAL: Record<(typeof CHANNEL_OUTCOMES)[number]["kanaal"], PriorityRow[]> = {
  "Google Ads": [
    {
      naam: "Priority 1",
      why: "Search Brand CPA rose 34% MoM while impression share held steady.",
      impact: "~EUR 4,200/mo in avoidable spend at current pace.",
      action: "Split Brand from Generic, cap Generic tROAS.",
    },
    {
      naam: "Priority 2",
      why: "Three non-brand ad groups show Quality Score below 5, inflating CPCs 20%+.",
      impact: "~EUR 2,100/mo in avoidable CPC premium.",
      action: "Add negatives, tighten ad group themes to match search intent.",
    },
  ],
  "Meta": [
    {
      naam: "Priority 1",
      why: "Three ad sets show frequency above 3.5 with hook rate falling.",
      impact: "CTR decay compounding week over week.",
      action: "Refresh creative on the two oldest ad sets.",
    },
    {
      naam: "Priority 2",
      why: "Retargeting audience overlaps 40% with an active lookalike, inflating CPMs.",
      impact: "~EUR 1,800/mo in wasted overlap spend.",
      action: "Exclude the retargeting audience from the lookalike ad set.",
    },
  ],
  "LinkedIn": [
    {
      naam: "Priority 1",
      why: "Lead form completion rate dropped 22% after switching to a longer form.",
      impact: "~15 fewer qualified leads/mo at current volume.",
      action: "Revert to the 3-field form, test length as its own experiment.",
    },
    {
      naam: "Priority 2",
      why: "Sponsored Content targeting 'Director+' seniority converts 3x the broader audience.",
      impact: "Budget still concentrated on lower-converting seniority tiers.",
      action: "Shift budget toward Director+ segments, tailor messaging to that tier.",
    },
  ],
};

export function DeliverableExample() {
  const [kanaal, setKanaal] = useState<(typeof CHANNEL_OUTCOMES)[number]["kanaal"]>("Google Ads");
  const actief = CHANNEL_OUTCOMES.find((c) => c.kanaal === kanaal) ?? CHANNEL_OUTCOMES[0];

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
          Illustrative example. What you actually learn about each channel, not a generic template.
        </p>

        <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Channel">
          {CHANNEL_OUTCOMES.map((c) => (
            <button
              key={c.kanaal}
              type="button"
              role="tab"
              aria-selected={kanaal === c.kanaal}
              onClick={() => setKanaal(c.kanaal)}
              className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                kanaal === c.kanaal
                  ? "border-neon-indigo/50 bg-neon-indigo/10 text-neon-indigo"
                  : "border-off-white/10 text-off-white/40 hover:text-off-white/70"
              }`}
            >
              {c.kanaal}
            </button>
          ))}
        </div>

        <div className="mt-4" style={{ fontFamily: "var(--font-marketing-mono)" }}>
          <p className="text-[11px] uppercase tracking-wide text-off-white/30">
            What you get, every month
          </p>
          <ul className="mt-2 space-y-1">
            {actief.outcomes.map((o) => (
              <li key={o} className="text-[11px] leading-relaxed text-off-white/25">{o}</li>
            ))}
          </ul>
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
          {PRIORITIES_PER_KANAAL[kanaal].map((p) => (
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

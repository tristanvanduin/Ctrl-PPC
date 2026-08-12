"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { LOOP_STAGES } from "@/lib/marketing/loop";

// The full Data -> Analyse -> Decision -> Execution -> Evaluation -> Learning loop, deep-dive
// version. Built native for this page rather than reusing ExecutionNode's compact homepage
// timeline: this page has a full paragraph and a real code reference per stage, which needs more
// room than a 3-column feature grid has to give.
//
// A vertical timeline, not the circular/infinity shape in the reference images the user shared --
// deliberately. A literal circular path with text following the curve does not reflow cleanly at
// narrow widths without a second, unrelated mobile layout to maintain; a vertical list already
// degrades to mobile for free (it never was anything else). The loop's closure -- stage 6 feeding
// back into stage 1 -- is instead stated explicitly at the bottom, which is more honest anyway:
// nothing about this mechanism is automatic today (see the file header in lib/marketing/loop.ts),
// so a literal arrow looping shut would overstate exactly the thing that page is careful not to.
//
// PER-STAGE COLLAPSE (12 augustus 2026, mobiele audit): all 6 stages used to render fully expanded
// -- pitch, detail paragraph, and code citation -- making this by far the largest block on
// how-it-works ("mega lange scroll", eigenaars woorden). The ring diagram right above already gives
// the overview; this list is the depth a reader opts into. Number badge + pitch stay always
// visible (the FAQ page proved that pattern works for "what is this" at a glance); detail +
// citation collapse per stage, same as FAQ's question/answer split. The vertical connecting line
// stays intact regardless of which stages are open -- it is positioned absolutely across the full
// list, independent of individual item height, so the "one continuous loop" visual holds either way.

export function DecisionLoop() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="relative" style={{ fontFamily: "var(--font-marketing-mono)" }}>
      <div className="absolute bottom-1 left-[19px] top-1 w-px bg-gradient-to-b from-neon-indigo/60 via-neon-indigo/40 to-neon-indigo/60 sm:left-[23px]" aria-hidden />

      <ol className="space-y-3">
        {LOOP_STAGES.map((s) => {
          const isOpen = open === s.id;
          return (
            <li key={s.id} className="relative flex gap-4 sm:gap-5">
              <span
                className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neon-indigo/50 bg-midnight-slate text-xs font-bold text-neon-indigo sm:h-12 sm:w-12 sm:text-sm"
                style={{ boxShadow: "0 0 10px rgba(129, 140, 248, 0.35)" }}
              >
                {s.stap}
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start justify-between gap-3 py-1 text-left"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-off-white/40">{s.naam}</p>
                    <h3
                      className="mt-1 text-base font-bold text-off-white sm:text-lg"
                      style={{ fontFamily: "var(--font-marketing-heading)" }}
                    >
                      {s.pitch}
                    </h3>
                  </div>
                  <ChevronDown
                    className={`mt-1.5 h-4 w-4 shrink-0 text-neon-indigo transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>
                {isOpen && (
                  <>
                    <p
                      className="mt-2 max-w-2xl text-sm leading-relaxed text-off-white/60"
                      style={{ fontFamily: "var(--font-sans, inherit)" }}
                    >
                      {s.detail}
                    </p>
                    <p className="mt-2 text-[11px] text-off-white/30">{s.gegrond}</p>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="relative z-10 mt-8 flex items-center gap-3 pl-14 sm:pl-[52px]">
        <RotateCcw className="h-4 w-4 shrink-0 text-neon-indigo/70" aria-hidden />
        <p className="text-xs text-off-white/50">
          Stage 6 closes back into stage 1: the next signal is read with this outcome already on record.
        </p>
      </div>
    </div>
  );
}

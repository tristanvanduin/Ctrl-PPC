import { RotateCcw } from "lucide-react";
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

export function DecisionLoop() {
  return (
    <div className="relative" style={{ fontFamily: "var(--font-marketing-mono)" }}>
      <div className="absolute bottom-1 left-[19px] top-1 w-px bg-gradient-to-b from-neon-indigo/60 via-neon-indigo/40 to-neon-indigo/60 sm:left-[23px]" aria-hidden />

      <ol className="space-y-8">
        {LOOP_STAGES.map((s) => (
          <li key={s.id} className="relative flex gap-4 sm:gap-5">
            <span
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neon-indigo/50 bg-midnight-slate text-xs font-bold text-neon-indigo sm:h-12 sm:w-12 sm:text-sm"
              style={{ boxShadow: "0 0 10px rgba(129, 140, 248, 0.35)" }}
            >
              {s.stap}
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-off-white/40">{s.naam}</p>
              <h3
                className="mt-1 text-base font-bold text-off-white sm:text-lg"
                style={{ fontFamily: "var(--font-marketing-heading)" }}
              >
                {s.pitch}
              </h3>
              <p
                className="mt-2 max-w-2xl text-sm leading-relaxed text-off-white/60"
                style={{ fontFamily: "var(--font-sans, inherit)" }}
              >
                {s.detail}
              </p>
              <p className="mt-2 text-[11px] text-off-white/30">{s.gegrond}</p>
            </div>
          </li>
        ))}
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

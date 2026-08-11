// Quality Gate Matrix: server-diagnostics styling, not a marketing report. A dense, mono-font
// list of validation checks a hypothesis has to clear before it counts, matching step 3 of the
// Decision Framework (lib/decision/quality-gates.ts). Representative example data, same treatment
// as ComparisonBlock's DIAGNOSE_REGELS -- illustrative of the mechanism, not a live feed.
//
// The section title was a styled <p> with nothing else on the page claiming an <h2> at this point
// in the outline (audit, 11 August 2026). Promoted to <h2> so the heading structure matches what
// the section visually is: its own topic, not a caption inside ComparisonBlock above it.

import { CheckCircle2, XCircle } from "lucide-react";

interface GateCheck {
  naam: string;
  status: "PASS" | "FAIL";
  gevolg?: string;
}

const CHECKS: GateCheck[] = [
  { naam: "Organic Brand Volume", status: "PASS" },
  { naam: "Meta Frequency Cap", status: "PASS" },
  { naam: "Shopify Inventory", status: "FAIL", gevolg: "Halt Execution" },
];

export function QualityGateMatrix() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-20">
      <div
        className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/70 p-6"
        style={{ boxShadow: "0 0 40px rgba(0, 0, 0, 0.3)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">
          Quality Gate: Validation Run
        </h2>
        <p className="mt-1.5 text-xs text-off-white/40">
          Every hypothesis clears this before it reaches you. No check, no execution.
        </p>

        <div className="mt-5 space-y-2.5" style={{ fontFamily: "var(--font-marketing-mono)" }}>
          {CHECKS.map((check, i) => (
            <div
              key={check.naam}
              className={`flex flex-col gap-2 rounded-[6px] border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                check.status === "FAIL"
                  ? "border-amber-waste/40 bg-amber-waste/5"
                  : "border-off-white/10 bg-midnight-slate/40"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 text-off-white/30">[</span>
                <span className="shrink-0 text-off-white/40">Check {i + 1}:</span>
                <span className="truncate text-off-white/80">{check.naam}</span>
                <span className="shrink-0 text-off-white/30">]</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {check.gevolg && (
                  <span className="text-[11px] uppercase tracking-wide text-amber-waste">{check.gevolg}</span>
                )}
                {check.status === "PASS" ? (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    PASS
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-waste">
                    <XCircle className="h-3.5 w-3.5" aria-hidden />
                    FAIL
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-off-white/40">
          One failed check is enough. A hypothesis with a real blocker never reaches your inbox as
          a recommendation.
        </p>
      </div>
    </section>
  );
}

// Quality Gate Matrix: server-diagnostics styling, not a marketing report. A dense, mono-font
// list of validation checks a hypothesis has to clear before it counts, matching step 3 of the
// Decision Framework (lib/decision/quality-gates.ts). Representative example data, same treatment
// as ComparisonBlock's DIAGNOSE_REGELS -- illustrative of the mechanism, not a live feed.
//
// The section title was a styled <p> with nothing else on the page claiming an <h2> at this point
// in the outline (audit, 11 August 2026). Promoted to <h2> so the heading structure matches what
// the section visually is: its own topic, not a caption inside ComparisonBlock above it.
//
// SPACING FIX (12 augustus 2026, "toch een grotere witruimte dan elders"): this section's own
// pb-16 used to sit directly in front of FeaturesBlock's py-16 when this component still rendered
// on the homepage. Padding does not collapse like margins do, so that stacked to a 128px gap
// versus the 64px gap everywhere else on the page. Removed the self-owned bottom padding; the
// next element's own top spacing now owns the gap on both sides.
//
// HOMEPAGE REMOVAL (13 augustus 2026, "ik wil het blok met quality gates niet op de homepage"):
// this component sat alone in a max-w-3xl single column, sandwiched between ComparisonBlock
// (max-w-6xl, 2-column grid) and FeaturesBlock (max-w-6xl, 3-column grid) -- a narrow single
// section breaking the wide/wide rhythm on both sides. Removed from app/(marketing)/page.tsx; it
// stays on /how-it-works ("Stage 03, in practice"), where it illustrates one specific stage inside
// a page that is already deep-dive in nature, not sandwiched between wide multi-column sections.

import { CheckCircle2, XCircle } from "lucide-react";

interface GateCheck {
  naam: string;
  status: "PASS" | "FAIL";
  gevolg?: string;
}

// De drie namen hieronder zijn 3 van de 9 echte gates uit lib/decision/quality-gates.ts (GATES),
// niet verzonnen voorbeeldlabels. Eerdere versie gebruikte "Organic Brand Volume", "Meta Frequency
// Cap" en "Shopify Inventory" -- geen daarvan bestaat als gate, en Shopify is bovendien een
// ongebouwde integratie (zie de "Coming soon"-badge in TrustBanner). Gevonden bij een audit op de
// live site.
//
// KLEUR (12 augustus 2026, design feedback): FAIL/HALT EXECUTION stond op amber. Het product
// maakt zelf al het onderscheid tussen amber (waarschuwing) en rood (harde stop) --
// components/dashboard/code-rood-banner.tsx gebruikt rood voor "churnrisico, alle hands on
// deck" en amber voor "wees alert". Een HALT is geen waarschuwing, het is de harde stop. Amber
// hier gaf geen doorbraak-verband, alleen kleurherhaling. Naar rood-tokens (--color-red-400/500
// e.v., app/globals.css) i.p.v. amber-waste.
const CHECKS: GateCheck[] = [
  { naam: "Evidence Gate", status: "PASS" },
  { naam: "Causal Chain Gate", status: "PASS" },
  { naam: "Coverage Gate", status: "FAIL", gevolg: "Halt Execution" },
];

export function QualityGateMatrix() {
  return (
    <section className="mx-auto max-w-3xl px-6">
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

        <div className="mt-5 space-y-3" style={{ fontFamily: "var(--font-marketing-mono)" }}>
          {CHECKS.map((check, i) => (
            <div
              key={check.naam}
              className={`flex flex-col gap-2.5 rounded-[6px] border px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                check.status === "FAIL"
                  ? "border-red-400/50 bg-red-400/10"
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
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-red-400">{check.gevolg}</span>
                )}
                {check.status === "PASS" ? (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    PASS
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-semibold text-red-400">
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

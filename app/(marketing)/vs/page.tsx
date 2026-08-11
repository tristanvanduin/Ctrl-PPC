import type { Metadata } from "next";
import Link from "next/link";
import { Check, Clock, X } from "lucide-react";
import { KILL_SHOT_ROWS, SUCCESS_TAX_EXAMPLES } from "@/lib/marketing/comparison";
import { ComingSoonBadge } from "@/components/marketing/coming-soon-badge";
import { PrimaryCta } from "@/components/marketing/primary-cta";

// The comparison page against the legacy status quo (Optmyzr, Triple Whale, Supermetrics,
// Madgicx, Skai). Canonical stays relative (resolved via metadataBase in app/layout.tsx, same as
// every other marketing page), not hardcoded to www -- CANONIEK_DOMEIN is non-www, and
// middleware.ts documents a past production incident from a www redirect that was removed. A
// hardcoded www canonical here would put this one page on a different canonical scheme than the
// rest of the site. See lib/marketing/comparison.ts for why rows 3 and 4 of the table are worded
// the way they are -- the source brief's "autonomous execution" framing contradicts the FAQ and
// was not published as-is.
//
// TITLE FIX (audit, 11 August 2026): this metadata originally said "The Autonomous Decision
// Engine" -- the same claim rows 3/4 were reworded to avoid, just left standing in the one place
// search engines and AI answer engines actually quote verbatim. The FAQ states plainly that Ctrl
// PPC "never executes anything itself." A title contradicting the page's own body copy is worse
// than the claim it replaces, so it is gone from both the title and openGraph.title.
//
// Row and Success Tax card titles were <p> tags styled as headings, same audit pass: promoted to
// <h3> under this page's <h1> so the heading outline matches the visual one.
//
// REPOSITIONING (11 August 2026): title and H1 said "Decisioning, Not Dashboards" / "The
// Alternative to the Dashboard Illusion" -- an absolute claim that does not survive contact with
// /pricing, which offers the dashboard itself for free on every tier. Changed to "Not Just
// Dashboards" / "Beyond the Dashboard Layer": the comparison targets against Optmyzr, Triple
// Whale, Supermetrics, Madgicx, and Skai stands (they are reporting/bid-management tools first),
// the point is not that dashboards are fake, it is that a dashboard alone is not a decision.
export const metadata: Metadata = {
  title: "Ctrl PPC vs. Legacy Platforms | Not Just Dashboards",
  description:
    "Stop paying the success tax. Compare Ctrl PPC against Optmyzr, Triple Whale, and others. See why modern agencies use a decision engine on top of their dashboard, not instead of it.",
  alternates: { canonical: "/vs" },
  openGraph: {
    title: "Ctrl PPC vs. Legacy Platforms | Not Just Dashboards",
    description:
      "Stop paying the success tax. Compare Ctrl PPC against Optmyzr, Triple Whale, and others.",
    type: "website",
  },
};

function KillShotRowBlock({ row }: { row: (typeof KILL_SHOT_ROWS)[number] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,10rem)_1fr_1fr] lg:items-stretch">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-off-white/40 lg:flex lg:items-center">
        {row.label}
      </p>

      <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/40 p-4">
        <div className="flex items-center gap-2">
          <X className="h-3.5 w-3.5 shrink-0 text-off-white/30" aria-hidden />
          <h3 className="text-sm font-semibold text-off-white/50">{row.legacy}</h3>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-off-white/35">{row.legacyDetail}</p>
      </div>

      <div
        className="rounded-[6px] border border-neon-indigo/50 bg-neon-indigo/5 p-4"
        style={{ boxShadow: "0 0 24px rgba(129, 140, 248, 0.12)" }}
      >
        <div className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-neon-indigo" aria-hidden />
          <h3 className="text-sm font-semibold text-off-white">{row.ctrlPpc}</h3>
          {!row.gebouwd && <ComingSoonBadge />}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-off-white/70">{row.ctrlPpcDetail}</p>
      </div>
    </div>
  );
}

export default function VsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-14 pb-20 sm:pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Compare</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl md:text-5xl">
          Beyond the Dashboard Layer
        </h1>
        <p className="mt-4 text-off-white/60">
          Optmyzr, Triple Whale, Supermetrics, Madgicx, Skai: five different platforms with a
          similar pattern. Pricing that scales with ad spend, and insights that stay locked to
          a single account. Ctrl PPC includes the dashboard layer free on every tier -- the
          difference is what happens on top of it.
        </p>
      </div>

      <div className="mt-12 space-y-5">
        {KILL_SHOT_ROWS.map((row) => (
          <KillShotRowBlock key={row.label} row={row} />
        ))}
      </div>

      <div className="mt-16">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
          How the Success Tax is structured
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-off-white/40">
          Based on each platform's own published pricing structure, not specific current rates.
          Pricing changes over time - check directly with the platform before deciding.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {SUCCESS_TAX_EXAMPLES.map((ex) => (
            <div
              key={ex.platform}
              className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-off-white">{ex.platform}</h3>
                <span className="text-[10px] uppercase tracking-wide text-off-white/40">{ex.mechanism}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-off-white/60" style={{ fontFamily: "var(--font-marketing-mono)" }}>
                {ex.example}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 flex items-center justify-center gap-3 rounded-[6px] border border-copper/30 bg-copper/5 px-6 py-4 text-sm text-off-white/80">
        <Clock className="h-5 w-5 shrink-0 text-copper" aria-hidden />
        <span>
          <strong className="font-semibold text-copper">No Limits, same as every tier:</strong> your
          software cost stays flat while your accounts scale. See{" "}
          <Link href="/pricing" className="font-semibold text-copper underline hover:text-off-white">
            the full breakdown
          </Link>.
        </span>
      </div>

      <div className="mt-10 flex items-center justify-center">
        <PrimaryCta />
      </div>
    </div>
  );
}

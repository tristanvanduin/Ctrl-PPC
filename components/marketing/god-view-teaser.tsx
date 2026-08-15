import Link from "next/link";
import { BarChart3, ShieldAlert, Target, TrendingUp } from "lucide-react";
import { ComingSoonBadge } from "./coming-soon-badge";

// God View homepage teaser (15 August 2026, on the owner's request, placed right after Platform
// Pulse so the narrative reads as one line: Pulse is today's live proof that accounts are
// connected, God View is what that connected network becomes). Ties directly into the Foundation
// cap in the hero above - Foundation is explicitly the network's data source (see the Ctrl PPC
// Masterplan section 10.1, "Foundation levert de netwerkdata waar God View op draait"), so a
// narrower launch cap and a sharper God View are the same story told twice.
//
// Same integrity rule as lib/marketing/modules.ts: God View (the cross-tenant version described
// here) is not live - components/terminal/god-mode.tsx and agency-god-view.tsx are single-agency
// or platform-admin views, not this. ComingSoonBadge carries that, same as the Layer 3 card on
// /how-it-works and the God View entry in the Intelligence Store on /pricing - one claim, said
// consistently in three places rather than three different ways.

const SIGNALEN = [
  { icon: BarChart3, label: "Benchmarks" },
  { icon: TrendingUp, label: "Niche trends" },
  { icon: ShieldAlert, label: "Churn risk" },
  { icon: Target, label: "Opportunity patterns" },
];

export function GodViewTeaser() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="rounded-[6px] border border-neon-indigo/30 bg-midnight-slate-raised/50 p-8 backdrop-blur-sm sm:p-10">
        <div className="flex flex-col items-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Collective Intelligence</p>
          <h2 className="mx-auto mt-3 max-w-2xl font-marketing-heading text-2xl font-bold text-off-white sm:text-3xl">
            Every Foundation account makes God View sharper.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-off-white/60">
            Anonymized market data pooled across every connected agency - benchmarks, niche trends,
            churn risk, and opportunity patterns no single account can see on its own. The network
            gets sharper as more agencies connect on Foundation, which is exactly why we are
            keeping that door narrow while it grows.
          </p>
          <ComingSoonBadge className="mt-4" />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-4">
          {SIGNALEN.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 rounded-[6px] border border-off-white/10 bg-midnight-slate/60 p-4 text-center"
            >
              <Icon className="h-4 w-4 text-neon-indigo" aria-hidden />
              <p className="text-xs font-semibold text-off-white/80">{label}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-off-white/40">
          Not a live feature today - the direction every Foundation account is building toward.{" "}
          <Link href="/pricing" className="font-semibold text-neon-indigo hover:underline">
            See the God View tiers
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { moduleById, type ModulePriceTier } from "@/lib/marketing/modules";
import { ComingSoonBadge } from "./coming-soon-badge";

// Compact God View companion for the ROI-calculator section on the homepage (15 August 2026, on
// the owner's request: "a God View block next to the ROI calculator could add value, provided it
// doesn't distract from the calculator"). Deliberately the secondary element in that pair - muted
// border, no big colored numbers, no icon grid, roughly a third of the section's visual weight.
//
// Not the same pitch as the removed GodViewTeaser (deleted earlier today): that block framed
// Foundation as "you feed the network, you see nothing back," which is why it was cut. This one
// carries no such framing - it's a plain upsell mention (three paid tiers, same as AI Council or
// Second Opinion get pitched elsewhere), so the earlier problem doesn't apply here.
//
// Copy reuses the `positionering` line and the three tiers' naam/tagline straight from
// lib/marketing/modules.ts (the God View entry) rather than a second, hand-maintained copy of the
// same names and taglines already shown in the Intelligence Store on /pricing.
//
// Sits in a 3-column, top-aligned row next to RoiCalculator (app/(marketing)/page.tsx, "The Math"
// section) - not stretched to match the calculator's height. It's meant to read as the shorter,
// quieter neighbor, not an equal-weight twin.
//
// TIER LIST ADDED (15 August 2026, "God View mag wat meer ruimte innemen"): was a single
// paragraph. Rather than pad with invented copy, added the three real tier names + taglines below
// it - the same information already visible on the /pricing card, condensed to one line each.

const GOD_VIEW = moduleById("god-view");
const GOD_VIEW_TIERS = Array.isArray(GOD_VIEW?.prijs) ? (GOD_VIEW.prijs as ModulePriceTier[]) : [];

export function GodViewCompanion() {
  return (
    <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">Beyond your own numbers</p>
      <h3 className="mt-2 font-marketing-heading text-base font-bold text-off-white">
        God View: market intelligence on top
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-off-white/60">
        Same connected accounts, more context - anonymized benchmarks, niche trends, and
        opportunity patterns pooled across every agency on the platform.
      </p>

      <ul className="mt-4 space-y-2 border-t border-off-white/10 pt-4">
        {GOD_VIEW_TIERS.map((t) => (
          <li key={t.naam} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-off-white/80">{t.naam}</span>
            <span className="text-off-white/45">{t.tagline}</span>
          </li>
        ))}
      </ul>

      <ComingSoonBadge className="mt-4" />
      <Link
        href="/pricing"
        className="group mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-neon-indigo hover:text-off-white"
      >
        See the God View tiers
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  );
}

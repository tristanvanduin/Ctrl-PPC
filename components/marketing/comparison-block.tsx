import { X } from "lucide-react";

// Fase 7, Task 2 (Blok 2): het splitscherm. Links een generiek "dashboard" -- grafieken die
// niets vertellen over de oorzaak, doorgestreept met Amber Waste. Rechts hoe Ctrl PPC hetzelfde
// account leest: een diagnose met een oorzaak, in JetBrains Mono, met een Neon Indigo gloed.
// De rechterkant is illustratief or de echte lezing die de Decision Core oplevert (signaal ->
// hypothese -> kwaliteitspoort, zie lib/decision/), geen live data.

const NEP_BALKEN = [40, 65, 30, 80, 45, 60, 35];

const DIAGNOSE_REGELS = [
  { label: "SCAN", value: "71 accounts, 3 channels" },
  { label: "SIGNAL", value: "Search CPA (mobile) +34% vs. target" },
  { label: "ROOT CAUSE", value: "Bid strategy not reacting to the 19:00-22:00 peak window" },
  { label: "HYPOTHESIS", value: "tROAS +10% during evening hours -> CPA -15%" },
  { label: "STATUS", value: "awaiting quality gate" },
];

export function ComparisonBlock() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-center font-marketing-heading text-3xl font-bold text-off-white sm:text-4xl">
        Numbers are not a diagnosis
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-off-white/60">
        A dashboard shows you what happened. Ctrl PPC shows you why, and what to do next.
      </p>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Left: The Dashboard Illusion */}
        <div className="relative overflow-hidden rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/60">The Dashboard Illusion</p>
          <p className="mt-2 text-sm text-off-white/50">
            Charts per channel, lined up neatly. None of them tell you which one to trust, or what to
            do about it.
          </p>

          <div className="relative mt-8 flex h-40 items-end gap-3 opacity-40 grayscale">
            {NEP_BALKEN.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-off-white/60" style={{ height: `${h}%` }} />
            ))}
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <X className="h-24 w-24 text-amber-waste" strokeWidth={2.5} aria-hidden />
          </div>
        </div>

        {/* Right: Ctrl PPC Primary Diagnosis */}
        <div
          className="rounded-[6px] border border-neon-indigo/40 bg-midnight-slate-raised p-6"
          style={{ boxShadow: "0 0 32px rgba(129, 140, 248, 0.18)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">
            Ctrl PPC: Primary Diagnosis
          </p>

          <div className="mt-6 space-y-3" style={{ fontFamily: "var(--font-marketing-mono)" }}>
            {DIAGNOSE_REGELS.map((r) => (
              <div key={r.label} className="flex flex-wrap gap-x-3 text-sm">
                <span className="w-28 shrink-0 text-off-white/60">{r.label}</span>
                <span className="text-off-white">{r.value}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2 text-sm text-neon-indigo">
              <span className="inline-block h-3.5 w-2 animate-pulse bg-neon-indigo" aria-hidden />
              <span>awaiting next signal_</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

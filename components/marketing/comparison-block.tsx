// Fase 7, Task 2 (Blok 2): het splitscherm. Links een generiek "dashboard" -- grafieken die
// niets vertellen over de oorzaak. Rechts hoe Ctrl PPC hetzelfde account leest: een diagnose met
// een oorzaak, in JetBrains Mono, met een Neon Indigo gloed. De rechterkant is illustratief voor
// de echte lezing die de Decision Core oplevert (signaal -> hypothese -> kwaliteitspoort, zie
// lib/decision/), geen live data.
//
// De twee kaarttitels stonden op <p>, niet op een koptag (audit, 11 augustus 2026) -- de
// visuele hierarchie zei "titel", de heading-outline die crawlers en screenreaders gebruiken zei
// niets. Nu <h3>, onder de <h2> van deze sectie.
//
// REPOSITIONERING (11 augustus 2026, op vraag van de eigenaar): de linkerkant heette eerst "The
// Dashboard Illusion" met een grote X eroverheen. Dat is teruggedraaid na een terechte vraag: Ctrl
// PPC heeft zelf een substantiele dashboardlaag (gratis op elke tier, zie /pricing -- "Just want
// the dashboard and the forecast? Basis is free"), en die data voedt op macro-niveau ook de
// analyselaag zelf. "Je dashboard is een illusie" naast "hier is ons gratis dashboard" is een
// tegenspraak die een scherpe prospect direct ziet. De X en de "Illusion"-naam zijn weg; de
// vergelijking blijft (een los dashboard stopt bij wat er gebeurde, geen oorzaak, geen actie),
// maar erkent nu dat het dashboard zelf niet het probleem is -- het is de basislaag, inbegrepen,
// niet de illusie. Zie ook app/(marketing)/vs/page.tsx en app/(marketing)/opengraph-image.tsx
// voor dezelfde correctie elders op de site.

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
      <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
        Intelligence is not decisioning
      </p>
      <h2 className="mt-2 text-center font-marketing-heading text-3xl font-bold text-off-white sm:text-4xl">
        Numbers are not a diagnosis
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-off-white/60">
        A dashboard shows you what happened. Ctrl PPC shows you why, and what to do next.
      </p>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Left: Dashboards Alone */}
        <div className="relative overflow-hidden rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/60">Dashboards Alone</h3>
          <p className="mt-2 text-sm text-off-white/50">
            Charts per channel, lined up neatly -- included free on every Ctrl PPC tier too. On its
            own, it stops at what happened: it does not tell you which number to trust, or what to
            do about it.
          </p>

          <div className="relative mt-8 flex h-40 items-end gap-3 opacity-40 grayscale">
            {NEP_BALKEN.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-off-white/60" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        {/* Right: Ctrl PPC Primary Diagnosis */}
        <div
          className="rounded-[6px] border border-neon-indigo/40 bg-midnight-slate-raised p-6"
          style={{ boxShadow: "0 0 32px rgba(129, 140, 248, 0.18)" }}
        >
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">
            Ctrl PPC: Primary Diagnosis
          </h3>

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

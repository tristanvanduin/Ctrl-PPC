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
//
// TWEEDE NUANCESLAG (12 augustus 2026, mobiele screenshot-review): de body-tekst en de grafiek
// waren nog steeds negatiever getoond dan verdiend, vooral omdat dashboarding niet zomaar "ook
// inbegrepen" is -- het IS de volledige inhoud van de Foundation-tier (zie lib/marketing/tiers.ts:
// "Dashboarding, forecasting, and KPI monitoring" zijn letterlijk Foundation's drie features).
// "Stops at what happened", "does not tell you" klonk als een tekortkoming van iets dat de site
// zelf gratis weggeeft. Herschreven om te erkennen dat dit de basis is die elk account nodig
// heeft, met "free forever" er expliciet bij, i.p.v. alleen de beperking te benoemen. De grafiek
// ging van opacity-40 + grayscale (oogt uitgeschakeld) naar opacity-70 zonder grayscale (oogt
// gewoon, niet stuk) -- het punt is een ander soort laag, niet een mindere kwaliteit dashboard.
//
// DERDE NUANCESLAG (12 augustus 2026, zelfde review, direct erna): de correctie hierboven ging
// te ver de andere kant op -- "ik vind de dashboarding nu wel echt te licht ... de echte winst
// zit bij de analyse en het vervolg erop. dat stuk mis ik." Dashboarding blijft waardevol en
// gratis (geen terugval naar de eerste, te negatieve versie), maar de zin die zei waar het
// echte rendement zit is verdwenen in de vorige pass. Toegevoegd: een expliciete slotzin die
// benoemt dat de analyselaag is waar het rendement zit, niet als tekortkoming van het dashboard
// maar als plaatsbepaling -- "waardevol op zichzelf" staat naast "het rendement zit een laag
// hoger", niet in plaats van.

const NEP_BALKEN = [40, 65, 30, 80, 45, 60, 35];

// Hierarchy pass (12 augustus 2026, design feedback): alle vijf regels stonden op gelijk gewicht
// -- zelfde grootte, alleen het label gedimd -- waardoor niets eruit sprong en het blok werd
// overgescand in plaats van gelezen. SCAN/SIGNAL zijn nu de opzet (klein, compact), ROOT CAUSE en
// HYPOTHESIS de twee regels die de sectie-titel ("Numbers are not a diagnosis") daadwerkelijk
// waarmaken -- die krijgen het formaat en de helderheid, niet de context eromheen.
const SETUP_REGELS = [
  { label: "SCAN", value: "71 accounts, 3 channels" },
  { label: "SIGNAL", value: "Search CPA (mobile) +34% vs. target" },
];

const KERN_REGELS = [
  { label: "ROOT CAUSE", value: "Bid strategy not reacting to the 19:00-22:00 peak window" },
  { label: "HYPOTHESIS", value: "tROAS +10% during evening hours -> CPA -15%" },
];

export function ComparisonBlock() {
  return (
    // py-16 (was py-20, 12 augustus 2026): zes marketingcomponenten droegen elk hun eigen
    // sectiepadding zonder gedeelde schaal (py-20/pb-20/pb-16 door elkaar) -- gelijkgetrokken op
    // py-16/pb-16, dezelfde waarde als product-video.tsx en de homepage al gebruikten.
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
        Intelligence is not decisioning
      </p>
      {/* text-4xl -> text-3xl (13 augustus 2026, "header/titels mega groot"): dit was de enige
          sectiekop op de homepage die zwaarder woog dan Global Platform Pulse's eigen h2
          (text-2xl) zonder daar een reden voor te hebben -- allebei zijn secundaire secties onder
          de hero. Gelijkgetrokken zodat de hero de enige echt grote kop op de pagina blijft. */}
      <h2 className="mt-2 text-center font-marketing-heading text-2xl font-bold text-off-white sm:text-3xl">
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
            Real-time charts per channel, forecasting, and KPI monitoring -- this is Foundation,
            free forever on every tier above it too. It is genuinely valuable on its own: the base
            every account needs, and where most agencies run today. But the return that actually
            moves the needle -- the diagnosis, the hypothesis, the next action -- lives one layer
            up, not here.
          </p>

          <div className="relative mt-8 flex h-40 items-end gap-3 opacity-70">
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

          <div className="mt-6" style={{ fontFamily: "var(--font-marketing-mono)" }}>
            <div className="space-y-1.5">
              {SETUP_REGELS.map((r) => (
                <div key={r.label} className="flex flex-wrap gap-x-3 text-xs">
                  <span className="w-24 shrink-0 text-off-white/40">{r.label}</span>
                  <span className="text-off-white/60">{r.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-4 border-l-2 border-neon-indigo/50 pl-4">
              {KERN_REGELS.map((r) => (
                <div key={r.label}>
                  <p className="text-[11px] uppercase tracking-wide text-neon-indigo/80">{r.label}</p>
                  <p className="mt-1 text-base leading-snug text-off-white">{r.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2 text-xs text-off-white/50">
              <span className="inline-block h-3.5 w-2 animate-pulse bg-neon-indigo" aria-hidden />
              <span>awaiting next signal_</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

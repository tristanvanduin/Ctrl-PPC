"use client";

import { useMemo, useState } from "react";
import { STANDAARDPAKKET, KANAAL_MULTIPLIER_PER_EXTRA_KANAAL, berekenBesparing } from "@/lib/marketing/roi-pakket";

// The package data (STANDAARDPAKKET), the channel-multiplier constant, and the calculation itself
// live in lib/marketing/roi-pakket.ts, not here (15 August 2026, bugfix - see that file's header
// for why: this component has "use client", and a Server Component importing a plain data export
// from a "use client" module crashes at request time in the App Router). This file is UI only now.
// Layout history below is about this component specifically; the package's own content history
// (why these four items, this wording) moved to roi-pakket.ts with the data.
//
// text-off-white/40 op deze en andere marketingpagina's gaf 3,56:1 contrast tegen
// --midnight-slate (WCAG AA vereist 4,5:1 voor gewone tekst); nagerekend en overal opgehoogd
// naar /60 (6,42:1). /50 (4,84:1) haalt de norm net wel en is met opzet ongemoeid gelaten.
//
// Negende keer (15 augustus 2026, "in zijn eentje moet het enorm breed worden of een relevante
// sectie ernaast krijgen, anders breekt het de pagina"): eerst geprobeerd als een kaart met twee
// kolommen intern (sliders links, uitkomst rechts) om zelf breed genoeg te zijn. Teruggedraaid in
// de tiende ronde hieronder -- een interne lg-breedtesplitsing gaat uit van de volle paginabreedte,
// niet van de helft daarvan zodra er een buur naast komt te staan, en zou dan juist te smal ogen.
//
// Tiende keer, zelfde dag (eigenaar wil alsnog een buurblok, "een god view blok naast die ROI
// calculator kan toegevoegde waarde bieden, mits het niet de aandacht afleidt"): kaart terug naar
// 1 kolom (dit bestand raakt de sectielayout niet meer aan) zodat hij goed past in een helft-
// breedte kolom naast components/marketing/god-view-companion.tsx. Zie app/(marketing)/page.tsx
// voor de sectieplaatsing (moest achter TrustBanner, niet ertussenin) en de 2-koloms opzet.
//
// Elfde keer, zelfde dag ("geef de kopkolom ernaast echt meer body"): app/(marketing)/page.tsx
// wilde STANDAARDPAKKET hergebruiken voor een "Replaces"-lijst naast de calculator. Eerste poging
// was gewoon `export` toevoegen hier -- leek te werken (tsc, tests, build waren allemaal groen),
// maar crashte in productie op de homepage ("this page couldn't load"), want de homepage is
// dynamisch (auth-redirect) en wordt dus nooit door `next build` echt gerenderd om de fout te
// vinden. Twaalfde keer: de data verhuisd naar lib/marketing/roi-pakket.ts (geen "use client")
// i.p.v. alleen een exportsleutelwoord toe te voegen aan een "use client"-bestand.

export function RoiCalculator() {
  const [klanten, setKlanten] = useState(15);
  const [uurtarief, setUurtarief] = useState(65);
  const [kanalenPerKlant, setKanalenPerKlant] = useState(1);
  const [toonPakket, setToonPakket] = useState(false);

  const { urenPerKlantPerMaand, urenPerMaand, euroPerMaand } = useMemo(
    () => berekenBesparing({ klanten, uurtarief, kanalenPerKlant }),
    [klanten, uurtarief, kanalenPerKlant],
  );

  const euroFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6" style={{ fontFamily: "var(--font-marketing-mono)" }}>
      <p className="text-xs uppercase tracking-[0.2em] text-off-white/50">Minimum monthly savings</p>

      <div className="mt-5 space-y-5">
        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Number of clients</span>
            <span className="text-neon-indigo">{klanten}</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={klanten}
            onChange={(e) => setKlanten(Number(e.target.value))}
            className="mt-2 w-full accent-[#818cf8]"
          />
        </label>

        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Channels per client (avg.)</span>
            <span className="text-neon-indigo">{kanalenPerKlant}</span>
          </div>
          <input
            type="range"
            min={1}
            max={4}
            value={kanalenPerKlant}
            onChange={(e) => setKanalenPerKlant(Number(e.target.value))}
            className="mt-2 w-full accent-[#818cf8]"
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-off-white/40">
            Google, Meta, LinkedIn, and Bing (coming soon) each get their own analysis -- more connected channels means more manual work replaced, not just more accounts.
          </p>
        </label>

        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Your specialist&apos;s hourly rate</span>
            <span className="text-neon-indigo">{euroFmt.format(uurtarief)}</span>
          </div>
          <input
            type="range"
            min={20}
            max={200}
            step={5}
            value={uurtarief}
            onChange={(e) => setUurtarief(Number(e.target.value))}
            className="mt-2 w-full accent-[#818cf8]"
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-off-white/10 pt-5">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-off-white/50">Hours per month</p>
          <p className="mt-1 text-2xl font-bold text-off-white">{urenPerMaand.toFixed(0)}h</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-off-white/50">Minimum value</p>
          <p className="mt-1 text-2xl font-bold text-neon-indigo">{euroFmt.format(euroPerMaand)}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setToonPakket((v) => !v)}
        className="mt-4 py-2.5 text-xs font-semibold text-off-white/50 underline hover:text-off-white"
      >
        {toonPakket
          ? "Hide the standard package"
          : `Where do those ${urenPerKlantPerMaand.toFixed(1)}h per client (x ${klanten} clients = ${urenPerMaand.toFixed(0)}h) come from?`}
      </button>

      {toonPakket && (
        <>
          <ul className="mt-3 space-y-2.5 border-t border-off-white/10 pt-3">
            {STANDAARDPAKKET.map((a) => (
              <li key={a.naam} className="text-xs">
                <div className="flex items-center justify-between text-off-white/80">
                  <span className="font-semibold">{a.naam}</span>
                  <span className="text-off-white/60">{a.minutenPerMaand} min/mo</span>
                </div>
                <p className="mt-0.5 leading-relaxed text-off-white/50">{a.beschrijving}</p>
                {a.kanalen.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {a.kanalen.map((k) => (
                      <p key={k.k} className="text-[11px] leading-relaxed text-off-white/40">
                        <span className="text-off-white/55">{k.k}:</span> {k.t}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Zesde keer (12 augustus 2026, "dit is wel echt een lap tekst"): 3 aparte
              disclaimer-paragrafen (schatting/handmatige deep dives, kanaal-multiplier,
              tier-dekking) samengevoegd tot 2 kortere -- inhoud niet weggelaten, wel ontdaan van
              overlap ("minimum, niet het plafond" zei hetzelfde als "niet meegeteld"). */}
          <p className="mt-4 text-xs leading-relaxed text-off-white/60">
            Estimate based on your input, not a measured result -- manual deep dives (budget
            allocation, bid strategy, and similar on-demand work) are on top and not counted here.
            Automatic coverage depends on your tier, Foundation has none; see the current limits
            on <a href="/pricing" className="underline hover:text-off-white/70">the pricing page</a>.
          </p>
          {kanalenPerKlant > 1 && (
            <p className="mt-2 text-xs leading-relaxed text-off-white/60">
              Each additional channel adds an estimated {Math.round(KANAAL_MULTIPLIER_PER_EXTRA_KANAAL * 100)}%,
              not a full extra trajectory -- shared account context lowers the cost.
              {kanalenPerKlant === 4 && " Bing is in development; this slot assumes the same savings once it's live."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

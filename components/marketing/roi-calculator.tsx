"use client";

import { useMemo, useState } from "react";

// Herzien twee keer na terechte feedback. Eerste keer: de vorige versie ("de 7 analyses die voor
// elke klant lopen") telde budget-allocation, bid-strategy, quality-score, impression-share,
// cross-channel en kpi-relations mee als het automatische standaardpakket. Dat klopt niet --
// lib/analysis/credit-costs.ts noemt die zes expliciet "HANDMATIGE deep-dive-routes", nooit de
// automatische SOP-cadans. Wat automatisch draait is monthly + weekly + biweekly
// (lib/tenancy/sop-dekking.ts). Tweede keer (11 augustus 2026): een eerste herbouw op die drie,
// elk als los item met een frequentie-vermenigvuldiging (weekly x4/maand, biweekly x2/maand), werd
// terecht als zwak ervaren -- een kaal "x keer per maand" zegt niets over de inhoud of de
// bewijslast waarom iets zoveel tijd kost. Herbouwd naar drie grotere, herkenbare blokken die elk
// een korte inhoudsbeschrijving dragen (wat er in zit, niet alleen hoe vaak het draait): de
// maandelijkse diepe analyse, de doorlopende monitoring (weekly + biweekly samengevoegd, want voor
// de lezer is "wat wordt er gecontroleerd tussen twee maandanalyses in" één verhaal, geen twee
// aparte regels), en de rapportage. Tijdsschatting per blok blijft dezelfde methode: wat een
// specialist er naar schatting handmatig aan kwijt zou zijn, gebaseerd op de stappen in de
// SOP-prompts zelf (lib/prompts/sop-prompts.ts: buildWeeklyPrompt's 3 stappen, buildBiWeeklyPrompt's
// 4 stappen, de monthly 9-staps diepe analyse).
//
// text-off-white/40 op deze en andere marketingpagina's gaf 3,56:1 contrast tegen
// --midnight-slate (WCAG AA vereist 4,5:1 voor gewone tekst); nagerekend en overal opgehoogd
// naar /60 (6,42:1). /50 (4,84:1) haalt de norm net wel en is met opzet ongemoeid gelaten.

interface Analyse {
  naam: string;
  beschrijving: string;
  minutenPerMaand: number;
}

const STANDAARDPAKKET: Analyse[] = [
  {
    naam: "Monthly deep dive",
    beschrijving:
      "9 steps: account, campaigns, ad groups, auction insights, search terms, creative, audience & device, geography, network & schedule -- plus 3 sprint hypotheses.",
    minutenPerMaand: 90,
  },
  {
    naam: "Ongoing monitoring",
    beschrijving:
      "Weekly (x4): tracking health, keyword/search-term bleeders, budget anomalies. Biweekly (x2): re-checks account, campaign, ad group, and device pacing against the monthly forecast.",
    minutenPerMaand: 20 * 4 + 45 * 2,
  },
  {
    naam: "Monthly report",
    beschrijving: "Client-facing PDF synthesis of the month's findings.",
    minutenPerMaand: 60,
  },
];

const MINUTEN_TOTAAL = STANDAARDPAKKET.reduce((som, a) => som + a.minutenPerMaand, 0);
const UREN_PER_KLANT_PER_MAAND = MINUTEN_TOTAAL / 60;

interface Invoer {
  klanten: number;
  uurtarief: number;
}

function berekenBesparing({ klanten, uurtarief }: Invoer) {
  const urenPerMaand = UREN_PER_KLANT_PER_MAAND * klanten;
  const euroPerMaand = urenPerMaand * uurtarief;
  return { urenPerMaand, euroPerMaand };
}

export function RoiCalculator() {
  const [klanten, setKlanten] = useState(15);
  const [uurtarief, setUurtarief] = useState(65);
  const [toonPakket, setToonPakket] = useState(false);

  const { urenPerMaand, euroPerMaand } = useMemo(
    () => berekenBesparing({ klanten, uurtarief }),
    [klanten, uurtarief],
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
          : `Where do those ${UREN_PER_KLANT_PER_MAAND.toFixed(1)}h per client (x ${klanten} clients = ${urenPerMaand.toFixed(0)}h) come from?`}
      </button>

      {toonPakket && (
        <ul className="mt-3 space-y-2.5 border-t border-off-white/10 pt-3">
          {STANDAARDPAKKET.map((a) => (
            <li key={a.naam} className="text-xs">
              <div className="flex items-center justify-between text-off-white/80">
                <span className="font-semibold">{a.naam}</span>
                <span className="text-off-white/60">{a.minutenPerMaand} min/mo</span>
              </div>
              <p className="mt-0.5 leading-relaxed text-off-white/50">{a.beschrijving}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-off-white/60">
        These are the three automatic SOP runs that happen for every client by default --
        monthly, weekly, and biweekly -- with an estimated time cost if a specialist did each by
        hand. Manual deep dives (budget allocation, bid strategy, and similar on-demand analyses)
        come on top of this and are not counted here: this is the minimum, not the ceiling. An
        estimate based on your input, not a measured result.
      </p>
    </div>
  );
}

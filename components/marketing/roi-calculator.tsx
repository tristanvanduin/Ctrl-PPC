"use client";

import { useMemo, useState } from "react";

// Herzien drie keer na terechte feedback. Eerste keer: de vorige versie ("de 7 analyses die voor
// elke klant lopen") telde budget-allocation, bid-strategy, quality-score, impression-share,
// cross-channel en kpi-relations mee als het automatische standaardpakket. Dat klopt niet --
// lib/analysis/credit-costs.ts noemt die zes expliciet "HANDMATIGE deep-dive-routes", nooit de
// automatische SOP-cadans. Wat automatisch draait is monthly + weekly + biweekly
// (lib/tenancy/sop-dekking.ts). Tweede keer (11 augustus 2026): een eerste herbouw op die drie,
// elk als los item met een frequentie-vermenigvuldiging (weekly x4/maand, biweekly x2/maand), werd
// terecht als zwak ervaren -- een kaal "x keer per maand" zegt niets over de inhoud of de
// bewijslast waarom iets zoveel tijd kost. Herbouwd naar drie grotere, herkenbare blokken die elk
// een korte inhoudsbeschrijving dragen.
//
// Derde keer (12 augustus 2026, mobiele design-review): "weekly/biweekly/monthly" als itemnamen
// was zelf het volgende probleem -- cadans-jargon, geen marketingtaal, en het verstopte "Ongoing
// monitoring" als een vage paraplu over twee heel verschillende controles. Opgesplitst naar wat
// elk item inhoudelijk DOET: "Anomaly detection" (het weekly-signaal, vroeg problemen vangen) en
// "Progress vs. monthly target" (het biweekly-signaal, prognose-vs-doelstelling).
//
// Vierde keer, zelfde dag: de "Monthly deep dive"-beschrijving noemde eerst 6 vaste pijlers uit
// docs/ANALYSE-LOGICA.md #5.1 -- maar die tabel documenteert alleen het Google Ads-pad. "Dit is
// weer extreem google minded", terecht -- app/api/analysis/monthly/route.ts draait per kanaal een
// eigen stappenreeks (lib/analysis/adapters/: Google, Meta, LinkedIn), elk gebouwd rond wat dat
// kanaal daadwerkelijk is, niet een generiek sjabloon met een kanaallabel erop. Herschreven naar
// kanaalspecifieke aandachtsgebieden (zoekintentie voor Google, creative/audience-fatigue voor
// Meta, ICP-fit en lead funnel voor LinkedIn) zonder de exacte stappenlijst of het stappenaantal
// per kanaal te noemen -- genoeg om doordacht en specifiek te ogen, niet genoeg om de SOP-structuur
// zelf na te bouwen. Wat wel gedeeld is over elk kanaal, en veilig hardop te zeggen: elk kanaal
// eindigt in hypothesevalidatie en clear't dezelfde kwaliteitspoorten voor synthese
// (finalizeChannelMonthlySynthesis, gedeeld door Google/Meta/LinkedIn -- zie deliverable-example.tsx
// voor dezelfde correctie). Tijdsschatting per blok blijft dezelfde methode: wat een specialist er
// naar schatting handmatig aan kwijt zou zijn, gebaseerd op de stappen in de SOP-prompts zelf
// (lib/prompts/sop-prompts.ts: buildWeeklyPrompt, buildBiWeeklyPrompt, de monthly diepe analyse).
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
    naam: "Anomaly detection",
    beschrijving:
      "Weekly (x4): tracking health, keyword and search-term bleeders, budget anomalies -- catches problems before they compound.",
    minutenPerMaand: 20 * 4,
  },
  {
    naam: "Progress vs. monthly target",
    beschrijving:
      "Biweekly (x2): re-checks account, campaign, ad group, and device pacing against the monthly forecast -- is the month on track?",
    minutenPerMaand: 45 * 2,
  },
  {
    naam: "Monthly deep dive",
    beschrijving:
      "Reasoning shaped per channel -- search intent for Google, creative & audience fatigue for Meta, ICP-fit and lead funnel for LinkedIn -- every finding cleared through the same quality gates, ending in hypothesis validation.",
    minutenPerMaand: 90,
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
        <>
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

          {/* Stond hiervoor los van de toggle, altijd zichtbaar -- verlengde de pagina zonder dat
              iemand er iets voor hoefde te doen. Hoort inhoudelijk bij dezelfde uitleg als het
              pakket erboven, dus nu ook achter dezelfde knop (12 augustus 2026, mobiele audit). */}
          <p className="mt-4 text-xs leading-relaxed text-off-white/60">
            These are the automatic SOP runs that happen for every covered client by default --
            monthly, weekly, and biweekly -- with an estimated time cost if a specialist did each
            by hand. Manual deep dives (budget allocation, bid strategy, and similar on-demand
            analyses) come on top of this and are not counted here: this is the minimum, not the
            ceiling. An estimate based on your input, not a measured result.
          </p>
          {/* Disclaimer (12 augustus 2026, mobiele design-review): dit rekentool-scherm suggereert
              stilzwijgend dat elke klant in het slider-cijfer automatische SOP's krijgt, maar die
              dekking is tier-afhankelijk (lib/tenancy/sop-dekking.ts: 0 op Foundation, oplopend
              per tier). Zonder deze regel leest de besparing als een garantie die op een lagere
              tier niet klopt. */}
          <p className="mt-2 text-xs leading-relaxed text-off-white/40">
            How many client accounts run these automatically depends on your tier -- Foundation
            does not include automatic SOPs, and paid tiers cover a set number of accounts each.
            See the current limits on <a href="/pricing" className="underline hover:text-off-white/70">the pricing page</a>.
          </p>
        </>
      )}
    </div>
  );
}

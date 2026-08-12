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
//
// DERDE AS: KANALEN PER KLANT (12 augustus 2026, eigenaar): STANDAARDPAKKET hierboven is de
// automatische SOP-cyclus voor 1 kanaal. Maar app/api/analysis/monthly/route.ts draait
// per kanaal een VOLLEDIG eigen stappenreeks (Google/Meta/LinkedIn-adapters, zie
// deliverable-example.tsx) -- een klant met alle drie kanalen aangesloten levert dus ook drie
// keer zoveel handmatig werk op om te vervangen, niet slechts een. Geen platte x2/x3 per extra
// kanaal ("misschien niet de tijd x2 of x3, maar wel een extra layer eroverheen") -- gekozen
// voor +60% van het basispakket per extra kanaal: reflecteert dat elk kanaal zijn eigen SOP-run
// nodig heeft, maar met gedeeld accountniveau-overzicht i.p.v. drie volledig losse trajecten.
// 60% is een bewuste, ronde, conservatieve inschatting -- geen gemeten kanaal-voor-kanaal
// tijdsopname (die bestaat niet), dus geen valse precisie zoals 11/13 of 9/13 zou suggereren.
const KANAAL_MULTIPLIER_PER_EXTRA_KANAAL = 0.6;

// Vijfde keer (12 augustus 2026, na live-controle op mobiel): "Monthly deep dive" perste Google,
// Meta en LinkedIn in een enkele doorlopende zin -- Meta en LinkedIn verdwenen visueel ("ik mis
// hier de linkedin en meta"), en "ICP-fit" las als interne sales-jargon, niet als marketingtaal
// ("ik vind de termen niet voldoen aan de marketing termen"). Eerst opgesplitst naar drie eigen
// REGELS per kanaal -- loste de zichtbaarheid op, maar maakte het blok voor 1 item al 4 regels
// lang.
//
// Zesde keer, zelfde dag ("moeten weekly en biweekly niet ook geupdatet worden?? dit is een lap
// tekst, kan het korter"): twee eisen die tegen elkaar in leken te staan -- alle 3 items moeten
// per-kanaal info tonen (lib/prompts/sop-prompts.ts: buildWeeklyPrompt en buildBiWeeklyPrompt
// hebben net zo goed echte META_WEEKLY/LINKEDIN_WEEKLY- en META_BIWEEKLY/LINKEDIN_BIWEEKLY-content,
// niet alleen de monthly-adapters), maar het geheel moest korter, niet langer. Opgelost door de
// kanaalweergave te verdichten van 3 losse rijen naar EEN regel per item ("Google: ... -- Meta:
// ... -- LinkedIn: ..."), toegepast op alle 3 -- meer dekking, minder ruimte per item.
//
// Zevende keer, zelfde dag ("ik wil ook van de termen weekly, biweekly en monthly af"): de
// itembeschrijvingen zeiden nog letterlijk "Weekly (x4)" en "Biweekly (x2)", en twee van de vier
// itemnamen waren zelf een cadans-label ("Monthly deep dive", "Monthly report"). Cadans-woorden
// vervangen door een neutrale "xN/mo"-multiplier (het getal blijft zichtbaar, het Engelse
// cadanswoord niet) en de twee resterende cadans-namen herschreven naar wat het item DOET.
// "Progress vs. monthly target" blijft ongewijzigd -- "monthly" verwijst daar naar de
// doelstelling zelf (een normaal bedrijfsbegrip), niet naar hoe vaak Ctrl PPC checkt, en is
// letterlijk de eigen formulering van de eigenaar ("vs maand doelstellingen").
const KANAAL_REGEL = (g: string, m: string, l: string) =>
  [{ k: "Google", t: g }, { k: "Meta", t: m }, { k: "LinkedIn", t: l }];

interface Analyse {
  naam: string;
  beschrijving: string;
  minutenPerMaand: number;
  kanalen: ReturnType<typeof KANAAL_REGEL>;
}

const STANDAARDPAKKET: Analyse[] = [
  {
    naam: "Continuous anomaly detection",
    beschrijving: "x4/mo -- catches problems before they compound.",
    minutenPerMaand: 20 * 4,
    kanalen: KANAAL_REGEL(
      "keyword and search-term waste",
      "ad set bleeders and creative fatigue",
      "campaign bleeders, weighted for low B2B volume",
    ),
  },
  {
    naam: "Progress vs. monthly target",
    beschrijving: "x2/mo -- is the month on track against forecast?",
    minutenPerMaand: 45 * 2,
    kanalen: KANAAL_REGEL(
      "ad group and device pacing",
      "ad set pacing and audience saturation",
      "creative and bid pacing",
    ),
  },
  {
    naam: "Deep dive analysis",
    beschrijving: "Every finding clears the same quality gates, ending in hypothesis validation.",
    minutenPerMaand: 90,
    kanalen: KANAAL_REGEL(
      "what buyers are searching for, and the auction",
      "which creative works, and audience fatigue",
      "reaching the right decision-makers, and the lead funnel",
    ),
  },
  {
    naam: "Client report",
    beschrijving: "PDF synthesis of the findings, ready to send.",
    minutenPerMaand: 60,
    kanalen: [],
  },
];

const MINUTEN_TOTAAL = STANDAARDPAKKET.reduce((som, a) => som + a.minutenPerMaand, 0);
const UREN_PER_KLANT_PER_MAAND = MINUTEN_TOTAAL / 60;

interface Invoer {
  klanten: number;
  uurtarief: number;
  kanalenPerKlant: number;
}

function berekenBesparing({ klanten, uurtarief, kanalenPerKlant }: Invoer) {
  const kanaalMultiplier = 1 + (kanalenPerKlant - 1) * KANAAL_MULTIPLIER_PER_EXTRA_KANAAL;
  const urenPerKlantPerMaand = UREN_PER_KLANT_PER_MAAND * kanaalMultiplier;
  const urenPerMaand = urenPerKlantPerMaand * klanten;
  const euroPerMaand = urenPerMaand * uurtarief;
  return { urenPerKlantPerMaand, urenPerMaand, euroPerMaand };
}

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
                  <p className="mt-1 text-[11px] leading-relaxed text-off-white/40">
                    {a.kanalen.map((k) => `${k.k}: ${k.t}`).join(" -- ")}
                  </p>
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

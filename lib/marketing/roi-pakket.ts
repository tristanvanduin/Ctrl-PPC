// Pure data and calculation logic for the ROI calculator's "standard package" - deliberately NOT
// in components/marketing/roi-calculator.tsx (15 August 2026, bugfix, "this page couldn't load, a
// server error occurred"). That component has "use client", and a Server Component
// (app/(marketing)/page.tsx) importing a plain data export from a "use client" module crashes at
// request time in the App Router: the RSC boundary treats every export of a "use client" file as
// an opaque client reference, not the real value, so `STANDAARDPAKKET.map(...)` inside a Server
// Component throws. It never showed up in `next build` because the homepage is dynamically
// rendered (the auth redirect), not statically prerendered - the crash only happens on an actual
// request. Moved the data and its dependencies here, a plain module with no "use client", so both
// roi-calculator.tsx (client) and app/(marketing)/page.tsx (server) import the real array.
//
// Content history (why these four items, this wording, this per-channel breakdown - not the bug
// above): revised multiple times after feedback, in order --
//
// 1. The original package ("the 7 analyses that run for every client") counted budget-allocation,
//    bid-strategy, quality-score, impression-share, cross-channel and kpi-relations as automatic.
//    Wrong - lib/analysis/credit-costs.ts calls those six explicitly "MANUAL deep-dive routes",
//    never the automatic SOP cadence. What runs automatically is monthly + weekly + biweekly
//    (lib/tenancy/sop-dekking.ts).
// 2. First rebuild on those three, each as a separate item with a frequency multiplier (weekly
//    x4/month, biweekly x2/month) - felt weak, a bare "x times per month" says nothing about the
//    content or why something takes that long. Rebuilt into three larger, recognizable blocks each
//    carrying a short content description.
// 3. "weekly/biweekly/monthly" as item names was itself the next problem - cadence jargon, not
//    marketing language, and it hid "ongoing monitoring" as a vague umbrella over two very
//    different checks. Split into what each item actually DOES: "Anomaly detection" (the weekly
//    signal, catching problems early) and "Progress vs. monthly target" (the biweekly signal,
//    forecast vs. target).
// 4. The "Monthly deep dive" description first named 6 fixed pillars from docs/ANALYSE-LOGICA.md
//    #5.1 - but that table only documents the Google Ads path. Rewritten to channel-specific focus
//    areas (search intent for Google, creative/audience fatigue for Meta, ICP fit and lead funnel
//    for LinkedIn) without exposing the exact step list or count per channel.
// 5. "Monthly deep dive" squeezed Google, Meta and LinkedIn into one run-on sentence - Meta and
//    LinkedIn disappeared visually. Split into three separate lines per channel.
// 6. Needed per-channel info on all 3 items without getting longer - condensed the channel display
//    from 3 separate rows to one line per item ("Google: ... - Meta: ... - LinkedIn: ...").
// 7. Item descriptions still literally said "Weekly (x4)" and "Biweekly (x2)", and two of the four
//    item names were themselves cadence labels. Replaced with a neutral "xN/mo" multiplier and
//    rewrote the two remaining cadence names to what the item does.
// 8. The channel line was back to one run-on row - reverted to one row per channel, still shorter
//    than the original four-line version.
//
// DERDE AS: KANALEN PER KLANT (12 augustus 2026, eigenaar): STANDAARDPAKKET hierboven is de
// automatische SOP-cyclus voor 1 kanaal. Maar app/api/analysis/monthly/route.ts draait per kanaal
// een VOLLEDIG eigen stappenreeks (Google/Meta/LinkedIn-adapters, zie deliverable-example.tsx) --
// een klant met alle drie kanalen aangesloten levert dus ook drie keer zoveel handmatig werk op om
// te vervangen, niet slechts een. Geen platte x2/x3 per extra kanaal ("misschien niet de tijd x2 of
// x3, maar wel een extra layer eroverheen") -- gekozen voor +60% van het basispakket per extra
// kanaal: reflecteert dat elk kanaal zijn eigen SOP-run nodig heeft, maar met gedeeld
// accountniveau-overzicht i.p.v. drie volledig losse trajecten. 60% is een bewuste, ronde,
// conservatieve inschatting -- geen gemeten kanaal-voor-kanaal tijdsopname (die bestaat niet), dus
// geen valse precisie zoals 11/13 of 9/13 zou suggereren.
export const KANAAL_MULTIPLIER_PER_EXTRA_KANAAL = 0.6;

const KANAAL_REGEL = (g: string, m: string, l: string) =>
  [{ k: "Google", t: g }, { k: "Meta", t: m }, { k: "LinkedIn", t: l }];

interface Analyse {
  naam: string;
  beschrijving: string;
  minutenPerMaand: number;
  kanalen: ReturnType<typeof KANAAL_REGEL>;
}

export const STANDAARDPAKKET: Analyse[] = [
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

export interface Invoer {
  klanten: number;
  uurtarief: number;
  kanalenPerKlant: number;
}

export function berekenBesparing({ klanten, uurtarief, kanalenPerKlant }: Invoer) {
  const kanaalMultiplier = 1 + (kanalenPerKlant - 1) * KANAAL_MULTIPLIER_PER_EXTRA_KANAAL;
  const urenPerKlantPerMaand = UREN_PER_KLANT_PER_MAAND * kanaalMultiplier;
  const urenPerMaand = urenPerKlantPerMaand * klanten;
  const euroPerMaand = urenPerMaand * uurtarief;
  return { urenPerKlantPerMaand, urenPerMaand, euroPerMaand };
}

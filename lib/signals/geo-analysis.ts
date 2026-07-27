// Markt-analyse: welke landen — en binnen de VS welke staten — verdienen een ingreep.
//
// De kaart liet al zien wáár het verkeer vandaan komt, maar concludeerde niets. Een kaart is een
// kijkinstrument; dit is de bijbehorende bevinding. Vier vragen die er bij internationale
// beursmarketing echt toe doen:
//
//   1. Betalen we ergens voor verkeer dat nooit converteert?
//   2. Is een markt structureel duurder dan de rest?
//   3. Komt het verkeer wél binnen maar converteert het niet — dan wijst dat naar de landingspagina
//      of de taal, niet naar de targeting.
//   4. Is er een markt die goedkoop converteert maar nauwelijks budget krijgt?
//
// Vergelijken gebeurt binnen hetzelfde niveau: landen tegen landen, VS-staten tegen VS-staten.
// Californië tegen Nederland leggen zou structurele marktverschillen (hogere CPC's in de VS) als
// probleem markeren, en dat is geen bevinding maar een verkeerde vergelijking.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";
import { countryLabel } from "@/lib/countries";
import { stateLabel } from "@/lib/geo/us-fips";
import type { GeoAgg } from "@/lib/demo/geo-demo";

export type GeoLevel = "country" | "region";

/** Minimale kosten voordat een markt de moeite van een oordeel waard is. */
export const GEO_MIN_COST = 100;
/** Minimale klikken: zonder verkeer zegt "geen conversies" niets. */
export const GEO_MIN_CLICKS = 50;
/** Zoveel keer de mediane CPA telt als duur. */
export const GEO_CPA_HIGH = 1.75;
/** Onder dit deel van de mediane CPA is een markt opvallend efficiënt. */
export const GEO_CPA_LOW = 0.6;
/** Onder dit deel van de mediane conversieratio haakt het verkeer af na de klik. */
export const GEO_CONV_RATE_LOW = 0.5;
/** Zoveel markten moeten er zijn voordat een mediaan iets betekent. */
export const GEO_MIN_MARKETS = 3;
/** Boven dit kostenaandeel is een markt te groot om nog een "schaalkans" te heten. */
export const GEO_SCALE_MAX_SHARE = 0.15;

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
// Conversieratio's hebben twee decimalen nodig (0,80% vs 1,79% is een echt verschil); een
// budgetaandeel niet — "39,98% van het budget" suggereert een precisie die er niet is.
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const share = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));
const ev = (metric: string, value: string, prev?: string): SignalEvidence => ({ metric, value, prev });

const labelFor = (code: string, level: GeoLevel) => (level === "region" ? stateLabel(code) : countryLabel(code));
const noun = (level: GeoLevel) => (level === "region" ? "staat" : "markt");
const nounPlural = (level: GeoLevel) => (level === "region" ? "staten" : "markten");

interface Market extends GeoAgg {
  label: string;
  cpa: number | null;
  convRate: number | null;
  ctr: number | null;
  costShare: number;
}

function toMarkets(rows: GeoAgg[], level: GeoLevel): Market[] {
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  return rows.map((r) => ({
    ...r,
    label: labelFor(r.code, level),
    cpa: r.conversions > 0 ? r.cost / r.conversions : null,
    convRate: r.clicks > 0 ? r.conversions / r.clicks : null,
    ctr: r.impressions > 0 ? r.clicks / r.impressions : null,
    costShare: totalCost > 0 ? r.cost / totalCost : 0,
  }));
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
}

/** Draagt deze markt genoeg volume om er iets over te zeggen? */
function isMaterial(m: Market): boolean {
  return m.cost >= GEO_MIN_COST && m.clicks >= GEO_MIN_CLICKS;
}

/**
 * Bouwt de marktbevindingen voor één niveau. `channelLabel` komt in de scope terecht zodat een
 * voorstel in de wachtrij meteen duidelijk maakt over welk kanaal het gaat.
 */
export function buildGeoSignals(rows: GeoAgg[], level: GeoLevel, channelLabel: string): DetectionResult {
  const checked = [`geo_${level}_geen_conversies`, `geo_${level}_dure_markt`, `geo_${level}_conversieratio`, `geo_${level}_schaalkans`];
  const triggered: SignalStory[] = [];

  const markets = toMarkets(rows, level).filter(isMaterial);
  // Zonder een handvol vergelijkbare markten is er geen zinnige mediaan en dus geen norm.
  if (markets.length < GEO_MIN_MARKETS) return { triggered: [], checked };

  const medCpa = median(markets.map((m) => m.cpa).filter((v): v is number => v != null));
  const medConvRate = median(markets.map((m) => m.convRate).filter((v): v is number => v != null));
  const scope = (m: Market) => `${channelLabel} — ${m.label}`;

  for (const m of [...markets].sort((a, b) => b.cost - a.cost)) {
    // 1. Betaald verkeer dat nergens toe leidt. Het scherpst omdat er geen afweging aan zit.
    if (m.conversions === 0) {
      triggered.push({
        id: `geo_${level}_geen_conversies_${m.code}`,
        category: "budget_pacing",
        scope: scope(m),
        story: `${m.label} kostte ${eur(m.cost)} over ${int(m.clicks)} klikken zonder één conversie, terwijl de andere ${nounPlural(level)} wél converteren.`,
        actionDirection: `controleer of deze ${noun(level)} bij de doelgroep past en of de landingspagina er in de juiste taal en met het juiste aanbod staat; zo niet, sluit 'm uit of verlaag het bod`,
        certainty: "bewezen_binnen_platform",
        evidence: [ev("kosten", eur(m.cost)), ev("klikken", int(m.clicks)), ev("conversies", "0"), ev("kostenaandeel", share(m.costShare))],
      });
      continue; // een markt zonder conversies hoeft niet ook nog "duur" te heten
    }

    // 2. Verkeer komt binnen maar haakt af ná de klik. Wijst naar de pagina, niet naar de targeting.
    if (medConvRate != null && m.convRate != null && m.convRate < medConvRate * GEO_CONV_RATE_LOW) {
      triggered.push({
        id: `geo_${level}_conversieratio_${m.code}`,
        category: "conversie_meting",
        scope: scope(m),
        story: `${m.label} trekt verkeer (${int(m.clicks)} klikken, CTR ${pct(m.ctr)}) maar converteert op ${pct(m.convRate)} tegen ${pct(medConvRate)} mediaan over de andere ${nounPlural(level)}. De klik komt binnen, daarna gaat het mis.`,
        actionDirection: `kijk naar wat er ná de klik gebeurt voor deze ${noun(level)}: taal en valuta van de landingspagina, verzendbaarheid of leverbaarheid, en of het formulier voor deze markt werkt — dit is geen targetingprobleem`,
        certainty: "bewezen_binnen_platform",
        evidence: [
          ev(`conversieratio ${m.label}`, pct(m.convRate), `mediaan ${pct(medConvRate)}`),
          ev("klikken", int(m.clicks)), ev("CTR", pct(m.ctr)), ev("kosten", eur(m.cost)),
        ],
      });
      continue;
    }

    // 3. Structureel duur ten opzichte van de andere markten op hetzelfde niveau.
    if (medCpa != null && m.cpa != null && m.cpa > medCpa * GEO_CPA_HIGH) {
      triggered.push({
        id: `geo_${level}_dure_markt_${m.code}`,
        category: "veiling_concurrentie",
        scope: scope(m),
        story: `${m.label} kost ${eur(m.cpa)} per conversie tegen ${eur(medCpa)} mediaan over de andere ${nounPlural(level)}, bij ${eur(m.cost)} aan kosten (${share(m.costShare)} van het budget).`,
        actionDirection: `weeg of deze ${noun(level)} strategisch genoeg is om de hogere prijs te dragen; zo niet, verlaag het bod of verschuif budget naar de ${nounPlural(level)} die goedkoper converteren`,
        certainty: "bewezen_binnen_platform",
        evidence: [
          ev(`CPA ${m.label}`, eur(m.cpa), `mediaan ${eur(medCpa)}`),
          ev("kosten", eur(m.cost)), ev("conversies", int(m.conversions)), ev("kostenaandeel", share(m.costShare)),
        ],
      });
      continue;
    }

    // 4. Goedkoop maar klein: ruimte om te groeien.
    if (medCpa != null && m.cpa != null && m.cpa < medCpa * GEO_CPA_LOW && m.costShare < GEO_SCALE_MAX_SHARE) {
      triggered.push({
        id: `geo_${level}_schaalkans_${m.code}`,
        category: "zichtbaarheid_vraag",
        scope: scope(m),
        story: `${m.label} converteert op ${eur(m.cpa)} tegen ${eur(medCpa)} mediaan, maar krijgt maar ${share(m.costShare)} van het budget.`,
        actionDirection: `onderzoek of hier meer volume te halen is (bod of budget omhoog, breder targeten); controleer wel eerst of het lage volume niet komt door beperkte marktomvang`,
        // De efficiëntie is gemeten, de groeiruimte is een aanname: dat een markt goedkoop is
        // betekent niet dat er meer vraag zit.
        certainty: "indicatie",
        evidence: [
          ev(`CPA ${m.label}`, eur(m.cpa), `mediaan ${eur(medCpa)}`),
          ev("kostenaandeel", share(m.costShare)), ev("conversies", int(m.conversions)),
        ],
      });
    }
  }

  return { triggered, checked };
}

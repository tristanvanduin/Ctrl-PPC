// Snelle verzadigingsdetectie op dag-/weekdata.
//
// Waarom dit de maand-variant vervangt: campagnes lopen hier maximaal ~4 maanden (beurscampagnes
// richting een event). Een detector die drie volle maanden nodig heeft spreekt pas als de campagne
// voor driekwart voorbij is — dan is het advies niet meer uitvoerbaar. Bijsturen moet in weken.
//
// Het principe is daarom niet "wacht op tijd" maar "wacht op volume": een venster telt mee zodra
// beide helften genoeg vertoningen hebben om een verschil te kunnen dragen. Een kanaal met veel
// volume krijgt zo al na een week een oordeel; een kanaal met weinig volume wacht langer, maar op
// dezelfde bewijslast. Geen vaste wachttijd die voor iedereen hetzelfde is.
//
// Alle kwalificerende vensters worden beoordeeld, niet alleen het kortste. Twee redenen: een omslag
// die drie weken geleden begon valt bij een venster van 7 dagen volledig buiten beeld, en een
// scherpe prijspiek in de laatste dagen zou anders een sluipende verzadiging maskeren. Bij meerdere
// uitkomsten wint de ernstigste diagnose (publiek/creative raakt op) boven "bereik is duurder".
//
// Vensters zijn veelvouden van 7 dagen, zodat weekbuckets (Google) er precies in passen en er geen
// halve weken worden meegeteld.

import { type DetectionResult, type SignalStory, type SignalEvidence, relDelta, pct } from "./types";

/** Kandidaat-venstergroottes in dagen, kort naar lang. Veelvouden van 7 zodat weekbuckets passen. */
export const WINDOW_LADDER = [7, 14, 21, 28, 42, 56];
/** Minimale vertoningen per vensterhelft. Daaronder draagt het verschil geen conclusie. */
export const MIN_IMPRESSIONS_PER_WINDOW = 10_000;
/** CPM-stijging die materieel genoeg is om iets over te zeggen. */
export const CPM_RISE_THRESHOLD = 0.15;
/** CTR-daling die verzadiging onderscheidt van pure veilingdruk. */
export const CTR_DROP_THRESHOLD = -0.10;
/** Frequency-stijging die telt als "we bereiken steeds vaker dezelfde mensen". */
export const FREQ_RISE_THRESHOLD = 0.15;

const CHANNEL_LABEL: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn" };
const labelOf = (c: string) => CHANNEL_LABEL[c] ?? c;
const eur2 = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v);
const ev = (metric: string, value: string, prev?: string): SignalEvidence => ({ metric, value, prev });

/**
 * Eén bucket meetdata. Voor Meta/LinkedIn is dat een dag, voor Google een week — de detector telt
 * buckets op datum bij elkaar, dus beide werken zonder de data te moeten opsplitsen of te fabriceren.
 */
export interface SaturationPoint {
  channel: string;
  /** ISO-datum (YYYY-MM-DD). Bij een weekbucket: de eerste dag van die week. */
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  /** Alleen Meta: hoe vaak dezelfde persoon de advertentie gemiddeld zag. */
  frequency?: number | null;
}

interface WindowAgg { impressions: number; clicks: number; spend: number; freqWeighted: number; freqBase: number }

const emptyAgg = (): WindowAgg => ({ impressions: 0, clicks: 0, spend: 0, freqWeighted: 0, freqBase: 0 });

function addPoint(a: WindowAgg, p: SaturationPoint): void {
  a.impressions += p.impressions;
  a.clicks += p.clicks;
  a.spend += p.spend;
  // Frequency is een verhouding, geen optelbare hoeveelheid: we wegen 'm naar vertoningen.
  if (p.frequency != null && Number.isFinite(p.frequency) && p.impressions > 0) {
    a.freqWeighted += p.frequency * p.impressions;
    a.freqBase += p.impressions;
  }
}

const cpmOf = (a: WindowAgg) => (a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null);
const ctrOf = (a: WindowAgg) => (a.impressions > 0 ? a.clicks / a.impressions : null);
const freqOf = (a: WindowAgg) => (a.freqBase > 0 ? a.freqWeighted / a.freqBase : null);

const dayMs = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export interface WindowChoice {
  days: number;
  recent: WindowAgg;
  prior: WindowAgg;
  recentFrom: string;
  priorFrom: string;
}

/**
 * Alle vensters waarin beide helften de volume-eis halen, van kort naar lang.
 *
 * Waarom een lijst en niet alleen het kortste: als de omslag drie weken geleden begon, liggen bij
 * een venster van 7 dagen béide helften ná die omslag en zie je niets. Alleen naar het kortste
 * venster kijken maakt de detector dus blind voor precies de trends die al even lopen. Door van
 * kort naar lang te proberen krijg je een recente verandering meteen te zien, en een die eerder
 * inzette alsnog — in plaats van geen van beide.
 */
export function qualifyingWindows(points: SaturationPoint[], now?: number): WindowChoice[] {
  if (points.length === 0) return [];
  const times = points.map((p) => toTime(p.date)).filter((t) => Number.isFinite(t));
  if (times.length === 0) return [];
  // Anker op de laatste meetdag, niet op "vandaag": zo werkt het ook op een dataset die een paar
  // dagen achterloopt, wat bij advertentiedata de normale situatie is.
  const anchor = now ?? Math.max(...times);

  const out: WindowChoice[] = [];
  for (const days of WINDOW_LADDER) {
    const recentStart = anchor - (days - 1) * dayMs;
    const priorStart = recentStart - days * dayMs;
    const recent = emptyAgg();
    const prior = emptyAgg();
    for (const p of points) {
      const t = toTime(p.date);
      if (!Number.isFinite(t)) continue;
      if (t >= recentStart && t <= anchor) addPoint(recent, p);
      else if (t >= priorStart && t < recentStart) addPoint(prior, p);
    }
    if (recent.impressions >= MIN_IMPRESSIONS_PER_WINDOW && prior.impressions >= MIN_IMPRESSIONS_PER_WINDOW) {
      out.push({
        days,
        recent,
        prior,
        recentFrom: new Date(recentStart).toISOString().slice(0, 10),
        priorFrom: new Date(priorStart).toISOString().slice(0, 10),
      });
    }
  }
  return out;
}

/** Het kortste venster dat de volume-eis haalt; null als zelfs het langste te dun blijft. */
export function chooseWindow(points: SaturationPoint[], now?: number): WindowChoice | null {
  return qualifyingWindows(points, now)[0] ?? null;
}

/**
 * Detecteert verzadiging en stijgende bereikkosten zo vroeg als de data het toelaat.
 * Drie uitkomsten, met bewust verschillende acties:
 *   - frequency omhoog + CTR omlaag  -> publiek raakt op (Meta; de vroegste waarschuwing)
 *   - CPM omhoog + CTR omlaag        -> verzadiging: creative of publiek
 *   - CPM omhoog + CTR overeind      -> veilingdruk of seizoen, geen creative-ingreep
 */
export function buildFastSaturationSignals(points: SaturationPoint[], now?: number): DetectionResult {
  const checked = ["snelle_verzadiging", "snelle_bereikkosten", "snelle_frequency_uitputting"];
  const triggered: SignalStory[] = [];

  const byChannel = new Map<string, SaturationPoint[]>();
  for (const p of points) {
    if (!byChannel.has(p.channel)) byChannel.set(p.channel, []);
    byChannel.get(p.channel)!.push(p);
  }

  for (const [channel, rows] of byChannel) {
    const windows = qualifyingWindows(rows, now);
    // Van kort naar lang beoordelen, maar niet zomaar het eerste resultaat nemen: een scherpe
    // prijspiek in de laatste dagen zou anders een sluipende verzadiging maskeren die pas over een
    // langer venster zichtbaar is. Uitputting (CTR die wegzakt) is de ernstigere en beter
    // uitvoerbare diagnose, dus die wint — ook als een korter venster alleen duurder bereik ziet.
    const found = windows.map((w) => evaluateWindow(channel, w)).filter((s): s is SignalStory => s !== null);
    const serious = found.find((s) => s.category === "creative"); // frequency-uitputting of verzadiging
    const story = serious ?? found[0];
    if (story) triggered.push(story);
  }

  return { triggered, checked };
}

/** Beoordeelt één venster; geeft het verhaal terug, of null als er niets uit komt. */
function evaluateWindow(channel: string, w: WindowChoice): SignalStory | null {
  const label = labelOf(channel);
  const cpmNow = cpmOf(w.recent), cpmPrev = cpmOf(w.prior);
  const ctrNow = ctrOf(w.recent), ctrPrev = ctrOf(w.prior);
  if (cpmNow == null || cpmPrev == null || ctrNow == null || ctrPrev == null) return null;

  const cpmDelta = relDelta(cpmNow, cpmPrev);
  const ctrDelta = relDelta(ctrNow, ctrPrev);
  if (cpmDelta == null || ctrDelta == null) return null;

  const span = `${w.days} dagen (${w.recentFrom} t/m nu) vs de ${w.days} dagen ervoor`;
  const base: SignalEvidence[] = [
    ev(`${label} CPM`, eur2(cpmNow), eur2(cpmPrev)),
    ev(`${label} CTR`, pct(ctrNow), pct(ctrPrev)),
    ev(`${label} vertoningen`, String(Math.round(w.recent.impressions)), String(Math.round(w.prior.impressions))),
    ev("vergelijking", span),
  ];

  // 1. Frequency (Meta): de vroegste en scherpste waarschuwing. Stijgt de frequency terwijl de
  // CTR zakt, dan bereik je steeds vaker dezelfde mensen én raken ze uitgekeken.
  const freqNow = freqOf(w.recent), freqPrev = freqOf(w.prior);
  const freqDelta = freqNow != null && freqPrev != null ? relDelta(freqNow, freqPrev) : null;
  if (freqDelta != null && freqDelta >= FREQ_RISE_THRESHOLD && ctrDelta <= CTR_DROP_THRESHOLD) {
    return {
      id: `snelle_frequency_uitputting_${channel}`,
      category: "creative",
      scope: `${label} — publieksuitputting`,
      story: `Op ${label} steeg de frequency ${pct(freqDelta)} (${freqPrev!.toFixed(2)}× → ${freqNow!.toFixed(2)}× per persoon) terwijl de CTR ${pct(Math.abs(ctrDelta))} zakte, gemeten over ${span}. Je bereikt steeds vaker dezelfde mensen en die raken uitgekeken — verder opschalen levert vooral herhaling op.`,
      actionDirection: `verbreed het publiek of ververs de creatives op ${label} vóór je meer budget toevoegt; binnen een campagne van enkele maanden is dit het moment om te draaien`,
      // Frequency op vensterniveau is een benadering: reach telt niet op over dagen (dezelfde
      // persoon telt meerdere keren mee). De richting is betrouwbaar, het niveau bij benadering.
      certainty: "indicatie",
      evidence: [
        ev(`${label} frequency`, `${freqNow!.toFixed(2)}×`, `${freqPrev!.toFixed(2)}×`),
        ...base,
      ],
    }; // frequency is de preciezere diagnose; geen dubbelmelding met het CPM-verhaal
  }

  if (cpmDelta < CPM_RISE_THRESHOLD) return null;

  // 2. CPM omhoog + CTR omlaag: verzadiging (creative of publiek).
  if (ctrDelta <= CTR_DROP_THRESHOLD) {
    return {
      id: `snelle_verzadiging_${channel}`,
      category: "creative",
      scope: `${label} — bereik en publiek`,
      story: `Op ${label} steeg de CPM ${pct(cpmDelta)} (${eur2(cpmPrev)} → ${eur2(cpmNow)}) terwijl de CTR ${pct(Math.abs(ctrDelta))} zakte, gemeten over ${span}. Je betaalt meer voor bereik dat minder aandacht oplevert.`,
      actionDirection: `ververs de creatives of verbreed het publiek op ${label}; meer budget vergroot hier vooral de frequentie, niet het bereik. Bij een campagne van enkele maanden telt elke week: grijp nu in in plaats van het volgende meetmoment af te wachten`,
      certainty: "bewezen_binnen_platform",
      evidence: base,
    };
  }

    // 3. CPM omhoog, CTR overeind: markt, geen creative-probleem.
    return {
      id: `snelle_bereikkosten_${channel}`,
      category: "veiling_concurrentie",
      scope: `${label} — bereikkosten`,
      story: `Op ${label} steeg de CPM ${pct(cpmDelta)} (${eur2(cpmPrev)} → ${eur2(cpmNow)}) terwijl de CTR overeind bleef, gemeten over ${span}. Bereik wordt duurder zonder dat de advertentie slechter aanslaat: veilingdruk of seizoen, geen versleten creative.`,
      actionDirection: `geen creative-ingreep nodig; weeg of het duurdere bereik het waard blijft en of de timing (beursseizoen, concurrentie) dit verklaart`,
      certainty: "bewezen_binnen_platform",
      evidence: base,
  };
}

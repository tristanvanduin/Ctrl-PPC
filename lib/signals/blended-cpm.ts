// Bereikkosten en publieksverzadiging per kanaal, op de blended maanddata.
//
// Waarom hier en niet per kanaal: CPM is het enige cijfer dat Google (incl. YouTube), Meta en
// LinkedIn op dezelfde manier meten — ze kopen alle drie aandacht. Meta en LinkedIn berekenden
// intern al een verzadigingssignaal, maar dat verdween in de facts-blob richting het model en
// bereikte de gebruiker nooit. Deze detector tilt hetzelfde patroon naar het signaalframe, waar
// het wél zichtbaar wordt — en werkt meteen ook voor Google-video.
//
// De signatuur: CPM omhoog én CTR omlaag = het publiek raakt op of de creative is versleten; je
// betaalt meer voor aandacht die minder oplevert. Blijft CTR overeind terwijl CPM stijgt, dan is
// het geen creative-probleem maar veilingdruk — een andere diagnose en een andere actie. Dat
// onderscheid is de kern: zonder CTR erbij zou "CPM stijgt" tot de verkeerde ingreep leiden.

import { type DetectionResult, type SignalStory, type SignalEvidence, relDelta, pct } from "./types";
import type { ChannelMonthlyInput } from "./cross-channel";

/** Aantal volle maanden dat de trend beslaat (eerste vs laatste). */
export const CPM_WINDOW_MONTHS = 3;
/** CPM-stijging die materieel genoeg is om iets over te zeggen. */
export const CPM_RISE_THRESHOLD = 0.20;
/** CTR-daling die de verzadigingsdiagnose onderscheidt van pure veilingdruk. */
export const CTR_DROP_THRESHOLD = -0.10;
/** Onder deze maandvertoningen is een CPM/CTR-verschil ruis, geen trend. */
export const CPM_MIN_IMPRESSIONS = 5000;

const CHANNEL_LABEL: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn" };
const labelOf = (c: string) => CHANNEL_LABEL[c] ?? c;
const eur2 = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v);
const ev = (metric: string, value: string, prev?: string): SignalEvidence => ({ metric, value, prev });

interface MonthPoint { month: string; impressions: number; clicks: number; spend: number; cpm: number; ctr: number }

/** Sommeer per kanaal per maand en leid CPM/CTR uit die maandtotalen af. */
function byChannelMonth(rows: ChannelMonthlyInput[]): Map<string, MonthPoint[]> {
  const acc = new Map<string, Map<string, { impressions: number; clicks: number; spend: number }>>();
  for (const r of rows) {
    const month = r.month.slice(0, 7); // "YYYY-MM", ongeacht of er een dag aan hangt
    if (!acc.has(r.channel)) acc.set(r.channel, new Map());
    const m = acc.get(r.channel)!;
    const a = m.get(month) ?? { impressions: 0, clicks: 0, spend: 0 };
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.spend += r.spend;
    m.set(month, a);
  }

  const out = new Map<string, MonthPoint[]>();
  for (const [channel, months] of acc) {
    const points = [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, a]) => ({
        month,
        impressions: a.impressions,
        clicks: a.clicks,
        spend: a.spend,
        cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
        ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
      }));
    out.set(channel, points);
  }
  return out;
}

/**
 * Detecteert stijgende bereikkosten per kanaal en scheidt verzadiging van veilingdruk.
 * Zwijgt bij te weinig maanden of te dunne volumes — een CPM-sprong op 800 vertoningen is ruis.
 */
export function buildBlendedCpmSignals(rows: ChannelMonthlyInput[]): DetectionResult {
  const checked = ["blended_cpm_verzadiging", "blended_cpm_veilingdruk"];
  const triggered: SignalStory[] = [];
  const perChannel = byChannelMonth(rows);

  // Context: het CPM-niveau van elk kanaal in de laatste maand. Bewust alleen als bewijsregel —
  // een hogere CPM op LinkedIn dan op Meta is normaal (ander publiek, ander formaat) en zegt op
  // zichzelf niets over verspilling. Wat wél zegt: hoe een kanaal zich tot zichzelf verhoudt.
  const latestCpm: Array<{ channel: string; cpm: number }> = [];
  for (const [channel, points] of perChannel) {
    const last = points[points.length - 1];
    if (last && last.impressions >= CPM_MIN_IMPRESSIONS) latestCpm.push({ channel, cpm: last.cpm });
  }
  latestCpm.sort((a, b) => b.cpm - a.cpm);
  const cpmContext: SignalEvidence[] = latestCpm.map((c) => ev(`${labelOf(c.channel)} CPM (laatste maand)`, eur2(c.cpm)));

  for (const [channel, points] of perChannel) {
    const window = points.slice(-CPM_WINDOW_MONTHS);
    if (window.length < CPM_WINDOW_MONTHS) continue;
    // Elke maand in het venster moet materieel zijn, anders vergelijk je ruis met ruis.
    if (window.some((p) => p.impressions < CPM_MIN_IMPRESSIONS)) continue;

    const first = window[0];
    const last = window[window.length - 1];
    const cpmDelta = relDelta(last.cpm, first.cpm);
    const ctrDelta = relDelta(last.ctr, first.ctr);
    if (cpmDelta == null || ctrDelta == null) continue;
    if (cpmDelta < CPM_RISE_THRESHOLD) continue;

    const label = labelOf(channel);
    const spanned = `${first.month} → ${last.month}`;
    const base: SignalEvidence[] = [
      ev(`${label} CPM`, eur2(last.cpm), eur2(first.cpm)),
      ev(`${label} CTR`, pct(last.ctr), pct(first.ctr)),
      ev(`${label} vertoningen`, String(Math.round(last.impressions)), String(Math.round(first.impressions))),
      ev("periode", spanned),
    ];

    if (ctrDelta <= CTR_DROP_THRESHOLD) {
      triggered.push({
        id: `blended_cpm_verzadiging_${channel}`,
        category: "creative",
        scope: `${label} — bereik en publiek`,
        story: `Op ${label} steeg de CPM ${pct(cpmDelta)} (${eur2(first.cpm)} → ${eur2(last.cpm)}) terwijl de CTR ${pct(Math.abs(ctrDelta))} zakte (${spanned}). Je betaalt meer voor bereik dat minder aandacht oplevert — het patroon van een publiek dat opraakt of een creative die is uitgekeken.`,
        actionDirection: `ververs de creatives en/of verbreed het publiek op ${label}; puur méér budget vergroot hier vooral de frequentie, niet het bereik`,
        certainty: "bewezen_binnen_platform",
        evidence: [...base, ...cpmContext],
      });
    } else {
      triggered.push({
        id: `blended_cpm_veilingdruk_${channel}`,
        category: "veiling_concurrentie",
        scope: `${label} — bereikkosten`,
        story: `Op ${label} steeg de CPM ${pct(cpmDelta)} (${eur2(first.cpm)} → ${eur2(last.cpm)}) terwijl de CTR overeind bleef (${spanned}). Bereik wordt duurder zonder dat de advertentie slechter aanslaat: dat wijst op veilingdruk of seizoen, niet op een versleten creative.`,
        actionDirection: `geen creative-ingreep nodig; weeg of het duurdere bereik het waard blijft en of de timing (beursseizoen, concurrentie) dit verklaart`,
        certainty: "bewezen_binnen_platform",
        evidence: [...base, ...cpmContext],
      });
    }
  }

  return { triggered, checked };
}

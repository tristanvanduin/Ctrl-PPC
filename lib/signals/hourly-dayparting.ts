// Uur-dagdeel-efficiëntie: converteert een bepaald dagdeel structureel slechter per euro? Dit
// vergt uur-data (Meta levert een hourly breakdown), die de dag- en maandtotalen wegmiddelen.
// Een duur nacht- of vroege-ochtend-venster is stuurbaar via een bod-/budget-schema. Uren in
// dagdelen van vier gegroepeerd (genoeg volume per blok); CPA per blok uit periodetotalen,
// drempels op volume; eigen-platform-rekenkunde met het schema-advies als indicatie. Puur.
//
// Dezelfde toets op toeval als de weekdag-detector (lib/signals/toeval.ts): een dagdeel heet pas
// structureel duur bij minstens tien verwachte conversies en een tekort dat niet van toeval komt.

import { type DetectionResult, type NotAssessable, type SignalEvidence } from "./types";
import { toetsTekort, MIN_VERWACHTE_CONVERSIES } from "./toeval";

export interface HourlyRow { hour: number; spend: number; conversions: number }

export const HD_MIN_TOTAL_CONVERSIONS = 15;   // minimaal volume om dagdeel-CPA's te vergelijken
export const HD_MIN_BLOCK_SPEND_SHARE = 0.08; // een dagdeel moet materieel budget dragen
export const HD_WASTE_CPA_MULT = 1.6;         // blok-CPA boven dit veelvoud van het daggemiddelde = duur

// Vaste dagdelen van vier uur, met leesbare labels.
const BLOCKS: { key: string; label: string; hours: number[] }[] = [
  { key: "nacht", label: "nacht (00–04u)", hours: [0, 1, 2, 3] },
  { key: "vroeg", label: "vroege ochtend (04–08u)", hours: [4, 5, 6, 7] },
  { key: "ochtend", label: "ochtend (08–12u)", hours: [8, 9, 10, 11] },
  { key: "middag", label: "middag (12–16u)", hours: [12, 13, 14, 15] },
  { key: "avond", label: "avond (16–20u)", hours: [16, 17, 18, 19] },
  { key: "laat", label: "late avond (20–24u)", hours: [20, 21, 22, 23] },
];
const blockOf = (hour: number): string => BLOCKS.find((b) => b.hours.includes(hour))?.key ?? "onbekend";
const labelOf = (key: string): string => BLOCKS.find((b) => b.key === key)?.label ?? key;

const eurS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "n.v.t." : `€${Math.round(v * 100) / 100}`);
const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

export function buildHourlyDaypartingSignals(rows: HourlyRow[], opts: { channelLabel: string; idPrefix: string }): DetectionResult {
  const id = `${opts.idPrefix}_dayparting`;
  const byBlock = new Map<string, { spend: number; conversions: number }>();
  let totalSpend = 0, totalConv = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.hour) || r.hour < 0 || r.hour > 23) continue;
    const key = blockOf(r.hour);
    const cur = byBlock.get(key) ?? { spend: 0, conversions: 0 };
    cur.spend += r.spend; cur.conversions += r.conversions;
    byBlock.set(key, cur);
    totalSpend += r.spend; totalConv += r.conversions;
  }
  if (totalSpend <= 0 || totalConv < HD_MIN_TOTAL_CONVERSIONS) return { triggered: [], checked: [id] };
  const overallCpa = div(totalSpend, totalConv)!;

  const blokken = [...byBlock.entries()]
    .map(([key, a]) => ({ key, conversions: a.conversions, cpa: div(a.spend, a.conversions), share: a.spend / totalSpend }))
    .filter((d) => d.share >= HD_MIN_BLOCK_SPEND_SHARE);
  const duur = blokken
    .filter((d) => d.cpa == null || d.cpa >= overallCpa * HD_WASTE_CPA_MULT)
    .map((d) => ({ ...d, toets: toetsTekort(d.conversions, d.share, totalConv, blokken.length) }));
  const worst = duur.filter((d) => d.toets.significant).sort((a, b) => a.toets.p - b.toets.p)[0];

  if (!worst) {
    const dun = duur.filter((d) => !d.toets.genoegVolume);
    const notAssessable: NotAssessable[] = dun.length > 0
      ? [{ id, reason: `${dun.map((d) => labelOf(d.key)).join(", ")} oogt duur, maar met minder dan ${MIN_VERWACHTE_CONVERSIES} verwachte conversies is dat niet van toeval te onderscheiden` }]
      : [];
    return { triggered: [], checked: notAssessable.length > 0 ? [] : [id], ...(notAssessable.length > 0 ? { notAssessable } : {}) };
  }
  const label = labelOf(worst.key);
  const cpaText = worst.cpa == null
    ? `converteert niet (spend zonder conversies)`
    : `converteert tegen ${eurS(worst.cpa)} CPA — ${Math.round((worst.cpa / overallCpa) * 10) / 10}× het daggemiddelde (${eurS(overallCpa)})`;
  return {
    triggered: [{
      id: `${opts.idPrefix}_dayparting_duur`,
      category: "budget_pacing",
      scope: `${opts.channelLabel}: ${label}`,
      story: `Op ${opts.channelLabel} draagt het dagdeel ${label} ${pctI(worst.share)} van de spend en ${cpaText}: dat venster is structureel duur.`,
      actionDirection: `overweeg een lager bod/budget-schema in het venster ${label}, of onderzoek waarom die uren slechter converteren (publiek minder actief, andere intentie)`,
      certainty: "indicatie",
      evidence: [
        ev("dagdeel", label), ev("blok-CPA", worst.cpa == null ? "geen conversies" : eurS(worst.cpa)), ev("daggemiddelde CPA", eurS(overallCpa)), ev("spend-aandeel", pctI(worst.share)),
        ev("conversies tegen verwacht", `${Math.round(worst.conversions * 10) / 10} tegen ${Math.round(worst.toets.verwacht * 10) / 10}`),
      ],
    }],
    checked: [id],
  };
}

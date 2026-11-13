// Weekday-efficiëntie: converteert een bepaalde weekdag structureel slechter per euro? Meta en
// LinkedIn laten geen uur-planning per se toe, maar een weekdag die consequent duur converteert
// is stuurbaar (bod/budget-schema of dagdeel-uitsluiting). Het maand-totaal middelt dat weg.
// CPA per weekdag uit periodetotalen, drempels op volume; de dag-CPA is eigen-platform-
// rekenkunde, het schema-advies een indicatie. Puur, los getest.
//
// Een dag heet pas structureel duur als zijn tekort aan conversies geen toeval is (lib/signals/
// toeval.ts): minstens tien verwachte conversies op die dag, en een kans op zo weinig conversies
// onder de significantiegrens gedeeld door het aantal getoetste dagen. Zonder die toets vuurde de
// detector bij 20 tot 40 conversies in ongeveer 80% van de runs op een account zonder weekdageffect.

import { type DetectionResult, type NotAssessable, type SignalEvidence } from "./types";
import { toetsTekort, MIN_VERWACHTE_CONVERSIES } from "./toeval";

export interface WeekdayRow { date: string; spend: number; conversions: number }

export const WD_MIN_TOTAL_CONVERSIONS = 15;  // minimaal volume om weekdag-CPA's te vergelijken
export const WD_MIN_DAY_SPEND_SHARE = 0.08;  // een weekdag moet materieel budget dragen
export const WD_WASTE_CPA_MULT = 1.6;        // dag-CPA boven dit veelvoud van het weekgemiddelde = duur

const WEEKDAY_NL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const eurS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "n.v.t." : `€${Math.round(v * 100) / 100}`);
const pctI = (v: number): string => `${Math.round(v * 100)}%`;
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

export function buildWeekdayEfficiencySignals(rows: WeekdayRow[], opts: { channelLabel: string; idPrefix: string }): DetectionResult {
  const id = `${opts.idPrefix}_weekday`;
  const byDay = new Map<number, { spend: number; conversions: number }>();
  let totalSpend = 0, totalConv = 0;
  for (const r of rows) {
    const t = Date.parse(r.date);
    if (!Number.isFinite(t)) continue;
    const wd = new Date(t).getUTCDay();
    const cur = byDay.get(wd) ?? { spend: 0, conversions: 0 };
    cur.spend += r.spend; cur.conversions += r.conversions;
    byDay.set(wd, cur);
    totalSpend += r.spend; totalConv += r.conversions;
  }
  if (totalSpend <= 0 || totalConv < WD_MIN_TOTAL_CONVERSIONS) return { triggered: [], checked: [id] };
  const overallCpa = div(totalSpend, totalConv)!;

  const dagen = [...byDay.entries()]
    .map(([wd, a]) => ({ wd, conversions: a.conversions, cpa: div(a.spend, a.conversions), share: a.spend / totalSpend }))
    .filter((d) => d.share >= WD_MIN_DAY_SPEND_SHARE);
  const duur = dagen
    .filter((d) => d.cpa == null || d.cpa >= overallCpa * WD_WASTE_CPA_MULT)
    .map((d) => ({ ...d, toets: toetsTekort(d.conversions, d.share, totalConv, dagen.length) }));
  const worst = duur
    .filter((d) => d.toets.significant)
    .sort((a, b) => a.toets.p - b.toets.p)[0];

  if (!worst) {
    // Een dag die duur oogt maar te weinig volume heeft: zeggen dat er niets te zeggen is, in
    // plaats van hem als "gecontroleerd, niets gevonden" te laten lezen.
    const dun = duur.filter((d) => !d.toets.genoegVolume);
    const notAssessable: NotAssessable[] = dun.length > 0
      ? [{ id, reason: `${dun.map((d) => WEEKDAY_NL[d.wd]).join(", ")} oogt duur, maar met ${dun.map((d) => Math.round(d.toets.verwacht * 10) / 10).join(", ")} verwachte conversies (minder dan ${MIN_VERWACHTE_CONVERSIES}) is dat niet van toeval te onderscheiden` }]
      : [];
    return { triggered: [], checked: notAssessable.length > 0 ? [] : [id], ...(notAssessable.length > 0 ? { notAssessable } : {}) };
  }

  const name = WEEKDAY_NL[worst.wd];
  const cpaText = worst.cpa == null
    ? `converteert niet (spend zonder conversies)`
    : `converteert tegen ${eurS(worst.cpa)} CPA — ${Math.round((worst.cpa / overallCpa) * 10) / 10}× het weekgemiddelde (${eurS(overallCpa)})`;
  return {
    triggered: [{
      id: `${opts.idPrefix}_weekday_duur`,
      category: "budget_pacing",
      scope: `${opts.channelLabel}: ${name}`,
      story: `Op ${opts.channelLabel} draagt ${name} ${pctI(worst.share)} van de spend en ${cpaText}: die dag is structureel duur.`,
      actionDirection: `overweeg een lager bod/budget-schema op ${name} of onderzoek waarom die dag slechter converteert (doelgroep-actief, concurrentie, tracking)`,
      certainty: "indicatie",
      evidence: [
        ev("weekdag", name), ev("dag-CPA", worst.cpa == null ? "geen conversies" : eurS(worst.cpa)), ev("weekgemiddelde CPA", eurS(overallCpa)), ev("spend-aandeel", pctI(worst.share)),
        ev("conversies tegen verwacht", `${Math.round(worst.conversions * 10) / 10} tegen ${Math.round(worst.toets.verwacht * 10) / 10}`),
        ev("kans bij toeval", worst.toets.p < 0.0001 ? "< 0,01%" : `${(worst.toets.p * 100).toFixed(2).replace(".", ",")}%`),
      ],
    }],
    checked: [id],
  };
}

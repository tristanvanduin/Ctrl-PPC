// Spend-velocity: wijkt het dagelijkse uitgeeftempo van de laatste dagen materieel af van het
// niveau van de weken ervoor? Een plotse VERSNELLING (budgetverhoging of een op hol geslagen
// campagne) of een INZAKKING (budget op, bod te laag, campagne gepauzeerd) is stuurbaar nieuws
// dat een maand-totaal uitmiddelt. Kanaal-agnostisch. Gemiddelden uit venstertotalen, drempel op
// volume; een tempo-afwijking is een indicatie (de oorzaak — bewust of niet — staat open). Puur.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";

export interface SpendDailyRow { date: string; spend: number }

export const SV_RECENT_DAYS = 7;        // recente venster (dagen)
export const SV_BASELINE_DAYS = 28;     // basislijn: de 4 weken daarvóór
export const SV_MIN_BASELINE_SPEND = 200; // minimale basislijn-spend (EUR) om ruis te vermijden
export const SV_SPIKE = 0.4;            // >= +40% dagtempo = versnelling
export const SV_DROP = -0.4;            // <= -40% dagtempo = inzakking

const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const dS = (v: number): string => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
const ev = (metric: string, value: string): SignalEvidence => ({ metric, value });

// Vanaf dit aantal dagen zonder data is niet het tempo maar de AANVOER het verhaal.
export const SV_STALE_DAYS = 3;

export function buildSpendVelocitySignals(
  daily: SpendDailyRow[],
  opts: { channelLabel: string; idPrefix: string; vandaag?: string }
): DetectionResult {
  const id = `${opts.idPrefix}_spend_velocity`;
  if (daily.length === 0) return { triggered: [], checked: [] };

  // Anker op de laatste DATADATUM, niet op de wandklok: bij een paar dagen sync-lag zou het
  // recente venster anders half leeg zijn en een fictieve "inzakking" triggeren (de
  // sloop-audit ving dit live: 6 dagen lag gaf gegarandeerd -86%). Valt de aanvoer zelf
  // stil, dan is dát het signaal — apart, hieronder — in plaats van een vals tempo-verhaal.
  const anchor = daily.map((r) => r.date).sort().at(-1)!;
  const anchorMs = Date.parse(anchor);
  const ageOf = (date: string): number => (anchorMs - Date.parse(date)) / 86_400_000;

  const staleness: SignalStory[] = [];
  if (opts.vandaag) {
    const lagDagen = Math.floor((Date.parse(opts.vandaag) - anchorMs) / 86_400_000);
    if (Number.isFinite(lagDagen) && lagDagen >= SV_STALE_DAYS) {
      staleness.push({
        id: `${opts.idPrefix}_data_achterstand`,
        category: "budget_pacing",
        scope: `${opts.channelLabel}-account`,
        story: `De jongste ${opts.channelLabel}-dagdata is ${lagDagen} dagen oud (laatste datum ${anchor}): óf de sync loopt achter, óf de levering is volledig gestopt.`,
        actionDirection: "controleer eerst de sync-status; draait die, check dan of het account nog levert (budget op, betaalprobleem, gepauzeerd)",
        certainty: "indicatie",
        evidence: [ev("laatste datadatum", anchor), ev("achterstand", `${lagDagen} dagen`)],
      });
    }
  }

  let recentTotal = 0, baselineTotal = 0;
  for (const r of daily) {
    const age = ageOf(r.date);
    if (!Number.isFinite(age) || age < 0) continue;
    if (age < SV_RECENT_DAYS) recentTotal += r.spend;
    else if (age < SV_RECENT_DAYS + SV_BASELINE_DAYS) baselineTotal += r.spend;
  }
  if (baselineTotal < SV_MIN_BASELINE_SPEND) return { triggered: staleness, checked: [id] };

  const recentAvg = recentTotal / SV_RECENT_DAYS;
  const baselineAvg = baselineTotal / SV_BASELINE_DAYS;
  if (baselineAvg <= 0) return { triggered: staleness, checked: [id] };
  const dev = (recentAvg - baselineAvg) / baselineAvg;

  // Het achterstandssignaal rijdt mee op ELK pad: een lag-melding en een tempo-oordeel
  // sluiten elkaar niet uit.
  if (dev >= SV_SPIKE) {
    return {
      triggered: [...staleness, {
        id: `${opts.idPrefix}_spend_versnelling`,
        category: "budget_pacing",
        scope: `${opts.channelLabel}-account`,
        story: `De dagelijkse ${opts.channelLabel}-spend ligt de laatste ${SV_RECENT_DAYS} dagen ${dS(dev)} boven het niveau van de ${SV_BASELINE_DAYS} dagen ervoor (${eur(baselineAvg)}/dag → ${eur(recentAvg)}/dag): een budget-versnelling.`,
        actionDirection: `controleer of deze versnelling bewust is en of de CPA meebeweegt; een ongeplande sprong duidt op een budget-/bodwijziging of een op hol geslagen campagne`,
        certainty: "indicatie",
        evidence: [ev("dagtempo recent", `${eur(recentAvg)}/dag`), ev("dagtempo ervoor", `${eur(baselineAvg)}/dag`), ev("afwijking", dS(dev))],
      }],
      checked: [id],
    };
  }
  if (dev <= SV_DROP) {
    return {
      triggered: [...staleness, {
        id: `${opts.idPrefix}_spend_inzakking`,
        category: "budget_pacing",
        scope: `${opts.channelLabel}-account`,
        story: `De dagelijkse ${opts.channelLabel}-spend ligt de laatste ${SV_RECENT_DAYS} dagen ${dS(dev)} onder het niveau van de ${SV_BASELINE_DAYS} dagen ervoor (${eur(baselineAvg)}/dag → ${eur(recentAvg)}/dag): de levering zakt weg.`,
        actionDirection: `check of het budget op is, het bod te laag staat, of een campagne is gepauzeerd; een onbedoelde inzakking kost volume in de aanloop`,
        certainty: "indicatie",
        evidence: [ev("dagtempo recent", `${eur(recentAvg)}/dag`), ev("dagtempo ervoor", `${eur(baselineAvg)}/dag`), ev("afwijking", dS(dev))],
      }],
      checked: [id],
    };
  }
  return { triggered: staleness, checked: [id] };
}

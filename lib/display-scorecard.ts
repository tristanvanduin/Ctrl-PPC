/**
 * Display Campaign Scorecard (masterplan sectie 5.4, Campaign Type Intelligence)
 *
 * Zelfde vorm als lib/search-scorecard.ts en lib/pmax-scorecard.ts (HealthScore, 0-20 per factor,
 * "assessed" i.p.v. een gegokte score bij te weinig data), met een EIGEN opbouw: Display draait op
 * bereik en doelgroep-targeting, niet op keywords (Search) of assets (PMax).
 *
 * ── DE VIJF FACTOREN, EN WAAROM ZE GEEN Search-LOGICA ZIJN ────────────────────
 *
 *   Conversion Efficiency   CPA-trend (cost/conversions), trendOver() -- zelfde functie en venster
 *                           als de andere scorecards, hier op campaign_type='DISPLAY'-rijen.
 *   Engagement-trend        CTR-trend (clicks/impressions). Display-CTR ligt structureel een
 *                           factor 10-20 lager dan Search -- geen absolute drempel dus, een trend.
 *   CPM-trend               cost/impressions*1000. Display wordt vaak op CPM ingekocht, niet CPC;
 *                           een stijgende CPM bij gelijk bereik is de zuiverste inkoopdruk-indicator
 *                           die deze tabel draagt (er is geen CPC-kolom die hier iets zegt dat CTR
 *                           al niet zegt -- clicks zijn op Display een bijproduct, geen doel).
 *   Doelgroep-mix           ads_audience_performance_monthly, audience_type (AFFINITY/IN_MARKET/
 *                           CUSTOM/REMARKETING). Aandeel spend in segmenten die naar verhouding
 *                           meer kosten dan opleveren -- zelfde soort "aandeel in een duur segment"-
 *                           vraag als PMax' Netwerkmix-factor, maar op EIGEN data (doelgroepen, geen
 *                           netwerken) en een eigen, hier geschreven aggregatie.
 *   Viewability             Geen kolom in dit schema (geen viewable_impressions/measurable_
 *                           impressions op ads_network_performance_monthly of elders, geverifieerd
 *                           21 augustus). Altijd assessed:false tot die koppeling er is -- regel 3
 *                           van de vertrouwensdoctrine, zelfde als PMax' Feed Health.
 */

import type { HealthScore, HealthFactor } from "./health-score";
import { samenvatFactoren } from "./health-score";
import { trendOver } from "./analysis/trend";

export interface DisplayCampaignMonthlyRow {
  campaign_name: string;
  month: string;
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

export interface DisplayAudienceRow {
  audience_type: string | null;
  cost: number;
  conversions: number;
  conversions_value: number;
}

interface MaandTotaal {
  month: string;
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

function perMaand(rows: readonly DisplayCampaignMonthlyRow[]): MaandTotaal[] {
  const map = new Map<string, MaandTotaal>();
  for (const r of rows) {
    const bestaand = map.get(r.month) ?? { month: r.month, cost: 0, conversions: 0, clicks: 0, impressions: 0 };
    bestaand.cost += r.cost;
    bestaand.conversions += r.conversions;
    bestaand.clicks += r.clicks;
    bestaand.impressions += r.impressions;
    map.set(r.month, bestaand);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Zelfde vier-banden-vorm als search-scorecard.ts, voor een gelijk schaalgevoel tussen de
// scorecards -- onafhankelijk hier neergezet, niet geïmporteerd (search-scorecard.ts's versies
// zijn module-privé, en PMax herhaalt zijn eigen bandvorm ook liever dan een gedeelde import).
function trendScoreDalendIsGoed(trendPct: number): number {
  if (trendPct < -10) return 20;
  if (trendPct < 5) return 16;
  if (trendPct < 20) return 10;
  return 4;
}
function trendScoreStijgendIsGoed(trendPct: number): number {
  if (trendPct > 10) return 20;
  if (trendPct > -10) return 14;
  if (trendPct > -25) return 8;
  return 4;
}
function aandeelScoreOmgekeerd(aandeel: number): number {
  if (aandeel < 0.10) return 20;
  if (aandeel < 0.25) return 14;
  if (aandeel < 0.40) return 8;
  return 4;
}

/**
 * Bouwt de Display-scorecard. `campMonthlyRows` zijn ads_campaign_monthly-rijen, vooraf gefilterd
 * op campaign_type = 'DISPLAY' door de aanroeper. `audienceRows` zijn ads_audience_performance_
 * monthly-rijen voor dezelfde Display-campagnes (elke rij draagt al audience_type).
 */
export function computeDisplayScorecard(
  campMonthlyRows: readonly DisplayCampaignMonthlyRow[],
  audienceRows: readonly DisplayAudienceRow[],
): HealthScore {
  const factors: HealthFactor[] = [];
  const maanden = perMaand(campMonthlyRows);

  // ── 1. CONVERSION EFFICIENCY (20pt) ──
  const cpaReeks = maanden.filter((m) => m.conversions > 0).map((m) => m.cost / m.conversions);
  const efficiencyBeoordeeld = cpaReeks.length >= 2;
  const cpaTrend = efficiencyBeoordeeld ? trendOver(cpaReeks) : 0;
  factors.push({
    name: "Conversion Efficiency",
    score: efficiencyBeoordeeld ? trendScoreDalendIsGoed(cpaTrend) : 0,
    maxScore: 20,
    description: efficiencyBeoordeeld
      ? `CPA-trend ${cpaTrend >= 0 ? "+" : ""}${Math.round(cpaTrend)}% over de laatste maanden`
      : "Te weinig maanden met conversies voor een CPA-trend — niet beoordeeld",
    assessed: efficiencyBeoordeeld,
  });

  // ── 2. ENGAGEMENT-TREND (20pt) ──
  const ctrReeks = maanden.filter((m) => m.impressions > 0).map((m) => m.clicks / m.impressions);
  const engagementBeoordeeld = ctrReeks.length >= 2;
  const ctrTrend = engagementBeoordeeld ? trendOver(ctrReeks) : 0;
  factors.push({
    name: "Engagement-trend",
    score: engagementBeoordeeld ? trendScoreStijgendIsGoed(ctrTrend) : 0,
    maxScore: 20,
    description: engagementBeoordeeld
      ? `CTR-trend ${ctrTrend >= 0 ? "+" : ""}${Math.round(ctrTrend)}% over de laatste maanden`
      : "Te weinig maanden met impressies voor een CTR-trend — niet beoordeeld",
    assessed: engagementBeoordeeld,
  });

  // ── 3. CPM-TREND (20pt) ──
  const cpmReeks = maanden.filter((m) => m.impressions > 0).map((m) => (m.cost / m.impressions) * 1000);
  const cpmBeoordeeld = cpmReeks.length >= 2;
  const cpmTrend = cpmBeoordeeld ? trendOver(cpmReeks) : 0;
  factors.push({
    name: "CPM-trend",
    score: cpmBeoordeeld ? trendScoreDalendIsGoed(cpmTrend) : 0,
    maxScore: 20,
    description: cpmBeoordeeld
      ? `CPM-trend ${cpmTrend >= 0 ? "+" : ""}${Math.round(cpmTrend)}% (stijgend = meer inkoopdruk per duizend vertoningen)`
      : "Te weinig maanden met impressies voor een CPM-trend — niet beoordeeld",
    assessed: cpmBeoordeeld,
  });

  // ── 4. DOELGROEP-MIX (20pt) ──
  const perAudienceType = new Map<string, { cost: number; conversions: number; conversionsValue: number }>();
  for (const r of audienceRows) {
    const type = r.audience_type ?? "ONBEKEND";
    const a = perAudienceType.get(type) ?? { cost: 0, conversions: 0, conversionsValue: 0 };
    a.cost += r.cost; a.conversions += r.conversions; a.conversionsValue += r.conversions_value;
    perAudienceType.set(type, a);
  }
  const totaalAudienceCost = [...perAudienceType.values()].reduce((s, a) => s + a.cost, 0);
  const doelgroepBeoordeeld = totaalAudienceCost > 0;
  // Gemiddelde ROAS over alle segmenten, als referentie voor "naar verhouding meer kost dan oplevert".
  const totaalWaarde = [...perAudienceType.values()].reduce((s, a) => s + a.conversionsValue, 0);
  const gemiddeldeRoas = totaalAudienceCost > 0 ? totaalWaarde / totaalAudienceCost : 0;
  const dureSegmenten = doelgroepBeoordeeld
    ? [...perAudienceType.entries()].filter(([, a]) => a.cost > 0 && (a.conversionsValue / a.cost) < gemiddeldeRoas * 0.5)
    : [];
  const dureAandeel = doelgroepBeoordeeld ? dureSegmenten.reduce((s, [, a]) => s + a.cost, 0) / totaalAudienceCost : 0;
  factors.push({
    name: "Doelgroep-mix",
    score: doelgroepBeoordeeld ? aandeelScoreOmgekeerd(dureAandeel) : 0,
    maxScore: 20,
    description: doelgroepBeoordeeld
      ? dureSegmenten.length > 0
        ? `${Math.round(dureAandeel * 100)}% van de spend zit in doelgroepsegmenten die minder dan de helft van de gemiddelde ROAS halen (${dureSegmenten.map(([t]) => t).join(", ")})`
        : "Geen doelgroepsegment presteert materieel onder het gemiddelde"
      : "Geen doelgroepdata — niet beoordeeld",
    assessed: doelgroepBeoordeeld,
  });

  // ── 5. VIEWABILITY (20pt) ── — geen kolom in dit schema, zie de kop.
  factors.push({
    name: "Viewability",
    score: 0,
    maxScore: 20,
    description: "Geen viewability-koppeling gesynct — niet beoordeeld",
    assessed: false,
  });

  return { factors, anomalies: [], ...samenvatFactoren(factors) };
}

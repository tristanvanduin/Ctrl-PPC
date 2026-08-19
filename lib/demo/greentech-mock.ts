// Curated GreenTech demo-dataset — geserveerd vanuit de data-invoerpunten (client-data +
// overview) zodat de klant-cockpit (Overzicht/Campagnes/Prognose) en de portfolio-cel zonder
// Google Ads API of keys werken. Scoped op de demo-klant "demo-greentech" + de geo-clones
// (GRT/GRA/GRN, via campagnenamen). Puur presentatie; raakt geen echte data of berekening.
//
// De cijfers sluiten aan op scripts/demo/seed-demo-client.ts (dezelfde fictieve GreenTech-wereld),
// maar dit pad vraagt géén seed en géén backend — het is hardcoded voor review/presentatie.

import { demoGeoCountries, geoMonthlyRows } from "./geo-demo";

export const DEMO_GREENTECH_ID = "demo-greentech";
export const DEMO_GREENTECH_NAME = "GreenTech (demo)";

// customerId komt binnen als clientId zonder "gads-"-prefix; de demo-klant heeft die prefix niet.
export function isGreentechDemo(customerId: string | null | undefined): boolean {
  if (!customerId) return false;
  return customerId.replace(/^gads-/, "") === DEMO_GREENTECH_ID;
}

interface Monthly { month: number; conversions: number; revenue: number; adSpend: number; impressions: number; clicks: number; ctr: number; avgCpc: number; conversionRate: number }
interface Weekly { week: number; month: number; conversions: number; revenue: number; adSpend: number }

const AOV = 120;
function months(base: { conv: number; spend: number; clicks: number; imp: number }): Monthly[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const s = 1 + 0.18 * Math.sin(((m - 3) / 12) * 2 * Math.PI); // lichte seizoensvorm, piek voorjaar
    const conversions = Math.round(base.conv * s);
    const adSpend = Math.round(base.spend * s);
    const clicks = Math.round(base.clicks * s);
    const impressions = Math.round(base.imp * s);
    const revenue = Math.round(conversions * AOV);
    return {
      month: m, conversions, revenue, adSpend, impressions, clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      avgCpc: clicks > 0 ? adSpend / clicks : 0,
      conversionRate: clicks > 0 ? conversions / clicks : 0,
    };
  });
}

function weeks(monthly: Monthly[], upToMonth: number): Weekly[] {
  const out: Weekly[] = [];
  for (const m of monthly.filter((x) => x.month <= upToMonth)) {
    for (let w = 1; w <= 4; w++) {
      out.push({ week: w, month: m.month, conversions: Math.round(m.conversions / 4), revenue: Math.round(m.revenue / 4), adSpend: Math.round(m.adSpend / 4) });
    }
  }
  return out;
}

// Groei-curve: 2024 < 2025 < 2026. Alleen op accountniveau: er is geen per-campagne-historie
// vóór 2026 (campaignsHistorical blijft leeg, zoals ook hieronder).
const BASE_2024 = { conv: 82, spend: 6800, clicks: 3900, imp: 78000 };
const BASE_2025 = { conv: 95, spend: 7400, clicks: 4300, imp: 85000 };
/**
 * Tot welke maand de demo "gerealiseerd" is.
 *
 * ── WAAROM DIT MEELOOPT MET DE KLOK ─────────────────────────────────────────
 *
 * Hier stond `= 6` met de opmerking "t/m juni gerealiseerd". Dat klopte toen het geschreven werd
 * en niet meer daarna. Op 5 augustus 2026 vraagt de standaardperiode van het dashboard om
 * augustus 2025 t/m juli 2026, filtert deze constante juli weg, en meldt de hero-kaart in amber:
 * "Voor juli 2026 is geen data geladen; dat totaal ontbreekt hierboven."
 *
 * Dat is het eerste blok dat iemand ziet. In een demonstratie leest dat als een kapotte app,
 * terwijl er alleen een getal was blijven staan.
 *
 * Nu: gerealiseerd tot en met de laatste AFGESLOTEN maand. De lopende maand blijft eruit, want
 * die is per definitie incompleet -- dat is de bedoeling van de constante, en dat blijft zo.
 */
const DEMO_JAAR = 2026;
function gerealiseerdeMaanden(): number {
  const nu = new Date();
  const jaar = nu.getUTCFullYear();
  // Het demo-jaar ligt volledig in het verleden: dan is er niets meer aan de gang.
  if (jaar > DEMO_JAAR) return 12;
  // getUTCMonth() is nul-gebaseerd, dus in augustus (7) is dat precies "t/m juli".
  // Minimaal 1: bij nul zou months[REALIZED_MONTH - 1] verderop undefined opleveren.
  return Math.min(12, Math.max(1, jaar < DEMO_JAAR ? 1 : nu.getUTCMonth()));
}
const REALIZED_MONTH = gerealiseerdeMaanden();

// Elke beurs zijn eigen basis, eigen aov en eigen koers over het jaar (trend), in plaats van een
// vaste "share" van één gedeelde accountcurve -- dat liet GRT/GRA/GRN altijd exact dezelfde vorm
// zien, alleen geschaald, en dat was precies de klacht: geen twee beurzen die een eigen verhaal
// vertellen. Het accounttotaal (currentYearMonthly/target-vergelijking) is hieronder de SOM van
// deze campagnereeksen, nooit een los curve -- anders lopen KPI-rij en campagnetabel uiteen.
interface CampaignDef {
  id: string; name: string; type: string;
  base: { conv: number; spend: number; clicks: number; imp: number };
  aov: number; // per-beurs dealgrootte -- bepaalt mede de ROAS-verschillen
  trend: (m: number) => number; // koers over de maand (1..12), 0 = nog niet actief
  is: { sis: number; budgetLost: number; rankLost: number; budget: number; util: number };
}

const CAMPAIGN_DEFS: CampaignDef[] = [
  // GRT (Amsterdam, vlaggenschip): sterke groei t/m april, daarna een merkbare afvlakking/lichte
  // terugval -- de aanloop dit jaar houdt niet het tempo van het begin van het jaar vast, een
  // effectiviteitsvraag, geen investeringskwestie (spiegelt [S10] in scripts/demo/seed-demo-client.ts).
  { id: "demo-c-grt", name: "GRT | Search | NL", type: "SEARCH", base: { conv: 44, spend: 4300, clicks: 2150, imp: 43000 }, aov: 140,
    trend: (m) => (m <= 4 ? 1 + 0.15 * (m - 1) : 1.45 - 0.08 * (m - 4)),
    is: { sis: 0.55, budgetLost: 0.28, rankLost: 0.05, budget: 140, util: 0.97 } },
  // GRA (Americas): op koers, gestage lineaire groei het hele jaar -- geen actie nodig (spiegelt [S11]).
  { id: "demo-c-gra", name: "GRA | Search | US", type: "SEARCH", base: { conv: 22, spend: 2000, clicks: 950, imp: 20000 }, aov: 190,
    trend: (m) => 1 + 0.12 * (m - 1),
    is: { sis: 0.62, budgetLost: 0.04, rankLost: 0.22, budget: 100, util: 0.70 } },
  // Brand: stabiel en gezond -- hoort in elke analyse stil te blijven.
  { id: "demo-c-brand", name: "GreenTech | Brand", type: "SEARCH", base: { conv: 45, spend: 500, clicks: 1000, imp: 15000 }, aov: 200,
    trend: (m) => 1 + 0.02 * (m - 1),
    is: { sis: 0.93, budgetLost: 0.01, rankLost: 0.03, budget: 20, util: 0.80 } },
  // GRN (North America): pas sinds april actief, dunne en jonge reeks die daarna snel oploopt
  // vanaf een lage basis -- "eerste editie" (spiegelt [S12]).
  { id: "demo-c-grn", name: "GRN | Search | Canada", type: "SEARCH", base: { conv: 10, spend: 950, clicks: 460, imp: 9200 }, aov: 130,
    trend: (m) => (m < 4 ? 0 : 0.6 + 0.35 * (m - 4)),
    is: { sis: 0.48, budgetLost: 0.31, rankLost: 0.08, budget: 90, util: 0.95 } },
];

const monthKey = (m: number) => `2026-${String(m).padStart(2, "0")}`;
const seasonFactor = (m: number) => 1 + 0.18 * Math.sin(((m - 3) / 12) * 2 * Math.PI);

function campaignRows() {
  const rows = [];
  for (const c of CAMPAIGN_DEFS) {
    for (let m = 1; m <= REALIZED_MONTH; m++) {
      const f = c.trend(m) * seasonFactor(m);
      if (f <= 0) continue; // nog niet actief deze maand (GRN vóór april)
      const conversions = Math.round(c.base.conv * f);
      const adSpend = Math.round(c.base.spend * f);
      const clicks = Math.round(c.base.clicks * f);
      const impressions = Math.round(c.base.imp * f);
      rows.push({
        campaignId: c.id, campaignName: c.name, campaignStatus: "ENABLED", month: monthKey(m),
        conversions, revenue: Math.round(conversions * c.aov), adSpend, impressions, clicks,
        ctr: impressions > 0 ? clicks / impressions : 0, avgCpc: clicks > 0 ? adSpend / clicks : 0,
        conversionRate: clicks > 0 ? conversions / clicks : 0,
      });
    }
  }
  return rows;
}

/** Accounttotalen als som van de campagnereeksen -- nooit een los curve, anders lopen de KPI-rij
 * en de campagnetabel uiteen. */
function accountMonthlyFromCampaigns(rows: ReturnType<typeof campaignRows>): Monthly[] {
  const byMonth = new Map<number, { conv: number; rev: number; spend: number; clicks: number; imp: number }>();
  for (const r of rows) {
    const m = Number(r.month.slice(5, 7));
    const a = byMonth.get(m) ?? { conv: 0, rev: 0, spend: 0, clicks: 0, imp: 0 };
    a.conv += r.conversions; a.rev += r.revenue; a.spend += r.adSpend; a.clicks += r.clicks; a.imp += r.impressions;
    byMonth.set(m, a);
  }
  return [...byMonth.entries()].sort(([x], [y]) => x - y).map(([month, a]) => ({
    month, conversions: a.conv, revenue: a.rev, adSpend: a.spend, impressions: a.imp, clicks: a.clicks,
    ctr: a.imp > 0 ? a.clicks / a.imp : 0, avgCpc: a.clicks > 0 ? a.spend / a.clicks : 0,
    conversionRate: a.clicks > 0 ? a.conv / a.clicks : 0,
  }));
}

// Per-land maanddata voor de geo-mapping. AFGELEID uit lib/demo/geo-demo.ts, de enige plek waar
// de demo-geo gedefinieerd staat. Eerder stond hier een eigen lijstje, en dat liep uiteen met de
// kaart en de analyse: de een kende Frankrijk wel, de ander niet. Afleiden kan niet uiteenlopen.
const GEO_MONTHS = ["2026-05-01", "2026-06-01", "2026-07-01"];
const DEMO_COUNTRY_MONTHLY = geoMonthlyRows(demoGeoCountries("google"), GEO_MONTHS).map((r) => ({
  countryCode: r.code, month: r.month,
  impressions: r.impressions, clicks: r.clicks, cost: r.cost,
  conversions: r.conversions, conversionsValue: r.conversionsValue,
  ctr: r.ctr, avgCpc: r.avgCpc, costPerConversion: r.costPerConversion,
  conversionRate: r.conversionRate, roas: r.roas,
  campaignCount: 2, spendShare: 0,
}));

// De volledige respons zoals /api/google-ads/client-data die teruggeeft (mock-variant).
export function buildGreentechClientData(customerId: string) {
  const campaigns = campaignRows();
  const cur = accountMonthlyFromCampaigns(campaigns);
  const target = { conversions: 1500, revenue: 180000, adSpend: 100000 };
  // Laatste rij per campagne -- niet meer een gedeeld accounttotaal keer share, elke beurs heeft
  // zijn eigen laatste maand nu de reeksen uiteenlopen.
  const lastRowOf = (id: string) => [...campaigns].reverse().find((r) => r.campaignId === id) ?? null;
  const impressionShare = CAMPAIGN_DEFS.map((c) => {
    const last = lastRowOf(c.id);
    return {
      campaignId: c.id, campaignName: c.name, campaignType: c.type,
      cost: last?.adSpend ?? 0, conversions: last?.conversions ?? 0,
      searchImpressionShare: c.is.sis, searchBudgetLostIS: c.is.budgetLost, searchRankLostIS: c.is.rankLost,
      dailyBudget: c.is.budget, budgetUtilization: c.is.util,
    };
  });
  return {
    customerId,
    currentYear: 2026,
    realizedThroughMonth: REALIZED_MONTH,
    targetCurrentYear: target,
    historicalYears: [
      { year: 2024, monthly: months(BASE_2024), weekly: weeks(months(BASE_2024), 12) },
      { year: 2025, monthly: months(BASE_2025), weekly: weeks(months(BASE_2025), 12) },
    ],
    currentYearMonthly: cur,
    currentYearWeekly: weeks(cur, REALIZED_MONTH),
    campaigns,
    campaignsHistorical: [],
    impressionShare,
    conversionActions: [
      { id: "demo-ca-lead", name: "Stand-aanvraag", category: "SUBMIT_LEAD_FORM", status: "ENABLED", type: "WEBPAGE", primaryForGoal: true },
      { id: "demo-ca-reg", name: "Bezoekersregistratie", category: "SIGNUP", status: "ENABLED", type: "WEBPAGE", primaryForGoal: true },
    ],
    accountStructure: {
      campaigns: CAMPAIGN_DEFS.map((c) => {
        const last = lastRowOf(c.id);
        return {
          id: c.id, name: c.name, type: c.type, biddingStrategy: "MAXIMIZE_CONVERSIONS", purpose: "demand_capture",
          bucketLabel: null, adGroupCount: 3, assetGroupCount: 0, hasFeed: false, productGroupCount: 0,
          cost30d: last?.adSpend ?? 0, conversions30d: last?.conversions ?? 0, impressions30d: last?.impressions ?? 0,
        };
      }),
      detectedStrategy: ["MAXIMIZE_CONVERSIONS"],
    },
    wastefulSearchTerms: [
      { searchTerm: "greentech festival tickets", campaignName: "GRT | Search | NL", adGroupName: "GRT Generiek", clicks: 34, cost: 78 },
      { searchTerm: "gratis kas bouwen", campaignName: "GRT | Search | NL", adGroupName: "GRT Generiek", clicks: 21, cost: 41 },
    ],
    campaignCountryMap: { "GRT | Search | NL": "NL", "GRA | Search | US": "US", "GreenTech | Brand": "NL", "GRN | Search | Canada": "CA" },
    campaignCountryShares: { "GRT | Search | NL": { NL: 1 }, "GRA | Search | US": { US: 1 }, "GreenTech | Brand": { NL: 1 }, "GRN | Search | Canada": { CA: 1 } },
    detectedCountries: ["NL", "US", "CA"],
    countryMonthlyData: DEMO_COUNTRY_MONTHLY,
    adGroupBleeders: [],
    adGroupPerformance: [],
    productBleeders: [],
    productPerformance: [],
    changeHistory: [],
  };
}

// De overview-vorm zoals /api/google-ads/overview per account teruggeeft (mock-variant).
export function buildGreentechOverview(customerId: string) {
  const cur = accountMonthlyFromCampaigns(campaignRows());
  const prev = months(BASE_2025);
  const sum = (arr: Monthly[], upto: number, key: keyof Monthly) => arr.filter((m) => m.month <= upto).reduce((s, m) => s + (m[key] as number), 0);
  const ytdConv = sum(cur, REALIZED_MONTH, "conversions");
  const ytdRev = sum(cur, REALIZED_MONTH, "revenue");
  const ytdSpend = sum(cur, REALIZED_MONTH, "adSpend");
  const prevConv = sum(prev, REALIZED_MONTH, "conversions");
  const prevRev = sum(prev, REALIZED_MONTH, "revenue");
  const prevSpend = sum(prev, REALIZED_MONTH, "adSpend");
  const pct = (c: number, p: number) => (p > 0 ? ((c - p) / p) * 100 : null);
  const last = cur[cur.length - 1];
  return {
    customerId,
    ytd: { conversions: ytdConv, revenue: ytdRev, adSpend: ytdSpend, roas: ytdSpend > 0 ? ytdRev / ytdSpend : 0, cpa: ytdConv > 0 ? ytdSpend / ytdConv : 0 },
    yoy: { convChange: pct(ytdConv, prevConv), revChange: pct(ytdRev, prevRev), spendChange: pct(ytdSpend, prevSpend) },
    lastMonth: { month: REALIZED_MONTH, conversions: last.conversions, revenue: last.revenue, adSpend: last.adSpend, prevYearConv: prev[REALIZED_MONTH - 1].conversions },
    monthlyConversions: cur.map((m) => m.conversions),
  };
}

// Demo geo-dataset voor de kaart-laag (Laag 1): per-kanaal land-data én de VS-staten-drilldown.
// Waarom mock: alleen Google levert vandaag echte land-data (op landniveau); Meta/LinkedIn geo en
// staten-uitsplitsing zijn nog niet gesynct (Laag 2). Deze mock laat de kaart-UX op elk kanaal én
// bij "Alle kanalen" zien, met plausibele verschillen per kanaal, zodat de metric-selector iets te
// vertellen heeft. Puur presentatie — nooit vermengd met echte data; alleen actief in demo-modus.

import { splitAlong, splitInt } from "./split";

export interface GeoAgg {
  code: string; // alpha-2 land óf USPS-staat
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

const AOV = 130;
// Bouwt een rij uit impressies + CTR + conversieratio + CPA, zodat de afgeleide metrics kloppen.
function row(code: string, impressions: number, ctr: number, convRate: number, cpa: number): GeoAgg {
  const clicks = Math.round(impressions * ctr);
  const conversions = Math.round(clicks * convRate);
  const cost = Math.round(conversions * cpa);
  return { code, impressions, clicks, cost, conversions, conversionsValue: Math.round(conversions * AOV) };
}

// Een markt die wél verkeer trekt maar niets oplevert. Bewust apart van row(): daar volgen de
// kosten uit de conversies, en juist hier zijn er geen conversies terwijl het geld wel op gaat.
// Dit is het patroon waar de markt-analyse op let — meestal een landingspagina die niet in de
// taal van die markt staat, of een aanbod dat er niet levert.
function deadMarket(code: string, impressions: number, ctr: number, cost: number): GeoAgg {
  return { code, impressions, clicks: Math.round(impressions * ctr), cost, conversions: 0, conversionsValue: 0 };
}

// Per kanaal een eigen geografisch profiel. Google = demand-capture (NL/US/CA, sterke conv). Meta =
// awareness (breed bereik, veel impressies, lagere conv-ratio). LinkedIn = B2B (smal, duur, kwaliteit).
type Channel = "google" | "meta" | "linkedin" | "blended";

const COUNTRY_BASE: Record<Exclude<Channel, "blended">, GeoAgg[]> = {
  google: [
    row("NL", 132500, 0.047, 0.037, 50),
    row("US", 94000, 0.044, 0.029, 74),
    row("CA", 46700, 0.038, 0.023, 96),
    // Frankrijk krijgt verkeer maar converteert niet: geen Franse landingspagina.
    deadMarket("FR", 41000, 0.036, 1_240),
  ],
  meta: [
    row("NL", 410000, 0.021, 0.012, 62),
    row("US", 288000, 0.019, 0.009, 85),
    row("DE", 176000, 0.018, 0.010, 78),
    row("BE", 98000, 0.020, 0.011, 70),
    row("GB", 142000, 0.017, 0.008, 92),
  ],
  linkedin: [
    row("NL", 84000, 0.011, 0.021, 118),
    row("US", 61000, 0.010, 0.017, 156),
    row("DE", 39000, 0.009, 0.018, 142),
    row("GB", 47000, 0.009, 0.015, 168),
  ],
};

// VS-staten per kanaal. Google sterk in CA/TX/NY; Meta breder; LinkedIn geconcentreerd in de
// B2B-hubs (NY/CA/MA). Alleen de VS — dit voedt de drilldown-kaart onder de wereldkaart.
const STATE_BASE: Record<Exclude<Channel, "blended">, GeoAgg[]> = {
  google: [
    row("CA", 22800, 0.045, 0.031, 70),
    row("TX", 16400, 0.043, 0.028, 76),
    // New York is hier structureel duur: veel concurrentie op hetzelfde vakpubliek.
    row("NY", 14900, 0.046, 0.030, 205),
    row("IL", 8600, 0.041, 0.026, 84),
    row("FL", 9800, 0.040, 0.024, 90),
    row("WA", 6100, 0.044, 0.029, 74),
    row("MA", 5400, 0.047, 0.032, 68),
  ],
  meta: [
    row("CA", 68000, 0.020, 0.010, 80),
    row("TX", 54000, 0.019, 0.009, 86),
    row("NY", 47000, 0.021, 0.011, 78),
    row("FL", 41000, 0.018, 0.008, 94),
    row("IL", 29000, 0.019, 0.009, 88),
    row("GA", 22000, 0.017, 0.008, 96),
    row("WA", 18000, 0.020, 0.010, 82),
  ],
  linkedin: [
    row("NY", 16800, 0.011, 0.019, 150),
    row("CA", 15200, 0.010, 0.018, 158),
    row("MA", 9400, 0.012, 0.022, 138),
    row("IL", 6100, 0.009, 0.016, 166),
    row("TX", 7300, 0.009, 0.015, 172),
    row("WA", 5200, 0.010, 0.017, 160),
  ],
};

// Blended = som over de kanalen per code (impressies/klikken/kosten/conversies opgeteld).
function blend(sets: GeoAgg[][]): GeoAgg[] {
  const m = new Map<string, GeoAgg>();
  for (const set of sets) {
    for (const r of set) {
      const a = m.get(r.code) ?? { code: r.code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
      a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost;
      a.conversions += r.conversions; a.conversionsValue += r.conversionsValue;
      m.set(r.code, a);
    }
  }
  return [...m.values()];
}

export function demoGeoCountries(channel: Channel): GeoAgg[] {
  if (channel === "blended") return blend(Object.values(COUNTRY_BASE));
  return COUNTRY_BASE[channel];
}

export function demoGeoStates(channel: Channel): GeoAgg[] {
  if (channel === "blended") return blend(Object.values(STATE_BASE));
  return STATE_BASE[channel];
}

// ── Maandrijen ─────────────────────────────────────────────────────────────
// Dezelfde geo-wereld, maar in de tabelvorm die de maand-SOP en de client-data-API verwachten.
//
// Waarom hier en niet apart: er waren drie losse demo-definities van geo (de kaart, de analyse en
// de client-data-API), en die spraken elkaar tegen — de een kende Frankrijk wel, de ander niet.
// Eén definitie met afgeleide vormen kán niet uiteenlopen.
//
// De maandbedragen tellen exact op tot het totaal uit demoGeoCountries/demoGeoStates. Dat is de
// eigenschap die het gelijktrekken waarmaakt: wie de maanden optelt krijgt precies wat de kaart
// toont, tot op de eenheid.

export interface GeoMonthlyRow extends GeoAgg {
  month: string;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
  conversionRate: number;
  roas: number;
}

// Lichte seizoensvorm zodat de reeks niet kaarsrecht is; genormaliseerd zodat de som klopt.
const MONTH_WEIGHTS = [0.94, 1.0, 1.06];

/**
 * Zet de geaggregeerde markten om naar maandrijen over de opgegeven maanden (ISO, eerste van de
 * maand). De afgeleide ratio's komen uit de maandtotalen zelf, niet uit het jaartotaal.
 */
export function geoMonthlyRows(aggs: GeoAgg[], months: string[]): GeoMonthlyRow[] {
  const weights = months.map((_, i) => MONTH_WEIGHTS[i % MONTH_WEIGHTS.length]);
  const out: GeoMonthlyRow[] = [];
  for (const a of aggs) {
    const imp = splitInt(a.impressions, weights);
    const clk = splitInt(a.clicks, weights);
    const cost = splitInt(Math.round(a.cost), weights);
    const conv = splitInt(Math.round(a.conversions), weights);
    const val = splitAlong(Math.round(a.conversionsValue), conv, weights);
    months.forEach((month, i) => {
      out.push({
        code: a.code, month,
        impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversionsValue: val[i],
        ctr: imp[i] > 0 ? clk[i] / imp[i] : 0,
        avgCpc: clk[i] > 0 ? cost[i] / clk[i] : 0,
        costPerConversion: conv[i] > 0 ? cost[i] / conv[i] : 0,
        conversionRate: clk[i] > 0 ? conv[i] / clk[i] : 0,
        roas: cost[i] > 0 ? val[i] / cost[i] : 0,
      });
    });
  }
  return out;
}

// ── Vorig jaar ─────────────────────────────────────────────────────────────
// De YoY-tabel draagt alleen percentages, en losse percentages zijn het makkelijkst te verzinnen
// en het makkelijkst tegenstrijdig. Daarom leggen we hier het vórige jaar vast als verhouding tot
// het huidige, en rekenen we élk percentage — ook de afgeleide zoals CPA en ROAS — daaruit uit.
// Dan kan de YoY-uitkomst per definitie niet botsen met de markt-data ernaast.
//
// Het verhaal: Nederland groeit gestaag, de VS is dit jaar hard opgeschaald, Canada is juist
// teruggeschroefd. Frankrijk staat er bewust NIET in — die markt is dit jaar geopend en heeft dus
// geen vorig jaar. Dat sluit aan op het dode-markt-patroon: nieuw opengezet, maar zonder Franse
// landingspagina.
const COUNTRY_PRIOR_YEAR: Record<string, { impressions: number; clicks: number; cost: number; conversions: number }> = {
  NL: { impressions: 0.86, clicks: 0.84, cost: 0.89, conversions: 0.82 },
  US: { impressions: 0.71, clicks: 0.68, cost: 0.74, conversions: 0.63 },
  CA: { impressions: 1.12, clicks: 1.15, cost: 1.08, conversions: 1.21 },
};

export interface GeoYoyPct {
  month: string;
  impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number;
  ctr: number; avgCpc: number; conversionRate: number; roas: number; costPerConversion: number;
}

const yoyPct = (cur: number, prev: number): number =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : 0;

/**
 * YoY-percentages per maand voor één markt, of null als die markt vorig jaar niet liep.
 *
 * Twee dingen zijn hier bewust: de percentages komen uit een échte vorig-jaar-reeks in plaats van
 * uit losse getallen, zodat de afgeleide metrics (CPA, ROAS) volgen uit kosten en conversies en er
 * niet naast kunnen liggen. En het vorige jaar krijgt een verschoven seizoensvorm, want een markt
 * die twee jaar op rij exact hetzelfde maandprofiel heeft bestaat niet — zonder die verschuiving
 * zou elke maand op de komma hetzelfde YoY-percentage tonen.
 */
export function geoYoyMonthly(agg: GeoAgg, months: string[]): GeoYoyPct[] | null {
  const f = COUNTRY_PRIOR_YEAR[agg.code];
  if (!f) return null;
  const prevAgg: GeoAgg = {
    code: agg.code,
    impressions: Math.round(agg.impressions * f.impressions),
    clicks: Math.round(agg.clicks * f.clicks),
    cost: Math.round(agg.cost * f.cost),
    conversions: Math.round(agg.conversions * f.conversions),
    conversionsValue: Math.round(agg.conversionsValue * f.conversions), // waarde volgt de conversies (vaste AOV)
  };
  const cur = geoMonthlyRows([agg], months);
  // Eén positie opgeschoven seizoensvorm: vorig jaar piekte de markt een maand eerder. We draaien
  // de vorig-jaar-reeks door, dus de maandlabels doen er niet toe — alleen de vorm.
  const prevSeries = geoMonthlyRows([prevAgg], months);
  const prev = months.map((_, i) => prevSeries[(i + 1) % prevSeries.length]);
  return months.map((month, i) => ({
    month,
    impressions: yoyPct(cur[i].impressions, prev[i].impressions),
    clicks: yoyPct(cur[i].clicks, prev[i].clicks),
    cost: yoyPct(cur[i].cost, prev[i].cost),
    conversions: yoyPct(cur[i].conversions, prev[i].conversions),
    conversionsValue: yoyPct(cur[i].conversionsValue, prev[i].conversionsValue),
    ctr: yoyPct(cur[i].ctr, prev[i].ctr),
    avgCpc: yoyPct(cur[i].avgCpc, prev[i].avgCpc),
    conversionRate: yoyPct(cur[i].conversionRate, prev[i].conversionRate),
    roas: yoyPct(cur[i].roas, prev[i].roas),
    costPerConversion: yoyPct(cur[i].costPerConversion, prev[i].costPerConversion),
  }));
}

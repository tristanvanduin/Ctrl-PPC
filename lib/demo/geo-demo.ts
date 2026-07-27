// Demo geo-dataset voor de kaart-laag (Laag 1): per-kanaal land-data én de VS-staten-drilldown.
// Waarom mock: alleen Google levert vandaag echte land-data (op landniveau); Meta/LinkedIn geo en
// staten-uitsplitsing zijn nog niet gesynct (Laag 2). Deze mock laat de kaart-UX op elk kanaal én
// bij "Alle kanalen" zien, met plausibele verschillen per kanaal, zodat de metric-selector iets te
// vertellen heeft. Puur presentatie — nooit vermengd met echte data; alleen actief in demo-modus.

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

/** Verdeelt één geheel getal over de maanden volgens de gewichten, met de rest naar de laatste. */
function splitInt(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = weights.slice(0, -1).map((w) => Math.round((total * w) / sum));
  out.push(total - out.reduce((s, v) => s + v, 0)); // rest, zodat de som exact klopt
  return out;
}

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
    const val = splitInt(Math.round(a.conversionsValue), weights);
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

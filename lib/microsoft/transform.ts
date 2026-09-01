// De pure vertaalslag van Microsoft-rapport-CSV's naar databaserijen. Geen HTTP en geen
// Supabase: alles hier is met fixtures te unit-testen (__microsoft_transform_test.ts), en dat
// is precies de scheiding die de LIVE-ONGETESTE api.ts klein houdt.

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Parseert een rapport-CSV naar rijen op kolomnaam. Dekt het formaat dat de Reporting API
 * levert: komma-gescheiden, velden met komma's/aanhalingstekens in dubbele quotes, quotes
 * binnen een veld verdubbeld. Meer dan dat bewust niet -- dit is geen algemene CSV-lezer.
 */
export function parseReportCsv(tekst: string): Record<string, string>[] {
  const regels = tekst.split(/\r?\n/).filter((r) => r.length > 0);
  if (regels.length < 2) return [];
  const kolommen = parseCsvRegel(regels[0]);
  const rijen: Record<string, string>[] = [];
  for (let i = 1; i < regels.length; i++) {
    const velden = parseCsvRegel(regels[i]);
    // Een rij met een ander veldental dan de kop is geen datarij (bv. een voettekst die
    // ondanks ExcludeReportFooter meekwam); overslaan is veiliger dan scheef toewijzen.
    if (velden.length !== kolommen.length) continue;
    const rij: Record<string, string> = {};
    for (let k = 0; k < kolommen.length; k++) rij[kolommen[k]] = velden[k];
    rijen.push(rij);
  }
  return rijen;
}

function parseCsvRegel(regel: string): string[] {
  const velden: string[] = [];
  let huidig = "";
  let inQuotes = false;
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i];
    if (inQuotes) {
      if (c === '"') {
        if (regel[i + 1] === '"') { huidig += '"'; i++; }
        else inQuotes = false;
      } else huidig += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      velden.push(huidig);
      huidig = "";
    } else huidig += c;
  }
  velden.push(huidig);
  return velden;
}

// ── Getallen ────────────────────────────────────────────────────────────────

/**
 * Microsoft levert getallen als opgemaakte strings: "1,234", "4.56%", "--" voor "geen
 * waarde". Een niet-parseerbaar veld wordt null -- null is eerlijk, een verzonnen 0 leest
 * als een gemeten nul (zelfde doctrine als parseNum bij Meta).
 */
export function parseGetal(w: string | undefined | null): number | null {
  if (w == null) return null;
  const schoon = w.replace(/[%,]/g, "").trim();
  if (!schoon || schoon === "--") return null;
  const n = Number(schoon);
  return Number.isFinite(n) ? n : null;
}

/** Percent-string naar fractie: "46.5%" → 0.465. De IS-kolommen zijn als fractie opgeslagen. */
export function parseFractie(w: string | undefined | null): number | null {
  const n = parseGetal(w);
  return n === null ? null : rond(n / 100, 4);
}

function rond(n: number, decimalen = 2): number {
  const f = 10 ** decimalen;
  return Math.round(n * f) / f;
}

function heel(w: string | undefined | null): number | null {
  const n = parseGetal(w);
  return n === null ? null : Math.round(n);
}

/**
 * Conversies met de juiste kolomvoorkeur. De klassieke kolom `Conversions` is sinds 2022
 * afgeschaft en levert in rapporten structureel "0" (geverifieerd in de v13-docs,
 * 2026-09-01); `ConversionsQualified` is de opvolger. De terugval op `Conversions` blijft
 * staan voor het geval een rapport de nieuwe kolom (nog) niet draagt -- dan is een oud
 * getal eerlijker dan een verzonnen nul. Zelfde voorkeursvolgorde voor Revenue is niet
 * nodig: die kolom is niet afgeschaft.
 */
function conversies(rij: Record<string, string>): number | null {
  const q = parseGetal(rij.ConversionsQualified);
  if (q !== null) return q;
  return parseGetal(rij.Conversions);
}

/** Monthly-aggregatie levert de maand als datum; normaliseer defensief naar de eerste. */
function naarMaand(timePeriod: string | undefined): string | null {
  const t = (timePeriod ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(t)) return null;
  return `${t.slice(0, 7)}-01`;
}

function naarDatum(timePeriod: string | undefined): string | null {
  const t = (timePeriod ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

// ── Normalisaties naar de labels die de lezers kennen ───────────────────────

/**
 * Netwerklabels: de analyse en de demo spreken over "Search", "Syndicated search partners"
 * en "Audience Network" (de searchbenchmark matcht letterlijk op "search", zie
 * prepared-facts.ts). Microsoft's rapportwaarden wijken daarvan af; dit is de enige plek
 * die dat verschil kent.
 */
export function normaliseerNetwerk(w: string): string {
  const laag = w.trim().toLowerCase();
  if (laag.includes("microsoft sites") || laag === "search" || laag.includes("bing and yahoo")) return "Search";
  if (laag === "audience" || laag.includes("audience")) return "Audience Network";
  if (laag.includes("syndicated")) return "Syndicated search partners";
  return w.trim();
}

/** Apparaatlabels: Computer→Desktop, Smartphone→Mobile; Tablet blijft. Zelfde reden. */
export function normaliseerApparaat(w: string): string {
  const laag = w.trim().toLowerCase();
  if (laag === "computer") return "Desktop";
  if (laag === "smartphone") return "Mobile";
  if (laag === "tablet") return "Tablet";
  return w.trim();
}

/** Matchtypes zijn in de tabellen kleingeschreven ("exact"/"phrase"/"broad"). */
export function normaliseerMatchType(w: string | undefined): string | null {
  const laag = (w ?? "").trim().toLowerCase();
  return laag || null;
}

/**
 * Campagnetypes kleingeschreven, met de rapportwaarde "Search & content" op "search": de
 * demo en de facts-laag spreken over "search", en het &-label is dezelfde campagnesoort
 * (v13-rapportdocs: mogelijke waarden Audience, Dynamic search, Search & content, Shopping).
 */
export function normaliseerCampagnetype(w: string | undefined): string | null {
  const laag = (w ?? "").trim().toLowerCase();
  if (!laag) return null;
  if (laag === "search & content") return "search";
  return laag;
}

// ── Rijmappers ──────────────────────────────────────────────────────────────

/** Dagrij voor microsoft_account_daily / _campaign_daily / _adgroup_daily. */
export function naarDagRij(
  rij: Record<string, string>,
  clientId: string,
  entityId: string
): Record<string, unknown> | null {
  const date = naarDatum(rij.TimePeriod);
  if (!date || !entityId) return null;
  const impressions = heel(rij.Impressions) ?? 0;
  const clicks = heel(rij.Clicks) ?? 0;
  const spend = parseGetal(rij.Spend) ?? 0;
  return {
    client_id: clientId,
    date,
    entity_id: entityId,
    impressions,
    clicks,
    spend: rond(spend),
    conversions: conversies(rij) ?? 0,
    conversion_value: parseGetal(rij.Revenue) ?? 0,
    // Afgeleid en niet uit de rapportkolommen: die zijn al afgerond aangeleverd, en twee
    // bronnen voor hetzelfde getal gaan uit elkaar lopen.
    ctr: impressions > 0 ? rond(clicks / impressions, 4) : 0,
    avg_cpc: clicks > 0 ? rond(spend / clicks) : 0,
  };
}

/** Breakdown-dagrij (level "account", zoals de lezers pinnen). */
export function naarBreakdownRij(
  rij: Record<string, string>,
  clientId: string,
  accountId: string,
  breakdownType: "network" | "device",
  waarde: string
): Record<string, unknown> | null {
  const date = naarDatum(rij.TimePeriod);
  if (!date || !waarde) return null;
  return {
    client_id: clientId,
    date,
    level: "account",
    entity_id: accountId,
    breakdown_type: breakdownType,
    breakdown_value: waarde,
    impressions: heel(rij.Impressions) ?? 0,
    clicks: heel(rij.Clicks) ?? 0,
    spend: rond(parseGetal(rij.Spend) ?? 0),
    conversions: conversies(rij) ?? 0,
    conversion_value: parseGetal(rij.Revenue) ?? 0,
  };
}

export function naarKeywordMaandRij(rij: Record<string, string>, clientId: string): Record<string, unknown> | null {
  const month = naarMaand(rij.TimePeriod);
  const keywordId = (rij.KeywordId ?? "").trim();
  if (!month || !keywordId) return null;
  const impressions = heel(rij.Impressions) ?? 0;
  const clicks = heel(rij.Clicks) ?? 0;
  const cost = parseGetal(rij.Spend) ?? 0;
  const conversions = conversies(rij) ?? 0;
  return {
    client_id: clientId,
    month,
    campaign_id: (rij.CampaignId ?? "").trim() || null,
    campaign_name: (rij.CampaignName ?? "").trim(),
    ad_group_id: (rij.AdGroupId ?? "").trim() || null,
    ad_group_name: (rij.AdGroupName ?? "").trim(),
    keyword_id: keywordId,
    keyword_text: (rij.Keyword ?? "").trim(),
    match_type: normaliseerMatchType(rij.BidMatchType) ?? "broad",
    impressions,
    clicks,
    cost: rond(cost),
    conversions,
    conversions_value: parseGetal(rij.Revenue) ?? 0,
    ctr: impressions > 0 ? rond(clicks / impressions, 4) : 0,
    avg_cpc: clicks > 0 ? rond(cost / clicks) : 0,
    conversion_rate: clicks > 0 ? rond(conversions / clicks, 4) : 0,
    cost_per_conversion: conversions > 0 ? rond(cost / conversions) : 0,
    quality_score: heel(rij.QualityScore),
  };
}

export function naarZoektermMaandRij(rij: Record<string, string>, clientId: string): Record<string, unknown> | null {
  const month = naarMaand(rij.TimePeriod);
  const term = (rij.SearchQuery ?? "").trim();
  if (!month || !term) return null;
  const impressions = heel(rij.Impressions) ?? 0;
  const clicks = heel(rij.Clicks) ?? 0;
  const conversions = conversies(rij) ?? 0;
  return {
    client_id: clientId,
    month,
    campaign_id: (rij.CampaignId ?? "").trim() || null,
    ad_group_id: (rij.AdGroupId ?? "").trim() || null,
    campaign_name: (rij.CampaignName ?? "").trim(),
    ad_group_name: (rij.AdGroupName ?? "").trim(),
    search_term: term,
    match_type: normaliseerMatchType(rij.BidMatchType),
    impressions,
    clicks,
    cost: rond(parseGetal(rij.Spend) ?? 0),
    conversions,
    conversions_value: parseGetal(rij.Revenue) ?? 0,
    ctr: impressions > 0 ? rond(clicks / impressions, 4) : 0,
    conversion_rate: clicks > 0 ? rond(conversions / clicks, 4) : 0,
  };
}

/**
 * Impressieaandeel-maandrij. daily_budget komt uit Campaign Management (niet uit het
 * rapport) en budget_utilization wordt hier afgeleid: spend / (dagbudget × dagen in de
 * maand) -- de lopende maand telt tot de einddatum van het venster, zodat de stand een
 * maand-tot-nu is, precies zoals de demo-generator hem bouwt.
 */
export function naarImpressieAandeelRij(
  rij: Record<string, string>,
  clientId: string,
  budgetPerCampagne: Map<string, number>,
  vensterEinde: string
): Record<string, unknown> | null {
  const month = naarMaand(rij.TimePeriod);
  const campaignId = (rij.CampaignId ?? "").trim();
  if (!month || !campaignId) return null;
  const cost = parseGetal(rij.Spend) ?? 0;
  const budget = budgetPerCampagne.get(campaignId) ?? null;
  const dagen = dagenInMaandTot(month, vensterEinde);
  return {
    client_id: clientId,
    campaign_id: campaignId,
    campaign_name: (rij.CampaignName ?? "").trim(),
    campaign_type: normaliseerCampagnetype(rij.CampaignType),
    month,
    impressions: heel(rij.Impressions) ?? 0,
    clicks: heel(rij.Clicks) ?? 0,
    cost: rond(cost),
    conversions: conversies(rij) ?? 0,
    impression_share: parseFractie(rij.ImpressionSharePercent),
    budget_lost_is: parseFractie(rij.ImpressionLostToBudgetPercent),
    rank_lost_is: parseFractie(rij.ImpressionLostToRankAggPercent),
    daily_budget: budget,
    budget_utilization: budget && budget > 0 && dagen > 0 ? rond(cost / (budget * dagen)) : null,
  };
}

/** Hoeveel dagen van deze maand binnen het venster vallen (volle maand of maand-tot-nu). */
export function dagenInMaandTot(month: string, vensterEinde: string): number {
  const [jaar, maand] = month.split("-").map(Number);
  const laatste = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
  if (vensterEinde.slice(0, 7) === month.slice(0, 7)) {
    const dag = Number(vensterEinde.slice(8, 10));
    return Math.min(Math.max(dag, 1), laatste);
  }
  return vensterEinde > month ? laatste : 0;
}

/**
 * Profielrijen (LinkedIn-targeting) voor microsoft_profile_monthly.
 *
 * Het ProfessionalDemographics-rapport eist zijn drie naamkolommen (CompanyName,
 * IndustryName, JobFunctionName) plus AccountName/AdGroupName VERPLICHT SAMEN (geverifieerd
 * in de v13-docs, 2026-09-01) -- losse pivots opvragen kan dus niet. Elke rapportrij is één
 * cel in het kruisproduct van de drie dimensies; per pivot sommeren over de andere twee (en
 * over de adgroups) is exact, want elke impressie zit in precies één combinatie.
 */
export const PROFIEL_PIVOTS = [
  { pivot: "company" as const, kolom: "CompanyName" },
  { pivot: "industry" as const, kolom: "IndustryName" },
  { pivot: "job_function" as const, kolom: "JobFunctionName" },
];

export function aggregeerProfielRijen(rijen: Record<string, string>[], clientId: string): Record<string, unknown>[] {
  interface Som { impressions: number; clicks: number; spend: number; conversions: number }
  const sommen = new Map<string, Som>();
  for (const rij of rijen) {
    const month = naarMaand(rij.TimePeriod);
    if (!month) continue;
    for (const { pivot, kolom } of PROFIEL_PIVOTS) {
      const waarde = (rij[kolom] ?? "").trim();
      if (!waarde) continue;
      const sleutel = `${month}~~${pivot}~~${waarde}`;
      const som = sommen.get(sleutel) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
      som.impressions += heel(rij.Impressions) ?? 0;
      som.clicks += heel(rij.Clicks) ?? 0;
      som.spend += parseGetal(rij.Spend) ?? 0;
      som.conversions += conversies(rij) ?? 0;
      sommen.set(sleutel, som);
    }
  }
  return [...sommen.entries()].map(([sleutel, som]) => {
    const [month, pivot_type, pivot_value] = sleutel.split("~~");
    return {
      client_id: clientId, month, pivot_type, pivot_value,
      impressions: som.impressions, clicks: som.clicks,
      spend: rond(som.spend), conversions: rond(som.conversions, 3),
    };
  });
}

// ── Entiteiten (Campaign Management) ────────────────────────────────────────

export function naarCampagneRij(
  c: { Id?: number; Name?: string; CampaignType?: string; Status?: string; DailyBudget?: number; BiddingScheme?: { Type?: string } },
  clientId: string
): Record<string, unknown> | null {
  if (c.Id == null) return null;
  return {
    campaign_id: String(c.Id),
    client_id: clientId,
    name: c.Name ?? null,
    campaign_type: c.CampaignType?.toLowerCase() ?? null,
    status: c.Status?.toLowerCase() ?? null,
    daily_budget: c.DailyBudget ?? null,
    bid_strategy: c.BiddingScheme?.Type ?? null,
  };
}

export function naarAdGroupRij(
  ag: { Id?: number; Name?: string; Status?: string },
  campaignId: string,
  clientId: string
): Record<string, unknown> | null {
  if (ag.Id == null) return null;
  return {
    adgroup_id: String(ag.Id),
    campaign_id: campaignId,
    client_id: clientId,
    name: ag.Name ?? null,
    status: ag.Status?.toLowerCase() ?? null,
  };
}

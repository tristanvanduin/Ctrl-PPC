/**
 * Meta objective-taxonomie en evaluatiecriteria per objective.
 *
 * Dit is het Meta-equivalent van lib/campaign-types.ts, maar geen kopie van dat
 * patroon -- Meta's eigen structuur is anders en dat bestand volgt die structuur:
 *
 * - Google Ads heeft geen expliciet "doel"-veld per Search-campagne, dus
 *   lib/campaign-types.ts MOET het doel afleiden uit de campagnenaam
 *   (detectCampaignPurpose). Meta wél: elke campagne heeft sinds de ODAX-migratie
 *   (februari 2022) een verplicht `objective`-veld, al opgehaald
 *   (lib/api/meta-ads.ts:232) en al opgeslagen (meta_campaigns.objective,
 *   scripts/migrations/007_meta.sql:13) -- alleen nog nergens gebruikt in de
 *   analyselaag (masterplan sectie 14.1/16.3). Naamdetectie is hier dus de
 *   uitzondering (val alleen terug als het API-veld ontbreekt), niet de hoofdroute.
 * - Meta's echte hiërarchie is Campagne (objective) -> Adset (optimization_goal,
 *   targeting, budget) -> Advertentie (creative). De evaluatiecriteria hieronder
 *   zitten op objective-niveau omdat dat het niveau is waarop Google's purpose ook
 *   zit (vergelijkbare granulariteit) -- optimization_goal per adset is een
 *   logische volgende verdieping, hier bewust niet gebouwd om scope niet te laten
 *   groeien voordat dit niveau al staat.
 *
 * Bron: developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
 * (zes ODAX-objectives, geverifieerd 17 augustus 2026 -- zie masterplan 14.2).
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** De zes actuele Outcome-Driven Ad Experience (ODAX) objectives. */
export type MetaObjective =
  | "OUTCOME_AWARENESS"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_LEADS"
  | "OUTCOME_APP_PROMOTION"
  | "OUTCOME_SALES";

export const OBJECTIVE_LABELS: Record<MetaObjective, string> = {
  OUTCOME_AWARENESS: "Bekendheid",
  OUTCOME_TRAFFIC: "Verkeer",
  OUTCOME_ENGAGEMENT: "Interactie",
  OUTCOME_LEADS: "Leads",
  OUTCOME_APP_PROMOTION: "App-promotie",
  OUTCOME_SALES: "Verkoop",
};

/** Whether ROAS is a meaningful metric for this objective */
export function isRoasRelevant(objective: MetaObjective): boolean {
  return objective === "OUTCOME_SALES";
}

/** Whether a campaign with this objective is suitable for budget scaling */
export function isScalable(objective: MetaObjective): boolean {
  return objective === "OUTCOME_SALES" || objective === "OUTCOME_LEADS" || objective === "OUTCOME_TRAFFIC";
}

// ── Evaluatiecriteria per objective ─────────────────────────────────────────

export interface EvalCriterion {
  metric: string;
  label: string;
  /** Waarom dit ertoe doet bij dit objective */
  why: string;
  direction: "higher_better" | "lower_better" | "range";
  /** Kunnen we dit berekenen uit meta_campaign_daily/meta_account_daily? */
  available: boolean;
  /** Waar dit handmatig te checken is in Meta Ads Manager, als het niet in de data zit */
  checkInAds?: string;
}

/**
 * Beschikbaarheid hieronder is getoetst tegen de kolommen die daadwerkelijk bestaan
 * in meta_campaign_daily (scripts/migrations/007_meta.sql:68-108, campaign_daily erft
 * 1-op-1 van account_daily). Geen aannames -- wat er niet in staat is "available: false"
 * met een concrete checkInAds-verwijzing, net als bij Google's onbeschikbare Ads-only
 * metrics.
 */
export const OBJECTIVE_EVAL_CRITERIA: Record<MetaObjective, EvalCriterion[]> = {
  OUTCOME_AWARENESS: [
    { metric: "cpm", label: "CPM", why: "Primaire efficiency-metric bij bekendheid: kosten per 1000 vertoningen. Vergelijk met vorige periode.", direction: "lower_better", available: true },
    { metric: "reach", label: "Bereik", why: "Aantal unieke mensen bereikt. Stagneert bereik terwijl budget gelijk blijft, dan is de doelgroep uitgeput.", direction: "higher_better", available: true },
    { metric: "frequency", label: "Frequentie", why: "Ideaal 1-3x voor bekendheid. Boven de 5x is het geld dat aan dezelfde mensen wordt herhaald in plaats van nieuw bereik.", direction: "range", available: true },
    { metric: "hook_rate", label: "Hook Rate", why: "% dat de eerste 3 seconden van de video kijkt. Laag = de eerste seconden grijpen niet, ongeacht de rest van de creative.", direction: "higher_better", available: true },
    { metric: "hold_rate", label: "Hold Rate", why: "% dat blijft kijken na de hook. Laag terwijl hook_rate hoog is = de content zelf houdt niet vast.", direction: "higher_better", available: true },
    { metric: "video_thruplay", label: "Thruplays", why: "Volledige of 15s-views. Volume-indicator voor daadwerkelijke aandacht, los van CPM.", direction: "higher_better", available: true },
    { metric: "ctr_link", label: "CTR (secundair)", why: "Niet de hoofdmetric bij bekendheid, maar een onverwacht hoge CTR duidt op vraag die de campagne niet opvangt.", direction: "higher_better", available: true },
    { metric: "brand_lift", label: "Brand Lift", why: "Directe meting van merkbekendheid-uplift. De enige metric die daadwerkelijk bewijst dat het doel is gehaald.", direction: "higher_better", available: false, checkInAds: "Ads Manager → Brand Lift-experiment (indien actief opgezet)" },
  ],
  OUTCOME_TRAFFIC: [
    { metric: "cpc_link", label: "CPC (link)", why: "Primaire kostenmetric: kosten per doorklik naar de bestemming.", direction: "lower_better", available: true },
    { metric: "ctr_link", label: "CTR (link)", why: "Relevantie-indicator. Laag = creative of targeting sluit niet aan op wie hem ziet.", direction: "higher_better", available: true },
    { metric: "link_clicks", label: "Link Clicks", why: "Ruw volume. Belangrijk naast CPC omdat een lage CPC bij laag volume niets zegt over schaalbaarheid.", direction: "higher_better", available: true },
    { metric: "landing_page_views", label: "Landingspagina-weergaven", why: "Verschil met link_clicks = mensen die klikken maar de pagina niet laden (trage site, app-vs-browser-frictie).", direction: "higher_better", available: true },
    { metric: "cpm", label: "CPM (secundair)", why: "Stijgende CPM bij gelijke CPC/CTR wijst op duurdere plaatsingen, niet op een targeting-probleem.", direction: "lower_better", available: true },
    { metric: "quality_ranking", label: "Kwaliteitsclassificatie", why: "Meta's eigen relatieve advertentiekwaliteit tov concurrenten voor dezelfde doelgroep. Onder gemiddeld = hogere kosten voor hetzelfde resultaat.", direction: "higher_better", available: false, checkInAds: "Ads Manager → kolommen → Kwaliteitsclassificatie (ad-niveau)" },
  ],
  OUTCOME_ENGAGEMENT: [
    { metric: "post_engagement", label: "Post-interacties", why: "Primaire volumemetric: reacties, shares, likes, comments samen.", direction: "higher_better", available: true },
    { metric: "video_thruplay", label: "Thruplays", why: "Voor video-engagement de belangrijkste completion-metric.", direction: "higher_better", available: true },
    { metric: "hook_rate", label: "Hook Rate", why: "Zelfde logica als bij bekendheid: grijpt de creative in de eerste seconden.", direction: "higher_better", available: true },
    { metric: "hold_rate", label: "Hold Rate", why: "Houdt de creative vast na de hook.", direction: "higher_better", available: true },
    { metric: "ctr_link", label: "CTR (secundair)", why: "Engagement-campagnes sturen soms ook naar een link; onverwacht hoge CTR is een signaal om als traffic te heroverwegen.", direction: "higher_better", available: true },
    { metric: "messaging_conversations", label: "Berichtgesprekken", why: "Voor Messenger/WhatsApp-gerichte engagement-campagnes de kernmetric — niet in dit schema opgeslagen.", direction: "higher_better", available: false, checkInAds: "Ads Manager → kolommen → Berichten-metrics" },
  ],
  OUTCOME_LEADS: [
    { metric: "leads", label: "Aantal leads", why: "Primaire volumemetric.", direction: "higher_better", available: true },
    { metric: "cpa", label: "Kosten per lead", why: "De cpa-kolom is generiek 'kosten per actie'; bij een Leads-objective is dat effectief cost-per-lead.", direction: "lower_better", available: true },
    { metric: "landing_page_views", label: "Paginaweergaven vs. leads", why: "Groot verschil tussen paginaweergaven en leads wijst op een formulier- of aanbod-probleem, niet op targeting.", direction: "range", available: true },
    { metric: "form_completion_rate", label: "Formulier-voltooiingspercentage", why: "Bij Instant Forms de directe frictie-metric — hoeveel van de geopende formulieren wordt afgemaakt.", direction: "higher_better", available: false, checkInAds: "Ads Manager → Instant Forms → Voltooiingspercentage" },
    { metric: "lead_quality", label: "Leadkwaliteit (CRM-gematcht)", why: "Meta telt een lead bij formulierinzending, niet bij een gekwalificeerde deal. Zonder CRM-koppeling is volume een schijnresultaat.", direction: "higher_better", available: false, checkInAds: "Vergelijk exportlijst leads met CRM-uitkomst per lead" },
  ],
  OUTCOME_APP_PROMOTION: [
    { metric: "installs", label: "Installaties", why: "Primaire volumemetric voor app-promotie.", direction: "higher_better", available: false, checkInAds: "Ads Manager → kolommen → App-installaties (vereist Events Manager-koppeling)" },
    { metric: "cost_per_install", label: "Kosten per installatie (CPI)", why: "Primaire efficiencymetric.", direction: "lower_better", available: false, checkInAds: "Ads Manager → kolommen → Kosten per app-installatie" },
    { metric: "in_app_events", label: "In-app events", why: "Installaties zonder vervolgactiviteit zijn waardeloze installs — de eerste in-app-event (bijv. registratie, aankoop) is de echte kwaliteitsmaat.", direction: "higher_better", available: false, checkInAds: "Events Manager → App-events per campagne" },
    { metric: "app_roas", label: "App-ROAS", why: "Voor e-commerce-apps de uiteindelijke maatstaf, gemeten via een Mobile Measurement Partner (SDK), niet via de generieke web-roas-kolom.", direction: "higher_better", available: false, checkInAds: "MMP-dashboard (Adjust/AppsFlyer) of Ads Manager → App-ROAS" },
  ],
  OUTCOME_SALES: [
    { metric: "roas", label: "ROAS", why: "Primaire rendementsmetric.", direction: "higher_better", available: true },
    { metric: "purchase_roas", label: "Purchase ROAS", why: "Meta's eigen aankoop-specifieke ROAS naast de generieke roas-kolom — bij afwijking is dat het signaal om te checken welke actie-typen worden meegeteld (zie masterplan 14.2, omni_purchase-kanttekening).", direction: "higher_better", available: true },
    { metric: "cpa", label: "Kosten per aankoop", why: "Vergelijk met gemiddelde orderwaarde voor winstgevendheid per aankoop.", direction: "lower_better", available: true },
    { metric: "conversion_value", label: "Conversiewaarde", why: "Absolute omzet, los van efficiency — belangrijk om te zien of ROAS-verbetering gepaard gaat met krimpend volume.", direction: "higher_better", available: true },
    { metric: "conversions", label: "Aantal conversies", why: "Volume naast waarde — een hoge gemiddelde orderwaarde kan een laag aantal conversies maskeren.", direction: "higher_better", available: true },
    { metric: "add_to_cart", label: "Toegevoegd aan winkelwagen", why: "Eerste funnelstap na de klik. Hoog volume hier met weinig checkouts wijst op een prijs- of vertrouwensprobleem, niet op targeting.", direction: "higher_better", available: true },
    { metric: "initiate_checkout", label: "Checkout gestart", why: "Tweede funnelstap. Groot verschil met add_to_cart of met conversions wijst op frictie in het checkout-proces zelf.", direction: "range", available: true },
    { metric: "ctr_link", label: "CTR (secundair)", why: "Relevantie-check los van de kooptrechter — lage CTR bij hoge ROAS betekent dat een klein, zeer gekwalificeerd publiek wordt bereikt.", direction: "higher_better", available: true },
  ],
};

/** Shorthand: de belangrijkste, daadwerkelijk beschikbare focusgebieden voor een objective */
export function getObjectiveFocus(objective: MetaObjective): string {
  return OBJECTIVE_EVAL_CRITERIA[objective]
    .filter((c) => c.available)
    .slice(0, 4)
    .map((c) => c.label)
    .join(", ");
}

// ── Objective-resolutie ─────────────────────────────────────────────────────

/**
 * Objective-waarden van vóór de ODAX-migratie (februari 2022). Meta heeft bestaande
 * campagnes destijds zelf omgezet, maar oude, nooit-meer-bewerkte campagnes op
 * langlopende accounts kunnen in theorie nog de oude waarde tonen. Val terug op het
 * ODAX-equivalent zodat zulke campagnes niet in een lege "onbekend"-bucket vallen.
 */
const LEGACY_OBJECTIVE_MAP: Record<string, MetaObjective> = {
  BRAND_AWARENESS: "OUTCOME_AWARENESS",
  REACH: "OUTCOME_AWARENESS",
  LINK_CLICKS: "OUTCOME_TRAFFIC",
  POST_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  PAGE_LIKES: "OUTCOME_ENGAGEMENT",
  EVENT_RESPONSES: "OUTCOME_ENGAGEMENT",
  VIDEO_VIEWS: "OUTCOME_ENGAGEMENT",
  MESSAGES: "OUTCOME_ENGAGEMENT",
  LEAD_GENERATION: "OUTCOME_LEADS",
  APP_INSTALLS: "OUTCOME_APP_PROMOTION",
  CONVERSIONS: "OUTCOME_SALES",
  PRODUCT_CATALOG_SALES: "OUTCOME_SALES",
  STORE_VISITS: "OUTCOME_SALES",
};

/** Zet een ruwe API/DB-waarde om naar een bekend ODAX-objective, of null als onherkenbaar. */
function resolveMetaObjective(raw: string | null | undefined): MetaObjective | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper in OBJECTIVE_LABELS) return upper as MetaObjective;
  return LEGACY_OBJECTIVE_MAP[upper] ?? null;
}

/**
 * Bepaal het objective van een campagne. Gebruikt in de eerste plaats het echte
 * `objective`-veld uit meta_campaigns (of legacy-equivalent) — dat is er bijna altijd,
 * want het is verplicht bij het aanmaken van elke campagne. Campagnenaam is alleen een
 * terugval voor het zeldzame geval dat het veld ontbreekt of onherkenbaar is (bijv.
 * incomplete sync); dit is bewust het omgekeerde van Google Ads, waar naamdetectie de
 * hoofdroute moet zijn omdat er geen equivalent apiveld bestaat.
 */
export function detectMetaObjective(
  rawObjective: string | null | undefined,
  campaignName?: string | null,
): MetaObjective | null {
  const resolved = resolveMetaObjective(rawObjective);
  if (resolved) return resolved;
  if (!campaignName) return null;

  const lower = campaignName.toLowerCase();
  if (lower.includes("awareness") || lower.includes("bekendheid")) return "OUTCOME_AWARENESS";
  if (lower.includes("traffic") || lower.includes("verkeer")) return "OUTCOME_TRAFFIC";
  if (lower.includes("engagement") || lower.includes("interactie")) return "OUTCOME_ENGAGEMENT";
  if (lower.includes("lead")) return "OUTCOME_LEADS";
  if (lower.includes("app") || lower.includes("install")) return "OUTCOME_APP_PROMOTION";
  if (lower.includes("sales") || lower.includes("verkoop") || lower.includes("conversie")) return "OUTCOME_SALES";
  return null;
}

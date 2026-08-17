/**
 * LinkedIn objective-taxonomie en evaluatiecriteria per objective.
 *
 * Zelfde rol als lib/meta/campaign-types.ts, maar weer een eigen vorm — niet
 * gekopieerd van Meta of Google:
 *
 * - LinkedIn kent, net als Meta en anders dan Google Ads, een verplicht
 *   `objectiveType`-veld per campagne. Ook dat wordt al opgehaald en opgeslagen
 *   (linkedin_campaigns.objective_type, scripts/migrations/008_linkedin.sql:61,
 *   doorgezet in lib/linkedin/entities.ts:106 en lib/linkedin/analysis-data.ts:103)
 *   maar nergens in de analyselaag gebruikt (masterplan 14.1/16.3) — objective-
 *   detectie op naam is hier dus, net als bij Meta, de uitzondering voor het
 *   zeldzame geval dat het veld ontbreekt, niet de hoofdroute.
 * - LinkedIn's zeven objectives zijn geen ODAX-equivalent van Meta's zes — een
 *   eigen indeling met een eigen zwak punt in de huidige data: Job Applicants
 *   heeft in dit schema geen enkele gedekte metric (zie onder), waar dat bij
 *   Meta's App Promotion ook zo is maar om een andere reden (geen MMP-koppeling
 *   vs. hier: geen job-board-specifieke kolom in linkedin_campaign_daily).
 *
 * Bron: learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/
 * account-structure/create-and-manage-campaigns (objectiveType-enum en de
 * "Optimization based on ObjectiveType"-tabel), geraadpleegd 17 augustus 2026.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** De zeven actuele objectiveType-waarden uit LinkedIn's Campaign Manager API. */
export type LinkedInObjective =
  | "BRAND_AWARENESS"
  | "ENGAGEMENT"
  | "JOB_APPLICANTS"
  | "LEAD_GENERATION"
  | "WEBSITE_CONVERSIONS"
  | "WEBSITE_VISITS"
  | "VIDEO_VIEWS";

export const OBJECTIVE_LABELS: Record<LinkedInObjective, string> = {
  BRAND_AWARENESS: "Merkbekendheid",
  ENGAGEMENT: "Interactie",
  JOB_APPLICANTS: "Sollicitanten",
  LEAD_GENERATION: "Leadgeneratie",
  WEBSITE_CONVERSIONS: "Websiteconversies",
  WEBSITE_VISITS: "Websitebezoek",
  VIDEO_VIEWS: "Video-views",
};

/** Whether a campaign with this objective is suitable for budget scaling */
export function isScalable(objective: LinkedInObjective): boolean {
  return objective === "WEBSITE_CONVERSIONS" || objective === "LEAD_GENERATION" || objective === "WEBSITE_VISITS";
}

// ── Evaluatiecriteria per objective ─────────────────────────────────────────

export interface EvalCriterion {
  metric: string;
  label: string;
  /** Waarom dit ertoe doet bij dit objective */
  why: string;
  direction: "higher_better" | "lower_better" | "range";
  /** Kunnen we dit berekenen uit linkedin_campaign_daily/linkedin_account_daily? */
  available: boolean;
  /** Waar dit handmatig te checken is in LinkedIn Campaign Manager, als het niet in de data zit */
  checkInAds?: string;
}

/**
 * Beschikbaarheid getoetst tegen linkedin_campaign_daily
 * (scripts/migrations/008_linkedin.sql:132-165). Job Applicants heeft daarin geen
 * eigen kolom — LinkedIn's job-board-metrics komen niet door de standaard
 * Analytics-API mee, dus dat objective staat hieronder eerlijk met vier
 * "available: false"-criteria in plaats van gepadde alternatieven.
 */
export const OBJECTIVE_EVAL_CRITERIA: Record<LinkedInObjective, EvalCriterion[]> = {
  BRAND_AWARENESS: [
    { metric: "cpm", label: "CPM", why: "Primaire efficiencymetric: kosten per 1000 vertoningen.", direction: "lower_better", available: true },
    { metric: "impressions", label: "Vertoningen", why: "Volumemetric. Vlakke groei bij gelijk budget wijst op een uitgeputte doelgroep — LinkedIn's zakelijke doelgroepen zijn kleiner dan op consumentenkanalen.", direction: "higher_better", available: true },
    { metric: "ctr", label: "CTR (secundair)", why: "Niet de hoofdmetric bij bekendheid, maar een onverwacht hoge CTR duidt op vraag die de campagne niet opvangt.", direction: "higher_better", available: true },
    { metric: "total_engagements", label: "Totale interacties", why: "Reacties, comments, shares samen — een indirecte maar reële indicator dat de boodschap iets losmaakt.", direction: "higher_better", available: true },
    { metric: "video_completion_rate", label: "Video-voltooiing (indien video)", why: "Bij video-creatives de completion-metric die aangeeft of de boodschap wordt afgemaakt.", direction: "higher_better", available: true },
    { metric: "frequency", label: "Frequentie", why: "LinkedIn's zakelijke doelgroepen zijn klein; te hoge frequentie is hier sneller een risico dan op Meta.", direction: "range", available: false, checkInAds: "Campaign Manager → Prestaties → Frequentie (indien getoond per format)" },
  ],
  ENGAGEMENT: [
    { metric: "total_engagements", label: "Totale interacties", why: "Primaire volumemetric: reacties, comments, shares, follows samen.", direction: "higher_better", available: true },
    { metric: "reactions", label: "Reacties", why: "Deelmetric van total_engagements — laat zien welk deel actieve waardering is.", direction: "higher_better", available: true },
    { metric: "comments", label: "Reacties/comments", why: "Zwaarste vorm van interactie; comments wegen zwaarder dan een like voor organisch bereik van het bedrijfsprofiel.", direction: "higher_better", available: true },
    { metric: "shares", label: "Shares", why: "Enige interactievorm die het bereik daadwerkelijk buiten de betaalde doelgroep vergroot.", direction: "higher_better", available: true },
    { metric: "follows", label: "Nieuwe volgers", why: "Langetermijnwaarde: een gevolgde bedrijfspagina bereikt daarna ook organisch.", direction: "higher_better", available: true },
    { metric: "cost_per_engagement", label: "Kosten per interactie", why: "Afgeleide efficiencymetric (spend/total_engagements) — vergelijkbaar tussen creatives en periodes.", direction: "lower_better", available: true },
  ],
  JOB_APPLICANTS: [
    { metric: "job_applicants", label: "Aantal sollicitanten", why: "Primaire volumemetric voor werving-campagnes.", direction: "higher_better", available: false, checkInAds: "Campaign Manager → kolommen → Job Applicants (job-board-metric, niet in standaard Analytics-API)" },
    { metric: "cost_per_applicant", label: "Kosten per sollicitant", why: "Primaire efficiencymetric.", direction: "lower_better", available: false, checkInAds: "Campaign Manager → kolommen → Kosten per sollicitant" },
    { metric: "clicks", label: "Clicks naar vacature (indicatief)", why: "Ruwe kliks als enige beschikbare proxy zolang job-board-metrics niet gesynchroniseerd worden — geen vervanging, wel de enige data die er al is.", direction: "higher_better", available: true },
    { metric: "ctr", label: "CTR (indicatief)", why: "Relevantie van de vacature-advertentie voor wie hem ziet, als proxy zolang job-board-data ontbreekt.", direction: "higher_better", available: true },
  ],
  LEAD_GENERATION: [
    { metric: "one_click_leads", label: "One-click leads", why: "Primaire volumemetric voor LinkedIn's eigen Lead Gen Forms (vooraf ingevuld met profielgegevens).", direction: "higher_better", available: true },
    { metric: "cpl", label: "Kosten per lead", why: "Primaire efficiencymetric.", direction: "lower_better", available: true },
    { metric: "one_click_lead_form_opens", label: "Formulier geopend vs. leads", why: "Groot verschil tussen opens en leads wijst op een te lang formulier of een onaantrekkelijk aanbod, niet op targeting.", direction: "range", available: true },
    { metric: "form_completion_rate", label: "Formulier-voltooiingspercentage", why: "Directe frictie-metric voor het formulier zelf.", direction: "higher_better", available: true },
    { metric: "lead_quality", label: "Leadkwaliteit (CRM-gematcht)", why: "Een one-click lead is een formulierinzending, geen gekwalificeerde deal. Zonder CRM-koppeling is volume een schijnresultaat — zelfde kanttekening als bij Meta's Leads-objective.", direction: "higher_better", available: false, checkInAds: "Vergelijk leadexport met CRM-uitkomst per lead" },
  ],
  WEBSITE_CONVERSIONS: [
    { metric: "external_website_conversions", label: "Websiteconversies (totaal)", why: "Primaire volumemetric. Dit is het totaal (click + view-through) — niet los optellen bij post_click_conversions, dat is een subset, geen aanvulling (geverifieerd tegen LinkedIn's docs, masterplan 14.2).", direction: "higher_better", available: true },
    { metric: "conversion_value", label: "Conversiewaarde", why: "Absolute waarde naast volume — nodig om te zien of volumegroei gepaard gaat met lagere waarde per conversie.", direction: "higher_better", available: true },
    { metric: "post_click_conversions", label: "Post-click conversies (subset)", why: "Alleen ter controle van de click-attributiemix binnen het totaal, niet als aparte KPI naast external_website_conversions.", direction: "higher_better", available: true },
    { metric: "cost_per_conversion", label: "Kosten per conversie", why: "Afgeleide efficiencymetric (spend/external_website_conversions).", direction: "lower_better", available: true },
    { metric: "landing_page_clicks", label: "Paginakliks vs. conversies", why: "Groot verschil tussen kliks en conversies wijst op een landingspagina- of trackingprobleem.", direction: "range", available: true },
  ],
  WEBSITE_VISITS: [
    { metric: "landing_page_clicks", label: "Paginakliks", why: "Primaire volumemetric: daadwerkelijk geladen bestemmingspagina's, niet alleen kliks op de advertentie.", direction: "higher_better", available: true },
    { metric: "cpc", label: "CPC", why: "Primaire efficiencymetric.", direction: "lower_better", available: true },
    { metric: "ctr", label: "CTR", why: "Relevantie-indicator van advertentie voor doelgroep.", direction: "higher_better", available: true },
    { metric: "clicks", label: "Kliks vs. paginakliks", why: "Verschil tussen totale kliks en landing_page_clicks is drop-off tussen advertentieklik en geladen pagina.", direction: "range", available: true },
    { metric: "cpm", label: "CPM (secundair)", why: "Stijgende CPM bij gelijke CPC/CTR wijst op duurdere plaatsingen, niet op een targetingprobleem.", direction: "lower_better", available: true },
  ],
  VIDEO_VIEWS: [
    { metric: "video_views", label: "Video-views", why: "Primaire volumemetric.", direction: "higher_better", available: true },
    { metric: "video_completion_rate", label: "Voltooiingspercentage", why: "Primaire kwaliteitsmetric: houdt de video vast tot het einde.", direction: "higher_better", available: true },
    { metric: "video_completions", label: "Volledige weergaven", why: "Absoluut volume naast het percentage — nodig om te zien of een hoog percentage niet gewoon een klein bereik maskeert.", direction: "higher_better", available: true },
    { metric: "cost_per_view", label: "Kosten per view", why: "Afgeleide efficiencymetric (spend/video_views).", direction: "lower_better", available: true },
    { metric: "video_starts_dropoff", label: "Starts vs. views", why: "Groot verschil tussen video_starts en video_views wijst op afhaken in de eerste seconden — vergelijkbaar met Meta's hook_rate, hier alleen niet als apart percentage opgeslagen.", direction: "range", available: true },
  ],
};

/** Shorthand: de belangrijkste, daadwerkelijk beschikbare focusgebieden voor een objective */
export function getObjectiveFocus(objective: LinkedInObjective): string {
  return OBJECTIVE_EVAL_CRITERIA[objective]
    .filter((c) => c.available)
    .slice(0, 4)
    .map((c) => c.label)
    .join(", ");
}

// ── Objective-resolutie ─────────────────────────────────────────────────────

/** Zet een ruwe API/DB-waarde om naar een bekend objectiveType, of null als onherkenbaar. */
function resolveLinkedInObjective(raw: string | null | undefined): LinkedInObjective | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return upper in OBJECTIVE_LABELS ? (upper as LinkedInObjective) : null;
}

/**
 * Bepaal het objective van een campagne. Gebruikt in de eerste plaats het echte
 * `objective_type`-veld uit linkedin_campaigns — dat is er bijna altijd, want het is
 * verplicht bij het aanmaken van elke campagne. Campagnenaam is alleen een terugval
 * voor het zeldzame geval dat het veld ontbreekt (bijv. incomplete sync).
 */
export function detectLinkedInObjective(
  rawObjective: string | null | undefined,
  campaignName?: string | null,
): LinkedInObjective | null {
  const resolved = resolveLinkedInObjective(rawObjective);
  if (resolved) return resolved;
  if (!campaignName) return null;

  const lower = campaignName.toLowerCase();
  if (lower.includes("awareness") || lower.includes("bekendheid")) return "BRAND_AWARENESS";
  if (lower.includes("engagement") || lower.includes("interactie")) return "ENGAGEMENT";
  if (lower.includes("job") || lower.includes("vacature") || lower.includes("sollicit")) return "JOB_APPLICANTS";
  if (lower.includes("lead")) return "LEAD_GENERATION";
  if (lower.includes("conversion") || lower.includes("conversie")) return "WEBSITE_CONVERSIONS";
  if (lower.includes("visit") || lower.includes("traffic") || lower.includes("verkeer")) return "WEBSITE_VISITS";
  if (lower.includes("video")) return "VIDEO_VIEWS";
  return null;
}

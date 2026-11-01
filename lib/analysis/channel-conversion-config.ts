// Conversie-selectie per kanaal — het Meta/LinkedIn-equivalent van Google's keuze welke
// conversie-acties meetellen. Meta's sync mapt de ruwe action_types al naar vaste
// uitkomst-velden (conversions = aankopen, leads), en LinkedIn levert leads, website-conversies
// en post-click-conversies als aparte kolommen. "Welke conversies tellen mee" is hier dus:
// welke van die velden je optelt tot de conversie die de KPI's, forecasts en views gebruiken.
//
// Eén centrale bron voor elke leesplek die de *_daily-tabellen leest: die tellen via
// sumSelectedConversions met de selectie van de klant, en dag -> maand loopt via
// kanaalMaandenUitDagen (channel-report-blend.ts). Puur, geen IO, los getest.
//
// Wat NIET via deze selectie loopt: fact_core en blended_account_monthly. Die vult de
// SQL-projectie (refresh_fact_from_legacy, migratie 054/078) met de STANDAARDselectie hieronder,
// wat de klant ook koos. Hier stond eerst dat cross-channel dezelfde selectie toepaste; dat was
// niet waar, en daardoor liepen de KPI-band en het Jaaroverzicht uiteen zodra een klant iets
// anders koos. Lezers van die twee tellen dus de standaard -- voor een bureaubrede vergelijking
// (god view, benchmarks) is dat bewust, voor het dashboard van één klant niet. Verander
// DEFAULT_CHANNEL_CONVERSION_CONFIG alleen samen met die SQL.
//
// Google kent geen velden maar conversieacties; welke meetellen staat in
// client_settings.conversion_actions (dashboardConversionActionIds, onderaan).

export type ChannelConversionChannel = "meta_ads" | "linkedin_ads" | "microsoft_ads";

export interface ChannelConversionSource {
  field: string; // kolomnaam in de *_daily-tabellen van het kanaal
  label: string; // UI-label
  hint?: string; // korte toelichting
}

// De velden die de sync per kanaal daadwerkelijk bewaart (en die dus selecteerbaar zijn).
export const META_CONVERSION_SOURCES: ChannelConversionSource[] = [
  { field: "conversions", label: "Aankopen / conversies", hint: "purchase / omni_purchase / pixel-conversie" },
  { field: "leads", label: "Leads", hint: "lead / omni_lead / pixel-lead" },
];
export const LINKEDIN_CONVERSION_SOURCES: ChannelConversionSource[] = [
  { field: "one_click_leads", label: "Lead-formulieren", hint: "one-click lead-gen-forms" },
  { field: "external_website_conversions", label: "Website-conversies", hint: "conversies op de eigen site" },
  { field: "post_click_conversions", label: "Post-click-conversies", hint: "na een klik toegeschreven" },
];

// Microsoft levert één conversiekolom: de sync (zodra die er is) telt de conversiedoelen al
// samen, zoals Google's ads_*-tabellen dat ook doen. Eén selecteerbaar veld dus -- de dropdown
// heeft daar niets te kiezen, maar de vorm blijft gelijk aan de andere kanalen zodat elke
// leesplek dezelfde route volgt.
export const MICROSOFT_CONVERSION_SOURCES: ChannelConversionSource[] = [
  { field: "conversions", label: "Conversies", hint: "alle conversiedoelen (UET)" },
];

export function conversionSourcesFor(channel: ChannelConversionChannel): ChannelConversionSource[] {
  return channel === "meta_ads" ? META_CONVERSION_SOURCES
    : channel === "linkedin_ads" ? LINKEDIN_CONVERSION_SOURCES
    : MICROSOFT_CONVERSION_SOURCES;
}

// Welke velden per kanaal meetellen. Leeg/ongeldig valt terug op de default van dat kanaal,
// zodat de conversie nooit per ongeluk 0 wordt (dat zou elke CPA/ROAS breken).
export interface ChannelConversionConfig {
  meta_ads: string[];
  linkedin_ads: string[];
  microsoft_ads: string[];
}

export const DEFAULT_CHANNEL_CONVERSION_CONFIG: ChannelConversionConfig = {
  meta_ads: ["conversions", "leads"],
  linkedin_ads: ["one_click_leads", "external_website_conversions"],
  microsoft_ads: ["conversions"],
};

function validFields(selected: unknown, channel: ChannelConversionChannel): string[] {
  const allowed = new Set(conversionSourcesFor(channel).map((s) => s.field));
  const list = Array.isArray(selected) ? selected.filter((f): f is string => typeof f === "string" && allowed.has(f)) : [];
  const deduped = [...new Set(list)];
  return deduped.length > 0 ? deduped : DEFAULT_CHANNEL_CONVERSION_CONFIG[channel];
}

// Normaliseer een (deels) opgeslagen config naar een volledige, geldige config.
export function resolveChannelConversionConfig(stored: Partial<Record<ChannelConversionChannel, unknown>> | null | undefined): ChannelConversionConfig {
  return {
    meta_ads: validFields(stored?.meta_ads, "meta_ads"),
    linkedin_ads: validFields(stored?.linkedin_ads, "linkedin_ads"),
    microsoft_ads: validFields(stored?.microsoft_ads, "microsoft_ads"),
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));

// Tel de geselecteerde conversievelden uit één dag/rij op — de conversie die telt.
export function sumSelectedConversions(row: Record<string, unknown>, channel: ChannelConversionChannel, config: ChannelConversionConfig): number {
  const fields = config[channel];
  let sum = 0;
  for (const f of fields) sum += num(row[f]);
  return sum;
}

// De labels van de geselecteerde velden, voor een eerlijke bijschrift in de UI ("telt: Leads").
export function selectedConversionLabels(channel: ChannelConversionChannel, config: ChannelConversionConfig): string[] {
  const byField = new Map(conversionSourcesFor(channel).map((s) => [s.field, s.label]));
  return config[channel].map((f) => byField.get(f) ?? f);
}

// ── Google: welke conversieacties tellen mee ────────────────────────────────
//
// De sync (orchestrator) las de selectie uit client_settings.conversion_actions, de browser uit
// een localStorage-kopie die pas gevuld wordt nadat het dashboard geladen is (volgens de
// mountvolgorde vraagt een nieuwe browser de eerste keer dus ongefilterd). Eén lezing van de
// opgeslagen lijst, zodat beide paden hetzelfde filter kunnen maken.

/**
 * De ids van de conversieacties met includedInDashboard, uit client_settings.conversion_actions.
 * `undefined` betekent "niet filteren": geen lijst, een ongeldige lijst, of geen enkele actie
 * aangevinkt (zo deed de sync het al -- alles uitvinken gaf nooit nul conversies). Een actie
 * zonder bruikbaar id telt niet mee: "undefined" als id zou de Google-query stil leeg maken.
 */
export function dashboardConversionActionIds(actions: unknown): string[] | undefined {
  if (!Array.isArray(actions)) return undefined;
  const ids: string[] = [];
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const { id, includedInDashboard } = a as { id?: unknown; includedInDashboard?: unknown };
    if (!includedInDashboard) continue;
    const tekst = typeof id === "string" ? id.trim() : typeof id === "number" && Number.isFinite(id) ? String(id) : "";
    if (tekst !== "" && !ids.includes(tekst)) ids.push(tekst);
  }
  return ids.length > 0 ? ids : undefined;
}

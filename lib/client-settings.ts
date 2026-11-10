/**
 * Client-level settings: conversion action toggles + KPI targets
 * Persisted in Supabase so all users share the same settings.
 * Falls back to localStorage if Supabase is not configured.
 */

import { supabase } from "./supabase";
import type { GoogleAdsConversionAction } from "./api/google-ads";
import { dbUpsert } from "./data-access/client-write";
import { dbSelectOne } from "./data-access/client-read";

// --- Conversion actions ---

export interface ConversionAction {
  id: string;
  name: string;
  category: "primary" | "secondary";
  activeInAds: boolean;
  includedInDashboard: boolean;
}

export function toDashboardConversionCategory(primaryForGoal: boolean): "primary" | "secondary" {
  return primaryForGoal ? "primary" : "secondary";
}

export function mergeConversionActionsWithLiveStatus(
  storedActions: ConversionAction[],
  liveActions: GoogleAdsConversionAction[],
): ConversionAction[] {
  if (liveActions.length === 0) return storedActions;

  return liveActions
    .filter((action) => action.status !== "REMOVED")
    .map((action) => {
      const existing = storedActions.find((stored) => stored.id === action.id || stored.name === action.name);
      return {
        id: action.id,
        name: action.name,
        category: toDashboardConversionCategory(action.primaryForGoal),
        activeInAds: action.status === "ENABLED" || action.status === "HIDDEN",
        includedInDashboard: existing?.includedInDashboard ?? true,
      };
    });
}

// --- KPI Targets ---

export type KpiMode = "growth" | "absolute";

export interface KpiTargets {
  conversionsMode: KpiMode;
  conversionsGrowthPct: number;
  conversionsAbsolute: number;
  revenueMode: KpiMode;
  revenueGrowthPct: number;
  revenueAbsolute: number;
  roasTarget: number;
  cpaTarget: number;
  /** Manual conversion overrides for months with broken tracking. Key = "YYYY-MM", value = estimated conversions */
  conversionOverrides?: Record<string, number>;
}

// --- Combined settings ---

export interface ClientSettings {
  clientId: string;
  conversionActions: ConversionAction[];
  kpiTargets: KpiTargets;
  sector?: string | null;
  aovSegment?: string | null;
  /**
   * b2b of b2c. Apart van `sector`, want dat veld gooide model en niche op één hoop -- zie de
   * kop van lib/benchmark/segment.ts. Leeg = onbekend, en dat is bewust: er is geen "beide".
   */
  bedrijfsmodel?: string | null;
  /** De niche, genormaliseerd. Vaste lijst plus vrije invoer; zie lib/benchmark/segment.ts. */
  niche?: string | null;
  /** Number of days conversions typically lag behind clicks. Default: 3. */
  conversionLagDays: number;
  /** Active countries for multi-country clients. Null = auto-detect. E.g. ["NL", "DE", "FR"] */
  activeCountries?: string[] | null;
  merchantAccountId?: string | null;
  merchantFeedLabel?: string | null;
  merchantContentLanguage?: string | null;
  merchantChannel?: string | null;
  /**
   * Of `kpiTargets` echt opgeslagen is: een rij met kpi_targets in de database, of een opslag via
   * saveClientSettings. False: `kpiTargets` is DEFAULT_KPI_TARGETS, en die groei van 10 is het
   * standaarddoel en geen ingevoerd doel. Zonder deze vlag waren die twee niet uit elkaar te halen,
   * en zei elk scherm "geschat" (ook naast een ingevoerd doel) of zou het "jaardoel (vorig jaar
   * +10%)" zeggen waar niemand iets had ingevoerd. Lees hem via kpiDoelenIngevoerd: een vermelding in
   * localStorage van vóór dit veld heeft hem niet.
   */
  kpiDoelenOpgeslagen?: boolean;
}

// --- Default KPI targets ---

// Groei 10, gelijk aan het standaarddoel van de routes ("vorig jaar +10%", standaardJaardoel in
// lib/analysis/standaard-jaardoel.ts), zodat Instellingen zonder opgeslagen doel hetzelfde toont als
// het dashboard. Dat dit niet meer dubbel telt, regelt mergeKpiTargets: het percentage werkt op
// vorig jaar, niet op het doel dat al +10% is. Eerder gaf deze 10 daar bovenop vorig jaar x 1,21,
// terwijl het scherm "vorig jaar +10%" zei. Op 0 zetten loste dat ook op, maar dan stond de
// doelkaart in Instellingen op "uit" terwijl het dashboard wel een doel van +10% toonde.
const DEFAULT_KPI_TARGETS: KpiTargets = {
  conversionsMode: "growth",
  conversionsGrowthPct: 10,
  conversionsAbsolute: 0,
  revenueMode: "growth",
  revenueGrowthPct: 10,
  revenueAbsolute: 0,
  roasTarget: 0,
  cpaTarget: 0,
};

const FALLBACK_CONVERSION_ACTIONS: ConversionAction[] = [];

// --- localStorage keys (for migration + fallback) ---

const STORAGE_KEY_PREFIX = "rm-dashboard-settings-";

// --- In-memory cache to avoid async issues with synchronous consumers ---

const settingsCache = new Map<string, ClientSettings>();

/**
 * Of er voor deze klant al instellingen bekend zijn zonder de database: in het geheugen (een
 * eerdere loadClientSettings of saveClientSettings) of in de localStorage van een eerder bezoek.
 * Zonder is getClientSettings de standaard, en dat is bij een opgeslagen doel een ander getal dan
 * Instellingen zegt (ClientDataProvider wacht dan op het eerste lezen).
 */
export function heeftGecachteInstellingen(clientId: string): boolean {
  if (settingsCache.has(clientId)) return true;
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY_PREFIX + clientId) != null;
  } catch {
    return false;
  }
}

/**
 * Get client settings (synchronous — reads from cache).
 * Call loadClientSettings() first to populate the cache from Supabase.
 */
export function getClientSettings(clientId: string): ClientSettings {
  const cached = settingsCache.get(clientId);
  if (cached) return cached;

  // Try localStorage as fallback (existing data or Supabase not loaded yet)
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PREFIX + clientId);
      if (stored) {
        const parsed = JSON.parse(stored);
        settingsCache.set(clientId, parsed);
        return parsed;
      }
    } catch { /* ignore */ }
  }

  return {
    clientId,
    conversionActions: FALLBACK_CONVERSION_ACTIONS,
    kpiTargets: DEFAULT_KPI_TARGETS,
    conversionLagDays: 3,
    merchantAccountId: null,
    merchantFeedLabel: null,
    merchantContentLanguage: null,
    merchantChannel: null,
    kpiDoelenOpgeslagen: false,
  };
}

/**
 * Of de KPI-doelen van deze instellingen echt zijn ingevoerd, en niet de standaard zijn die
 * getClientSettings zonder opgeslagen doel teruggeeft. mergeKpiTargets zet hiermee de herkomst van
 * het doel (ClientHistoricalData.doelHerkomst), en die bepaalt of een scherm "jaardoel" of "geschat
 * jaardoel" zegt.
 *
 * Een vermelding in localStorage van vóór kpiDoelenOpgeslagen heeft de vlag niet. Wijken haar doelen
 * af van de standaard, dan zijn ze ingevoerd: de standaard kunnen ze niet zijn. Zijn ze gelijk aan de
 * standaard, dan is het niet te zeggen; dan de schatting, tot loadClientSettings de rij heeft gelezen
 * en de vlag zet. Dat getal is in beide gevallen hetzelfde (vorig jaar +10%), alleen het woord
 * verschilt.
 */
export function kpiDoelenIngevoerd(settings: ClientSettings): boolean {
  if (typeof settings.kpiDoelenOpgeslagen === "boolean") return settings.kpiDoelenOpgeslagen;
  const kpi = settings.kpiTargets;
  if (!kpi) return false;
  const velden = Object.keys(DEFAULT_KPI_TARGETS) as (keyof typeof DEFAULT_KPI_TARGETS)[];
  return velden.some((veld) => kpi[veld] !== DEFAULT_KPI_TARGETS[veld])
    || Object.keys(kpi.conversionOverrides ?? {}).length > 0;
}

/**
 * De client_settings-rij zoals GET /api/data/client_settings hem geeft (select *). Behalve de
 * kolommen die loadClientSettings omzet, ook de jsonb-kolommen die andere lezers van het Overzicht
 * nodig hebben: zo volstaat één lezing van de rij voor de huisstijl (brand_guide), de beurzen
 * (rai_events) en de conversieselectie van Meta/LinkedIn/Microsoft (channel_conversion_config).
 * Die drie blijven `unknown`: elke lezer kent zijn eigen vorm en controleert die zelf, zoals hij
 * dat bij zijn losse dbSelectOne ook deed.
 */
export interface ClientSettingsRow {
  conversion_actions?: ConversionAction[] | null;
  kpi_targets?: Partial<KpiTargets> | null;
  sector?: string | null;
  bedrijfsmodel?: string | null;
  niche?: string | null;
  aov_segment?: string | null;
  conversion_lag_days?: number | null;
  active_countries?: string[] | null;
  merchant_account_id?: string | null;
  merchant_feed_label?: string | null;
  merchant_content_language?: string | null;
  merchant_channel?: string | null;
  brand_guide?: unknown;
  rai_events?: unknown;
  channel_conversion_config?: unknown;
  full_branding_enabled?: boolean | null;
}

/** Wat een lezing van de rij oplevert: dezelfde vorm als dbSelectOne, zodat de lezers niet hoeven te veranderen. */
export type ClientSettingsRijUitkomst = { data: ClientSettingsRow | null; error: { message: string } | null };

// --- De rij één keer per klant ---
//
// Bij het laden van het Overzicht lazen VIJF lezers dezelfde rij, met vier verschillende
// select-lijsten: ClientDataProvider en useBlendedClientData (allebei select * via loadClientSettings,
// zonder dedupe), de KPI-band (channel_conversion_config), de huisstijl (brand_guide) en de
// beurs-editie (rai_events); op de wissel naar Meta kwamen er twee bij. Dezelfde 3,4 kB vijf keer,
// en elk verzoek zijn eigen rondreis. settingsCache hierboven hielp daar niet tegen: die wordt pas
// NA het antwoord gevuld, en de provider roept loadClientSettings toch aan.
//
// Nu één ruwe rij per klant: `onderweg` laat gelijktijdige lezers op hetzelfde verzoek wachten, en
// `rijCache` bewaart het antwoord vijf minuten (dezelfde termijn als de Google- en blended cache),
// zodat ook een lezer die later mount (de provider wacht op de Google-route) geen nieuw verzoek
// doet. Vergeten na elke schrijfactie op client_settings (vergeetClientSettingsRij), zodat niemand
// vijf minuten een oude instelling leest.
const RIJ_TTL_MS = 5 * 60 * 1000;
const rijCache = new Map<string, { rij: ClientSettingsRow | null; timestamp: number }>();
const onderweg = new Map<string, Promise<ClientSettingsRijUitkomst>>();
// Per klant een teller die vergeetClientSettingsRij ophoogt. Een lezing die vóór het vergeten vertrok,
// brengt nog de oude rij mee en mag die dan niet meer in de cache zetten (dezelfde constructie als
// in lib/use-blended-client-data.ts).
const rijGeneratie = new Map<string, number>();

/**
 * De ruwe client_settings-rij van deze klant: uit de cache, of één gedeeld verzoek voor iedereen
 * die er tegelijk om vraagt. Null als er geen rij is (een nieuwe klant); dat wordt ook gecachet,
 * want "geen rij" is een geldig antwoord. Een mislukte lezing komt NIET in de cache: na een fout is
 * er niets bekend, en de volgende lezer probeert het opnieuw.
 *
 * Niet achter `if (supabase)`: de lezers die dit vervangt (dbSelectOne) gingen ook zonder
 * browser-Supabase naar /api/data. loadClientSettings houdt zijn eigen poort.
 */
export function loadClientSettingsRij(clientId: string): Promise<ClientSettingsRijUitkomst> {
  const c = rijCache.get(clientId);
  if (c && Date.now() - c.timestamp < RIJ_TTL_MS) return Promise.resolve({ data: c.rij, error: null });
  const lopend = onderweg.get(clientId);
  if (lopend) return lopend;
  const gen = rijGeneratie.get(clientId) ?? 0;
  const verzoek: Promise<ClientSettingsRijUitkomst> = dbSelectOne<ClientSettingsRow>("client_settings", { select: "*", clientId })
    .then((uitkomst) => {
      if (!uitkomst.error && (rijGeneratie.get(clientId) ?? 0) === gen) {
        rijCache.set(clientId, { rij: uitkomst.data, timestamp: Date.now() });
      }
      return uitkomst;
    })
    .finally(() => { if (onderweg.get(clientId) === verzoek) onderweg.delete(clientId); });
  onderweg.set(clientId, verzoek);
  return verzoek;
}

/**
 * Gooi de gecachte rij (en een lopend verzoek) van deze klant weg. Aan te roepen na ELKE
 * schrijfactie op client_settings: saveClientSettings, de conversieselectie, GA4, Search Console,
 * de beurzen en de huisstijl. Ook na een mislukte schrijfactie: een time-out kan ná een geslaagde
 * schrijfactie komen, en dan weet de browser niet meer wat er staat. Een extra lezing is goedkoop;
 * vijf minuten een oude instelling tonen niet.
 */
export function vergeetClientSettingsRij(clientId: string): void {
  rijCache.delete(clientId);
  onderweg.delete(clientId);
  rijGeneratie.set(clientId, (rijGeneratie.get(clientId) ?? 0) + 1);
}

/**
 * Load settings from Supabase into cache (async).
 * Should be called on component mount.
 */
export async function loadClientSettings(clientId: string): Promise<ClientSettings> {
  if (supabase) {
    const { data, error } = await loadClientSettingsRij(clientId);

    if (data) {
      const settings: ClientSettings = {
        clientId,
        conversionActions: data.conversion_actions ?? FALLBACK_CONVERSION_ACTIONS,
        kpiTargets: { ...DEFAULT_KPI_TARGETS, ...(data.kpi_targets ?? {}) },
        sector: data.sector ?? null,
        bedrijfsmodel: data.bedrijfsmodel ?? null,
        niche: data.niche ?? null,
        aovSegment: data.aov_segment ?? null,
        conversionLagDays: data.conversion_lag_days ?? 3,
        activeCountries: data.active_countries ?? null,
        merchantAccountId: data.merchant_account_id ?? null,
        merchantFeedLabel: data.merchant_feed_label ?? null,
        merchantContentLanguage: data.merchant_content_language ?? null,
        merchantChannel: data.merchant_channel ?? null,
        // Een rij kan er zijn om een andere reden (conversieacties, sector) met kpi_targets null.
        // Dan zijn de doelen hierboven de standaard en is er niets ingevoerd. Een leeg object ook.
        kpiDoelenOpgeslagen: data.kpi_targets != null && Object.keys(data.kpi_targets).length > 0,
      };
      settingsCache.set(clientId, settings);

      // Also sync to localStorage for fast reads on next load
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY_PREFIX + clientId, JSON.stringify(settings));
      }

      return settings;
    }

    // Geen rij (een nieuwe klant; 10 van de 70 klanten hebben er geen): de terugval ook in het
    // geheugen zetten. Zonder dat zei heeftGecachteInstellingen na een klantwissel A -> B -> A weer
    // "nee" voor A, en sloot ClientDataProvider het hele dashboard (ook Instellingen) opnieuw achter
    // "Data ophalen..." tot deze lezing terug was, bij elke wissel. Alleen na een geslaagde lezing:
    // na een fout is er niets bekend. Niet naar localStorage: daar hoort wat echt gelezen of
    // opgeslagen is, en kpiDoelenOpgeslagen blijft zo false (de standaard is geen ingevoerd doel).
    if (!error) {
      const terugval = getClientSettings(clientId);
      settingsCache.set(clientId, terugval);
      return terugval;
    }
  }

  // Fall back to localStorage / defaults
  return getClientSettings(clientId);
}

/**
 * Save settings to Supabase (primary) + localStorage (cache).
 */
/**
 * Slaat de instellingen op en geeft de fout van de databaseschrijfactie terug (null = gelukt, of
 * geen database). De Google client-data-route leest de conversieacties uit client_settings: wie
 * daarna de cache ververst, moet deze belofte eerst afwachten, anders leest de nieuwe ophaalronde
 * nog de oude selectie en houdt de cache die vijf minuten vast.
 */
export async function saveClientSettings(settings: ClientSettings): Promise<{ error: string | null }> {
  // Opgeslagen via Instellingen: de doelen zijn ingevoerd, ook als ze gelijk zijn aan de standaard
  // (wie "+10%" ziet staan en opslaat, heeft +10% als doel). De database krijgt kpi_targets hieronder
  // mee, dus het volgende lezen zegt hetzelfde.
  const opgeslagen: ClientSettings = { ...settings, kpiDoelenOpgeslagen: true };

  // Eerst de database, dan pas de cache en localStorage. Die werden hier VÓÓR de schrijfactie gevuld,
  // en na een mislukte opslag toonden dashboard en paneel het niet-opgeslagen doel dan als "jaardoel"
  // tot de volgende lezing, en blijvend als die ook faalde. Mislukt het schrijven, dan blijft wat er
  // stond (de vorige lezing of opslag) en zegt het paneel "niet opgeslagen". Zonder database (lokaal)
  // zijn cache en localStorage de opslag zelf.
  if (supabase) {
    const { error } = await dbUpsert("client_settings", settings.clientId, {
      conversion_actions: settings.conversionActions,
      kpi_targets: settings.kpiTargets,
      sector: settings.sector ?? null,
      bedrijfsmodel: settings.bedrijfsmodel ?? null,
      niche: settings.niche ?? null,
      aov_segment: settings.aovSegment ?? null,
      conversion_lag_days: settings.conversionLagDays ?? 3,
      active_countries: settings.activeCountries ?? null,
      merchant_account_id: settings.merchantAccountId ?? null,
      merchant_feed_label: settings.merchantFeedLabel ?? null,
      merchant_content_language: settings.merchantContentLanguage ?? null,
      merchant_channel: settings.merchantChannel ?? null,
      updated_at: new Date().toISOString(),
    });
    // Vóór de foutcontrole: ook na een mislukte schrijfactie is de gecachte rij niet meer te
    // vertrouwen (zie vergeetClientSettingsRij). De settingsCache hieronder blijft bij een fout wél
    // ongemoeid: die draagt wat echt gelezen of opgeslagen is.
    vergeetClientSettingsRij(settings.clientId);
    if (error) return { error: error.message };
  }
  settingsCache.set(settings.clientId, opgeslagen);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY_PREFIX + settings.clientId, JSON.stringify(opgeslagen));
  }
  return { error: null };
}

export function getDefaultConversionActions(clientId: string): ConversionAction[] {
  return FALLBACK_CONVERSION_ACTIONS;
}

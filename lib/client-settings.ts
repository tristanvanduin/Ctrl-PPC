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
  };
}

/**
 * Load settings from Supabase into cache (async).
 * Should be called on component mount.
 */
interface ClientSettingsRow {
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
}

export async function loadClientSettings(clientId: string): Promise<ClientSettings> {
  if (supabase) {
    const { data } = await dbSelectOne<ClientSettingsRow>("client_settings", { select: "*", clientId });

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
      };
      settingsCache.set(clientId, settings);

      // Also sync to localStorage for fast reads on next load
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY_PREFIX + clientId, JSON.stringify(settings));
      }

      return settings;
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
  // Always update cache + localStorage immediately
  settingsCache.set(settings.clientId, settings);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY_PREFIX + settings.clientId, JSON.stringify(settings));
  }

  // Persist to Supabase
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
    return { error: error?.message ?? null };
  }
  return { error: null };
}

export function getDefaultConversionActions(clientId: string): ConversionAction[] {
  return FALLBACK_CONVERSION_ACTIONS;
}

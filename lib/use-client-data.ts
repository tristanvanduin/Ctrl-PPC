"use client";

import { useState, useEffect } from "react";
import { getAllClients, type Client } from "./clients";
import { type ClientHistoricalData } from "./types";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "./api/adapter";
import { today } from "./reporting-date";

export interface ConversionAction {
  id: string;
  name: string;
  category: string;
  status: "ENABLED" | "REMOVED" | "HIDDEN";
  type: string;
  primaryForGoal: boolean;
}

export interface ImpressionShareData {
  campaignId: string;
  campaignName: string;
  campaignType: string;
  cost: number;
  conversions: number;
  searchImpressionShare: number;
  searchBudgetLostIS: number;
  searchRankLostIS: number;
  dailyBudget: number;
  budgetUtilization: number;
}

export interface AccountStructureData {
  campaigns: {
    id: string;
    name: string;
    type: string;
    biddingStrategy: string;
    purpose: string;
    bucketLabel: string | null;
    adGroupCount: number;
    assetGroupCount: number;
    hasFeed: boolean;
    productGroupCount: number;
    cost30d: number;
    conversions30d: number;
    impressions30d: number;
  }[];
  detectedStrategy: string[];
}

export interface WastefulSearchTermData {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
}

export interface AdGroupBleederData {
  campaignName: string;
  adGroupName: string;
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

export interface ProductBleederData {
  campaignName: string;
  productTitle: string;
  productId: string;
  cost: number;
  conversions: number;
  conversionsValue: number;
  clicks: number;
  impressions: number;
}

export interface ChangeHistoryData {
  changeDateTime: string;
  resourceType: string;
  campaignName: string;
  changeType: string;
  userEmail: string;
}

export interface CountryMonthlyRow {
  countryCode: string;
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  ctr: number;
  avgCpc: number;
  costPerConversion: number;
  conversionRate: number;
  roas: number;
  campaignCount: number;
  spendShare: number;
}

export interface ClientDataState {
  data: ClientHistoricalData | null;
  loading: boolean;
  error: string | null;
  source: "api" | "mock";
  googleAdsCustomerId?: string;
  campaigns?: ApiCampaignRow[];
  campaignsHistorical?: ApiCampaignRow[];
  impressionShare?: ImpressionShareData[];
  conversionActions?: ConversionAction[];
  accountStructure?: AccountStructureData;
  wastefulSearchTerms?: WastefulSearchTermData[];
  adGroupBleeders?: AdGroupBleederData[];
  productBleeders?: ProductBleederData[];
  changeHistory?: ChangeHistoryData[];
  /** Campaign name → dominant country code (from geo data) */
  campaignCountryMap?: Record<string, string>;
  /** Campaign name → all countries with spend share (e.g., { "NL": 0.8, "BE": 0.2 }) */
  campaignCountryShares?: Record<string, Record<string, number>>;
  /** Detected countries sorted by spend */
  detectedCountries?: string[];
  /** Pre-aggregated country-level monthly data from Supabase */
  countryMonthlyData?: CountryMonthlyRow[];
}

interface ApiCampaignRow {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  month: string;
  conversions: number;
  revenue: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
}

// Simple in-memory cache to avoid re-fetching on tab switches
const cache = new Map<string, { data: ClientDataState; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Invalidate cache for a specific client — triggers refetch */
export function invalidateClientCache(clientId: string): void {
  cache.delete(clientId);
  window.dispatchEvent(new CustomEvent("client-data-refresh", { detail: { clientId } }));
}

/**
 * Hook that returns ClientHistoricalData for a given clientId.
 * - If the client is a Google Ads account (id starts with "gads-"), fetches live data from the API.
 * - Otherwise, returns mock data.
 * - Listens for "client-data-refresh" events to refetch after settings changes.
 */
export function useClientData(clientId: string): ClientDataState {
  const [state, setState] = useState<ClientDataState>(() => {
    // Check cache first
    const cached = cache.get(clientId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // All clients use real API data — start loading
    return { data: null, loading: true, error: null, source: "api" };
  });

  // Refetch counter — incremented when settings change to force refetch
  const [refetchCount, setRefetchCount] = useState(0);

  // Listen for refresh events (triggered after saving settings)
  useEffect(() => {
    function onRefresh(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.clientId === clientId) {
        setRefetchCount((c) => c + 1);
      }
    }
    window.addEventListener("client-data-refresh", onRefresh);
    return () => window.removeEventListener("client-data-refresh", onRefresh);
  }, [clientId]);

  useEffect(() => {
    // All clients fetch from the API
    if (!clientId) return;

    // Check cache (skip if this is a forced refresh)
    if (refetchCount === 0) {
      const cached = cache.get(clientId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setState(cached.data);
        return;
      }
    }

    const googleAdsCustomerId = clientId.replace("gads-", "");

    setState({ data: null, loading: true, error: null, source: "api", googleAdsCustomerId });

    // Welke conversieacties meetellen bepaalt de route zelf, uit client_settings. Hier werd eerst
    // een localStorage-kopie meegestuurd, en die is pas gevuld nadat het dashboard één keer geladen
    // is: een eerste bezoek zag andere Google-cijfers dan een tweede. De cache blijft op clientId;
    // na een wijziging in de instellingen ververst invalidateClientCache hem. Dat moet dan wel ná
    // het opslaan in de database gebeuren: de route leest de selectie daar, niet uit de browser.
    fetch(`/api/google-ads/client-data?customerId=${googleAdsCustomerId}`)
      .then((res) => res.json())
      .then((apiData) => {
        if (apiData.error) {
          const result: ClientDataState = {
            data: null, loading: false, error: apiData.error, source: "api", googleAdsCustomerId,
          };
          setState(result);
          return;
        }

        // Convert API data to ClientHistoricalData using the adapter
        const historicalData: ClientHistoricalData = {
          ...buildClientDataFromApi(
            clientId,
            (apiData.historicalYears as YearDataInput[]) ?? [],
            (apiData.currentYearMonthly as ApiMonthlyData[]) ?? [],
            (apiData.currentYearWeekly as ApiWeeklyData[]) ?? [],
            apiData.targetCurrentYear,
            apiData.currentYear ?? Number(today().slice(0, 4)),
            apiData.realizedThroughMonth,
          ),
          // Tot waar de route de data definitief acht. Het venster van de KPI-band eindigt hierop;
          // zonder (een oudere route) volgen de presets de kalender.
          dataStand: apiData.dataStand ?? null,
        };

        const result: ClientDataState = {
          data: historicalData,
          loading: false,
          error: null,
          source: "api",
          googleAdsCustomerId,
          campaigns: apiData.campaigns,
          campaignsHistorical: apiData.campaignsHistorical,
          impressionShare: apiData.impressionShare,
          conversionActions: apiData.conversionActions,
          accountStructure: apiData.accountStructure,
          wastefulSearchTerms: apiData.wastefulSearchTerms,
          adGroupBleeders: apiData.adGroupBleeders,
          productBleeders: apiData.productBleeders,
          changeHistory: apiData.changeHistory,
          campaignCountryMap: apiData.campaignCountryMap,
          campaignCountryShares: apiData.campaignCountryShares,
          detectedCountries: apiData.detectedCountries,
          countryMonthlyData: apiData.countryMonthlyData,
        };

        // Cache the result
        cache.set(clientId, { data: result, timestamp: Date.now() });

        setState(result);
      })
      .catch((err) => {
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Onbekende fout",
          source: "api",
          googleAdsCustomerId,
        });
      });
  }, [clientId, refetchCount]);

  return state;
}

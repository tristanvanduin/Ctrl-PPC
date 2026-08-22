"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { type ClientHistoricalData } from "./types";
import { useClientData, type ClientDataState } from "./use-client-data";
import { loadClientSettings } from "./client-settings";
import { computeForecast, type ClientForecast } from "./forecast";
import { mergeKpiTargets } from "./kpi-target-merge";

const ClientDataContext = createContext<ClientDataState | null>(null);

// De forecast apart, want hij hangt aan dezelfde data maar is duur genoeg om te delen.
// Gemeten: computeForecast kost 0,566 ms, tegen 0,0018 ms voor een trendberekening — een
// factor 311. Twaalf componenten riepen hem aan, waarvan acht zonder useMemo, dus die
// herberekenden hem bij ELKE render. Nu gebeurt dat een keer per klant, en delen de
// componenten de uitkomst.
const ForecastContext = createContext<ClientForecast | null>(null);

/**
 * Provider that fetches client data (API or mock) and makes it
 * available to all dashboard child components via context.
 *
 * Merges user-configured KPI targets into the data so the forecast
 * engine uses the correct targets (not the auto-generated ones).
 */
export function ClientDataProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const clientData = useClientData(clientId);

  // Load settings from Supabase on mount (populates cache for getClientSettings)
  useEffect(() => { loadClientSettings(clientId); }, [clientId]);

  // Merge user's settings targets into the data (gedeelde helper, zie lib/kpi-target-merge.ts --
  // de blended prognosetabel gebruikt dezelfde functie buiten deze context om).
  const enrichedData = useMemo(() => {
    if (!clientData.data) return clientData;
    return { ...clientData, data: mergeKpiTargets(clientId, clientData.data) };
  }, [clientData, clientId]);

  // Eén keer per datawijziging, gedeeld met alle kinderen.
  const forecast = useMemo(
    () => (enrichedData.data ? computeForecast(enrichedData.data) : null),
    [enrichedData.data],
  );

  return (
    <ClientDataContext.Provider value={enrichedData}>
      <ForecastContext.Provider value={forecast}>
        {children}
      </ForecastContext.Provider>
    </ClientDataContext.Provider>
  );
}

/**
 * Hook for child components to get the client's historical data.
 * Returns data with user-configured targets merged in.
 */
export function useClientHistoricalData(clientId: string): ClientHistoricalData {
  const ctx = useContext(ClientDataContext);

  // If we're inside a provider and it has data, use it
  if (ctx?.data) {
    return ctx.data;
  }

  // No fallback — all clients must have real data via the provider
  throw new Error(
    `[ClientDataProvider] Client "${clientId}" has no data. ` +
    `Ensure the component is wrapped in <ClientDataProvider>.`
  );
}

/**
 * Hook to check data loading state
 */
export function useClientDataState(): ClientDataState | null {
  return useContext(ClientDataContext);
}

/**
 * De forecast van de actieve klant, één keer berekend.
 *
 * Componenten die hem eerder zelf uitrekenden kunnen hem hier ophalen. Buiten de provider —
 * of zolang de data nog laadt — is hij null; de aanroeper hoort dat af te vangen in plaats
 * van een lege forecast te tonen alsof er niets is.
 */
export function useForecast(): ClientForecast | null {
  return useContext(ForecastContext);
}

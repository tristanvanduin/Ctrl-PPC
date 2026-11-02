"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type ClientHistoricalData } from "./types";
import { useClientData, type ClientDataState } from "./use-client-data";
import { heeftGecachteInstellingen, loadClientSettings } from "./client-settings";
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
/** Hoe lang de provider op het eerste lezen van de instellingen wacht voordat hij met de standaard rendert. */
export const INSTELLINGEN_WACHT_MS = 3000;

export function ClientDataProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const clientData = useClientData(clientId);

  // De instellingen uit de database (vult de cache van getClientSettings), en daarna opnieuw
  // samenvoegen. Hier werd het verzoek gestart zonder op het antwoord te letten: de samenvoeging
  // hieronder draaide al bij het mounten, op een eerste bezoek (lege localStorage) met de
  // standaarddoelen, en niets voegde daarna nog samen. Het dashboard mount deze provider pas als de
  // data er is, dus bij een klant met alleen Google vertrok dit verzoek altijd na die samenvoeging:
  // het Google-tabblad toonde het routedoel (1.938) terwijl Instellingen 2.600 zei, en "Alle kanalen"
  // (dat wel wacht, lib/use-blended-client-data.ts) wel 2.600. Niet de data tegenhouden tot de
  // instellingen er zijn: useClientHistoricalData gooit zonder data, en de kinderen staan er al.
  // Mislukt het lezen, dan blijft het bij de cache of de standaard, zoals getClientSettings doet.
  //
  // Alleen opnieuw samenvoegen was niet genoeg: de kinderen renderden al met de eerste samenvoeging.
  // Zonder instellingen in de cache (een eerste bezoek: nieuw apparaat, privévenster, gewiste opslag)
  // toonde het Google-tabblad, ook de prognosetegels, de hele duur van het verzoek 1.938 conversies
  // en een kostendoel van € 139.860, en sprong daarna naar 2.600 en € 117.000. Dan wachten de
  // kinderen op het eerste lezen; met een cache meteen. `instellingenVoor` onthoudt voor welke klant
  // het lezen klaar is, zodat een klantwissel niet het antwoord van de vorige klant gebruikt.
  //
  // Wel met een grens. Deze provider omvat elk tabblad, ook Instellingen zelf: een verzoek dat blijft
  // hangen (de browser geeft een fetch zonder antwoord geen eigen time-out) hield anders het hele
  // dashboard op "Data ophalen...". Na INSTELLINGEN_WACHT_MS rendert hij met wat getClientSettings
  // dan heeft (de standaard); komt het antwoord later alsnog, dan voegt instellingenVersie opnieuw samen.
  const [instellingenVersie, setInstellingenVersie] = useState(0);
  const [instellingenVoor, setInstellingenVoor] = useState<string | null>(null);
  useEffect(() => {
    let weg = false;
    const opgegeven = setTimeout(() => { if (!weg) setInstellingenVoor(clientId); }, INSTELLINGEN_WACHT_MS);
    loadClientSettings(clientId)
      .catch(() => null)
      .finally(() => {
        clearTimeout(opgegeven);
        if (weg) return;
        setInstellingenVersie((v) => v + 1);
        setInstellingenVoor(clientId);
      });
    return () => { weg = true; clearTimeout(opgegeven); };
  }, [clientId]);
  const instellingenKlaar = instellingenVoor === clientId || heeftGecachteInstellingen(clientId);

  // Merge user's settings targets into the data (gedeelde helper, zie lib/kpi-target-merge.ts --
  // de blended prognosetabel gebruikt dezelfde functie buiten deze context om). instellingenVersie
  // staat in de deps omdat mergeKpiTargets de instellingen zelf leest (getClientSettings).
  //
  // En instellingenKlaar ook: de poort kan opengaan op een cache die een ANDERE lezer vulde
  // (useBlendedClientData leest de instellingen ook) terwijl het eigen verzoek nog loopt, of op de
  // wachttijd. De samenvoeging was dan al gedaan bij de eerste render, met een lege cache, en de
  // kinderen kregen het routedoel (1.938) terwijl Instellingen en "Alle kanalen" 2.600 zeiden. Op de
  // omslag van dicht naar open voegt hij opnieuw samen, met wat de cache dan heeft.
  const enrichedData = useMemo(() => {
    if (!clientData.data) return clientData;
    return { ...clientData, data: mergeKpiTargets(clientId, clientData.data) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- instellingenVersie en instellingenKlaar: zie hierboven
  }, [clientData, clientId, instellingenVersie, instellingenKlaar]);

  // Eén keer per datawijziging, gedeeld met alle kinderen.
  const forecast = useMemo(
    () => (enrichedData.data ? computeForecast(enrichedData.data) : null),
    [enrichedData.data],
  );

  // Zolang het eerste lezen loopt (en er niets in de cache staat) dezelfde laadregel als het
  // dashboard, in plaats van de kinderen met het standaarddoel. Ze mounten dan nog niet, dus
  // useClientHistoricalData gooit ook niet.
  if (!instellingenKlaar) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-muted-foreground">Data ophalen...</p>
      </div>
    );
  }

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

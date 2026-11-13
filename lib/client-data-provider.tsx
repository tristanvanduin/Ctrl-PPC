"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type ClientHistoricalData } from "./types";
import { useClientData, type ClientDataState } from "./use-client-data";
import { getClientSettings, heeftGecachteInstellingen, kpiDoelenIngevoerd, loadClientSettings } from "./client-settings";
import { computeForecast, type ClientForecast } from "./forecast";
import { mergeKpiTargetsVoorReeks } from "./kpi-target-merge";
import { jaardoelBereik, type JaardoelBereik } from "./doel/jaardoel";
import type { Kanaal } from "./kanalen/beschikbaar";
import { PaginaLaadvlak } from "@/components/ui/laadvlak";

const ClientDataContext = createContext<ClientDataState | null>(null);

// De forecast apart, want hij hangt aan dezelfde data maar is duur genoeg om te delen.
// Gemeten: computeForecast kost 0,566 ms, tegen 0,0018 ms voor een trendberekening — een
// factor 311. Twaalf componenten riepen hem aan, waarvan acht zonder useMemo, dus die
// herberekenden hem bij ELKE render. Nu gebeurt dat een keer per klant, en delen de
// componenten de uitkomst.
const ForecastContext = createContext<ClientForecast | null>(null);

// Over welke kanalen het jaardoel gaat (lib/doel/jaardoel.ts), voor elk blok binnen de provider
// dat een oordeel over het doel geeft: de pacing, het budgetadvies, de prognosetegels.
const JaardoelBereikContext = createContext<JaardoelBereik | null>(null);

/** Het bereik van het jaardoel van de actieve klant; null buiten de provider of zolang onbekend. */
export function useJaardoelBereik(): JaardoelBereik | null {
  return useContext(JaardoelBereikContext);
}

/**
 * Provider that fetches client data (API or mock) and makes it
 * available to all dashboard child components via context.
 *
 * Merges user-configured KPI targets into the data so the forecast
 * engine uses the correct targets (not the auto-generated ones).
 */
/** Hoe lang de provider op het eerste lezen van de instellingen wacht voordat hij met de standaard rendert. */
export const INSTELLINGEN_WACHT_MS = 3000;

export function ClientDataProvider({ clientId, children, wachtvlak, kanalen = null }: {
  clientId: string;
  children: ReactNode;
  /**
   * De kanalen van deze klant, voor de regel over het jaardoel (lib/doel/jaardoel.ts): het doel
   * uit Instellingen geldt voor het account, en komt dus alleen op deze Google-reeks als de klant
   * geen ander kanaal heeft. Onbekend (null): zoals voorheen, het doel op Google.
   */
  kanalen?: readonly Kanaal[] | null;
  /**
   * Wat er staat zolang het eerste lezen van de instellingen loopt; standaard het laadvlak van de
   * hele pagina. Het klantdashboard geeft er een zonder band-deel: daar staat de KPI-band buiten
   * deze provider, en een tweede band-skelet eronder zou verschijnen en weer verdwijnen (CLS).
   */
  wachtvlak?: ReactNode;
}) {
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
  // dashboard achter het laadvlak. Na INSTELLINGEN_WACHT_MS rendert hij met wat getClientSettings
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
  //
  // Het doel komt alleen op deze Google-reeks als het voor Google bedoeld is (lib/doel/jaardoel.ts).
  // Bij een klant met meer kanalen stond hier het accountdoel tegen Google alleen: "Jaardoel in
  // gevaar, -51%" op de Google-tab bij een account dat het doel al in oktober gehaald had.
  const kanalenSleutel = kanalen ? kanalen.join(",") : null;
  // Of er echt een doel is ingevoerd, gaat mee: een kanaaltab zei anders "het jaardoel uit
  // Instellingen" bij een klant zonder doel (oordeelOverTekst).
  const doelIngevoerd = kpiDoelenIngevoerd(getClientSettings(clientId));
  const bereik: JaardoelBereik | null = useMemo(
    () => jaardoelBereik(kanalenSleutel ? (kanalenSleutel.split(",") as Kanaal[]) : null, doelIngevoerd),
    [kanalenSleutel, doelIngevoerd],
  );
  const enrichedData = useMemo(() => {
    if (!clientData.data) return clientData;
    return { ...clientData, data: mergeKpiTargetsVoorReeks(clientId, clientData.data, "google", bereik) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- instellingenVersie en instellingenKlaar: zie hierboven
  }, [clientData, clientId, instellingenVersie, instellingenKlaar, bereik]);

  // Eén keer per datawijziging, gedeeld met alle kinderen.
  const forecast = useMemo(
    () => (enrichedData.data ? computeForecast(enrichedData.data) : null),
    [enrichedData.data],
  );

  // Zolang het eerste lezen loopt (en er niets in de cache staat) dezelfde laadregel als het
  // dashboard, in plaats van de kinderen met het standaarddoel. Ze mounten dan nog niet, dus
  // useClientHistoricalData gooit ook niet.
  if (!instellingenKlaar) {
    return wachtvlak ?? <PaginaLaadvlak />;
  }

  return (
    <ClientDataContext.Provider value={enrichedData}>
      <ForecastContext.Provider value={forecast}>
        <JaardoelBereikContext.Provider value={bereik}>
          {children}
        </JaardoelBereikContext.Provider>
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

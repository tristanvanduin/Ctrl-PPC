"use client";

import { useEffect, useState } from "react";
import { type ClientHistoricalData } from "./types";
import { buildClientDataFromApi, type ApiMonthlyData, type YearDataInput } from "./api/adapter";
import type { BlendedKanaalReeks } from "./api/blended-historical";
import type { DataStandSamen } from "./sync/datastand";
import type { ClientForecast } from "./forecast";
import { blendedForecastUitKanalen, eigenGrenzen } from "./forecast-som";
import { loadClientSettings } from "./client-settings";
import { mergeKpiTargets } from "./kpi-target-merge";

interface BlendedApiResponse {
  currentYear: number;
  realizedThroughMonth: number;
  targetCurrentYear: { conversions: number; revenue: number; adSpend: number };
  historicalYears: YearDataInput[];
  currentYearMonthly: ApiMonthlyData[];
  dataStand?: DataStandSamen | null;
  perKanaal?: BlendedKanaalReeks[];
}

export interface BlendedClientDataState {
  data: ClientHistoricalData | null;
  /** Tot waar de data over alle kanalen samen vol is (zie lib/sync/datastand.ts). */
  dataStand: DataStandSamen | null;
  /** Dezelfde maanden per kanaal, voor een vergelijking die per kanaal paart. */
  perKanaal: BlendedKanaalReeks[] | null;
  /**
   * De jaarprognose over alle kanalen: de SOM van de prognoses per kanaal (lib/forecast-som.ts),
   * niet computeForecast op `data`. Die laatste nam de kanaalmix als groei (de demo: 5.182
   * conversies waar 4.782 hoort, en de ROAS-kaart boven het doel waar hij eronder staat).
   */
  forecast: ClientForecast | null;
  loading: boolean;
  error: string | null;
}

interface Opgehaald {
  data: ClientHistoricalData;
  dataStand: DataStandSamen | null;
  perKanaal: BlendedKanaalReeks[];
  forecast: ClientForecast;
}

// Zelfde soort cache als use-client-data.ts, geen gedeelde entry: andere route, ander schema.
const cache = new Map<string, { waarde: Opgehaald; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Verzoeken die nog onderweg zijn. De KPI-band (client-dashboard) en het tabblad zelf
// (cross-channel-view, de Prognose-tabel) mounten tegelijk en vroegen elk de route op, die per
// aanroep vier tabellen leest plus de stand per kanaal. Een tweede mount wacht nu op hetzelfde
// verzoek in plaats van een eigen te starten.
const onderweg = new Map<string, Promise<Opgehaald>>();

// Per klant een teller die vergeetBlendedClientData ophoogt. Een verzoek dat vóór het vergeten
// vertrok, brengt nog de oude selectie mee en mag die dan niet meer in de cache zetten.
const generatie = new Map<string, number>();

/**
 * Gooi de cache voor deze klant weg. Aan te roepen na het opslaan van de conversieselectie of van de
 * KPI-doelen: het Jaaroverzicht en de Pacing tellen met de opgeslagen selectie, de cache bewaart de
 * data met de doelen al samengevoegd, en zonder dit toonde hij tot vijf minuten na het opslaan nog
 * de oude.
 */
export function vergeetBlendedClientData(clientId: string): void {
  cache.delete(clientId);
  onderweg.delete(clientId);
  generatie.set(clientId, (generatie.get(clientId) ?? 0) + 1);
}

const LEEG: BlendedClientDataState = { data: null, dataStand: null, perKanaal: null, forecast: null, loading: false, error: null };

function uitCache(clientId: string): Opgehaald | null {
  const c = cache.get(clientId);
  return c && Date.now() - c.timestamp < CACHE_TTL ? c.waarde : null;
}

function haal(clientId: string): Promise<Opgehaald> {
  const lopend = onderweg.get(clientId);
  if (lopend) return lopend;
  const gen = generatie.get(clientId) ?? 0;
  // De KPI-doelen worden hieronder samengevoegd en dan vijf minuten gecachet. Wachten op de
  // instellingen: anders hing het doel ervan af wat er eerder binnen was, dit antwoord of
  // loadClientSettings in ClientDataProvider (de demo: 1.938 of 2.600 conversies als doel). Mislukt
  // het lezen, dan de cache of de standaard, zoals getClientSettings dat altijd doet.
  const instellingen = loadClientSettings(clientId).catch(() => null);
  const verzoek: Promise<Opgehaald> = fetch(`/api/blended/client-data?clientId=${encodeURIComponent(clientId)}`)
    .then((res) => res.json())
    .then(async (apiData: BlendedApiResponse & { error?: string }) => {
      if (apiData.error) throw new Error(apiData.error);
      await instellingen;
      const built = buildClientDataFromApi(
        clientId,
        apiData.historicalYears,
        apiData.currentYearMonthly,
        [],
        apiData.targetCurrentYear,
        apiData.currentYear,
        apiData.realizedThroughMonth,
      );
      const data = mergeKpiTargets(clientId, built);
      const perKanaal = apiData.perKanaal ?? [];
      const waarde: Opgehaald = {
        data,
        dataStand: apiData.dataStand ?? null,
        perKanaal,
        // Eén keer per ophaalronde, met de rest gecachet: elke lezer (Jaaroverzicht, beursstrip,
        // grafiek, Prognose-tabel) krijgt hetzelfde object in plaats van zelf te rekenen.
        // Met de uitgesloten bronnen van de route: een kanaal dat stopte, telt na zijn dag als nul,
        // ook in de prognose (en niet op zijn oude tempo). En met de eigen grens per kanaal, uit
        // dezelfde dag die zijn tab krijgt: dan beslissen de som en de tab de stop op dezelfde maand.
        forecast: blendedForecastUitKanalen(clientId, perKanaal, data, apiData.realizedThroughMonth, apiData.dataStand?.uitgesloten ?? [],
          eigenGrenzen(apiData.dataStand?.bronnen, apiData.currentYear)),
      };
      if ((generatie.get(clientId) ?? 0) === gen) cache.set(clientId, { waarde, timestamp: Date.now() });
      return waarde;
    })
    .finally(() => { if (onderweg.get(clientId) === verzoek) onderweg.delete(clientId); });
  onderweg.set(clientId, verzoek);
  return verzoek;
}

/**
 * Blended (Google + Meta + LinkedIn + Microsoft) tegenhanger van useClientData -- voor het
 * Jaaroverzicht, de Prognose-tabel en de Pacing op "Alle kanalen", en voor de datastand van de
 * KPI-band. Zie app/api/blended/client-data/route.ts voor de bron.
 *
 * @param enabled false = niets ophalen (een klant met één kanaal heeft geen blended weergave);
 *   de hook geeft dan een lege, niet-ladende staat terug. Hooks moeten onvoorwaardelijk aangeroepen
 *   worden, dus de aanroeper zet hem uit in plaats van hem over te slaan.
 */
export function useBlendedClientData(clientId: string, enabled = true): BlendedClientDataState {
  // De staat hoort bij één (klant, aan/uit). Wisselt een van beide, dan geldt de opgeslagen staat
  // niet meer, en ook niet voor de ene render vóórdat het effect hieronder draait: na een
  // klantwissel stond daar anders nog de vorige klant, en bij uit -> aan (de kanalen zijn net
  // bekend) een lege staat met loading false -- de KPI-band las dat als "klaar, zonder datastand"
  // en toonde één frame het kalendervenster.
  const sleutel = enabled ? clientId : null;
  const [opgeslagen, setOpgeslagen] = useState<{ sleutel: string | null; staat: BlendedClientDataState }>(
    () => ({ sleutel, staat: beginStaat(clientId, enabled) }),
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = uitCache(clientId);
    if (cached) {
      setOpgeslagen({ sleutel: clientId, staat: { ...cached, loading: false, error: null } });
      return;
    }

    haal(clientId).then(
      (waarde) => { if (!cancelled) setOpgeslagen({ sleutel: clientId, staat: { ...waarde, loading: false, error: null } }); },
      (err: unknown) => {
        if (!cancelled) {
          setOpgeslagen({ sleutel: clientId, staat: { ...LEEG, error: err instanceof Error ? err.message : "Onbekende fout" } });
        }
      },
    );

    return () => { cancelled = true; };
  }, [clientId, enabled]);

  return opgeslagen.sleutel === sleutel ? opgeslagen.staat : beginStaat(clientId, enabled);
}

/** Wat de hook toont voordat er voor deze (klant, aan/uit) iets is opgehaald. */
function beginStaat(clientId: string, enabled: boolean): BlendedClientDataState {
  if (!enabled) return LEEG;
  const cached = uitCache(clientId);
  return cached ? { ...cached, loading: false, error: null } : { ...LEEG, loading: true };
}

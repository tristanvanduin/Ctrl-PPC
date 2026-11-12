"use client";

import { useEffect, useState } from "react";
import { type ClientHistoricalData } from "./types";
import { buildClientDataFromApi, type ApiMonthlyData, type YearDataInput } from "./api/adapter";
import type { BlendedKanaalReeks, ClientTargetRij } from "./api/blended-historical";
import type { DataStandSamen } from "./sync/datastand";
import type { ClientForecast } from "./forecast";
import { blendedForecastUitKanalen, eigenGrenzen } from "./forecast-som";
import { loadClientSettings } from "./client-settings";
import { mergeKpiTargets } from "./kpi-target-merge";
import { buildChannelForecastUitEmmers, tabStandUitRoute } from "./analysis/channel-forecast-data";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore } from "./health-score";
import { CONVERSIE_KANAAL, NIET_GOOGLE, type NietGoogleKanaal } from "./period/kanaal-maanden";
import { today as vandaag } from "./reporting-date";
import { maakZaadbak, type Zaad } from "./overzicht/zaadbak";

export interface BlendedApiResponse {
  currentYear: number;
  realizedThroughMonth: number;
  targetCurrentYear: { conversions: number; revenue: number; adSpend: number };
  historicalYears: YearDataInput[];
  currentYearMonthly: ApiMonthlyData[];
  dataStand?: DataStandSamen | null;
  perKanaal?: BlendedKanaalReeks[];
  /** Sinds fase 1, stap 3; een antwoord van daarvóór heeft hem niet. */
  clientTargets?: ClientTargetRij[];
}

/**
 * Wat een kanaaltab (Meta, LinkedIn, Microsoft) van zijn eigen kanaal nodig heeft: de historie en
 * de prognose zoals buildChannelForecast ze altijd bouwde, plus de Account Health erover. Eén
 * object per kanaal per ophaalronde, zodat de tab, zijn health-badge en de ranking op "Alle
 * kanalen" hetzelfde lezen -- en niet elk een eigen prognose uit een eigen bron.
 */
export interface KanaalTab {
  data: ClientHistoricalData;
  forecast: ClientForecast;
  /** zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)): geen Google-begrippen hier. */
  health: HealthScore;
}

/**
 * Per dagkanaal het tab-object, of "leeg" als de route voor dat kanaal geen emmers meestuurde
 * (geen dagrijen gesynced). Een kanaal dat er helemaal niet in staat, draagt geen data. Google
 * staat er niet in: die leest zijn prognose uit ClientDataProvider (useForecast), zoals altijd.
 */
export type PerKanaalTab = Partial<Record<NietGoogleKanaal, KanaalTab | "leeg">>;

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
  /**
   * De kanaal-gescoopte doelen uit client_targets, zoals de route ze meestuurt (de kanaaltab las
   * ze eerder zelf). De prognose per kanaal eruit staat in `perKanaalTab`.
   */
  clientTargets: ClientTargetRij[] | null;
  /**
   * Het tab-object per dagkanaal (zie KanaalTab), één keer per ophaalronde berekend en met de
   * rest gecachet; null zolang er geladen wordt of de route faalde.
   */
  perKanaalTab: PerKanaalTab | null;
  loading: boolean;
  error: string | null;
}

interface Opgehaald {
  data: ClientHistoricalData;
  dataStand: DataStandSamen | null;
  perKanaal: BlendedKanaalReeks[];
  forecast: ClientForecast;
  clientTargets: ClientTargetRij[];
  perKanaalTab: PerKanaalTab;
}

// Zelfde soort cache als use-client-data.ts, geen gedeelde entry: andere route, ander schema.
const cache = new Map<string, { waarde: Opgehaald; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Verzoeken die nog onderweg zijn. De KPI-band (client-dashboard) en het tabblad zelf
// (cross-channel-view, de Prognose-tabel) mounten tegelijk en vroegen elk de route op, die per
// aanroep vier tabellen leest plus de stand per kanaal. Een tweede mount wacht nu op hetzelfde
// verzoek in plaats van een eigen te starten.
const onderweg = new Map<string, Promise<Opgehaald>>();

// Het antwoord dat de server met de pagina meestuurde (lib/overzicht/zaadbak.ts): de eerste
// ophaalronde van een klant gebruikt dat in plaats van de route op te vragen. Alles NA het antwoord
// (samenvoegen, prognoses, cache, generatie) is dezelfde code als voor een antwoord van de route.
// Het zaad kan ook "geen data" dragen ({ error }, het lichaam van de 404 van de route): dat is een
// antwoord, en geeft in haal() dezelfde foutstaat als de route, zonder haar te vragen.
export type BlendedAntwoord = BlendedApiResponse | { error: string };
const zaadbak = maakZaadbak<BlendedAntwoord>();

/**
 * Leg het antwoord van de server klaar voor de eerste ophaalronde van deze klant. Aan te roepen
 * tijdens het renderen van de klantpagina (client-dashboard.tsx), vóór het effect van de hook: de
 * bak doet niets op de server, niets met een belofte die hij al kende, en niets als er voor deze
 * klant al een antwoord of een verzoek is.
 */
export function zaaiBlendedClientData(clientId: string, belofte: Promise<Zaad<BlendedAntwoord> | null> | null | undefined): void {
  if (uitCache(clientId) || onderweg.has(clientId)) return;
  zaadbak.zaai(clientId, belofte);
}

// Per klant een teller die vergeetBlendedClientData ophoogt. Een verzoek dat vóór het vergeten
// vertrok, brengt nog de oude selectie mee en mag die dan niet meer in de cache zetten.
const generatie = new Map<string, number>();

// Het seintje waarop GEMOUNTE lezers opnieuw ophalen. Zonder dit herlaadde alleen een nieuwe mount
// (de effect-deps hingen aan [clientId, enabled]): na het opslaan van de conversieselectie of een
// sync hielden de band, de ranking en de kanaalprovider de oude ronde vast tot een tabwissel.
const BLENDED_VERGETEN = "blended-client-data-vergeten";

/**
 * De ene vergeet-ingang voor deze klant: de cache, het lopende verzoek en de generatie weg, en een
 * seintje aan elke gemounte lezer om opnieuw op te halen. Aan te roepen na het opslaan van de
 * conversieselectie, de KPI-doelen en de overige client_settings-opslagen, en na een geslaagde
 * sync: het Jaaroverzicht en de Pacing tellen met de opgeslagen selectie, de cache bewaart de data
 * met de doelen al samengevoegd, en zonder dit toonde hij tot vijf minuten na het opslaan nog de
 * oude. De gemounte lezers houden hun VORIGE staat tot het nieuwe antwoord binnen is (geen
 * laadflits): het is dezelfde klant, alleen opnieuw geteld.
 */
export function vergeetBlendedClientData(clientId: string): void {
  cache.delete(clientId);
  onderweg.delete(clientId);
  // Ook het zaad van de server: dat is van vóór het opslaan of de sync.
  zaadbak.vergeet(clientId);
  generatie.set(clientId, (generatie.get(clientId) ?? 0) + 1);
  // Bewaakt: buiten de browser (en in de hook-test met een nep-window) is er geen dispatchEvent.
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(BLENDED_VERGETEN, { detail: { clientId } }));
}

const LEEG: BlendedClientDataState = { data: null, dataStand: null, perKanaal: null, forecast: null, clientTargets: null, perKanaalTab: null, loading: false, error: null };

/**
 * Het tab-object per dagkanaal uit het antwoord van de route: exact de stappen die
 * ChannelDataProvider deed toen hij de dagtabel nog zelf las (buildChannelForecast met het
 * client_targets-doel, de syncdag en de stop uit tabStandUitRoute), nu op de emmers die de route
 * meestuurt, en de health erbij zoals channel-health-badge hem rekende. Eén keer, hier: de badge
 * op de tab en de ranking op "Alle kanalen" lezen daarna hetzelfde object, en "kanaaltab == Alle
 * kanalen" is dan geen belofte van twee lezers maar een eigenschap van één berekening.
 *
 * Een kanaal zonder emmers (geen dagrijen) wordt "leeg", zoals de tab dat al toonde; een kanaal dat
 * niet in perKanaal staat, krijgt geen sleutel.
 */
function perKanaalTabUitAntwoord(
  clientId: string,
  perKanaal: BlendedKanaalReeks[],
  clientTargets: ClientTargetRij[],
  dataStand: DataStandSamen | null,
): PerKanaalTab {
  const targetRows = clientTargets.map((r) => ({
    channel: r.channel, metric: r.metric, targetValue: Number(r.target_value ?? 0),
    validFrom: r.valid_from, validTo: r.valid_to,
  }));
  const uit: PerKanaalTab = {};
  const peildag = vandaag();
  for (const kanaal of NIET_GOOGLE) {
    const reeks = perKanaal.find((k) => k.kanaal === kanaal);
    if (!reeks) continue;
    if (!reeks.emmers) { uit[kanaal] = "leeg"; continue; }
    // Per kanaal een vangnet: gooit de prognose van één kanaal, dan mag dat niet de hele ronde
    // (band, Jaaroverzicht, alle tabs) in de foutstaat zetten. Dat kanaal leest dan als "leeg".
    try {
      const { dataTot, gestopt } = tabStandUitRoute(dataStand, kanaal);
      const gebouwd = buildChannelForecastUitEmmers(clientId, reeks.emmers, targetRows, CONVERSIE_KANAAL[kanaal], peildag, dataTot, { gestopt });
      uit[kanaal] = gebouwd
        ? { ...gebouwd, health: zonderKanaalSpecifiekeHygiene(computeHealthScore(gebouwd.forecast)) }
        : "leeg";
    } catch (e) {
      console.error(`[blended] prognose voor ${kanaal} mislukt`, e);
      uit[kanaal] = "leeg";
    }
  }
  return uit;
}

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
  const vanRoute = (): Promise<BlendedApiResponse & { error?: string }> =>
    fetch(`/api/blended/client-data?clientId=${encodeURIComponent(clientId)}`).then((res) => res.json());
  // Stuurde de server het antwoord al mee, dan dat; anders (of als het zaad niets bruikbaars
  // draagt: geen toegang, een fout op de server) de route, met haar eigen foutmelding. Een zaad dat
  // te lang is blijven liggen geeft de bak niet meer uit (lib/overzicht/zaadbak.ts).
  const zaad = zaadbak.neem(clientId);
  const antwoord: Promise<BlendedApiResponse & { error?: string }> = zaad
    ? zaad.then((a) => (a as (BlendedApiResponse & { error?: string }) | undefined) ?? vanRoute())
    : vanRoute();
  const verzoek: Promise<Opgehaald> = antwoord
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
        clientTargets: apiData.clientTargets ?? [],
        perKanaalTab: perKanaalTabUitAntwoord(clientId, perKanaal, apiData.clientTargets ?? [], apiData.dataStand ?? null),
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

  // Opgehoogd op het seintje van vergeetBlendedClientData voor deze klant. Het effect hieronder
  // draait dan opnieuw; `opgeslagen` wordt NIET geleegd, dus de vorige cijfers blijven staan tot het
  // nieuwe antwoord binnen is -- geen `loading: true`-flits op de band, de ranking en de Prognose-
  // tabel bij elke opslag (vergelijk use-channel-period-data.ts: "de oude cijfers blijven staan").
  const [versie, setVersie] = useState(0);
  useEffect(() => {
    if (typeof window.addEventListener !== "function") return;
    const opVergeten = (e: Event) => {
      if ((e as CustomEvent<{ clientId?: string }>).detail?.clientId === clientId) setVersie((v) => v + 1);
    };
    window.addEventListener(BLENDED_VERGETEN, opVergeten);
    return () => window.removeEventListener(BLENDED_VERGETEN, opVergeten);
  }, [clientId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = uitCache(clientId);
    if (cached) {
      setOpgeslagen({ sleutel: clientId, staat: { ...cached, loading: false, error: null } });
      return;
    }

    // Na een vergeten is de cache leeg en het vorige verzoek uit `onderweg`: elke gemounte lezer
    // komt hier langs, de eerste start het nieuwe verzoek en de rest deelt het.
    haal(clientId).then(
      (waarde) => { if (!cancelled) setOpgeslagen({ sleutel: clientId, staat: { ...waarde, loading: false, error: null } }); },
      (err: unknown) => {
        if (!cancelled) {
          setOpgeslagen({ sleutel: clientId, staat: { ...LEEG, error: err instanceof Error ? err.message : "Onbekende fout" } });
        }
      },
    );

    return () => { cancelled = true; };
  }, [clientId, enabled, versie]);

  return opgeslagen.sleutel === sleutel ? opgeslagen.staat : beginStaat(clientId, enabled);
}

/** Wat de hook toont voordat er voor deze (klant, aan/uit) iets is opgehaald. */
function beginStaat(clientId: string, enabled: boolean): BlendedClientDataState {
  if (!enabled) return LEEG;
  const cached = uitCache(clientId);
  return cached ? { ...cached, loading: false, error: null } : { ...LEEG, loading: true };
}

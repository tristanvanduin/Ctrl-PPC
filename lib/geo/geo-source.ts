// Geo-bron-resolver: één plek die bepaalt wélke geo-data de kaart voedt, per kanaal en niveau.
// Dit is de "aanzet-knop" van Laag 2. Zodra de connectors de tabellen vullen (ads_region_monthly,
// channel_geo_monthly — zie scripts/geo-layer2-tables.sql) schakelt de kaart vanzelf over op echte
// data. Tot die tijd: in demo-modus de mock, en buiten demo niets (geen neppe cijfers).
//
// Volgorde per (kanaal, niveau):
//   demo?          -> demo-mock (lib/demo/geo-demo)
//   google/country -> ads_country_monthly (bestaande Laag 1-tabel)
//   google/region  -> ads_region_monthly  (VS-staten; region_name -> USPS)
//   meta|linkedin  -> channel_geo_monthly  (per kanaal + niveau)
//   blended        -> som over google + meta + linkedin op hetzelfde niveau

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoGeoCountries, demoGeoStates, type GeoAgg } from "@/lib/demo/geo-demo";
import { isDemoClientValue } from "@/lib/demo/mock-supabase";
import { isGeocloneDemo } from "@/lib/demo/geoclone-demo-data";
import { detectCountryFromName } from "@/lib/countries";
import { regionNameToUsps } from "./us-fips";

export type GeoChannel = "google" | "meta" | "linkedin" | "blended";
export type GeoLevel = "country" | "region";

const WINDOW_DAYS = 180;
function sinceMonth(): string {
  const d = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// Sommeer maandrijen op naar één rij per geo-code; ratio's worden later in de UI uit deze totalen
// afgeleid (nooit uit een gemiddelde van maand-deelwaarden). `month` reist mee zodat de analyse
// kan zien hoe vers het venster werkelijk is (sloop-audit 1 sep 2026: de geo-analyse beoordeelde
// stilzwijgend maanden-oude data omdat niemand de jongste maand kende).
interface RawRow { code: string | null; month: string | null; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }
function aggregate(rows: RawRow[]): GeoAgg[] {
  const m = new Map<string, GeoAgg>();
  for (const r of rows) {
    const code = (r.code || "").toUpperCase();
    if (!code) continue;
    const a = m.get(code) ?? { code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
    a.impressions += Number(r.impressions ?? 0);
    a.clicks += Number(r.clicks ?? 0);
    a.cost += Number(r.cost ?? 0);
    a.conversions += Number(r.conversions ?? 0);
    a.conversionsValue += Number(r.conversions_value ?? 0);
    m.set(code, a);
  }
  return [...m.values()];
}

// Zet een DB-rij om naar de neutrale RawRow-vorm; de geo-code komt uit de kolom die bij die tabel
// hoort (country_code / geo_code / region), de metrics heten overal hetzelfde.
function toRaw(code: string | null, r: Record<string, unknown>): RawRow {
  return {
    code,
    month: typeof r.month === "string" ? r.month : null,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversions_value: Number(r.conversions_value ?? 0),
  };
}

// De lezers leveren de RUWE maandrijen; aggregeren gebeurt bij de afnemer, zodat die ook het
// echte maandbereik van de gebruikte rijen kent (eerste/laatste maand) in plaats van alleen
// het opgevraagde venster.
async function readGoogleCountry(sb: SupabaseClient, clientId: string): Promise<RawRow[]> {
  const { data } = await sb
    .from("ads_country_monthly")
    .select("country_code, month, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .gte("month", sinceMonth());
  return (data ?? []).map((r) => toRaw(r.country_code as string, r));
}

async function readGoogleRegion(sb: SupabaseClient, clientId: string): Promise<RawRow[]> {
  // Alleen VS-staten voor de drilldown: filter op land US en map region_name -> USPS.
  const { data } = await sb
    .from("ads_region_monthly")
    .select("country_code, region_name, region_code, month, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .eq("country_code", "US")
    .gte("month", sinceMonth());
  // region_code is optioneel; valt terug op de Engelse staatsnaam -> USPS.
  return (data ?? []).map((r) => toRaw((r.region_code as string) || regionNameToUsps(r.region_name as string), r));
}

async function readChannelGeo(sb: SupabaseClient, clientId: string, channel: "meta" | "linkedin", level: GeoLevel): Promise<RawRow[]> {
  const { data } = await sb
    .from("channel_geo_monthly")
    .select("geo_code, month, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .eq("channel", channel)
    .eq("level", level)
    .gte("month", sinceMonth());
  return (data ?? []).map((r) => toRaw(r.geo_code as string, r));
}

/** Eerste en laatste maand in een set ruwe rijen (DATE-strings, dus tekstueel vergelijkbaar). */
function maandBereik(rows: RawRow[]): { eerste: string | null; laatste: string | null } {
  let eerste: string | null = null;
  let laatste: string | null = null;
  for (const r of rows) {
    if (!r.month) continue;
    if (eerste === null || r.month < eerste) eerste = r.month;
    if (laatste === null || r.month > laatste) laatste = r.month;
  }
  return { eerste, laatste };
}

function makeClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface ResolveGeoArgs {
  clientId: string;
  channel: GeoChannel;
  level: GeoLevel;
}

/** Geo-rijen mét het echte maandbereik van de gebruikte data (DATE-strings "YYYY-MM-01"). */
export interface GeoVensterResultaat {
  rows: GeoAgg[];
  /** Oudste maand in de gebruikte rijen; null bij demo-data (geen maandinformatie) of geen data. */
  eersteMaand: string | null;
  /** Jongste maand in de gebruikte rijen; null bij demo-data of geen data. */
  laatsteMaand: string | null;
}

// Levert de geo-rijen voor de gevraagde (kanaal, niveau). Nooit een throw: bij ontbrekende config
// of lege tabellen komt er gewoon [] terug, wat de kaart eerlijk laat verdwijnen.
export async function resolveGeo(args: ResolveGeoArgs): Promise<GeoAgg[]> {
  return (await resolveGeoMetVenster(args)).rows;
}

/**
 * Als resolveGeo, maar mét het maandbereik van de werkelijk gebruikte rijen. De geo-analyse
 * heeft dat nodig om te melden wanneer de data ouder is dan de laatste afgesloten maand en om
 * period_start/period_end op het echte datavenster te zetten in plaats van op de rundatum
 * (sloop-audit 1 sep 2026). De kaart blijft resolveGeo gebruiken; het contract daarvan is
 * ongewijzigd.
 */
export async function resolveGeoMetVenster({ clientId, channel, level }: ResolveGeoArgs): Promise<GeoVensterResultaat> {
  // De demo-status wordt bepaald door de klant-id, niet door een apart meegegeven vlag — dat gaf
  // eerder twee kapotte varianten: (1) ?clientId=<echte-klant>&demo=1 gaf de verzonnen
  // GreenTech-cijfers terug onder de naam van een echte klant, en (2) wie rechtstreeks naar
  // /client/demo-greentech navigeerde zonder ?demo=1 in díe tab gezet te hebben (geen vlag dus)
  // kreeg de ECHTE, lege tabellen terwijl de rest van het scherm demo-cijfers toonde. Beide gaten
  // sluiten door alleen op clientId te varen: geen risico op vermenging (isDemoClientValue herkent
  // uitsluitend de letterlijke demo-id), en werkt ook bij directe navigatie.
  if (isDemoClientValue(clientId)) {
    // De demo-mock draagt geen maandinformatie; de versheidscontrole slaat dan bewust over.
    return { rows: level === "region" ? demoGeoStates(channel) : demoGeoCountries(channel), eersteMaand: null, laatsteMaand: null };
  }
  const sb = makeClient();
  if (!sb) return { rows: [], eersteMaand: null, laatsteMaand: null };
  // De losse geo-clone-demoklanten (demo-grt/gra/grn, scripts/demo/seed-geoclone-clients.ts) zijn
  // ECHT geseed in ads_campaign_monthly, maar nooit in ads_country_monthly/ads_region_monthly --
  // readForChannel zou hier altijd leeg teruggeven, of (bij een demo-vlag die alsnog waar staat)
  // per ongeluk de gedeelde GreenTech-mock tonen, die een ander landenpalet heeft dan deze
  // single-market klant. Afgeleid uit de eigen, al-geseede campagnedata (zelfde detectie als
  // geoclone-demo-data.ts), niet uit een gedeelde mock die niet bij dit account hoort.
  if (isGeocloneDemo(clientId) && channel === "google" && level === "country") {
    try {
      const { data } = await sb.from("ads_campaign_monthly")
        .select("campaign_name, month, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId);
      const raws = (data ?? [])
        .map((r) => toRaw(detectCountryFromName(String(r.campaign_name ?? "")), r))
        .filter((r) => r.code);
      const land = aggregate(raws);
      if (land.length > 0) return { rows: land, ...naarVenster(raws) };
    } catch { /* val terug op de normale route hieronder */ }
  }
  try {
    if (channel === "blended") {
      // Ruwe rijen van de drie kanalen samen aggregeren geeft per code exact dezelfde som als
      // sumSets over drie deelaggregaties, maar houdt het maandbereik in één keer bij.
      const parts = await Promise.all([
        readForChannel(sb, clientId, "google", level),
        readForChannel(sb, clientId, "meta", level),
        readForChannel(sb, clientId, "linkedin", level),
      ]);
      const raws = parts.flat();
      return { rows: aggregate(raws), ...naarVenster(raws) };
    }
    const raws = await readForChannel(sb, clientId, channel, level);
    return { rows: aggregate(raws), ...naarVenster(raws) };
  } catch {
    return { rows: [], eersteMaand: null, laatsteMaand: null };
  }
}

function naarVenster(raws: RawRow[]): { eersteMaand: string | null; laatsteMaand: string | null } {
  const { eerste, laatste } = maandBereik(raws);
  return { eersteMaand: eerste, laatsteMaand: laatste };
}

async function readForChannel(sb: SupabaseClient, clientId: string, channel: Exclude<GeoChannel, "blended">, level: GeoLevel): Promise<RawRow[]> {
  if (channel === "google") {
    return level === "region" ? readGoogleRegion(sb, clientId) : readGoogleCountry(sb, clientId);
  }
  return readChannelGeo(sb, clientId, channel, level);
}

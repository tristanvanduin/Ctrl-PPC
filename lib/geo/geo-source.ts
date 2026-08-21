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
// afgeleid (nooit uit een gemiddelde van maand-deelwaarden).
interface RawRow { code: string | null; impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }
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

// Tel twee of meer geo-sets bij elkaar op per code (voor de blended weergave).
function sumSets(sets: GeoAgg[][]): GeoAgg[] {
  const m = new Map<string, GeoAgg>();
  for (const set of sets) {
    for (const r of set) {
      const a = m.get(r.code) ?? { code: r.code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
      a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost;
      a.conversions += r.conversions; a.conversionsValue += r.conversionsValue;
      m.set(r.code, a);
    }
  }
  return [...m.values()];
}

// Zet een DB-rij om naar de neutrale RawRow-vorm; de geo-code komt uit de kolom die bij die tabel
// hoort (country_code / geo_code / region), de metrics heten overal hetzelfde.
function toRaw(code: string | null, r: Record<string, unknown>): RawRow {
  return {
    code,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversions_value: Number(r.conversions_value ?? 0),
  };
}

async function readGoogleCountry(sb: SupabaseClient, clientId: string): Promise<GeoAgg[]> {
  const { data } = await sb
    .from("ads_country_monthly")
    .select("country_code, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .gte("month", sinceMonth());
  return aggregate((data ?? []).map((r) => toRaw(r.country_code as string, r)));
}

async function readGoogleRegion(sb: SupabaseClient, clientId: string): Promise<GeoAgg[]> {
  // Alleen VS-staten voor de drilldown: filter op land US en map region_name -> USPS.
  const { data } = await sb
    .from("ads_region_monthly")
    .select("country_code, region_name, region_code, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .eq("country_code", "US")
    .gte("month", sinceMonth());
  // region_code is optioneel; valt terug op de Engelse staatsnaam -> USPS.
  return aggregate((data ?? []).map((r) => toRaw((r.region_code as string) || regionNameToUsps(r.region_name as string), r)));
}

async function readChannelGeo(sb: SupabaseClient, clientId: string, channel: "meta" | "linkedin", level: GeoLevel): Promise<GeoAgg[]> {
  const { data } = await sb
    .from("channel_geo_monthly")
    .select("geo_code, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .eq("channel", channel)
    .eq("level", level)
    .gte("month", sinceMonth());
  return aggregate((data ?? []).map((r) => toRaw(r.geo_code as string, r)));
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

// Levert de geo-rijen voor de gevraagde (kanaal, niveau). Nooit een throw: bij ontbrekende config
// of lege tabellen komt er gewoon [] terug, wat de kaart eerlijk laat verdwijnen.
export async function resolveGeo({ clientId, channel, level }: ResolveGeoArgs): Promise<GeoAgg[]> {
  // De demo-status wordt bepaald door de klant-id, niet door een apart meegegeven vlag — dat gaf
  // eerder twee kapotte varianten: (1) ?clientId=<echte-klant>&demo=1 gaf de verzonnen
  // GreenTech-cijfers terug onder de naam van een echte klant, en (2) wie rechtstreeks naar
  // /client/demo-greentech navigeerde zonder ?demo=1 in díe tab gezet te hebben (geen vlag dus)
  // kreeg de ECHTE, lege tabellen terwijl de rest van het scherm demo-cijfers toonde. Beide gaten
  // sluiten door alleen op clientId te varen: geen risico op vermenging (isDemoClientValue herkent
  // uitsluitend de letterlijke demo-id), en werkt ook bij directe navigatie.
  if (isDemoClientValue(clientId)) {
    return level === "region" ? demoGeoStates(channel) : demoGeoCountries(channel);
  }
  const sb = makeClient();
  if (!sb) return [];
  // De losse geo-clone-demoklanten (demo-grt/gra/grn, scripts/demo/seed-geoclone-clients.ts) zijn
  // ECHT geseed in ads_campaign_monthly, maar nooit in ads_country_monthly/ads_region_monthly --
  // readForChannel zou hier altijd leeg teruggeven, of (bij een demo-vlag die alsnog waar staat)
  // per ongeluk de gedeelde GreenTech-mock tonen, die een ander landenpalet heeft dan deze
  // single-market klant. Afgeleid uit de eigen, al-geseede campagnedata (zelfde detectie als
  // geoclone-demo-data.ts), niet uit een gedeelde mock die niet bij dit account hoort.
  if (isGeocloneDemo(clientId) && channel === "google" && level === "country") {
    try {
      const { data } = await sb.from("ads_campaign_monthly")
        .select("campaign_name, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId);
      const land = aggregate(
        (data ?? [])
          .map((r) => ({ ...r, code: detectCountryFromName(String(r.campaign_name ?? "")) }))
          .filter((r) => r.code)
      );
      if (land.length > 0) return land;
    } catch { /* val terug op de normale route hieronder */ }
  }
  try {
    if (channel === "blended") {
      const parts = await Promise.all([
        readForChannel(sb, clientId, "google", level),
        readForChannel(sb, clientId, "meta", level),
        readForChannel(sb, clientId, "linkedin", level),
      ]);
      return sumSets(parts);
    }
    return await readForChannel(sb, clientId, channel, level);
  } catch {
    return [];
  }
}

async function readForChannel(sb: SupabaseClient, clientId: string, channel: Exclude<GeoChannel, "blended">, level: GeoLevel): Promise<GeoAgg[]> {
  if (channel === "google") {
    return level === "region" ? readGoogleRegion(sb, clientId) : readGoogleCountry(sb, clientId);
  }
  return readChannelGeo(sb, clientId, channel, level);
}

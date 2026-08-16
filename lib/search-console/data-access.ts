// Search Console data-access — spiegelt lib/ga4/data-access.ts exact qua gate-volgorde en
// doctrine. De ENIGE module die GSC-config en de echte Search Console API kent.
//
//  - demo-klant  → gemockte dataset (availability "mock").
//  - geen config → availability "absent", lege rijen: de tool draait volledig door zonder GSC.
//  - config aanwezig, geen actieve koppeling → "absent" met een expliciete beperking.
//  - config + koppeling aanwezig → echte searchAnalytics.query-aanroep.

import { isGreentechDemo } from "@/lib/demo/greentech-mock";
import { buildGscDemoDataset } from "@/lib/demo/search-console-demo";
import { runSearchAnalyticsQuery } from "./api-client";
import { searchConsoleAccessTokenVoorKlant } from "./credentials";
import type { GscConfig, GscDataset } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Zelfde minimale vorm als Ga4SupabaseLike — zie de opmerking daar.
export interface GscSupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
      };
    };
  };
}

export interface GscDeps {
  supabase?: GscSupabaseLike | null;
  now?: Date;
}

const GSC_FETCH_WINDOW_DAGEN = 185; // dekt het langste analysevenster (CTR-anomalie: 180d) plus marge

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseConfig(raw: unknown): GscConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const siteUrl = typeof o.siteUrl === "string" ? o.siteUrl : "";
  const brandTerms = Array.isArray(o.brandTerms) ? o.brandTerms.filter((x): x is string => typeof x === "string") : [];
  if (!siteUrl) return null;
  return { siteUrl, brandTerms };
}

const absent = (limitation: string): GscDataset => ({
  availability: "absent",
  config: null,
  rows: [],
  limitations: [limitation],
});

export async function fetchGscDataset(clientId: string, deps: GscDeps = {}): Promise<GscDataset> {
  const now = deps.now ?? new Date();

  // 1) Demo-klant: gemockte dataset, geen backend nodig.
  if (isGreentechDemo(clientId)) return buildGscDemoDataset(now);

  // 2) Config opzoeken.
  const sb = deps.supabase ?? null;
  if (!sb) return absent("Search Console-config niet opgehaald (geen databaseverbinding meegegeven).");

  let config: GscConfig | null = null;
  try {
    const { data, error } = await sb.from("client_settings").select("search_console_config").eq("client_id", clientId).maybeSingle();
    if (error) return absent("Search Console-config kon niet worden gelezen uit client_settings.");
    config = parseConfig(data?.search_console_config);
  } catch {
    return absent("Search Console-config kon niet worden gelezen (onverwachte fout).");
  }
  if (!config) return absent("Search Console niet geconfigureerd voor deze klant.");

  // 3) Config aanwezig — actieve OAuth-koppeling van het bureau proberen op te halen.
  const accessToken = await searchConsoleAccessTokenVoorKlant(sb as unknown as SupabaseClient, clientId);
  if (!accessToken) {
    return {
      availability: "absent",
      config,
      rows: [],
      limitations: [`Search Console-config aanwezig (${config.siteUrl}) maar er is geen actieve Search Console-koppeling voor dit bureau. Verbind via Instellingen.`],
    };
  }

  // 4) Echte aanroep. Nooit een crash van de hele analyse — GSC is een verrijkingslaag.
  try {
    const start = ymd(new Date(now.getTime() - GSC_FETCH_WINDOW_DAGEN * 86_400_000));
    const end = ymd(new Date(now.getTime() - 3 * 86_400_000)); // GSC se laatste 2-3 dagen zijn niet definitief
    const result = await runSearchAnalyticsQuery(config.siteUrl, accessToken, start, end);
    const limitations: string[] = ["Laatste 2-3 dagen ontbreken (dataState=final, GSC se eigen vertraging)."];
    if (result.mogelijkAfgekapt) limitations.push("Het aantal rijen kwam op de GSC-limiet uit — er kunnen meer query/pagina-combinaties bestaan dan opgehaald.");
    return { availability: "live", config, rows: result.rows, limitations };
  } catch (e) {
    return {
      availability: "absent",
      config,
      rows: [],
      limitations: [`Search Console API-aanroep mislukt: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

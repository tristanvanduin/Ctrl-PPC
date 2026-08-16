// GA4 data-access — de ENIGE module die GA4-config en de GA4 Data API kent. Alle andere
// GA4-modules (signals, context) en de feed-adapter werken uitsluitend op het genormaliseerde
// Ga4Dataset dat hier uitkomt. Zo dupliceert geen enkele consumer GA4-logica.
//
// Config-gate + geen valse zekerheid:
//  - demo-klant  → gemockte dataset (availability "mock").
//  - geen config → availability "absent", lege rijen: de tool draait volledig door zonder GA4.
//  - config aanwezig, geen actieve koppeling → "absent" met een expliciete beperking (we
//    verzinnen géén live cijfers zonder een echte OAuth-koppeling van het bureau).
//  - config + koppeling aanwezig → echte GA4 Data API-aanroep; "partial" als GA4 zelf samplet.

import { isGreentechDemo } from "@/lib/demo/greentech-mock";
import { buildGa4DemoDataset } from "@/lib/demo/ga4-demo";
import { fetchGa4SessionReport, fetchGa4EventReport } from "./api-client";
import { buildGa4DailyRows } from "./map-rows";
import { ga4AccessTokenVoorKlant } from "./credentials";
import type { Ga4Config, Ga4Dataset } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Minimale Supabase-vorm die we nodig hebben voor de config-lookup, zodat data-access niet aan
// een concrete client vastzit (demo heeft er geen nodig). Voor de live koppeling (credentials.ts)
// is een echte SupabaseClient nodig — server-routes geven die altijd mee, alleen getypeerd op
// deze smallere vorm; zie de cast verderop.
export interface Ga4SupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
      };
    };
  };
}

export interface Ga4Deps {
  supabase?: Ga4SupabaseLike | null;
  now?: Date;
}

const GA4_FETCH_WINDOW_DAGEN = 60; // ruim boven het langste analysevenster (56d prior in context.ts)

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseConfig(raw: unknown): Ga4Config | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const propertyId = typeof o.propertyId === "string" ? o.propertyId : "";
  const keyEvents = Array.isArray(o.keyEvents) ? o.keyEvents.filter((x): x is string => typeof x === "string") : [];
  const funnelSteps = Array.isArray(o.funnelSteps) ? o.funnelSteps.filter((x): x is string => typeof x === "string") : [];
  if (!propertyId || keyEvents.length === 0) return null;
  return { propertyId, keyEvents, funnelSteps };
}

const absent = (limitation: string): Ga4Dataset => ({
  availability: "absent",
  config: null,
  rows: [],
  limitations: [limitation],
});

// Haalt het GA4-dataset voor een klant. Zie de module-header voor de gate-volgorde.
export async function fetchGa4Dataset(clientId: string, deps: Ga4Deps = {}): Promise<Ga4Dataset> {
  const now = deps.now ?? new Date();

  // 1) Demo-klant: gemockte dataset, geen backend nodig.
  if (isGreentechDemo(clientId)) return buildGa4DemoDataset(now);

  // 2) Config opzoeken. Zonder Supabase-client (of zonder config) → absent, alles draait door.
  const sb = deps.supabase ?? null;
  if (!sb) return absent("GA4-config niet opgehaald (geen databaseverbinding meegegeven).");

  let config: Ga4Config | null = null;
  try {
    const { data, error } = await sb.from("client_settings").select("ga4_config").eq("client_id", clientId).maybeSingle();
    if (error) return absent("GA4-config kon niet worden gelezen uit client_settings.");
    config = parseConfig(data?.ga4_config);
  } catch {
    return absent("GA4-config kon niet worden gelezen (onverwachte fout).");
  }
  if (!config) return absent("GA4 niet geconfigureerd voor deze klant.");

  // 3) Config aanwezig — een actieve OAuth-koppeling van het bureau proberen op te halen. Geen
  //    koppeling (nog niet verbonden, ingetrokken, verlopen) → absent met reden, geen gok.
  const accessToken = await ga4AccessTokenVoorKlant(sb as unknown as SupabaseClient, clientId);
  if (!accessToken) {
    return {
      availability: "absent",
      config,
      rows: [],
      limitations: [`GA4-config aanwezig (property ${config.propertyId}) maar er is geen actieve GA4-koppeling voor dit bureau. Verbind via Instellingen.`],
    };
  }

  // 4) Echte aanroep. Elke fout hier is "absent met reden", nooit een crash van de hele analyse —
  //    GA4 is een verrijkingslaag, geen harde afhankelijkheid.
  try {
    const start = ymd(new Date(now.getTime() - GA4_FETCH_WINDOW_DAGEN * 86_400_000));
    const end = ymd(new Date(now.getTime() - 86_400_000)); // t/m gisteren; vandaag is vaak nog onvolledig
    const [sessieRapport, gebeurtenisRapport] = await Promise.all([
      fetchGa4SessionReport(config.propertyId, accessToken, start, end),
      fetchGa4EventReport(config.propertyId, accessToken, start, end),
    ]);
    const rows = buildGa4DailyRows(sessieRapport.rows, gebeurtenisRapport.rows, config);
    const sampled = sessieRapport.sampled || gebeurtenisRapport.sampled;
    return {
      availability: sampled ? "partial" : "live",
      config,
      rows,
      limitations: sampled ? ["GA4 samplet deze rapportage bij dit propertyvolume — cijfers zijn een schatting, geen exacte telling."] : [],
    };
  } catch (e) {
    return {
      availability: "absent",
      config,
      rows: [],
      limitations: [`GA4 Data API-aanroep mislukt: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

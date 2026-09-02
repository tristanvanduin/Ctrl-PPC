// De provider-laag voor de beslislaag. Geen tweede registry -- lib/analysis/channel-adapter.ts
// heeft er al een (registerAdapter/getAdapter/hasAdapter), maar die is de PROMPT-laag
// (stapinstructies, purity-contracten) voor de kanalen met een sync-tabel. Deze registry is de
// SIGNAL-laag: kan een kanaal vandaag iets leveren voor een klant, en zo ja, welke signalen.
// Twee registries met een eigen rol, gekoppeld via CHANNEL_TO_ADAPTER hieronder.
//
// Herbouw 2 september 2026: de providers krijgen de Supabase-client MEE in plaats van elk hun
// eigen getSupabase() aan te roepen. Zonder dat las de demo-klant altijd de echte database
// (waar ads_ad_schedule_performance voor demo-greentech leeg is), terwijl de rest van de app
// demo-rijen toont -- en was geen enkele provider testbaar zonder netwerk.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelId } from "@/lib/analysis/channel-adapter";
import type { Channel, ChannelAnalysisResult, RunType, SignaalVerzameling } from "./types";

/** De brug tussen de brede Channel uit de blueprint en de ChannelId van de bestaande adapter. */
export const CHANNEL_TO_ADAPTER: Partial<Record<Channel, ChannelId>> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  // Sinds migratie 106 een echt kanaal met adapter en microsoft_*-tabellen.
  microsoft: "microsoft_ads",
};
// tiktok_ads, tiktok_shop, shopify, crm en aicro hebben bewust GEEN provider: er is voor die
// kanalen geen synctabel en geen rij in de database. Een lege provider die nul signalen
// teruggeeft leest als "gemeten en niets gevonden"; dat is precies het verschil dat we niet
// willen vervagen. Ze staan wel in het Channel-type, zodat de code compileert zodra de eerste
// rij er is.

export interface ProviderInvoer {
  agencyId: string;
  accountId: string;
  runType: RunType;
  periodStart: string;
  periodEnd: string;
}

export interface ChannelProvider {
  channel: Channel;
  /** Kan dit kanaal vandaag iets leveren voor deze klant? Alleen 'ja' als er data is.
   *  Een queryfout gooit (DataLaagFout) -- "kanaal afwezig" mag nooit een storing verbergen. */
  isAvailable(supabase: SupabaseClient, accountId: string): Promise<boolean>;
  /** null = niet gemeten (geen detector). Een lege lijst = gemeten, niets gevonden. */
  collectSignals(supabase: SupabaseClient, input: ProviderInvoer): Promise<SignaalVerzameling | null>;
  analyze(supabase: SupabaseClient, input: ProviderInvoer): Promise<ChannelAnalysisResult>;
}

const registry = new Map<Channel, ChannelProvider>();

export function registerProvider(p: ChannelProvider): void {
  registry.set(p.channel, p);
}

export function getProvider(c: Channel): ChannelProvider | null {
  return registry.get(c) ?? null;
}

/** De GEREGISTREERDE providers -- niet "de kanalen die deze klant heeft". Voor dat laatste
 *  vraag je elke provider zelf via isAvailable(); decision-skeleton.ts doet dat en geeft alleen
 *  die uitkomst terug aan de UI. */
export function availableProviders(): Channel[] {
  return [...registry.keys()];
}

// De providers staan in lib/decision/providers/, geregistreerd zodra lib/decision/decision-
// skeleton.ts wordt geladen (zie daar). isAvailable() leunt op heeftKanaalData() in
// providers/beschikbaarheid.ts, dat dezelfde KANAAL_BRON gebruikt als lib/kanalen/beschikbaar.ts.
// Alleen google heeft een echte collectSignals(); meta en linkedin geven null (niet gemeten).

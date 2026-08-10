// EXECUTION_PLAN.md, Stap 3: de provider-laag voor de Decision Engine. Geen tweede registry --
// lib/analysis/channel-adapter.ts heeft er al een (registerAdapter/getAdapter/hasAdapter), maar
// die is de PROMPT-laag (stapinstructies, purity-contracten) voor de drie kanalen met een
// sync-tabel. Deze registry is de SIGNAL-laag: kan een kanaal vandaag iets leveren voor een
// klant, en zo ja, welke signalen en welke analyse. Twee registries met een eigen rol, gekoppeld
// via CHANNEL_TO_ADAPTER hieronder in plaats van in elkaar gebouwd.

import type { ChannelId } from "@/lib/analysis/channel-adapter";
import type { Channel, ChannelAnalysisResult, RunType, Signal } from "./types";

/** De brug tussen de brede Channel uit de blueprint en de ChannelId van de bestaande adapter. */
export const CHANNEL_TO_ADAPTER: Partial<Record<Channel, ChannelId>> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
};
// microsoft, tiktok_ads, tiktok_shop, shopify, crm en aicro hebben bewust GEEN adapter: er is
// voor die kanalen geen synctabel en geen rij in de database. Een lege provider die nul signalen
// teruggeeft leest als "gemeten en niets gevonden"; dat is precies het verschil dat we niet
// willen vervagen. Ze staan wel in het Channel-type, zodat de code compileert zodra de eerste
// rij er is.

export interface ChannelProvider {
  channel: Channel;
  /** Kan dit kanaal vandaag iets leveren voor deze klant? Alleen 'ja' als er data is. */
  isAvailable(accountId: string): Promise<boolean>;
  collectSignals(input: {
    agencyId: string;
    accountId: string;
    runType: RunType;
    periodStart: string;
    periodEnd: string;
  }): Promise<Signal[]>;
  analyze(input: {
    agencyId: string;
    accountId: string;
    runType: RunType;
    periodStart: string;
    periodEnd: string;
  }): Promise<ChannelAnalysisResult>;
}

const registry = new Map<Channel, ChannelProvider>();

export function registerProvider(p: ChannelProvider): void {
  registry.set(p.channel, p);
}

export function getProvider(c: Channel): ChannelProvider | null {
  return registry.get(c) ?? null;
}

export function availableProviders(): Channel[] {
  return [...registry.keys()];
}

// Fase 2: de drie providers staan in lib/decision/providers/, geregistreerd zodra
// lib/decision/decision-skeleton.ts wordt geladen (zie daar). isAvailable() leunt op
// heeftKanaalData() in providers/beschikbaarheid.ts, dat dezelfde KANAAL_BRON gebruikt als
// lib/kanalen/beschikbaar.ts (dat al per klant uitzoekt welke kanalen data hebben). Alleen
// google heeft een echte collectSignals(); meta en linkedin zijn nog stubs die altijd een lege
// signalenlijst geven, zie de kop van die twee bestanden voor de reden.

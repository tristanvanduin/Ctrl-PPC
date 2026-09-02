// Meta-provider: beschikbaarheid is echt (dezelfde KANAAL_BRON-check als Google), detectie is
// er nog niet. De bestaande Meta-signalen (lib/signals/meta-breakdown.ts, meta-creative.ts)
// draaien vandaag alleen als pure functies op rijen die een component al heeft opgehaald; een
// server-side I/O-schil zoals bij Google is later werk.
//
// collectSignals() geeft daarom null: NIET GEMETEN. De oude stub gaf een lege lijst, en dat las
// stroomopwaarts als "gemeten, niets gevonden" -- precies het onderscheid waarvoor
// channel-provider.ts tiktok/shopify géén provider geeft. Zelfde regel, nu ook hier.

import { heeftKanaalData } from "./beschikbaarheid";
import type { ChannelProvider } from "../channel-provider";

export const metaProvider: ChannelProvider = {
  channel: "meta",

  isAvailable(supabase, accountId) {
    return heeftKanaalData(supabase, "meta", accountId);
  },

  async collectSignals() {
    return null;
  },

  async analyze(_supabase, input) {
    return {
      channel: "meta",
      accountId: input.accountId,
      gemeten: false,
      signals: [],
      summary: "Meta: geen detector aangesloten, niet gemeten.",
    };
  },
};

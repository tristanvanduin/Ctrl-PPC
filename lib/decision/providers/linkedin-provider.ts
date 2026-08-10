// Fase 2, Task 2: lean stub. Zelfde status als meta-provider.ts: de bestaande LinkedIn-signalen
// (lib/signals/linkedin-signals.ts, linkedin-demographic.ts) draaien vandaag alleen als pure
// functies op al-opgehaalde rijen; een server-side I/O-schil is later werk.

import { heeftKanaalData } from "./beschikbaarheid";
import type { ChannelProvider } from "../channel-provider";

export const linkedinProvider: ChannelProvider = {
  channel: "linkedin",

  isAvailable(accountId) {
    return heeftKanaalData("linkedin", accountId);
  },

  async collectSignals() {
    return [];
  },

  async analyze(input) {
    return {
      channel: "linkedin",
      accountId: input.accountId,
      signals: [],
      summary: "LinkedIn-provider is nog een stub: geen detector aangesloten.",
    };
  },
};

// Fase 2, Task 2: lean stub. De bestaande Meta-signalen (lib/signals/meta-breakdown.ts,
// meta-creative.ts) draaien vandaag alleen als pure functies op rijen die een component al
// heeft opgehaald (zie components/dashboard/channel-structure-analysis.tsx); een server-side
// I/O-schil zoals bij Google is later werk, geen aanname voor deze stap.
//
// isAvailable() checkt wel echt of er Meta-data is (hergebruik van dezelfde KANAAL_BRON-check
// als Google), want dat is een feit dat al bekend is en niets kost om eerlijk te beantwoorden.
// collectSignals() geeft altijd een lege array: geen detector aangesloten, dus niets te melden
// in plaats van iets te verzinnen.

import { heeftKanaalData } from "./beschikbaarheid";
import type { ChannelProvider } from "../channel-provider";

export const metaProvider: ChannelProvider = {
  channel: "meta",

  isAvailable(accountId) {
    return heeftKanaalData("meta", accountId);
  },

  async collectSignals() {
    return [];
  },

  async analyze(input) {
    return {
      channel: "meta",
      accountId: input.accountId,
      signals: [],
      summary: "Meta-provider is nog een stub: geen detector aangesloten.",
    };
  },
};

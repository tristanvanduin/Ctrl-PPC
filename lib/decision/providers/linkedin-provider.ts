// LinkedIn-provider: zelfde status en dezelfde regel als meta-provider.ts. De bestaande
// LinkedIn-signalen (lib/signals/linkedin-signals.ts, linkedin-demographic.ts) draaien alleen
// als pure functies op al-opgehaalde rijen; collectSignals() geeft null (niet gemeten), geen
// lege lijst die als "niets gevonden" zou lezen.

import { heeftKanaalData } from "./beschikbaarheid";
import type { ChannelProvider } from "../channel-provider";

export const linkedinProvider: ChannelProvider = {
  channel: "linkedin",

  isAvailable(supabase, accountId) {
    return heeftKanaalData(supabase, "linkedin", accountId);
  },

  async collectSignals() {
    return null;
  },

  async analyze(_supabase, input) {
    return {
      channel: "linkedin",
      accountId: input.accountId,
      gemeten: false,
      signals: [],
      summary: "LinkedIn: geen detector aangesloten, niet gemeten.",
    };
  },
};

// De signaaloogst van de beslislaag: vraagt elke geregistreerde provider of hij voor deze klant
// iets kan leveren en verzamelt de signalen. Los van decision-skeleton.ts (dat Next.js-request-
// afhandeling en de auth-laag importeert) zodat dit deel puur op een meegegeven Supabase-client
// draait en met een in-memory database te testen is.
//
// Drie uitkomsten per kanaal, en ze blijven uit elkaar: gemeten (data én detector), niet gemeten
// (data maar geen detector: geen oordeel, ook geen "niets gevonden") en niet beschikbaar (geen
// data voor deze klant). Een datalaagfout gooit door; "kanaal faalde" mag nooit als "kanaal
// stil" lezen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { availableProviders, getProvider } from "./channel-provider";
import type { Channel, RunType, Signal } from "./types";
import { today, daysAgo } from "@/lib/reporting-date";

export type DecisionRunType = Extract<RunType, "weekly" | "biweekly">;

// Het venster per cadans -- de VRAAG van de run. Of een detector dat venster kan honoreren
// staat per kanaal in de dekking (schedule-waste kan het niet, zie providers/google-provider.ts).
export const VENSTER_DAGEN: Record<DecisionRunType, number> = { weekly: 7, biweekly: 14 };

export interface KanaalDekking {
  channel: Channel;
  /** De datagrenzen waarop de detector echt draaide. */
  venster: { start: string | null; eind: string | null };
  rijenAfgekapt: boolean;
  signalen: number;
}

export interface SignaalOogst {
  /** Kanalen met data én een detector: hier is echt gemeten. */
  gemeten: KanaalDekking[];
  /** Kanalen met data maar zonder detector: geen oordeel, geen "niets gevonden". */
  nietGemeten: Channel[];
  /** Kanalen zonder data voor deze klant. */
  nietBeschikbaar: Channel[];
  signalen: Signal[];
}

export async function verzamelSignalen(
  supabase: SupabaseClient,
  agencyId: string,
  accountId: string,
  runType: DecisionRunType,
): Promise<SignaalOogst> {
  const periodEnd = today();
  const periodStart = daysAgo(VENSTER_DAGEN[runType]);
  const oogst: SignaalOogst = { gemeten: [], nietGemeten: [], nietBeschikbaar: [], signalen: [] };

  for (const channel of availableProviders()) {
    const provider = getProvider(channel);
    if (!provider) continue;
    const beschikbaar = await provider.isAvailable(supabase, accountId);
    if (!beschikbaar) { oogst.nietBeschikbaar.push(channel); continue; }
    const verzameling = await provider.collectSignals(supabase, { agencyId, accountId, runType, periodStart, periodEnd });
    if (verzameling === null) { oogst.nietGemeten.push(channel); continue; }
    oogst.gemeten.push({ channel, venster: verzameling.venster, rijenAfgekapt: verzameling.rijenAfgekapt, signalen: verzameling.signalen.length });
    oogst.signalen.push(...verzameling.signalen);
  }
  return oogst;
}

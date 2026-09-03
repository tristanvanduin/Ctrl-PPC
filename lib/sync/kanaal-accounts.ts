// De accountlijst onder het bureautoken, per kanaal: wat kan een klant gekoppeld krijgen?
//
// Zelfde credential-resolutie als de syncs zelf (lib/tenancy/kanaal-credentials.ts), zelfde
// token-verversing mét rotatie (linkedinAccessToken / microsoftAccessToken in kanaal-runs.ts):
// wie hier een eigen refresh doet zonder het geroteerde token te bewaren, breekt de nachtcron.
// De uitkomst zegt WAAROM er geen lijst is (geen credentials, token dood, API-fout, handmatig
// invullen) in plaats van een lege lijst terug te geven die als "geen accounts" leest.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredentialBron } from "@/lib/tenancy/credentials";
import { metaCredentialsVoorKlant, linkedinCredentialsVoorKlant, microsoftCredentialsVoorKlant } from "@/lib/tenancy/kanaal-credentials";
import { listAdAccounts } from "@/lib/api/meta-ads";
import { fetchAdAccounts } from "@/lib/linkedin/entities";
import { fetchMicrosoftAccounts } from "@/lib/microsoft/api";
import { linkedinAccessToken, microsoftAccessToken } from "./kanaal-runs";
import type { KoppelKanaal } from "./kanaal-koppeling";

export interface KanaalAccount {
  /** In de vorm die de koppeling verwacht (act_..., urn:li:sponsoredAccount:..., cijfers). */
  id: string;
  naam: string;
  valuta: string | null;
  status: string | null;
}

export type AccountLijst =
  | { ok: true; accounts: KanaalAccount[]; bron: CredentialBron }
  | { ok: false; reden: "geen_credentials" | "token_probleem" | "api_fout" | "handmatig"; fout: string };

/** Meta's account_status-codes, voor het scherm. */
export const META_ACCOUNT_STATUS: Record<number, string> = {
  1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED", 201: "ANY_ACTIVE", 202: "ANY_CLOSED",
};

function geenCredentials(kanaal: KoppelKanaal): AccountLijst {
  const wat = kanaal === "meta" ? "Meta" : kanaal === "linkedin" ? "LinkedIn" : "Microsoft Advertising";
  return { ok: false, reden: "geen_credentials", fout: `Het bureau heeft geen actieve ${wat}-koppeling (Instellingen → Koppelingen) en de omgeving heeft geen terugval-credentials.` };
}

/** Een API-fout die naar een dood token ruikt, is een tokenprobleem; de rest is een API-fout. */
export function classificeerApiFout(melding: string): "token_probleem" | "api_fout" {
  const m = melding.toLowerCase();
  return /\b401\b|access token|token.*(expired|invalid|vervallen)|oauth/.test(m) ? "token_probleem" : "api_fout";
}

export async function kanaalAccounts(supabase: SupabaseClient, clientId: string, kanaal: KoppelKanaal): Promise<AccountLijst> {
  try {
    if (kanaal === "meta") {
      const creds = await metaCredentialsVoorKlant(supabase, clientId);
      if (!creds) return geenCredentials(kanaal);
      const accounts = await listAdAccounts({ accessToken: creds.accessToken, appId: creds.appId, appSecret: creds.appSecret });
      return {
        ok: true, bron: creds.bron,
        accounts: accounts.map((a) => ({ id: a.id, naam: a.name, valuta: a.currency ?? null, status: META_ACCOUNT_STATUS[a.accountStatus] ?? String(a.accountStatus) })),
      };
    }
    if (kanaal === "linkedin") {
      const creds = await linkedinCredentialsVoorKlant(supabase, clientId);
      if (!creds) return geenCredentials(kanaal);
      const token = await linkedinAccessToken(supabase, creds);
      if (!token) return { ok: false, reden: "token_probleem", fout: "LinkedIn token-refresh faalde; verbind LinkedIn opnieuw bij Instellingen → Koppelingen." };
      const accounts = await fetchAdAccounts({ accessToken: token });
      return { ok: true, bron: creds.bron, accounts: accounts.map((a) => ({ id: a.urn, naam: a.name, valuta: a.currency, status: a.status })) };
    }
    const creds = await microsoftCredentialsVoorKlant(supabase, clientId);
    if (!creds) return geenCredentials(kanaal);
    if (!creds.customerId) {
      return { ok: false, reden: "handmatig", fout: "De Microsoft-koppeling van het bureau draagt geen customer-id; vul account-id en customer-id handmatig in (Microsoft Advertising → Accounts)." };
    }
    const token = await microsoftAccessToken(supabase, creds);
    if (!token) return { ok: false, reden: "token_probleem", fout: "Microsoft token-refresh faalde; verbind Microsoft Advertising opnieuw bij Instellingen → Koppelingen." };
    const accounts = await fetchMicrosoftAccounts({ accessToken: token, developerToken: creds.developerToken, customerId: creds.customerId });
    return {
      ok: true, bron: creds.bron,
      accounts: accounts
        .filter((a) => a.Id != null)
        .map((a) => ({ id: String(a.Id), naam: a.Name?.trim() ? `${a.Name} (${a.Number ?? a.Id})` : String(a.Number ?? a.Id), valuta: null, status: a.AccountLifeCycleStatus ?? null })),
    };
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    return { ok: false, reden: classificeerApiFout(melding), fout: melding.slice(0, 500) };
  }
}

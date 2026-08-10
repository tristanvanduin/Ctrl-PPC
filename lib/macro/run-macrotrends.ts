// De gedeelde uitvoering achter de agency-macro-trends-aggregatie. Twee routes roepen dit aan:
// app/api/admin/macrotrends (de admin-pagina, capability user:manage via de /api/admin-
// middlewareregel) en app/api/platform/agency-macrotrends (Agency God View, capability
// client:read -- performance_marketeer heeft geen user:manage, en die route hoort dus NIET
// onder /api/admin te hangen). Twee dunne routes, één plek met de query/aggregatie-logica, zodat
// de bureaugrens-fix hieronder niet ergens anders vergeten kan worden.

import type { SupabaseClient } from "@supabase/supabase-js";
import { bouwMacroTrends } from "./aggregate";
import type { MacroInvoerRij, MacroTrendCell } from "./types";
import { ALL_CLIENTS, canAccessClient } from "../auth/roles";
import type { AuthUser } from "../auth/server";

export interface MacrotrendsResult {
  vanaf: string;
  aantalCellen: number;
  aantalKlantenIngelezen: number;
  cellen: MacroTrendCell[];
}

export type MacrotrendsOutcome = { ok: true; result: MacrotrendsResult } | { ok: false; status: number; error: string };

/** Standaard: de laatste 6 maanden. Genoeg om een trend te zien, klein genoeg om snel te blijven. */
export function standaardVanaf(): string {
  const nu = new Date();
  nu.setUTCMonth(nu.getUTCMonth() - 5, 1);
  return nu.toISOString().slice(0, 10);
}

/**
 * Bureaugrens: platform-brede scope (auth.scope === ALL_CLIENTS, membership in
 * platform_beheerders, zie lib/auth/scope.ts) ziet alles, desgewenst gefilterd op één bureau via
 * agencyIdFilter. Elke andere scope wordt hard beperkt tot de bureaus van de EIGEN klanten --
 * zowel als filter (een expliciet ander bureau opvragen geeft 403) als als default (geen filter
 * betekent nooit "alle bureaus", altijd "mijn bureaus"). Zonder deze grens kon elke client:read-
 * gebruiker via ?agencyId= de macrocijfers van een ander bureau opvragen.
 */
export async function runMacrotrends(
  admin: SupabaseClient,
  auth: AuthUser,
  agencyIdFilter: string | null,
  vanaf: string,
): Promise<MacrotrendsOutcome> {
  const [{ data: rijen, error: rijenError }, { data: accounts }, { data: instellingen }] = await Promise.all([
    admin.from("blended_account_monthly")
      .select("client_id, month, channel, impressions, clicks, spend, conversions, conversion_value, leads")
      .gte("month", vanaf),
    admin.from("accounts").select("client_id, agency_id"),
    admin.from("client_settings").select("client_id, bedrijfsmodel, niche"),
  ]);
  if (rijenError) return { ok: false, status: 500, error: rijenError.message };

  const agencyPerKlant = new Map(
    (accounts ?? []).map((a) => [String(a.client_id), a.agency_id ? String(a.agency_id) : null])
  );

  const isPlatformWide = auth.scope === ALL_CLIENTS;
  let eigenBureaus: Set<string> | null = null;
  if (!isPlatformWide) {
    eigenBureaus = new Set(
      Array.from(agencyPerKlant.entries())
        .filter(([clientId]) => canAccessClient(auth.scope, clientId))
        .map(([, agencyId]) => agencyId)
        .filter((id): id is string => id !== null)
    );
    if (agencyIdFilter && !eigenBureaus.has(agencyIdFilter)) {
      return { ok: false, status: 403, error: "Onvoldoende rechten voor dit bureau" };
    }
  }

  const segmentPerKlant = new Map(
    (instellingen ?? []).map((r) => [
      String(r.client_id),
      { bedrijfsmodel: (r.bedrijfsmodel as MacroInvoerRij["bedrijfsmodel"]) ?? null, niche: (r.niche as string | null) ?? null },
    ])
  );

  const invoer: MacroInvoerRij[] = [];
  for (const r of rijen ?? []) {
    const clientId = String(r.client_id);
    const agencyId = agencyPerKlant.get(clientId);
    if (!agencyId) continue;
    if (agencyIdFilter && agencyId !== agencyIdFilter) continue;
    if (eigenBureaus && !eigenBureaus.has(agencyId)) continue;
    const segment = segmentPerKlant.get(clientId) ?? { bedrijfsmodel: null, niche: null };
    invoer.push({
      clientId,
      agencyId,
      channel: String(r.channel),
      maand: String(r.month).slice(0, 10),
      bedrijfsmodel: segment.bedrijfsmodel,
      niche: segment.niche,
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      spend: Number(r.spend ?? 0),
      conversions: Number(r.conversions ?? 0),
      conversionValue: Number(r.conversion_value ?? 0),
      leads: Number(r.leads ?? 0),
    });
  }

  const cellen = bouwMacroTrends(invoer);
  return {
    ok: true,
    result: {
      vanaf,
      aantalCellen: cellen.length,
      aantalKlantenIngelezen: new Set(invoer.map((r) => r.clientId)).size,
      cellen,
    },
  };
}

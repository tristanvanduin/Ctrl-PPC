// De gedeelde uitvoering achter de agency-macro-churn-aggregatie. Zelfde bureaugrens-vorm als
// run-macrotrends.ts (spend/conversies), nu voor churn: in welk segment van de EIGEN portfolio
// zit het churnrisico geconcentreerd. Eén route roept dit aan: app/api/platform/agency-churn
// (Agency God View, capability client:read).

import type { SupabaseClient } from "@supabase/supabase-js";
import { bouwMacroChurn, type MacroChurnInvoerRij, type MacroChurnCel } from "./churn-aggregate";
import { ALL_CLIENTS, canAccessClient } from "../auth/roles";
import type { AuthUser } from "../auth/server";
import { beoordeelKlant } from "../adoptie/detecteer-code-rood";

export interface MacroChurnResult {
  aantalCellen: number;
  aantalKlantenIngelezen: number;
  cellen: MacroChurnCel[];
}

export type MacroChurnOutcome = { ok: true; result: MacroChurnResult } | { ok: false; status: number; error: string };

/**
 * Bureaugrens: zelfde regel als runMacrotrends -- platform-brede scope ziet alles (desgewenst
 * gefilterd op één bureau via agencyIdFilter), elke andere scope alleen de eigen bureaus.
 *
 * Live berekend via beoordeelKlant() (dezelfde functie als de cron-detectiejob), niet uit
 * code_rood_meldingen gelezen: dit scherm wil het actuele oordeel per segment, geen menselijk
 * geaccepteerde/afgewezen geschiedenis (zie het waarom bij lib/benchmark/god-view-churn-data.ts,
 * dezelfde afweging).
 */
export async function runMacroChurn(
  admin: SupabaseClient,
  auth: AuthUser,
  agencyIdFilter: string | null,
): Promise<MacroChurnOutcome> {
  const [{ data: accounts }, { data: instellingen }] = await Promise.all([
    admin.from("accounts").select("client_id, agency_id"),
    admin.from("client_settings").select("client_id, bedrijfsmodel, niche"),
  ]);

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
      { bedrijfsmodel: (r.bedrijfsmodel as MacroChurnInvoerRij["bedrijfsmodel"]) ?? null, niche: (r.niche as string | null) ?? null },
    ])
  );

  const inAanmerking: { clientId: string; agencyId: string; bedrijfsmodel: MacroChurnInvoerRij["bedrijfsmodel"]; niche: string | null }[] = [];
  for (const [clientId, agencyId] of agencyPerKlant) {
    if (!agencyId) continue;
    if (agencyIdFilter && agencyId !== agencyIdFilter) continue;
    if (eigenBureaus && !eigenBureaus.has(agencyId)) continue;
    const segment = segmentPerKlant.get(clientId) ?? { bedrijfsmodel: null, niche: null };
    if (!segment.bedrijfsmodel && !segment.niche) continue;
    inAanmerking.push({ clientId, agencyId, ...segment });
  }

  const invoer: MacroChurnInvoerRij[] = await Promise.all(
    inAanmerking.map(async (k) => {
      try {
        const oordeel = await beoordeelKlant(admin, k.clientId);
        return { ...k, licht: oordeel?.licht ?? "onbekend" as const };
      } catch {
        return { ...k, licht: "onbekend" as const };
      }
    })
  );

  const cellen = bouwMacroChurn(invoer);
  return {
    ok: true,
    result: {
      aantalCellen: cellen.length,
      aantalKlantenIngelezen: invoer.length,
      cellen,
    },
  };
}

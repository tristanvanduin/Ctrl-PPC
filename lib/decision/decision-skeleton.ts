// De gedeelde kern achter de twee decision-routes (weekly-decision, biweekly-decision). Eén
// functie in plaats van twee bijna-identieke routehandlers.
//
// Wat deze skeleton NIET doet, met opzet:
// 1. geen createProgressJob: dat schrijft in generation_jobs en die tabel voedt de UI;
// 2. geen saveAnalysisOutputSection: geen enkele schrijfactie in deze stap;
// 3. geen OpenRouter-aanroep, dus ook geen controleerPlafond uit lib/analysis/uitgavenplafond.ts;
// 4. geen wijziging aan lib/analysis/analysis-catalog.ts: deze routes horen nog niet in de UI.
//
// HERBOUW 2 SEPTEMBER 2026 (sloop-audit beslislaag)
//
// - Toegang: dezelfde vereisKlantToegangUitBody(...) als elke andere analyse-POST. Zonder die
//   kon, zodra O1_AUTH_ENFORCED aangaat, iedere ingelogde met analysis:run het client_id van een
//   ander bureau posten en diens bureau-id, kanalen en signalen terugkrijgen.
// - Demo-bewust: supabaseForClient(clientId) in plaats van getSupabase(), en de client gaat MEE
//   naar de providers. De demo-klant las eerder altijd de echte database (leeg voor hem).
// - De respons zei "providers: google, meta, linkedin" voor ELKE klant -- dat waren de
//   registry-sleutels, niet wat deze klant heeft. Nu: gemeten / niet gemeten / niet beschikbaar,
//   elk uit een echte isAvailable()- en collectSignals()-uitkomst.
// - runGates() met alleen runId/agencyId/accountId/analysisDate gaf per constructie negen keer
//   "warn: input ontbreekt". Dode uitvoer die als "poorten draaiden" las: weg.
// - Een providerfout was "geen signalen". Nu gooit de datalaag (DataLaagFout) en antwoordt de
//   route met een 500 die de bron noemt. Eén kapot kanaal verbergen achter een lege lijst is
//   precies de stilte die de audit overal vond.
// - Het venster: de schedule-detector werkt op het GESYNCTE venster van ads_ad_schedule_
//   performance, niet op de cadans van 7 of 14 dagen. Dat staat nu letterlijk in `dekking`.

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { klantVanId } from "@/lib/tenancy/klanten";
import { dataFoutNaarResponse } from "@/lib/analysis/db-veilig";
import { registerProvider } from "./channel-provider";
import { googleProvider } from "./providers/google-provider";
import { metaProvider } from "./providers/meta-provider";
import { linkedinProvider } from "./providers/linkedin-provider";
import { signalHypothesisDiscovery } from "./signal-hypothesis-discovery";
import { classify } from "./hypothesis-discovery";
import { verzamelSignalen, VENSTER_DAGEN, type DecisionRunType } from "./signaal-oogst";
import { today, daysAgo } from "@/lib/reporting-date";

// Registratie bij import, hetzelfde patroon als registerAdapter() in lib/analysis/channel-
// adapter.ts: de consumerende route importeert dit bestand en triggert zo de registratie.
registerProvider(googleProvider);
registerProvider(metaProvider);
registerProvider(linkedinProvider);

export type { DecisionRunType };

async function leesClientId(request: NextRequest): Promise<string | { fout: Response }> {
  try {
    const body = await request.json();
    const clientId = body?.client_id;
    if (!clientId || typeof clientId !== "string") {
      return { fout: Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 }) };
    }
    return clientId;
  } catch {
    return { fout: Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 }) };
  }
}

async function bepaalTenant(supabase: SupabaseClient, clientId: string): Promise<{ fout: Response } | { agencyId: string }> {
  const klant = await klantVanId(supabase, clientId);
  if (!klant) return { fout: Response.json({ error: "Onbekende klant" }, { status: 404 }) };
  if (!klant.agencyId) return { fout: Response.json({ error: "Klant heeft geen gekoppeld bureau" }, { status: 409 }) };
  return { agencyId: klant.agencyId };
}

/** De gedeelde afhandeling voor de decision-routes. Tenant-context komt uit de database via
 *  klantVanId, nooit uit de request-body zelf; de toegang wordt tegen de sessie getoetst. */
export async function handleDecisionSkeleton(request: NextRequest, runType: DecisionRunType): Promise<Response> {
  const clientIdOfFout = await leesClientId(request);
  if (typeof clientIdOfFout !== "string") return clientIdOfFout.fout;
  const clientId = clientIdOfFout;

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const tenant = await bepaalTenant(supabase, clientId);
  if ("fout" in tenant) return tenant.fout;

  try {
    const runId = crypto.randomUUID();
    const oogst = await verzamelSignalen(supabase, tenant.agencyId, clientId, runType);
    const hypotheses = signalHypothesisDiscovery
      .discover({ agencyId: tenant.agencyId, accountId: clientId, signals: oogst.signalen, causes: [] })
      .map((h) => ({ id: h.id, statement: h.statement, category: classify(h) }));

    return Response.json({
      runId,
      runType,
      accountId: clientId,
      status: "skeleton",
      // `providers` blijft de naam die de UI leest (decision-terminal.tsx), maar draagt nu de
      // kanalen waar echt gemeten is -- niet de registry.
      providers: oogst.gemeten.map((k) => k.channel),
      nietGemeten: oogst.nietGemeten,
      nietBeschikbaar: oogst.nietBeschikbaar,
      hypotheses,
      dekking: {
        gevraagdVenster: { start: daysAgo(VENSTER_DAGEN[runType]), eind: today() },
        kanalen: oogst.gemeten,
        opmerking: "De schedule-detector werkt op het gesyncte venster van ads_ad_schedule_performance (zie kanalen[].venster), niet op de cadans.",
      },
      note: "Vers berekend, niet opgeslagen, geen LLM-aanroep.",
    });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}

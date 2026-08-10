// EXECUTION_PLAN.md Stap 4: de gedeelde kern achter de drie decision-route-skeletons
// (weekly-decision, biweekly-decision, monthly-decision). Een functie in plaats van drie
// bijna-identieke routehandlers: het echte GateInput (lib/decision/quality-gates.ts) kent geen
// runType-veld, dus er is ook geen aparte tak per cadans nodig in de logica zelf, alleen in het
// antwoord.
//
// Wat deze skeleton NIET doet, met opzet:
// 1. geen createProgressJob: dat schrijft in generation_jobs en die tabel voedt de UI;
// 2. geen saveAnalysisOutputSection: geen enkele schrijfactie in deze stap;
// 3. geen OpenRouter-aanroep, dus ook geen controleerPlafond uit lib/analysis/uitgavenplafond.ts;
// 4. geen wijziging aan lib/analysis/analysis-catalog.ts: deze routes horen nog niet in de UI.

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/analysis/helpers";
import { klantVanId } from "@/lib/tenancy/klanten";
import { runGates, type GateInput } from "./quality-gates";
import { availableProviders, getProvider, registerProvider } from "./channel-provider";
import { googleProvider } from "./providers/google-provider";
import { metaProvider } from "./providers/meta-provider";
import { linkedinProvider } from "./providers/linkedin-provider";
import { signalHypothesisDiscovery } from "./signal-hypothesis-discovery";
import { classify } from "./hypothesis-discovery";
import type { Signal } from "./types";
import { today, daysAgo } from "@/lib/reporting-date";

// Fase 2, Task 3: registratie bij import, hetzelfde patroon als registerAdapter() in
// lib/analysis/channel-adapter.ts (elke adapter registreert zichzelf bij het laden van zijn
// module; de consumerende route importeert de modules en triggert zo de registratie). Hier is
// handleDecisionSkeleton die consument: elke aanroep van een van de drie decision-routes laadt
// dit bestand, en dus de drie providers hieronder.
registerProvider(googleProvider);
registerProvider(metaProvider);
registerProvider(linkedinProvider);

export type DecisionRunType = "weekly" | "biweekly" | "monthly";

// Het venster per cadans. google-provider.ts gebruikt periodStart/periodEnd vandaag niet (zie de
// kop van dat bestand), maar het contract vraagt ze wel, dus dit is de eerlijke invulling zonder
// op een specifieke provider-implementatie te leunen.
const VENSTER_DAGEN: Record<DecisionRunType, number> = { weekly: 7, biweekly: 14, monthly: 30 };

/** Haalt signalen op bij elke geregistreerde, beschikbare provider en zet ze om in
 *  kandidaat-hypotheses via signalHypothesisDiscovery, elk voorzien van zijn classify()-
 *  categorie. Faalt een provider, dan telt hij mee als "geen signalen" en niet als harde fout --
 *  één kapotte kanaalkoppeling hoort de andere twee niet te blokkeren. */
async function verzamelHypotheses(
  agencyId: string,
  accountId: string,
  runType: DecisionRunType,
): Promise<{ id: string; statement: string; category: string | null }[]> {
  const periodEnd = today();
  const periodStart = daysAgo(VENSTER_DAGEN[runType]);

  const signalen: Signal[] = [];
  for (const channel of availableProviders()) {
    const provider = getProvider(channel);
    if (!provider) continue;
    try {
      const beschikbaar = await provider.isAvailable(accountId);
      if (!beschikbaar) continue;
      const kanaalSignalen = await provider.collectSignals({ agencyId, accountId, runType, periodStart, periodEnd });
      signalen.push(...kanaalSignalen);
    } catch {
      // Eén kanaal dat faalt (netwerk, ontbrekende tabel) blokkeert de andere niet.
      continue;
    }
  }

  const hypotheses = signalHypothesisDiscovery.discover({ agencyId, accountId, signals: signalen, causes: [] });
  return hypotheses.map((h) => ({ id: h.id, statement: h.statement, category: classify(h) }));
}

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

/** De gedeelde afhandeling voor alle drie de decision-routes. Tenant-context komt uit de
 *  database via klantVanId, nooit uit de request-body zelf. */
export async function handleDecisionSkeleton(request: NextRequest, runType: DecisionRunType): Promise<Response> {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientIdOfFout = await leesClientId(request);
  if (typeof clientIdOfFout !== "string") return clientIdOfFout.fout;
  const clientId = clientIdOfFout;

  const tenant = await bepaalTenant(supabase, clientId);
  if ("fout" in tenant) return tenant.fout;

  const runId = crypto.randomUUID();
  const input: GateInput = {
    runId,
    agencyId: tenant.agencyId,
    accountId: clientId,
    analysisDate: today(),
  };

  const hypotheses = await verzamelHypotheses(tenant.agencyId, clientId, runType);

  return Response.json({
    runId,
    runType,
    agencyId: tenant.agencyId,
    accountId: clientId,
    status: "skeleton",
    providers: availableProviders(),
    hypotheses,
    gates: runGates(input),
    note: "Fase 2: providers en discovery leveren echte hypotheses, nog steeds geen schrijfactie en geen LLM-aanroep.",
  });
}

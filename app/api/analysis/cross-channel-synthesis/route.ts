// Kanaaloverstijgende SYNTHESE — de LLM-laag die lib/analysis/cross-channel-synthesis.ts bouwt
// (masterplan 17.12). Los van /api/analysis/cross-channel (volledig deterministisch, geen LLM):
// die route detecteert SIGNALEN tussen kanalen; deze route SYNTHETISEERT de al afgeronde
// eindconclusies van elk kanaal tot één samenhangend verhaal + acties, zodra de kanalen die deze
// cyclus een maandanalyse hebben allemaal in dezelfde cyclus zitten. Zie het bestand zelf voor de
// volledige toelichting op de poorten.
//
// Herbouwd 2 september 2026: de POST had geen enkele toegangscontrole (het klant-id zit in de
// body, waar de middleware niet kijkt) en gebruikte de kale getSupabase() — iedereen met een
// sessie kon zo een betaalde reasoning-call starten voor een klant van een ander bureau. Nu het
// route-eigen slot (vereisKlantToegangUitBody) en de demo-bewuste client, zoals elke andere
// POST-route die een LLM aanroept. Queries via eis(): een kapotte query is een 500 die zegt welke
// bron faalde, geen "wachten op Meta".

import { NextRequest } from "next/server";
import { getOpenRouterKey } from "@/lib/analysis/helpers";
import { runCrossChannelSynthesis, SOP_TYPE, SECTION } from "@/lib/analysis/cross-channel-synthesis";
import { eis, dataFoutNaarResponse, laatsteAfgeslotenMaandGrenzen } from "@/lib/analysis/db-veilig";
import { laadBeschikbareKanalen } from "@/lib/kanalen/beschikbaar";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";

// Zelfde reden als app/api/analysis/monthly/route.ts: zonder dit valt de route terug op Vercel's
// (veel kortere) platformdefault en breekt een lange analyse af met een platte foutpagina i.p.v.
// JSON, wat de client als "Unexpected token... is not valid JSON" laat zien in plaats van een
// bruikbare foutmelding.
// 600s sinds de upgrade naar Vercel Pro (mag in code tot 1800s) -- zelfde marge-redenering
// als app/api/analysis/monthly/route.ts, waar de kale Google-hoofdanalyse al 284-313s bleek
// te duren op de oude 300s-grens.
export const maxDuration = 600;

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
    const [rij] = eis<{ output: unknown; analysis_date: string }>(
      await supabase
        .from("sop_analysis_output")
        .select("output, analysis_date")
        .eq("client_id", clientId)
        .eq("sop_type", SOP_TYPE)
        .eq("section", SECTION)
        .order("analysis_date", { ascending: false })
        .limit(1),
      `sop_analysis_output (${SECTION})`
    );
    if (!rij?.output) return Response.json({ synthesis: null, analysisDate: null });

    try {
      const synthesis = typeof rij.output === "string" ? JSON.parse(rij.output) : rij.output;
      return Response.json({ synthesis, analysisDate: rij.analysis_date });
    } catch {
      // Een rij die er is maar niet leesbaar is, is iets anders dan "nog niet gedraaid"; de UI
      // toont in beide gevallen de lege staat, maar de datum en de vlag maken het verschil
      // zichtbaar voor wie in het antwoord kijkt.
      return Response.json({ synthesis: null, analysisDate: rij.analysis_date, onleesbaar: true });
    }
  } catch (e) {
    const f = dataFoutNaarResponse(e);
    if (f) return f;
    throw e;
  }
}

export async function POST(request: NextRequest) {
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  try {
    // "as never": zelfde workaround als trigger-sops/route.ts al gebruikt -- laadBeschikbareKanalen's
    // structurele parametertype laat TS bij een volle SupabaseClient "Type instantiation is
    // excessively deep and possibly infinite" geven, ondanks dat de vorm wel klopt.
    const beschikbareKanalen = await laadBeschikbareKanalen(supabase as never, clientId);
    const { start, eind } = laatsteAfgeslotenMaandGrenzen();

    const result = await runCrossChannelSynthesis({
      supabase,
      apiKey,
      clientId,
      beschikbareKanalen,
      analysisDate: today(),
      periodStart: start,
      periodEnd: eind,
    });

    // 409 en niet 200: de cron (app/api/cron/trigger-sops) en de UI-knop lezen een skip als
    // "nog niet aan de beurt", geen fout — en de reden zegt welk kanaal er ontbreekt of achterloopt.
    if (result.skipped) {
      return Response.json({ skipped: true, reason: result.reason }, { status: 409 });
    }
    return Response.json({
      skipped: false,
      synthesis: result.result,
      model: result.model,
      tokensUsed: result.tokensUsed,
      dekking: result.dekking,
    });
  } catch (e) {
    const f = dataFoutNaarResponse(e);
    if (f) return f;
    // Wél JSON en geen doorgooi: de aanroepers (UI-knop, cron) lezen `error` uit de body; een
    // platte Next-foutpagina leest daar als "Unexpected token" — zie de maxDuration-toelichting.
    return Response.json({ error: e instanceof Error ? e.message : "Synthese mislukt" }, { status: 500 });
  }
}

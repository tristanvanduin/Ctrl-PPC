// Portfolio-synthese (masterplan 17.15): de LLM-laag die lib/analysis/portfolio-synthesis.ts
// bouwt. Zelfde tier-gate als de bestaande Macro-portfolioroute (app/api/platform/agency-
// macrotrends/route.ts): vanaf Growth inbegrepen, geen aparte, nieuwe module -- dit hoort bij
// hetzelfde "eigen portfolio van het bureau"-scherm, niet bij God View (cross-agency, nog
// gebouwd:false) en niet bij cross-channel (blijft binnen 1 klant).
//
// Herbouwd 2 september 2026: de POST stond open voor client:read (een viewer kon een betaalde
// call starten) en elke query slikte zijn fout -- een kapotte agencies-query las als "Bureau niet
// gevonden" (403), een kapotte output-query als "nog geen synthese". Nu analysis:run voor de
// POST, eis() op elke query en een dekkingsblok in het antwoord dat zegt welke klanten wel en
// niet zijn meegenomen.

import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { heeftTenminste } from "@/lib/chat/toegang";
import { lijstAccountsMetSops } from "@/lib/tenancy/sop-dekking";
import { runPortfolioSynthesis, SECTION } from "@/lib/analysis/portfolio-synthesis";
import { getOpenRouterKey } from "@/lib/analysis/helpers";
import { eis, dataFoutNaarResponse, laatsteAfgeslotenMaandGrenzen } from "@/lib/analysis/db-veilig";
import { today } from "@/lib/reporting-date";

// Zelfde reden als app/api/analysis/monthly/route.ts: zonder dit valt de route terug op Vercel's
// (veel kortere) platformdefault en breekt een lange analyse af met een platte foutpagina i.p.v.
// JSON, wat de client als "Unexpected token... is not valid JSON" laat zien in plaats van een
// bruikbare foutmelding.
// 600s sinds de upgrade naar Vercel Pro (mag in code tot 1800s) -- zelfde marge-redenering
// als app/api/analysis/monthly/route.ts, waar de kale Google-hoofdanalyse al 284-313s bleek
// te duren op de oude 300s-grens.
export const maxDuration = 600;

export async function GET(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0];
  if (!agencyId) return Response.json({ error: "Geen bureau gekoppeld aan deze gebruiker" }, { status: 403 });

  try {
    const [rij] = eis<{ output: unknown; analysis_date: string }>(
      await admin
        .from("agency_analysis_output")
        .select("output, analysis_date")
        .eq("agency_id", agencyId)
        .eq("section", SECTION)
        .order("analysis_date", { ascending: false })
        .limit(1),
      `agency_analysis_output (${SECTION})`
    );
    if (!rij?.output) return Response.json({ synthesis: null, analysisDate: null });
    try {
      const synthesis = typeof rij.output === "string" ? JSON.parse(rij.output) : rij.output;
      return Response.json({ synthesis, analysisDate: rij.analysis_date });
    } catch {
      return Response.json({ synthesis: null, analysisDate: rij.analysis_date, onleesbaar: true });
    }
  } catch (e) {
    const f = dataFoutNaarResponse(e);
    if (f) return f;
    throw e;
  }
}

export async function POST(request: NextRequest) {
  // analysis:run, niet client:read: dit start een betaalde reasoning-call voor het hele bureau.
  const auth = await requireCapability("analysis:run");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0];
  if (!agencyId) return Response.json({ error: "Geen bureau gekoppeld aan deze gebruiker" }, { status: 403 });

  try {
    const [bureau] = eis<{ licentie: string | null }>(
      await admin.from("agencies").select("licentie").eq("id", agencyId).limit(1),
      "agencies"
    );
    if (!bureau) return Response.json({ error: "Bureau niet gevonden" }, { status: 403 });
    if (!heeftTenminste(bureau.licentie, "growth")) {
      return Response.json(
        { error: "Portfolio-synthese is vanaf de Growth-tier inbegrepen. Upgrade om dit te gebruiken." },
        { status: 403 }
      );
    }

    const apiKey = getOpenRouterKey();
    if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

    // lijstAccountsMetSops geeft null bij een leesfout (lib/tenancy/sop-dekking): dat is een
    // fout, geen lege portfolio.
    const clientIds = await lijstAccountsMetSops(admin, agencyId);
    if (clientIds == null) return Response.json({ error: "Kon de portfolio niet ophalen (accounts met sops_enabled)" }, { status: 500 });

    const accountRows = clientIds.length > 0
      ? eis<{ client_id: string; name: string | null }>(
          await admin.from("accounts").select("client_id, name").eq("agency_id", agencyId).in("client_id", clientIds),
          "accounts"
        )
      : [];
    const clients = accountRows.map((r) => ({ clientId: String(r.client_id), clientName: String(r.name ?? r.client_id) }));

    const { start, eind } = laatsteAfgeslotenMaandGrenzen();
    const result = await runPortfolioSynthesis({
      supabase: admin,
      apiKey,
      agencyId,
      clients,
      analysisDate: today(),
      periodStart: start,
      periodEnd: eind,
    });

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
    // JSON en geen doorgooi: de aanroeper leest `error` uit de body (zie de maxDuration-toelichting).
    return Response.json({ error: e instanceof Error ? e.message : "Portfolio-synthese mislukt" }, { status: 500 });
  }
}

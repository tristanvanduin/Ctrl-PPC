// De spar-assistent: één gesprek per klant, met de actuele cijfers en het hypothese-logboek als
// verborgen context.
//
// ── WAAROM DIT EEN ROUTE HANDLER IS EN GEEN EDGE FUNCTION ───────────────────
//
// De opdracht vroeg om een Supabase Edge Function. Die zijn er in dit project niet: er is geen
// supabase/functions-map en alle 53 bestaande endpoints zijn Next route handlers. Een Edge
// Function zou een tweede runtime (Deno), een tweede deploypad, een tweede set secrets en een
// tweede auth-implementatie betekenen -- terwijl deze route de bureaugrens, supabaseForClient en
// recordUsage gratis meekrijgt. Dat is geen afwijking van de bedoeling maar de plek waar diezelfde
// bedoeling hier al woont.
//
// ── HET BUREAU KOMT UIT DE KLANT ────────────────────────────────────────────
//
// De licentiecheck heeft een bureau nodig. Dat leidt deze route af uit accounts.agency_id bij de
// klant waar het gesprek over gaat, en niet uit de sessie. Reden: het werkt vandaag (de
// enforcement staat nog uit, dus er is meestal geen sessie) én het blijft kloppen als de
// enforcement aangaat, want dan komt de sessiecontrole er BOVENOP en niet in plaats van.
//
// ── DE TOKENS GAAN NAAR llm_usage ───────────────────────────────────────────
//
// De opdracht noemde api_usage_logs. Die tabel bestaat hier niet; llm_usage wel, met precies de
// goede kolommen. Een insert naar een niet-bestaande tabel geeft in een fire-and-forget-call geen
// fout maar een genegeerde 404 -- alle kostenregistratie stil uit, en dat merk je pas als de
// rekening komt.

import { NextRequest } from "next/server";
import { getOpenRouterKey } from "@/lib/analysis/helpers";
import { callRouted, MODEL_CATALOG } from "@/lib/analysis/llm-router";
import { controleerPlafond, schatCallKosten } from "@/lib/analysis/uitgavenplafond";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { realServerClient, supabaseForClient } from "@/lib/demo/server-supabase";
import { magChatten, normaliseerLicentie, GEEN_LICENTIE_TEKST } from "@/lib/chat/toegang";
import {
  bouwSysteemPrompt, bouwGebruikersbericht,
  type Beurt, type Campagneregel, type Hypotheseregel, type Maandregel,
} from "@/lib/chat/context";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

/** Hoeveel tekens een vraag mag zijn. Ruim, maar niet ongelimiteerd: dit is invoer van buiten. */
const MAX_VRAAG = 4000;

/** Het antwoordbudget van een chatbeurt. Staat hier omdat de plafondschatting hem ook nodig heeft. */
const CHAT_MAX_TOKENS = 1500;

type Bureaugegevens = { agencyId: string; licentie: string; klantnaam: string };

/**
 * Zoekt het bureau en de licentie bij een klant.
 *
 * Geeft null als de klant bij geen enkel bureau hoort. Dat is streng en met opzet, net als in
 * app_can_read_client(): een klant zonder account-rij valt buiten het model, en dan is weigeren
 * het juiste antwoord in plaats van stilzwijgend doorlaten.
 */
async function zoekBureau(clientId: string): Promise<Bureaugegevens | null> {
  const db = realServerClient();
  if (!db) return null;
  const { data } = await db
    .from("accounts")
    .select("agency_id, name, agencies(licentie)")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data?.agency_id) return null;
  const bureau = data.agencies as unknown as { licentie?: string } | null;
  return {
    agencyId: String(data.agency_id),
    licentie: normaliseerLicentie(bureau?.licentie),
    klantnaam: String(data.name ?? clientId),
  };
}

/** De cijfers die als verborgen context meegaan. Faalt zacht: een leeg blok is beter dan een 500. */
async function haalContext(clientId: string): Promise<{
  kanalen: string[]; maanden: Maandregel[]; campagnes: Campagneregel[]; hypotheses: Hypotheseregel[];
}> {
  const db = supabaseForClient(clientId);
  const leeg = { kanalen: [], maanden: [], campagnes: [], hypotheses: [] };
  if (!db) return leeg;

  // Alles naast elkaar: vier onafhankelijke vragen, en de traagste bepaalt de wachttijd.
  const [maandRes, campagneRes, hypotheseRes, metaRes, linkedinRes] = await Promise.all([
    db.from("ads_account_monthly")
      .select("month, cost, clicks, impressions, conversions, conversions_value")
      .eq("client_id", clientId).order("month", { ascending: false }).limit(24),
    db.from("ads_campaign_monthly")
      .select("campaign_name, cost, clicks, conversions, conversions_value")
      .eq("client_id", clientId).order("cost", { ascending: false }).limit(60),
    db.from("sprint_hypotheses")
      .select("hypothesis, status, expected_result, measurement_metric, outcome, learning, accepted_at, evaluated_at, created_at")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(40),
    db.from("meta_account_daily").select("date").eq("client_id", clientId).limit(1),
    db.from("linkedin_account_daily").select("date").eq("client_id", clientId).limit(1),
  ]);

  const maanden = (maandRes.data ?? []) as Maandregel[];
  // Google telt als aanwezig zodra er een maandrij is -- dezelfde maatstaf als de kanaaltabs in
  // het dashboard, zodat de chat en het scherm niet van mening verschillen over wat er draait.
  const kanalen = [
    maanden.length > 0 ? "Google Ads" : null,
    (metaRes.data ?? []).length > 0 ? "Meta" : null,
    (linkedinRes.data ?? []).length > 0 ? "LinkedIn" : null,
  ].filter((k): k is string => k !== null);

  return {
    kanalen,
    maanden,
    campagnes: (campagneRes.data ?? []) as Campagneregel[],
    hypotheses: (hypotheseRes.data ?? []) as Hypotheseregel[],
  };
}

/**
 * GET /api/chat?client_id=x            → de gesprekken van dit bureau over deze klant
 * GET /api/chat?client_id=x&session_id=y → de berichten van één gesprek
 */
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!clientId) return Response.json({ error: "client_id ontbreekt" }, { status: 400 });

  const bureau = await zoekBureau(clientId);
  if (!bureau) return Response.json({ error: "Onbekende klant" }, { status: 404 });
  if (!magChatten(bureau.licentie)) {
    return Response.json({ error: GEEN_LICENTIE_TEKST, licentie: bureau.licentie }, { status: 403 });
  }

  const db = realServerClient();
  if (!db) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  if (sessionId) {
    // De sessie eerst nakijken op bureau: zonder die controle kan iemand met een gegokt
    // sessie-id de berichten van een ander bureau opvragen.
    const { data: sessie } = await db
      .from("chat_sessions").select("id, agency_id").eq("id", sessionId).maybeSingle();
    if (!sessie || String(sessie.agency_id) !== bureau.agencyId) {
      return Response.json({ error: "Gesprek niet gevonden" }, { status: 404 });
    }
    const { data: berichten } = await db
      .from("chat_messages")
      .select("id, rol, inhoud, model, prompt_tokens, completion_tokens, created_at")
      .eq("session_id", sessionId).order("created_at", { ascending: true });
    return Response.json({ berichten: berichten ?? [] });
  }

  const { data: sessies } = await db
    .from("chat_sessions")
    .select("id, titel, client_id, created_at, updated_at")
    .eq("agency_id", bureau.agencyId).eq("client_id", clientId)
    .order("updated_at", { ascending: false }).limit(30);
  // De klantnaam gaat mee: de aanroepende pagina (app/client/[clientId]/page.tsx) geeft
  // `name: clientId` door aan het dashboard, dus dáár is de naam het id. Hier staat de echte.
  return Response.json({
    sessies: sessies ?? [], licentie: bureau.licentie, klantnaam: bureau.klantnaam,
  });
}

/** POST /api/chat — body: { client_id, bericht, session_id? } */
export async function POST(request: NextRequest) {
  let body: { client_id?: string; bericht?: string; session_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldige body" }, { status: 400 });
  }

  const clientId = String(body.client_id ?? "").trim();
  const vraag = String(body.bericht ?? "").trim();
  if (!clientId) return Response.json({ error: "client_id ontbreekt" }, { status: 400 });
  if (!vraag) return Response.json({ error: "Leeg bericht" }, { status: 400 });
  if (vraag.length > MAX_VRAAG) {
    return Response.json({ error: `Bericht is te lang (max ${MAX_VRAAG} tekens)` }, { status: 400 });
  }

  const bureau = await zoekBureau(clientId);
  if (!bureau) return Response.json({ error: "Onbekende klant" }, { status: 404 });
  if (!magChatten(bureau.licentie)) {
    return Response.json({ error: GEEN_LICENTIE_TEKST, licentie: bureau.licentie }, { status: 403 });
  }

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "LLM-sleutel niet geconfigureerd" }, { status: 500 });

  const db = realServerClient();
  if (!db) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  // ── Het gesprek ───────────────────────────────────────────────────────────
  let sessionId = body.session_id ?? null;
  let historie: Beurt[] = [];

  if (sessionId) {
    const { data: sessie } = await db
      .from("chat_sessions").select("id, agency_id").eq("id", sessionId).maybeSingle();
    if (!sessie || String(sessie.agency_id) !== bureau.agencyId) {
      return Response.json({ error: "Gesprek niet gevonden" }, { status: 404 });
    }
    const { data: eerder } = await db
      .from("chat_messages").select("rol, inhoud")
      .eq("session_id", sessionId).order("created_at", { ascending: true });
    historie = (eerder ?? []) as Beurt[];
  } else {
    // De titel is de eerste vraag, afgekapt. Een gesprekkenlijst met tien keer "Nieuw gesprek" is
    // een lijst waarin je niets terugvindt.
    const titel = vraag.length > 60 ? `${vraag.slice(0, 57)}...` : vraag;
    const { data: nieuw, error } = await db
      .from("chat_sessions")
      .insert({ agency_id: bureau.agencyId, client_id: clientId, titel })
      .select("id").single();
    if (error || !nieuw) {
      logger.error("[chat] gesprek aanmaken mislukt", { error: error?.message });
      return Response.json({ error: "Gesprek aanmaken mislukt" }, { status: 500 });
    }
    sessionId = String(nieuw.id);
  }

  // ── De verborgen context ──────────────────────────────────────────────────
  const context = await haalContext(clientId);
  const { prompt: systeemPrompt, geschatteTokens } = bouwSysteemPrompt({
    klantnaam: bureau.klantnaam,
    clientId,
    kanalen: context.kanalen,
    maanden: context.maanden,
    campagnes: context.campagnes,
    hypotheses: context.hypotheses,
  });

  // ── Het maandplafond ──────────────────────────────────────────────────────
  //
  // Hier, en niet verderop: pas als de context is opgebouwd weten we hoeveel tokens deze beurt
  // gaat kosten, en dat moet in de schatting mee (zie keuze 1 in uitgavenplafond.ts). Maar nog
  // vóór de vraag wordt weggeschreven, want een geblokkeerde beurt hoort niet als onbeantwoord
  // bericht in het gesprek te blijven staan.
  //
  // Zonder LLM_MAAND_PLAFOND_EUR verandert er niets: dan is het oordeel "geen_plafond" en doet
  // deze controle één env-lookup en geen databasequery.
  const plafond = await controleerPlafond(
    db,
    schatCallKosten(MODEL_CATALOG.strong, geschatteTokens, CHAT_MAX_TOKENS)
  );
  if (plafond.blokkeert) {
    logger.warn("[chat] geweigerd op maandplafond", { clientId, tekort: plafond.tekort });
    return Response.json({ error: plafond.tekst, session_id: sessionId }, { status: 429 });
  }

  // De vraag van de gebruiker eerst wegschrijven. Gaat de LLM-call daarna stuk, dan staat zijn
  // bericht er nog -- anders typt hij iets, ziet hij een foutmelding en is zijn tekst weg.
  await db.from("chat_messages").insert({ session_id: sessionId, rol: "user", inhoud: vraag });

  let antwoord: Awaited<ReturnType<typeof callRouted>>;
  try {
    antwoord = await callRouted({
      apiKey,
      systemPrompt: systeemPrompt,
      userMessage: bouwGebruikersbericht(historie, vraag),
      label: "chat",
      maxTokens: CHAT_MAX_TOKENS,
      temperature: 0.3,   // hoger dan de analyses (0): dit is een gesprek, geen rapportage
    });
  } catch (e) {
    logger.error("[chat] LLM-call mislukt", { error: e instanceof Error ? e.message : String(e) });
    return Response.json(
      { error: "Het model gaf geen antwoord. Probeer het opnieuw.", session_id: sessionId },
      { status: 502 }
    );
  }

  await db.from("chat_messages").insert({
    session_id: sessionId,
    rol: "assistant",
    inhoud: antwoord.output,
    model: antwoord.model,
    prompt_tokens: antwoord.promptTokens,
    completion_tokens: antwoord.completionTokens,
  });
  await db.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);

  // Het kostengrootboek. Dezelfde weg als alle analyses, zodat het chatverbruik straks in
  // dezelfde sommen meetelt als de rest -- en zodat het budgetplafond er maar één hoeft te lezen.
  void recordUsage(db, {
    runKey: `chat-${sessionId}`,
    clientId,
    callLabel: "chat",
    model: antwoord.model,
    promptTokens: antwoord.promptTokens,
    completionTokens: antwoord.completionTokens,
    cachedPromptTokens: antwoord.cachedPromptTokens,
  });

  return Response.json({
    session_id: sessionId,
    antwoord: antwoord.output,
    model: antwoord.model,
    verbruik: {
      prompt_tokens: antwoord.promptTokens,
      completion_tokens: antwoord.completionTokens,
      gecacht: antwoord.cachedPromptTokens,
      // De schatting náást het echte getal: loopt dat ver uiteen, dan klopt de aanname van
      // 4 tekens per token niet meer en is de begrenzing in context.ts aan herijking toe.
      geschat_systeem: geschatteTokens,
    },
  });
}

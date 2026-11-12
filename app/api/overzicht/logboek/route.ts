import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isDemoRequest } from "@/lib/demo/server-supabase";
import { leesLogboek } from "@/lib/overzicht/logboek-lezer";
import { clientIdsUitVerzoek } from "@/lib/auth/roles";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";

/**
 * GET /api/overzicht/logboek?clientId=xxx
 *
 * Het logboek "Wat er gebeurde" van één klant (bouwplan fase 4): meldingen, syncs en wissels in de
 * datastand, afgeronde analyses, voorstellen, beoordeelde hypothesen, notities en to-do's, in één
 * antwoord. Het Overzicht vraagt dit één keer bij het laden; een wissel van kanaal of periode
 * filtert in de browser en komt hier niet terug. Zie lib/overzicht/logboek.ts voor wat een regel
 * is, en lib/overzicht/logboek-lezer.ts voor de bronnen.
 *
 * TOEGANG, op twee plekken. De poortwachter (middleware.ts) eist een sessie, het recht client:read
 * (een GET zonder eigen regel in capabilityForApi), en dat elk klant-id in het verzoek binnen de
 * scope van de gebruiker valt. Daar leunt deze route niet op, want hij leest hierna met de
 * service-role en dus zonder RLS:
 *   1. Het verzoek noemt precies één klant. clientIdsUitVerzoek is dezelfde functie waarmee de
 *      poortwachter de id's leest; noemt het verzoek er twee (?client_id=a&clientId=b, of twee
 *      keer clientId), dan is het een 400. Er is dus geen id dat de één toetst en de ander leest.
 *   2. Op precies dat id toetst de route zelf het recht en de scope (vereisKlantToegangUitBody,
 *      achter dezelfde schakelaar O1_AUTH_ENFORCED als de poortwachter).
 *
 * ALLEEN LEZEN, met de service-role client net als de blended route. Voor de demoklant komen er
 * voorbeeldregels bij (klokrelatief, per stuk gemarkeerd); zonder Supabase-configuratie krijgt de
 * demo alleen die voorbeelden, en elke andere klant een 500, zoals bij de blended route.
 */
export async function GET(request: NextRequest) {
  const ids = clientIdsUitVerzoek(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (ids.length === 0) return Response.json({ error: "clientId is verplicht" }, { status: 400 });
  if (ids.length > 1) return Response.json({ error: "Het verzoek noemt meer dan één klant" }, { status: 400 });
  const clientId = ids[0];
  const geweigerd = await vereisKlantToegangUitBody(request, "client:read", clientId);
  if (geweigerd) return geweigerd;

  const demo = isDemoRequest(clientId);
  const supabase = getSupabaseAdmin();
  if (!supabase && !demo) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  return Response.json(await leesLogboek(supabase, clientId, { demo }));
}

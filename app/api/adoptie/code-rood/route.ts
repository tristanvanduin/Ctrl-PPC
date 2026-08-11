// Code Rood/Amber-meldingen: lezen (Today, dashboard-banner, sidebar) en reageren
// (accepteren/afwijzen). Tabel en RLS staan in scripts/migrations/073_code_rood_meldingen.sql
// (geschreven, niet toegepast) -- tot die migratie draait geeft GET hieronder gewoon een lege
// lijst terug (zie isTabelOntbreekt), zodat de rest van de app niet crasht op een tabel die er
// nog niet is.
//
// LET OP: er is nog GEEN detectiejob die hier daadwerkelijk rijen in schrijft. Deze route en de
// UI die hem aanroept zijn dus vandaag correct maar leeg -- ze tonen precies niets tot er een
// periodieke evaluatie bijkomt die lib/adoptie/code-rood.ts per klant aanroept en het resultaat
// hier upsert (met de service-role; er is bewust geen insert-policy voor authenticated).
//
// Scope-regel: lezen mag iedereen die de klant mag lezen (auth.scope, zelfde afleiding als
// overal); accepteren/afwijzen alleen bureau-brede rollen (zietHeleBureau), zelfde grens als de
// database-kant app_ziet_hele_bureau() in de migratie.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { zietHeleBureau, canAccessClient, ALL_CLIENTS } from "@/lib/auth/roles";
import type { SupabaseClient } from "@supabase/supabase-js";

interface MeldingRij {
  id: string;
  client_id: string;
  licht: "amber" | "rood";
  redenen: string[];
  gedetecteerd_op: string;
  status: "open" | "geaccepteerd" | "afgewezen";
  gereageerd_op: string | null;
}

// Zelfde controle als isProgressStorageUnavailableError in lib/progress/server.ts, hier los
// gehouden: die functie hoort semantisch bij generation-job-opslag, niet bij Code Rood.
function isTabelOntbreekt(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01"
    || (error.message ?? "").includes("schema cache")
    || (error.message ?? "").includes("Could not find the table");
}

async function naamPerKlant(admin: SupabaseClient, clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const { data } = await admin.from("accounts").select("client_id, name").in("client_id", clientIds);
  const kaart = new Map<string, string>();
  for (const r of (data ?? []) as { client_id: string; name: string | null }[]) {
    kaart.set(r.client_id, r.name ?? r.client_id);
  }
  return kaart;
}

export async function GET() {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  if (auth.scope !== ALL_CLIENTS && auth.scope.length === 0) {
    return Response.json({ ok: true, magReageren: false, meldingen: [] });
  }

  let query = admin.from("code_rood_meldingen").select("*").order("gedetecteerd_op", { ascending: false });
  if (auth.scope !== ALL_CLIENTS) query = query.in("client_id", auth.scope as string[]);
  const { data, error } = await query;

  if (error) {
    if (isTabelOntbreekt(error)) return Response.json({ ok: true, magReageren: false, meldingen: [] });
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rijen = (data ?? []) as MeldingRij[];
  const namen = await naamPerKlant(admin, [...new Set(rijen.map((r) => r.client_id))]);

  return Response.json({
    ok: true,
    magReageren: zietHeleBureau(auth.role),
    meldingen: rijen.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      clientNaam: namen.get(r.client_id) ?? r.client_id,
      licht: r.licht,
      redenen: r.redenen,
      gedetecteerdOp: r.gedetecteerd_op,
      status: r.status,
      gereageerdOp: r.gereageerd_op,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  if (!zietHeleBureau(auth.role)) {
    return Response.json(
      { error: "Alleen bureau-brede rollen mogen een Code Rood/Amber-melding accepteren of afwijzen." },
      { status: 403 }
    );
  }
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const body = await request.json().catch(() => null) as { id?: unknown; actie?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  const actie = body?.actie === "accepteren" || body?.actie === "afwijzen" ? body.actie : null;
  if (!id || !actie) {
    return Response.json({ error: "id en actie ('accepteren'|'afwijzen') zijn verplicht" }, { status: 400 });
  }

  const { data: melding, error: leesFout } = await admin
    .from("code_rood_meldingen").select("client_id, status").eq("id", id).maybeSingle();
  if (leesFout) {
    if (isTabelOntbreekt(leesFout)) return Response.json({ error: "Migratie 073 is nog niet toegepast" }, { status: 500 });
    return Response.json({ error: leesFout.message }, { status: 500 });
  }
  if (!melding) return Response.json({ error: "Melding niet gevonden" }, { status: 404 });
  if (!canAccessClient(auth.scope, melding.client_id)) {
    return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
  }
  if (melding.status !== "open") {
    return Response.json({ error: `Melding is al ${melding.status}` }, { status: 409 });
  }

  const status = actie === "accepteren" ? "geaccepteerd" : "afgewezen";
  const { error: schrijfFout } = await admin
    .from("code_rood_meldingen")
    .update({ status, gereageerd_door: auth.id, gereageerd_op: new Date().toISOString() })
    .eq("id", id);
  if (schrijfFout) return Response.json({ error: schrijfFout.message }, { status: 500 });

  return Response.json({ ok: true, status });
}

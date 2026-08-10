// Whitelabel per bureau: aan/uit, alleen door een platformbeheerder. Zelfde poort als de rest
// van /api/admin/* (requireCapability("user:manage"), zie de toelichting in
// app/api/admin/adoptie/route.ts). Geen bureau zet dit voor zichzelf aan; het is een knop op het
// beheerscherm, niet op de instellingenpagina van het bureau zelf.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const { data, error } = await admin.from("agencies").select("id, name, whitelabel_actief").order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ agencies: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const body = await request.json().catch(() => null) as { agencyId?: string; actief?: boolean } | null;
  if (!body?.agencyId || typeof body.actief !== "boolean") {
    return Response.json({ error: "agencyId en actief (boolean) zijn verplicht" }, { status: 400 });
  }

  const { error } = await admin.from("agencies").update({ whitelabel_actief: body.actief }).eq("id", body.agencyId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

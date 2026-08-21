// Volledige branding per klant: aan/uit, alleen door een platformbeheerder. Zelfde poort en
// vorm als app/api/admin/whitelabel/route.ts, nu client_id-gesleuteld i.p.v. agency_id. Geen
// klant zet dit voor zichzelf aan -- dit is precies waarom er geen zelfbedienings-toggle op de
// eigen instellingenpagina staat, en met opzet geen klantnaam-check in de code (zie migratie 101).

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const { data, error } = await admin
    .from("client_settings")
    .select("full_branding_enabled")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ fullBrandingEnabled: data?.full_branding_enabled ?? false });
}

export async function POST(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const body = await request.json().catch(() => null) as { clientId?: string; actief?: boolean } | null;
  if (!body?.clientId || typeof body.actief !== "boolean") {
    return Response.json({ error: "clientId en actief (boolean) zijn verplicht" }, { status: 400 });
  }

  const { error } = await admin
    .from("client_settings")
    .upsert({ client_id: body.clientId, full_branding_enabled: body.actief });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

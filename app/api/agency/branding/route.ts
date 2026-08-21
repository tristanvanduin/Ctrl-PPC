// Bureau-brede huisstijlkleuren: zelfbediening voor het eigen bureau, zodra whitelabel_actief
// staat -- zelfde voorwaarde en scope-check als de logo-upload (migratie 068's storage-policies,
// components/dashboard/agency-branding-section.tsx). agencies staat met opzet niet in de
// generieke /api/data/[table]-tabellenlijst (lib/data-access/read-policy.ts): bureau-brede
// kleuren zijn geen tabel die elke ingelogde gebruiker via die route zou moeten kunnen lezen/
// schrijven, alleen leden van het eigen bureau, en alleen met whitelabel_actief.

import { getAuthUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });

  const agencyId = new URL(request.url).searchParams.get("agencyId");
  if (!agencyId) return Response.json({ error: "agencyId is verplicht" }, { status: 400 });
  if (!user.agencyIds.includes(agencyId)) {
    return Response.json({ error: "Geen toegang tot dit bureau" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const { data, error } = await admin
    .from("agencies")
    .select("whitelabel_actief, brand_guide")
    .eq("id", agencyId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.whitelabel_actief) return Response.json({ error: "Whitelabel staat niet aan voor dit bureau" }, { status: 403 });
  return Response.json({ brandGuide: data.brand_guide ?? {} });
}

export async function PATCH(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await request.json().catch(() => null) as { agencyId?: string; brandGuide?: unknown } | null;
  if (!body?.agencyId || typeof body.brandGuide !== "object" || body.brandGuide === null) {
    return Response.json({ error: "agencyId en brandGuide zijn verplicht" }, { status: 400 });
  }
  if (!user.agencyIds.includes(body.agencyId)) {
    return Response.json({ error: "Geen toegang tot dit bureau" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  // Zelfde voorwaarde nogmaals server-side gecontroleerd, niet alleen client-side aangenomen:
  // whitelabel_actief kan tussen laden en opslaan zijn uitgezet door een platformbeheerder.
  const { data: agency } = await admin.from("agencies").select("whitelabel_actief").eq("id", body.agencyId).maybeSingle();
  if (!agency?.whitelabel_actief) return Response.json({ error: "Whitelabel staat niet aan voor dit bureau" }, { status: 403 });

  const { error } = await admin.from("agencies").update({ brand_guide: body.brandGuide }).eq("id", body.agencyId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

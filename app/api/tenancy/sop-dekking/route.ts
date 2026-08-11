// Zelfbedieningsroute voor de SOP-dekkingsmelding: het eigen bureau zijn dekkingsstatus laten
// zien, en toestaan dat het zelf accounts uitschakelt om weer binnen de dekking te komen.
//
// settings:write en niet user:manage: dit is geen platformbeheer (zoals whitelabel), maar iets
// wat een performance marketeer voor zijn EIGEN bureau moet kunnen doen. De bureaugrens zit in de
// POST: een account mag alleen gezet worden als het bij een van de eigen agencyIds hoort, anders
// zou deze route een zijdeur zijn om een ander bureau se SOP's uit te zetten.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { controleerDekking } from "@/lib/tenancy/sop-dekking";

export async function GET() {
  const auth = await requireCapability("settings:write");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0];
  if (!agencyId) return Response.json({ oordeel: null, accounts: [] });

  const [oordeel, accountsRes] = await Promise.all([
    controleerDekking(admin, agencyId),
    admin.from("accounts").select("id, name, sops_enabled").eq("agency_id", agencyId).order("name"),
  ]);

  return Response.json({ oordeel, accounts: accountsRes.data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireCapability("settings:write");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const body = await request.json().catch(() => null) as { accountId?: string; enabled?: boolean } | null;
  if (!body?.accountId || typeof body.enabled !== "boolean") {
    return Response.json({ error: "accountId en enabled (boolean) zijn verplicht" }, { status: 400 });
  }

  // Bureaugrens: het account moet bij het eigen bureau horen, ongeacht wat de client meestuurt.
  const { data: account } = await admin.from("accounts").select("agency_id").eq("id", body.accountId).maybeSingle();
  if (!account || !auth.agencyIds.includes(account.agency_id)) {
    return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
  }

  const { error } = await admin.from("accounts").update({ sops_enabled: body.enabled }).eq("id", body.accountId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

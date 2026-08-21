// Mag het hele dashboard-chrome (niet alleen de hero) meekleuren met de brand_guide van deze
// klant? Ja als een platformbeheerder dat expliciet aanzette voor deze klant
// (client_settings.full_branding_enabled), of als het eigen bureau whitelabel afneemt
// (agencies.whitelabel_actief) -- zie migratie 101 voor de volledige motivering.
//
// Eigen route i.p.v. twee aparte /api/data/[table]-aanroepen: accounts en agencies staan met
// opzet niet in die generieke tabellenlijst (lib/data-access/read-policy.ts), en
// BrandThemeProvider heeft dit op elke klantpaginalaad nodig -- één join, server-side, geen
// N+1 vanuit de browser. Alleen een boolean naar buiten, geen gevoelige data.

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ fullBrandingEnabled: false });

  const [{ data: account }, { data: settings }] = await Promise.all([
    admin.from("accounts").select("agency_id").eq("client_id", clientId).maybeSingle(),
    admin.from("client_settings").select("full_branding_enabled").eq("client_id", clientId).maybeSingle(),
  ]);

  if (settings?.full_branding_enabled) return Response.json({ fullBrandingEnabled: true });
  if (!account?.agency_id) return Response.json({ fullBrandingEnabled: false });

  const { data: agency } = await admin.from("agencies").select("whitelabel_actief").eq("id", account.agency_id).maybeSingle();
  return Response.json({ fullBrandingEnabled: Boolean(agency?.whitelabel_actief) });
}

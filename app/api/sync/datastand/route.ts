// De datastand van het hele bureau, voor de banner boven elke pagina (components/layout/
// datastand-banner.tsx): staat de Google-sync stil, en voor hoeveel klanten?
//
// client:read volstaat: dit verklapt niets wat de klantbadge niet ook al zegt, en juist een
// meekijker hoort te weten dat de cijfers van april zijn. De scope van de gebruiker beperkt
// welke klanten meetellen; de klantenlijst komt uit accounts (bureaugebonden), niet uit het
// globale app_settings-blob. Een queryfout is een 500 met de tabel erbij, geen lege banner.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { canAccessClient } from "@/lib/auth/roles";
import { synckandidaten } from "@/lib/tenancy/klanten";
import { datastandVoorBureau, samenvatDatastanden } from "@/lib/sync/datastand";
import { dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

export async function GET() {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0] ?? null;
  if (!agencyId && !auth.isPlatform) return Response.json({ samenvatting: samenvatDatastanden([]), klanten: [] });

  try {
    const kandidaten = (await synckandidaten(admin, { bron: "google-ads", agencyId }))
      .filter((k) => canAccessClient(auth.scope, k.clientId))
      .map((k) => ({ clientId: k.clientId, naam: k.naam }));
    const standen = await datastandVoorBureau(admin, kandidaten);
    return Response.json({
      samenvatting: samenvatDatastanden(standen),
      klanten: standen.map((s) => ({ clientId: s.clientId, naam: s.naam, toestand: s.stand.toestand, laatsteMaand: s.stand.laatsteMaand, laatsteGeslaagdeSync: s.stand.laatsteGeslaagdeSync })),
    });
  } catch (e) {
    return dataFoutNaarResponse(e) ?? Response.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: 500 });
  }
}

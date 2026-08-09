// Bulk-invulscherm voor bedrijfsmodel en niche: één tabel voor alle klanten tegelijk, in plaats
// van client-settings.tsx met zijn 71 aparte paginabezoeken.
//
// ── WAAROM DIT SERVER-SIDE EN NIET VIA DE BESTAANDE SCHRIJFROUTE ────────────
//
// app/api/data/[table]/route.ts (lib/data-access/write-policy.ts) kan client_settings al
// upserten, maar dwingt PER AANROEP precies één client_id af -- terecht voor de instellingen
// van een klant, onbruikbaar voor 71 klanten van verschillende bureaus in één keer. Dit volgt
// daarom het patroon van app/api/admin/users/route.ts: een platformbrede admin-actie met de
// service role, buiten de per-klant schrijfroute om.
//
// ── DE UPSERT RAAKT ALLEEN DEZE TWEE KOLOMMEN ────────────────────────────────
//
// De payload bevat uitsluitend client_id, bedrijfsmodel, niche en updated_at. Geverifieerd op
// 9 augustus 2026 met een losse testrij: een upsert met alleen die kolommen liet een gezette
// conversion_actions en kpi_targets op een bestaande rij ongewijzigd -- PostgREST past bij
// resolution=merge-duplicates alleen de kolommen toe die in de payload staan. Zie ook
// saveClientSettings in lib/client-settings.ts, dat wél de volledige rij schrijft omdat het per
// klant alle velden in de hand heeft; hier is dat expliciet niet de bedoeling.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { BEDRIJFSMODELLEN, normaliseerNiche, type Bedrijfsmodel } from "@/lib/benchmark/segment";

function adminUnavailable(): Response {
  return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
}

const GELDIGE_MODELLEN = new Set<string>(BEDRIJFSMODELLEN.map((m) => m.waarde));

export async function GET() {
  const auth = await requireCapability("settings:write");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const [{ data: accounts, error: accountsError }, { data: agencies }, { data: instellingen }] = await Promise.all([
    admin.from("accounts").select("client_id, name, agency_id"),
    admin.from("agencies").select("id, name"),
    admin.from("client_settings").select("client_id, bedrijfsmodel, niche"),
  ]);
  if (accountsError) return Response.json({ error: accountsError.message }, { status: 500 });

  const agencyNaam = new Map((agencies ?? []).map((a) => [String(a.id), String(a.name)]));
  const perKlant = new Map(
    (instellingen ?? []).map((r) => [
      String(r.client_id),
      r as { bedrijfsmodel: string | null; niche: string | null },
    ])
  );

  const rijen = (accounts ?? [])
    .map((a) => {
      const s = perKlant.get(String(a.client_id));
      const agencyId = a.agency_id ? String(a.agency_id) : null;
      return {
        clientId: String(a.client_id),
        naam: (a.name as string | null) ?? String(a.client_id),
        agencyNaam: agencyId ? (agencyNaam.get(agencyId) ?? "Onbekend bureau") : "Geen bureau",
        bedrijfsmodel: s?.bedrijfsmodel ?? null,
        niche: s?.niche ?? null,
      };
    })
    .sort((x, y) => x.agencyNaam.localeCompare(y.agencyNaam) || x.naam.localeCompare(y.naam));

  return Response.json({ rijen });
}

interface RijInput {
  clientId?: string;
  bedrijfsmodel?: string | null;
  niche?: string | null;
}

export async function POST(request: Request) {
  const auth = await requireCapability("settings:write");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as { rijen?: RijInput[] } | null;
  const invoer = body?.rijen ?? [];
  if (invoer.length === 0) return Response.json({ error: "geen rijen" }, { status: 400 });

  const nu = new Date().toISOString();
  const upsertRijen: Record<string, unknown>[] = [];
  for (const r of invoer) {
    if (!r.clientId) return Response.json({ error: "clientId ontbreekt in een rij" }, { status: 400 });
    if (r.bedrijfsmodel != null && !GELDIGE_MODELLEN.has(r.bedrijfsmodel)) {
      return Response.json({ error: `onbekend bedrijfsmodel: ${r.bedrijfsmodel}` }, { status: 400 });
    }
    upsertRijen.push({
      client_id: r.clientId,
      bedrijfsmodel: (r.bedrijfsmodel as Bedrijfsmodel | null) ?? null,
      niche: normaliseerNiche(r.niche),
      updated_at: nu,
    });
  }

  const { error } = await admin
    .from("client_settings")
    .upsert(upsertRijen, { onConflict: "client_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, aantal: upsertRijen.length });
}

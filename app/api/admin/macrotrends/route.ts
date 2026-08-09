// Agency macro trends: één bureau tegen zijn eigen portfolio, gesegmenteerd op bedrijfsmodel en
// niche. Dit is de aggregatielaag uit de Playbook-blueprint ("agency_macro_trends"): voordat een
// analyse een dalende CVR bij account X als een fout van dat account bestempelt, kan hij eerst
// vragen of het hele segment van dat bureau ook daalt.
//
// ── GEEN NIEUWE TABEL ─────────────────────────────────────────────────────
//
// De blueprint noemt "agency_macro_trends" als tabel, maar Fase 1 mag geen migratie doen tenzij
// nodig -- en dat is hij hier niet. blended_account_monthly (787 rijen, 63 klanten) is klein
// genoeg om live te aggregeren; een materialized tabel is pas nodig als dit traag wordt of als een
// analyse-route hem synchroon nodig heeft. Zie lib/macro/aggregate.ts voor de pure rekenkant.
//
// ── AGENCY-GESCOPED, NOOIT TUSSEN BUREAUS OPGETELD ─────────────────────────
//
// Elke cel draagt zijn agencyId. Zonder ?agencyId= geeft deze route cellen van ALLE bureaus terug,
// maar nooit SAMENGEVOEGD -- bouwMacroTrends groepeert op agencyId, dus bureau A's cijfers landen
// nooit in bureau B's cel. Met O1_AUTH_ENFORCED uit is er nog geen sessie om "het eigen bureau"
// aan af te leiden (zie migratie 065's toelichting); zodra die er is, hoort hier een
// canAccessAgency-achtige check bij, net als canAccessClient in lib/data-access/write-policy.ts.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { bouwMacroTrends } from "@/lib/macro/aggregate";
import type { Bedrijfsmodel } from "@/lib/benchmark/segment";
import type { MacroInvoerRij } from "@/lib/macro/types";

function adminUnavailable(): Response {
  return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
}

/** Standaard: de laatste 6 maanden. Genoeg om een trend te zien, klein genoeg om snel te blijven. */
function standaardVanaf(): string {
  const nu = new Date();
  nu.setUTCMonth(nu.getUTCMonth() - 5, 1);
  return nu.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const url = new URL(request.url);
  const agencyIdFilter = url.searchParams.get("agencyId");
  const vanaf = url.searchParams.get("vanaf") ?? standaardVanaf();

  const [{ data: rijen, error: rijenError }, { data: accounts }, { data: instellingen }] = await Promise.all([
    admin.from("blended_account_monthly")
      .select("client_id, month, channel, impressions, clicks, spend, conversions, conversion_value, leads")
      .gte("month", vanaf),
    admin.from("accounts").select("client_id, agency_id"),
    admin.from("client_settings").select("client_id, bedrijfsmodel, niche"),
  ]);
  if (rijenError) return Response.json({ error: rijenError.message }, { status: 500 });

  const agencyPerKlant = new Map(
    (accounts ?? []).map((a) => [String(a.client_id), a.agency_id ? String(a.agency_id) : null])
  );
  const segmentPerKlant = new Map(
    (instellingen ?? []).map((r) => [
      String(r.client_id),
      { bedrijfsmodel: (r.bedrijfsmodel as Bedrijfsmodel | null) ?? null, niche: (r.niche as string | null) ?? null },
    ])
  );

  const invoer: MacroInvoerRij[] = [];
  for (const r of rijen ?? []) {
    const clientId = String(r.client_id);
    const agencyId = agencyPerKlant.get(clientId);
    // Een klant zonder bureau (of een bureau dat niet gevraagd is) telt niet mee -- een macro
    // trend zonder bekend bureau kan aan niemand worden toegeschreven.
    if (!agencyId) continue;
    if (agencyIdFilter && agencyId !== agencyIdFilter) continue;
    const segment = segmentPerKlant.get(clientId) ?? { bedrijfsmodel: null, niche: null };
    invoer.push({
      clientId,
      agencyId,
      channel: String(r.channel),
      maand: String(r.month).slice(0, 10),
      bedrijfsmodel: segment.bedrijfsmodel,
      niche: segment.niche,
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      spend: Number(r.spend ?? 0),
      conversions: Number(r.conversions ?? 0),
      conversionValue: Number(r.conversion_value ?? 0),
      leads: Number(r.leads ?? 0),
    });
  }

  const cellen = bouwMacroTrends(invoer);
  return Response.json({
    vanaf,
    aantalCellen: cellen.length,
    aantalKlantenIngelezen: new Set(invoer.map((r) => r.clientId)).size,
    cellen,
  });
}

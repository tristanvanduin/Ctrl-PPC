// Fase 5, Task 3: God Mode -- ongefilterde top10/bottom10 rankings, platform-breed, rauw (geen
// k-anonimiteit zoals BenchmarkSectie: wie hier komt ziet toch al alles, dus anonimiseren voegt
// niets toe en verbergt alleen waar het juist om gaat). Precies daarom is de server-side gate
// hier hard: alleen platform-brede scope (auth.scope === ALL_CLIENTS, membership in
// platform_beheerders, zie lib/auth/scope.ts) komt binnen. role === "admin" alleen is NIET
// genoeg -- een agency-admin zonder platform_beheerders-rij is org-breed maar bureau-gescoped,
// en zou hier anders alsnog elk ander bureau kunnen zien. Dit is dezelfde grens die
// /api/admin/macrotrends net kreeg, maar dan als harde 403 in plaats van een filter: er is hier
// geen "eigen bureau"-fallback, want God Mode is per definitie platform-breed.
//
// Bewust NIET onder /api/admin: die prefix vergt via de middleware user:manage, en een
// platform-brede gebruiker heeft dat recht niet per se (zie de toelichting hierboven -- de
// platform-check zit los van de rolnaam). Buiten elk specifiek prefix valt een GET terug op de
// standaardregel client:read; de ECHTE grens is de scope-check hieronder, niet het prefix.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ALL_CLIENTS } from "@/lib/auth/roles";
import { monthsAgo } from "@/lib/reporting-date";

export interface GodModeRow {
  clientId: string;
  name: string;
  agencyId: string | null;
  spend: number;
  conversions: number;
  conversionValue: number;
  roas: number | null;
}

export async function GET() {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  if (auth.scope !== ALL_CLIENTS) {
    return Response.json({ error: "God Mode is alleen platform-breed toegankelijk" }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  // monthsAgo(1) is Amsterdam-tijdzone-bewust (lib/reporting-date.ts); de lokale versie die hier
  // stond gebruikte new Date()/setUTCDate rechtstreeks, exact de valkuil die dat bestand zelf
  // documenteert -- tussen 00:00 en 02:00 Amsterdamse tijd op de 1e van de maand zegt UTC nog de
  // vorige dag, en dan wijst "laatste volledige maand" een maand te ver terug.
  const month = monthsAgo(1);
  const [{ data: rijen, error }, { data: accounts }] = await Promise.all([
    admin.from("blended_account_monthly")
      .select("client_id, spend, conversions, conversion_value")
      .eq("month", month),
    admin.from("accounts").select("client_id, agency_id, name"),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const namePerKlant = new Map((accounts ?? []).map((a) => [String(a.client_id), a.name ? String(a.name) : a.client_id]));
  const agencyPerKlant = new Map((accounts ?? []).map((a) => [String(a.client_id), a.agency_id ? String(a.agency_id) : null]));

  // Sommeer over kanalen heen per klant -- blended_account_monthly heeft één rij per kanaal.
  const perKlant = new Map<string, { spend: number; conversions: number; conversionValue: number }>();
  for (const r of rijen ?? []) {
    const clientId = String(r.client_id);
    const acc = perKlant.get(clientId) ?? { spend: 0, conversions: 0, conversionValue: 0 };
    acc.spend += Number(r.spend ?? 0);
    acc.conversions += Number(r.conversions ?? 0);
    acc.conversionValue += Number(r.conversion_value ?? 0);
    perKlant.set(clientId, acc);
  }

  const rows: GodModeRow[] = Array.from(perKlant.entries()).map(([clientId, agg]) => ({
    clientId,
    name: namePerKlant.get(clientId) ?? clientId,
    agencyId: agencyPerKlant.get(clientId) ?? null,
    spend: Math.round(agg.spend),
    conversions: Math.round(agg.conversions * 100) / 100,
    conversionValue: Math.round(agg.conversionValue),
    roas: agg.spend > 0 ? Math.round((agg.conversionValue / agg.spend) * 100) / 100 : null,
  }));

  const bySpendDesc = [...rows].sort((a, b) => b.spend - a.spend);
  const bySpendAsc = [...rows].sort((a, b) => a.spend - b.spend);

  return Response.json({
    month,
    accountCount: rows.length,
    top10: bySpendDesc.slice(0, 10),
    bottom10: bySpendAsc.slice(0, 10),
    all: rows, // rauw, ongefilterd -- voor de virtuele volledige tabel
  });
}

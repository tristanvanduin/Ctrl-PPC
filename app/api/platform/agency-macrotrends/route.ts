// Agency macro trends -- de EIGEN portfolio van een bureau, gesegmenteerd (Fase 5). Zelfde data en
// dezelfde bureaugrens als app/api/admin/macrotrends (zie lib/macro/run-macrotrends.ts voor de
// gedeelde logica), maar bewust NIET onder /api/admin: die prefix vergt via de middleware
// user:manage, en performance_marketeer -- de rol die dit scherm draait -- heeft dat recht niet
// (zie lib/auth/roles.ts, ROLE_CAPABILITIES). Buiten elk specifiek prefix valt een GET terug op de
// standaardregel client:read, en dat recht heeft performance_marketeer wel. De bureaugrens komt
// niet uit deze route maar uit runMacrotrends zelf, dus geen dubbele logica om uit sync te raken.
//
// NAAMGEVING: de component heet components/terminal/agency-god-view.tsx, maar dit is niet "God
// View" in de zin die het bureau er nu aan geeft (11 augustus 2026): God View is straks anoniem,
// bureau-overstijgend, over de hele database (dat bestaat al als bouwsteen in lib/benchmark/cel.ts
// en is nog niet klantzijdig ontsloten). Dit scherm hier is "Macro": de EIGEN klanten van het
// bureau, niet anoniem, agencyId altijd aanwezig (zie lib/macro/types.ts). Bestandsnaam bewust niet
// meteen hernoemd -- dat raakt meerdere imports voor een zuiver naamgevingsprobleem -- maar de
// tier-eis hieronder hoort bij "Macro": vanaf Growth inbegrepen, niet los te koop.
//
// TIER-GATE (11 augustus 2026): ontbrak volledig. Elke performance_marketeer, op elke tier
// (inclusief het gratis Basis-niveau), kon deze route aanroepen -- de pricing-pagina noemt dit een
// betaalde feature, de toegangscontrole handhaafde dat niet.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runMacrotrends, standaardVanaf } from "@/lib/macro/run-macrotrends";
import { heeftTenminste } from "@/lib/chat/toegang";

export async function GET(request: Request) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0];
  if (!agencyId) return Response.json({ error: "Geen bureau gekoppeld aan deze gebruiker" }, { status: 403 });
  const { data: bureau, error: bureauError } = await admin
    .from("agencies")
    .select("licentie")
    .eq("id", agencyId)
    .maybeSingle();
  if (bureauError || !bureau) return Response.json({ error: "Bureau niet gevonden" }, { status: 403 });
  if (!heeftTenminste(bureau.licentie, "growth")) {
    return Response.json(
      { error: "Macro-inzichten zijn vanaf de Growth-tier inbegrepen. Upgrade om dit scherm te gebruiken." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const vanaf = url.searchParams.get("vanaf") ?? standaardVanaf();
  // Bewust geen ?agencyId=-passthrough hier: dit scherm toont altijd de EIGEN bureaus van de
  // aanroeper, nooit een expliciet gekozen bureau -- dat is precies het verschil met de
  // admin-variant, die platform-brede callers wel op één bureau laat filteren.
  const outcome = await runMacrotrends(admin, auth, null, vanaf);
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json(outcome.result);
}

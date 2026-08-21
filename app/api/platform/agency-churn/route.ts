// Agency macro churn -- de EIGEN portfolio van een bureau, gesegmenteerd op churnrisico
// (rood/amber/groen). Zelfde bureaugrens en dezelfde tier-gate als app/api/platform/
// agency-macrotrends (zie lib/macro/run-macro-churn.ts voor de gedeelde logica): niet onder
// /api/admin, want dat vergt user:manage en performance_marketeer -- de rol die Agency God View
// draait -- heeft dat recht niet.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runMacroChurn } from "@/lib/macro/run-macro-churn";
import { heeftTenminste } from "@/lib/chat/toegang";

export async function GET() {
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

  // Bewust geen ?agencyId=-passthrough, zelfde reden als agency-macrotrends: dit scherm toont
  // altijd de EIGEN bureaus van de aanroeper.
  const outcome = await runMacroChurn(admin, auth, null);
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json(outcome.result);
}

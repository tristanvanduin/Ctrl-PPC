// Agency macro trends, Agency-God-View-variant (Fase 5). Zelfde data en dezelfde bureaugrens als
// app/api/admin/macrotrends (zie lib/macro/run-macrotrends.ts voor de gedeelde logica), maar
// bewust NIET onder /api/admin: die prefix vergt via de middleware user:manage, en
// performance_marketeer -- de rol die Agency God View draait -- heeft dat recht niet (zie
// lib/auth/roles.ts, ROLE_CAPABILITIES). Buiten elk specifiek prefix valt een GET terug op de
// standaardregel client:read, en dat recht heeft performance_marketeer wel. De bureaugrens komt
// niet uit deze route maar uit runMacrotrends zelf, dus geen dubbele logica om uit sync te raken.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runMacrotrends, standaardVanaf } from "@/lib/macro/run-macrotrends";

export async function GET(request: Request) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const url = new URL(request.url);
  const vanaf = url.searchParams.get("vanaf") ?? standaardVanaf();
  // Bewust geen ?agencyId=-passthrough hier: Agency God View toont altijd de EIGEN bureaus van de
  // aanroeper, nooit een expliciet gekozen bureau -- dat is precies het verschil met de
  // admin-variant, die platform-brede callers wel op één bureau laat filteren.
  const outcome = await runMacrotrends(admin, auth, null, vanaf);
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json(outcome.result);
}

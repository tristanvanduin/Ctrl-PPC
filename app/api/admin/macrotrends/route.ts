// Agency macro trends, admin-pagina-variant. Zie lib/macro/run-macrotrends.ts voor de gedeelde
// query/aggregatie-logica en de uitleg van de bureaugrens-fix (Fase 5). Deze route hangt bewust
// onder /api/admin: de middleware-regel voor dat prefix vergt user:manage, en dit is de route
// achter MacroTrendsPreview op /admin. Agency God View (performance_marketeer, geen user:manage)
// gebruikt de zusje-route app/api/platform/agency-macrotrends, niet deze.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { runMacrotrends, standaardVanaf } from "@/lib/macro/run-macrotrends";

export async function GET(request: Request) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const url = new URL(request.url);
  const agencyIdFilter = url.searchParams.get("agencyId");
  const vanaf = url.searchParams.get("vanaf") ?? standaardVanaf();

  const outcome = await runMacrotrends(admin, auth, agencyIdFilter, vanaf);
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json(outcome.result);
}

// De eigen identiteit, rol, rechten en beurs-scope, voor de UI-gating (useAccess). Elke
// ingelogde gebruiker mag de eigen rechten zien. De server-guards blijven de waarheid; dit
// endpoint bepaalt alleen wat de UI toont. LIVE-ONGETEST tot WL.3.

import { requireUser } from "@/lib/auth/server";

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  return Response.json({
    id: auth.id,
    email: auth.email,
    role: auth.role,
    capabilities: auth.capabilities,
    // "all" of een lijst. Dat onderscheid moet bewaard blijven: bij een nieuwe beurs is
    // "alle beurzen" iets anders dan "toevallig deze beurzen".
    scope: auth.scope,
  });
}

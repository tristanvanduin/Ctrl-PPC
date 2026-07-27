// =====================================================================
// Server-side guards voor route-handlers. LIVE-ONGETEST: sessie-cookies en de rol-lookup
// zijn pas tegen een echte Supabase-omgeving te verifieren. De centrale enforcement zit in
// middleware.ts (achter de O1_AUTH_ENFORCED-flag); deze helpers zijn voor fijnmazige checks
// binnen routes — met name de scope-check, want het beurs-id staat vaak in de body en die
// kan de middleware niet lezen zonder de stream op te eten.
// =====================================================================

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  can, canAccessClient, capabilitiesOf, normalizeRole, scopeFor,
  type Capability, type ClientScope, type Role,
} from "./roles";

export interface AuthUser {
  id: string;
  email: string | null;
  role: Role | null;
  scope: ClientScope;
  capabilities: readonly Capability[];
}

// Leest de ingelogde gebruiker plus rol en beurs-scope uit de sessie-cookies. Null zonder
// sessie of zonder Supabase-configuratie. Beide reads werken onder RLS via de
// eigen-rij-policies uit migratie 001 en 032.
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Route-handlers muteren hier geen cookies; sessie-refresh doet de middleware.
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: roleRow }, { data: clientRows }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_clients").select("client_id").eq("user_id", user.id),
  ]);

  const role = normalizeRole(roleRow?.role);
  const assigned = (clientRows ?? []).map((row) => String(row.client_id));
  return {
    id: user.id,
    email: user.email ?? null,
    role,
    scope: scopeFor(role, assigned),
    capabilities: capabilitiesOf(role),
  };
}

// Geeft de gebruiker terug, of een 401-Response die de route direct kan returnen.
export async function requireUser(): Promise<AuthUser | Response> {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  return user;
}

// Geeft de gebruiker terug mits het recht aanwezig is, anders een 401- of 403-Response.
export async function requireCapability(capability: Capability): Promise<AuthUser | Response> {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!can(user.role, capability)) {
    return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
  }
  return user;
}

// Recht plus scope in een keer: voor routes die het beurs-id uit de body halen. Bewust
// dezelfde 403 als bij een ontbrekend recht — of een beurs bestaat maar niet voor jou, of
// hij bestaat niet, is niets wat een 403 hoort te verklappen.
export async function requireClientAccess(
  capability: Capability,
  clientId: string | null | undefined,
): Promise<AuthUser | Response> {
  const user = await requireCapability(capability);
  if (user instanceof Response) return user;
  if (!canAccessClient(user.scope, clientId)) {
    return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
  }
  return user;
}

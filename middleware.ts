// =====================================================================
// Centrale toegangscontrole. VEILIG TE MERGEN: zonder O1_AUTH_ENFORCED=true is dit een
// pass-through en verandert er niets aan de app. De activatie is een bewuste WL.3-stap,
// gecoordineerd met migratie 001 en 032 (user_roles, user_clients plus de eerste
// admin-seed) en 017 (RLS-lockdown). LIVE-ONGETEST: sessies, cookies, redirects en de
// lookups zijn pas tegen een echte Supabase-omgeving te verifieren.
//
// De scope-check hier dekt het beurs-id in de querystring en in het paginapad. Staat het in
// een request-body, dan kan de middleware er niet bij zonder de stream op te eten; die
// routes gebruiken requireClientAccess uit lib/auth/server.ts.
// =====================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  isPublicPath, isCronPath, capabilityForApi, can, canAccessClient,
  clientIdFromPath, normalizeRole, scopeFor,
} from "@/lib/auth/roles";

export async function middleware(request: NextRequest) {
  if (process.env.O1_AUTH_ENFORCED !== "true") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Cron blijft op het bestaande CRON_SECRET-headerpatroon: de route valideert zelf.
  if (isCronPath(pathname)) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Enforcement zonder configuratie kan niet; expliciet loggen en doorlaten zodat een
    // misconfiguratie de app niet onzichtbaar plat legt.
    console.error("[middleware] O1_AUTH_ENFORCED staat aan maar Supabase-env ontbreekt");
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isApi = pathname.startsWith("/api/");
  if (!user) {
    if (isApi) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const [{ data: roleRow }, { data: clientRows }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_clients").select("client_id").eq("user_id", user.id),
  ]);
  const role = normalizeRole(roleRow?.role);
  const scope = scopeFor(role, (clientRows ?? []).map((row) => String(row.client_id)));

  const clientId = clientIdFromPath(pathname, request.nextUrl.searchParams);
  if (clientId && !canAccessClient(scope, clientId)) {
    if (isApi) return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isApi && !can(role, capabilityForApi(pathname, request.method))) {
    return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
  }

  return response;
}

export const config = {
  // Alles behalve de statische Next-assets; de fijnmazige uitzonderingen (login, auth,
  // bestanden, cron) zitten in het pure beleid hierboven.
  matcher: ["/((?!_next/static|_next/image).*)"],
};

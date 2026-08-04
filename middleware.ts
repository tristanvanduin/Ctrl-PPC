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
//
// ── WAAROM DIT NOG middleware.ts HEET EN GEEN proxy.ts ──────────────────────
//
// Next 16 schaft de naam `middleware` af en waarschuwt daarover bij elke build. De hernoeming
// is geprobeerd en TERUGGEDRAAID, want in 16.2.2 met Turbopack wordt proxy.ts niet
// geregistreerd. Gemeten aan .next/server/middleware-manifest.json na een schone build:
//
//   middleware.ts  →  "middleware": { "/": { ...matchers... } }
//   proxy.ts       →  "middleware": {}, "sortedMiddleware": []
//
// Zowel `export function proxy` als `export default` geprobeerd; beide leeg. De build meldt
// intussen wel "ƒ Proxy (Middleware)" in de routetabel, dus de build zegt ja terwijl het
// manifest nee zegt -- er is geen foutmelding die dit verklapt. Hernoemen zou de hele
// toegangscontrole stilzwijgend hebben uitgezet.
//
// Opnieuw proberen bij een volgende Next-versie, en dan het manifest controleren en niet de
// buildmelding geloven.
// =====================================================================

import { NextResponse, type NextRequest } from "next/server";
import { canoniekeDoelUrlVoorVerzoek } from "@/lib/domein";
import { createServerClient } from "@supabase/ssr";
import {
  isPublicPath, isCronPath, capabilityForApi, can, canAccessClient, clientIdFromPath,
} from "@/lib/auth/roles";
import { bepaalScope } from "@/lib/auth/scope";

export async function middleware(request: NextRequest) {
  // ── Canoniek domein ───────────────────────────────────────────────────────
  //
  // ctrlppc.com is de echte plek, ctrlppc.nl verwijst erheen. Dit staat BOVEN de auth-afslag met
  // opzet: het is een domeinkwestie en geen authkwestie, en zolang de enforcement uit staat zou de
  // doorverwijzing anders helemaal niet werken.
  //
  // Waarom dit ertoe doet en niet alleen netjes is: sessiecookies horen bij één domein. Logt
  // iemand in op .nl en komt hij daarna op .com, dan is zijn sessie weg zonder foutmelding. De
  // doorverwijzing vooraan zorgt dat er maar één domein is waarop dat kan gebeuren.
  //
  // 308 en geen 307: dit is een blijvende verhuizing, en zoekmachines mogen dat weten. De methode
  // blijft behouden, dus een POST die hier langskomt gaat niet stiekem als GET verder.
  //
  // NIET request.url, maar de host-header. Next normaliseert request.url naar het adres waarop
  // de server luistert; bij een verzoek met `Host: ctrlppc.nl` staat er gewoon
  // http://localhost:3190/... in. Deze regel keek daar naar en heeft dus nooit iets gedaan.
  // De uitleg en de meting staan bij canoniekeDoelUrlVoorVerzoek in lib/domein.ts.
  const canoniek = canoniekeDoelUrlVoorVerzoek(
    request.url,
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")
  );
  if (canoniek) return NextResponse.redirect(canoniek, 308);

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

  // Dezelfde afleiding als in lib/auth/server.ts, uit één bestand. Hier stond eerst een eigen
  // kopie die scopeFor() rechtstreeks aanriep, en die gaf voor een organisatiebrede rol
  // ALL_CLIENTS terug: élke klant van élk bureau. De bureaugrens uit migratie 057 was daarmee
  // wel in de database en in de routes doorgevoerd, maar niet in de poortwachter ervoor.
  const { role, scope } = await bepaalScope(supabase as never, user.id);

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

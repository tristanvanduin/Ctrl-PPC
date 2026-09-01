// =====================================================================
// Centrale toegangscontrole. VEILIG TE MERGEN: zonder O1_AUTH_ENFORCED=true is dit een
// pass-through en verandert er niets aan de app. De activatie is een bewuste WL.3-stap,
// gecoordineerd met migratie 001 en 032 (user_roles, user_clients plus de eerste
// admin-seed) en 017 (RLS-lockdown). Sessies, cookies, redirects en de lookups zijn
// inmiddels wél getest tegen de echte productie-Supabase (masterplan 15.7): publieke
// paden blijven publiek, beveiligde paden redirecten, eigen-bureau-toegang wordt
// toegelaten, andere-bureau-toegang geweigerd. O1_AUTH_ENFORCED=true staat desondanks nog
// NIET in productie -- dat vergt Vercel-toegang die deze sessie niet heeft.
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
//
// STAND 2026-08-05: dit project draait 16.2.2, en op npm staat 16.3.0. De voorwaarde voor een
// hertest is dus vervuld, maar een Next-upgrade is een aparte beslissing en geen bijproduct van
// een hernoeming. De volgorde als je het doet:
//
//   1. upgraden en de poorten draaien -- eerst zonder iets te hernoemen;
//   2. dan pas middleware.ts -> proxy.ts, schoon bouwen (.next weg), en
//      .next/server/middleware-manifest.json openen;
//   3. staat daar "middleware": {} met een lege sortedMiddleware, dan is er niets geregistreerd
//      en moet de hernoeming terug -- ook als de routetabel "ƒ Proxy (Middleware)" meldt.
//
// Draai stap 2 niet met een server aan: die serveert uit dezelfde .next.
// =====================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  isPublicPath, isCronPath, capabilityForApi, can, canAccessClient, clientIdFromPath,
} from "@/lib/auth/roles";
import { bepaalScope } from "@/lib/auth/scope";

export async function middleware(request: NextRequest) {
  // De www/non-www- en .nl->.com-doorverwijzing stond hier tot een productie-uitval met
  // ERR_TOO_MANY_REDIRECTS: Vercel doet die doorverwijzing sinds kort zelf op domeinniveau,
  // en de twee bleken elkaar te lussen. Verwijderd, niet uitgeschakeld -- de doorverwijzing
  // hoort nu op precies één plek te staan, niet op twee die elkaar kunnen tegenspreken.
  // lib/domein.ts en lib/__domein_test.ts zijn om dezelfde reden verwijderd.

  if (process.env.O1_AUTH_ENFORCED !== "true") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Cron blijft op het bestaande CRON_SECRET-headerpatroon: de route valideert zelf.
  if (isCronPath(pathname)) return NextResponse.next();

  // Interne server-naar-server-aanroepen dragen geen browsersessie maar wel het CRON_SECRET:
  // trigger-sops fetcht de analyse-routes op de eigen origin, en zonder deze doorgang zou het
  // AANZETTEN van de vlag alle automatische SOP-runs op de inlogwal laten stuklopen — precies
  // het soort activatieverrassing dat de /api/cron-paden al eens raakte (zie de bugfix-notitie
  // van 17 augustus in lib/auth/roles.ts). Zonder secret in de omgeving bestaat deze doorgang
  // niet (fail-closed);
  // de route-eigen checks (vereisKlantToegangUitBody) hanteren hetzelfde geheim.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

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
    // '/' is sinds Fase 5 de publieke marketingpagina, niet meer de ingelogde cockpit -- een
    // ingelogde gebruiker die hier terechtkomt hoort naar zijn eigen startpagina terug te gaan,
    // niet naar de uitlogpagina van het product.
    url.pathname = "/vandaag";
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

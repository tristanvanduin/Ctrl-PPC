// Het pure autorisatiebeleid: rollen, rechten, scope en padclassificatie op EEN plek, los
// testbaar zonder omgeving. De middleware en de server-guards consumeren dit beleid; de
// enforcement zelf staat achter de O1_AUTH_ENFORCED-flag tot de gecoordineerde activatie
// (samen met migratie 001, 032 en de eerste admin-seed).
//
// WAAROM DIT GEEN RANGORDE MEER IS
//
// De oorspronkelijke opzet was een ladder: viewer < specialist < admin, met een
// >=-vergelijking. Een ladder kan alleen "alles van de trede eronder" uitdrukken. Een
// multi-rol-organisatie past daar niet in:
//
//   - IT moet bij koppelingen en syncs, maar hoeft geen omzet per beurs te zien. Op een
//     ladder is de enige trede die koppelingen geeft admin, en die geeft ook alles.
//   - Een brand-strateeg ziet merk- en creatie-inzichten, geen budget- of biedinstellingen.
//     Er bestaat geen trede die "wel creatie, geen budget" betekent.
//
// Beide zijn ZIJWAARTSE rollen, geen hogere of lagere. Daarom rechten per rol als set.
//
// DE TWEEDE AS: SCOPE
//
// Rechten zeggen WAT je mag, scope zegt OVER WELKE BEURS. Iemand van Aquatech is geen
// mindere gebruiker dan een performance marketeer, hij ziet alleen een kleinere verzameling
// beurzen. Die twee assen zijn onafhankelijk: dezelfde rol met een andere scope, of dezelfde
// scope met een andere rol, zijn allebei zinnige combinaties.
//
// GRENZEN VAN DIT BESTAND
//
// Dit is beleid, geen beveiliging. Zolang de RLS-policies `using (true)` zijn en de browser
// met de anon key rechtstreeks Supabase bevraagt, is alles hieronder cosmetisch: het bepaalt
// wat de UI toont en wat de route-handlers weigeren, niet waar de database bij laat. De
// echte grens komt met migratie 017 (RLS-lockdown) plus 032 (scope-policies).

export const ROLES = [
  "admin",
  "performance_marketeer",
  "beurs_manager",
  "brand_strateeg",
  "it",
  "viewer",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * De rolnamen zoals ze in de database staan zijn technisch; dit is wat een mens leest.
 *
 * Stond als lokale const in app/admin/page.tsx. Zodra de sprintplanning dezelfde namen als
 * functiesuggestie aanbiedt zijn het er twee, en dan drift de ene versie van de andere weg —
 * precies waar de hygiënepoort op let. Hier hoort hij, naast de rollen zelf.
 */
export const ROL_LABEL: Record<Role, string> = {
  admin: "Admin",
  performance_marketeer: "Performance marketeer",
  beurs_manager: "Beursverantwoordelijke",
  brand_strateeg: "Brand strateeg",
  it: "IT",
  viewer: "Meekijker",
};

// De oude waarden staan OPGESLAGEN in user_roles.role. Ze blijven geldig tot migratie 032
// de rijen omzet; normalizeRole vertaalt bij het lezen. Zelfde patroon als OwnerEnum.
const LEGACY_ROLE_MAP = {
  specialist: "performance_marketeer",
} as const satisfies Record<string, Role>;

export type LegacyRole = keyof typeof LEGACY_ROLE_MAP;

// ── Rechten ────────────────────────────────────────────────────────────────

// Bewust grof: een recht per samenhangend stuk werk, niet per route. Te fijn en niemand
// houdt de tabel bij; te grof en de zijwaartse rollen passen er weer niet in.
export const CAPABILITIES = [
  "client:read",         // dashboards en rapportages van beurzen binnen de scope
  "insight:brand",       // creatie, merk, doelgroep, video
  "insight:performance", // budget, biedingen, kosten, ROAS, second opinion
  "analysis:run",        // SOP- en analyse-runs starten
  "settings:write",      // client-settings, targets, events, conversie-config
  "sprint:write",        // sprint, taken, hypotheses
  "sync:run",            // handmatige syncs
  "connection:manage",   // Google Ads-, Meta-, LinkedIn-, GA4- en Search Console-koppelingen
  "system:ops",          // health, eval-harness, generation-jobs, scripts
  "user:manage",         // gebruikersbeheer en scope-toewijzing
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  // Alles. Bewust als expliciete lijst en niet als "alle rechten": een nieuw recht hoort
  // een bewuste toewijzing te zijn, ook aan admin. Een test bewaakt dat admin compleet is.
  admin: CAPABILITIES,

  // De uitvoerende rol: alle beurzen, alle inzichten, mag draaien en instellen. Erft de
  // rechten van de oude "specialist" plus sync:run.
  performance_marketeer: [
    "client:read", "insight:brand", "insight:performance",
    "analysis:run", "settings:write", "sprint:write", "sync:run",
  ],

  // De beursverantwoordelijke: alles zien en de sprint sturen binnen de eigen beurs, maar
  // geen runs starten en geen instellingen wijzigen — dat blijft bij de marketeers.
  beurs_manager: ["client:read", "insight:brand", "insight:performance", "sprint:write"],

  // Merk en creatie, lezend. Geen budget, geen biedingen, geen instellingen.
  brand_strateeg: ["client:read", "insight:brand"],

  // Zijwaarts: de techniek eromheen. client:read zit erbij omdat je zonder te kijken of er
  // rijen binnenkomen geen sync kunt debuggen; de duiding van die cijfers (insight:*) niet.
  it: ["client:read", "sync:run", "connection:manage", "system:ops"],

  // Meekijken, verder niets.
  viewer: ["client:read"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// Accepteert zowel de huidige als de opgeslagen oude waarden. Onbekend blijft null: een
// onbekende rol mag nooit stilzwijgend als viewer doorgaan.
export function normalizeRole(value: unknown): Role | null {
  if (isRole(value)) return value;
  if (typeof value === "string" && value in LEGACY_ROLE_MAP) {
    return LEGACY_ROLE_MAP[value as LegacyRole];
  }
  return null;
}

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesOf(role: Role | null | undefined): readonly Capability[] {
  return role ? ROLE_CAPABILITIES[role] : [];
}

// ── Scope: over welke beurzen ──────────────────────────────────────────────

// "all" is geen lijst van alle beurs-ids maar een aparte waarde: een nieuwe beurs valt er
// dan automatisch onder, zonder dat iemand alle rijen moet bijwerken.
export const ALL_CLIENTS = "all" as const;
export type ClientScope = typeof ALL_CLIENTS | readonly string[];

export function canAccessClient(scope: ClientScope, clientId: string | null | undefined): boolean {
  if (!clientId) return false;
  if (scope === ALL_CLIENTS) return true;
  return scope.includes(clientId);
}

// Rollen die per definitie over alle beurzen gaan. Voor de overige rollen komt de scope uit
// user_clients; staat daar niets, dan is de scope leeg en niet stilzwijgend alles.
const ORGANISATION_WIDE_ROLES: readonly Role[] = ["admin", "performance_marketeer", "it"];

/**
 * Dezelfde rollenset als de database-kant `app_ziet_hele_bureau()` (migratie 057) -- de
 * "C-level"-rollen in dit model. Gebruikt om te bepalen wie een Code Rood/Amber-melding mag
 * accepteren/afwijzen (scripts/migrations/073_code_rood_meldingen.sql): een klant-gebonden
 * viewer/brand_strateeg mag de melding zien, niet de keuze maken die het account uit zijn
 * normale plek in de sidebar trekt.
 */
export function zietHeleBureau(role: Role | null | undefined): boolean {
  return !!role && ORGANISATION_WIDE_ROLES.includes(role);
}

export function scopeFor(role: Role | null | undefined, assigned: readonly string[]): ClientScope {
  if (!role) return [];
  if (ORGANISATION_WIDE_ROLES.includes(role)) return ALL_CLIENTS;
  return assigned;
}

// ── Padclassificatie ───────────────────────────────────────────────────────

// Publieke paden: login, auth-callbacks, Next-internals en statische assets.
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/auth/")) return true;
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return true;
  if (/\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$/i.test(pathname)) return true;
  // Fase 5: de publieke marketingpagina ('/', Hero + Global Platform Pulse) en de aggregaat-
  // totalen die ze toont. Zonder dit zou O1_AUTH_ENFORCED een bezoeker zonder sessie meteen naar
  // /login sturen voordat hij de marketingpagina ooit ziet -- precies wat een pre-login pagina
  // niet mag doen. /api/public/platform-pulse geeft uitsluitend SOM/COUNT-aggregaten terug (zie
  // die route), geen per-klant data, dus zonder sessie blootstellen is hier geen risico.
  if (pathname === "/" || pathname === "/api/public/platform-pulse") return true;
  // Fase 7: de rest van de marketingsite (app/(marketing)/). Ontbrak hier tot deze controle --
  // met O1_AUTH_ENFORCED aan zou een bezoeker zonder sessie op /pricing, /faq of /blog meteen
  // naar /login zijn gestuurd, dezelfde fout als hierboven maar dan voor drie nieuwe pagina's.
  if (pathname === "/pricing" || pathname === "/faq") return true;
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return true;
  // Ontbrak hier: /how-it-works en /vs zijn gebouwd na deze lijst en zijn er nooit aan
  // toegevoegd, waardoor O1_AUTH_ENFORCED elke bezoeker zonder sessie naar /login stuurde --
  // ook via "See the full loop" op de homepage, wiens link zelf wel correct naar
  // /how-it-works wijst. Gevonden doordat de site live achter een login bleek te zitten.
  if (pathname === "/how-it-works" || pathname === "/vs") return true;
  // De demo-CTA: het formulier zelf en de route waar het naar post moeten allebei zonder
  // sessie werken, want een bezoeker die een demo aanvraagt heeft er per definitie nog geen.
  if (pathname === "/demo" || pathname === "/api/public/demo-request") return true;
  // Privacy Statement en Algemene Voorwaarden. Dezelfde val als hierboven bij /how-it-works en
  // /vs, en hier zwaarder: een privacyverklaring die alleen na inloggen te lezen is, is precies
  // het tegenovergestelde van wat de AVG ermee bedoelt -- en de footer linkt ernaar vanaf elke
  // pagina, dus ook vanaf pagina's die een bezoeker zonder sessie bekijkt.
  if (pathname === "/privacy" || pathname === "/terms") return true;
  // /data-deletion moet zonder account leesbaar zijn: Meta vraagt de URL bij App Review op en
  // haalt hem zonder sessie op, en een betrokkene die verwijdering wil vragen heeft per definitie
  // geen werkend account meer -- of nooit een account gehad.
  if (pathname === "/data-deletion") return true;
  return false;
}

// Cron-paden blijven op het bestaande CRON_SECRET-headerpatroon: de route valideert de
// header zelf (zie app/api/sync/cron/route.ts en de vier routes onder app/api/cron/, allemaal
// fail-closed op CRON_SECRET); de middleware laat ze daarom door.
//
// BUG GEVONDEN EN GEFIXT (17 augustus 2026, live tegen productie geverifieerd): deze functie
// matchte alleen /api/sync/cron, niet /api/cron/*. vercel.json plant drie crons:
// /api/sync/cron (matchte al, gaf 200) en /api/cron/evaluate-hypotheses + /api/cron/
// evaluate-code-rood (matchten niet -- elke aanroep kreeg de inlogwal uit regel 93 van
// middleware.ts, {"error":"Niet ingelogd"}, VOORDAT de route zijn eigen CRON_SECRET-check ooit
// bereikte). Bevestigd met een echte curl tegen www.ctrlppc.com: /api/sync/cron gaf 200,
// /api/cron/evaluate-code-rood gaf 401. Verklaart waarom sprint_hypotheses.evaluated_at bij
// alle 127+ rijen leeg stond, ook bij hypotheses geaccepteerd op 7 april 2026 -- ruim buiten elk
// meetvenster: de wekelijkse evaluatiecron heeft sindsdien nooit succesvol gedraaid.
// app/api/cron/process-action-queue en trigger-sops (nog niet in vercel.json, zie de eigen
// bestandskop) hadden dezelfde blokkade zodra ze wel geactiveerd worden.
export function isCronPath(pathname: string): boolean {
  return pathname === "/api/sync/cron" || pathname.startsWith("/api/sync/cron/") ||
    pathname.startsWith("/api/cron/");
}

// Het benodigde recht per API-verzoek. Volgorde is significant: de eerste match wint, dus
// de smalle prefixen staan boven de brede.
const API_RULES: readonly { prefix: string; read?: Capability; write?: Capability }[] = [
  { prefix: "/api/admin", read: "user:manage", write: "user:manage" },
  { prefix: "/api/users", read: "user:manage", write: "user:manage" },
  { prefix: "/api/invite", read: "user:manage", write: "user:manage" },
  // De lijst met toewijsbare collega's. Lezen vergt hier het recht om te MOGEN toewijzen, niet
  // het recht om te lezen: wie geen sprinttaak kan wijzigen, heeft geen reden de namen van het
  // team op te vragen. Zonder deze regel zou de standaard `client:read` gelden en zou een
  // meekijker de lijst kunnen ophalen — de route weigert dat zelf ook, maar dan pas erna.
  { prefix: "/api/team", read: "sprint:write", write: "sprint:write" },
  { prefix: "/api/connections", read: "connection:manage", write: "connection:manage" },
  { prefix: "/api/health", read: "system:ops", write: "system:ops" },
  { prefix: "/api/eval", read: "system:ops", write: "system:ops" },
  { prefix: "/api/generation-jobs", read: "system:ops", write: "system:ops" },
  { prefix: "/api/sync", read: "client:read", write: "sync:run" },
  // De merk- en creatie-analyses: het enige stuk dat een brand-strateeg mag opvragen.
  { prefix: "/api/analysis/meta-creatives", read: "insight:brand", write: "analysis:run" },
  { prefix: "/api/analysis/meta-briefing", read: "insight:brand", write: "analysis:run" },
  { prefix: "/api/analysis/rsa-insights", read: "insight:brand", write: "analysis:run" },
  { prefix: "/api/analysis/google-video", read: "insight:brand", write: "analysis:run" },
  { prefix: "/api/analysis/linkedin-icp-fit", read: "insight:brand", write: "analysis:run" },
  // De rest van de analyses raakt budget, biedingen en kosten.
  { prefix: "/api/analysis", read: "insight:performance", write: "analysis:run" },
  { prefix: "/api/second-opinion", read: "insight:performance", write: "analysis:run" },
];

export function capabilityForApi(pathname: string, method: string): Capability {
  const m = method.toUpperCase();
  const isRead = m === "GET" || m === "HEAD" || m === "OPTIONS";
  for (const rule of API_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      const needed = isRead ? rule.read : rule.write;
      if (needed) return needed;
    }
  }
  // Alles wat geen eigen regel heeft: lezen is client:read, muteren vergt settings:write.
  // Dat is de veilige kant — een nieuwe route valt niet per ongeluk in het laagste recht.
  return isRead ? "client:read" : "settings:write";
}

// Het beurs-id uit een verzoek, voor de scope-check. De app gebruikt client_id in de
// querystring (27 routes) en clientId in bodies; /client/<id> is het paginapad.
export function clientIdFromPath(pathname: string, searchParams: URLSearchParams): string | null {
  const q = searchParams.get("client_id") ?? searchParams.get("clientId");
  if (q) return q;
  const m = /^\/client\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

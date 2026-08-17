// Test voor het pure autorisatiebeleid. Deterministisch, geen IO.
// Draaien: npx tsx lib/auth/__auth_roles_test.ts
//
// De inzet: dit bestand bepaalt wie welke beursdata ziet. Een fout hier is niet "een knop
// staat op de verkeerde plek" maar "Aquatech ziet de cijfers van GreenTech". De tests gaan
// daarom vooral over de gevallen waar een recht per ongeluk te ruim uitvalt.

import {
  ROLES, CAPABILITIES, ROLE_CAPABILITIES, ALL_CLIENTS,
  can, capabilitiesOf, canAccessClient, capabilityForApi, clientIdFromPath,
  isCronPath, isPublicPath, isRole, normalizeRole, scopeFor,
  type Capability, type Role,
} from "./roles";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Rollen en oude waarden ─────────────────────────────────────────────────

assert(isRole("admin") && isRole("performance_marketeer") && isRole("it"), "de nieuwe rollen zijn geldig");
assert(!isRole("specialist"), "de oude waarde is geen huidige rol");
assert(!isRole("owner") && !isRole("") && !isRole(null), "onzin is geen rol");

assert(normalizeRole("specialist") === "performance_marketeer", "de oude specialist wordt performance marketeer");
assert(normalizeRole("viewer") === "viewer" && normalizeRole("admin") === "admin", "onveranderde waarden blijven");
assert(normalizeRole("onbekend") === null && normalizeRole(null) === null, "onbekend wordt null, niet viewer");

// ── Rechten per rol ────────────────────────────────────────────────────────

assert(CAPABILITIES.every((c) => ROLE_CAPABILITIES.admin.includes(c)), "admin heeft elk recht");
assert(!can(null, "client:read") && !can(undefined, "client:read"), "geen rol betekent geen recht");
assert(capabilitiesOf(null).length === 0, "geen rol levert een lege rechtenlijst");

// Elke rol behalve admin mist iets: een rol die alles mag is een tweede admin en dan klopt
// de rolindeling niet.
for (const role of ROLES.filter((r) => r !== "admin")) {
  assert(
    ROLE_CAPABILITIES[role].length < CAPABILITIES.length,
    `${role} is niet stiekem een tweede admin`,
  );
}

// Gebruikersbeheer is en blijft van admin alleen.
for (const role of ROLES.filter((r) => r !== "admin")) {
  assert(!can(role, "user:manage"), `${role} beheert geen gebruikers`);
}

// De zijwaartse rollen: het punt waarvoor de rangorde is losgelaten. Op een ladder waren
// deze twee assertions niet allebei tegelijk waar te maken.
assert(can("it", "connection:manage") && can("it", "system:ops"), "IT mag bij koppelingen en techniek");
assert(!can("it", "insight:performance") && !can("it", "settings:write"), "IT ziet geen budget en wijzigt geen instellingen");
assert(can("brand_strateeg", "insight:brand"), "de brand-strateeg ziet merk-inzichten");
assert(!can("brand_strateeg", "insight:performance"), "de brand-strateeg ziet geen budget");
assert(!can("brand_strateeg", "analysis:run") && !can("brand_strateeg", "sprint:write"), "de brand-strateeg is lezend");
assert(!can("it", "insight:brand") && can("brand_strateeg", "client:read"), "IT en brand overlappen niet volledig");

// De beursverantwoordelijke stuurt de sprint maar draait niets en stelt niets in.
assert(can("beurs_manager", "sprint:write") && can("beurs_manager", "insight:performance"), "de beurs-manager stuurt de sprint");
assert(!can("beurs_manager", "analysis:run") && !can("beurs_manager", "settings:write"), "de beurs-manager draait geen runs");
assert(!can("beurs_manager", "sync:run"), "de beurs-manager start geen syncs");

// De uitvoerende rol, en wat de oude specialist kon blijft kunnen.
assert(can("performance_marketeer", "analysis:run") && can("performance_marketeer", "settings:write") && can("performance_marketeer", "sprint:write"), "de performance marketeer erft de specialist-rechten");
assert(!can("performance_marketeer", "connection:manage"), "koppelingen blijven bij admin en IT");

assert(can("viewer", "client:read"), "viewer leest");
assert(CAPABILITIES.filter((c) => can("viewer", c)).length === 1, "viewer leest en verder niets");

// ── Scope ──────────────────────────────────────────────────────────────────

assert(scopeFor("admin", []) === ALL_CLIENTS, "admin dekt alle beurzen");
assert(scopeFor("performance_marketeer", []) === ALL_CLIENTS, "de performance marketeer ziet alle beurzen");
assert(scopeFor("it", []) === ALL_CLIENTS, "IT ziet alle beurzen");
assert(scopeFor("beurs_manager", ["greentech"]) !== ALL_CLIENTS, "de beurs-manager is per beurs");
assert(scopeFor(null, ["greentech"]) !== ALL_CLIENTS, "zonder rol geen brede scope");

// De belangrijkste regel van dit bestand: leeg betekent niets, niet alles.
assert(!canAccessClient(scopeFor("beurs_manager", []), "greentech"), "een lege toewijzing geeft geen toegang");
assert(!canAccessClient(scopeFor(null, []), "greentech"), "geen rol geeft geen toegang");
assert(!canAccessClient([], "greentech"), "een lege scope sluit alles uit");

assert(canAccessClient(scopeFor("beurs_manager", ["greentech"]), "greentech"), "de eigen beurs mag");
assert(!canAccessClient(scopeFor("beurs_manager", ["greentech"]), "aquatech"), "de beurs van een ander niet");
assert(canAccessClient(ALL_CLIENTS, "aquatech") && canAccessClient(ALL_CLIENTS, "wat-dan-ook"), "all dekt ook een nieuwe beurs");
assert(!canAccessClient(ALL_CLIENTS, null) && !canAccessClient(ALL_CLIENTS, ""), "geen beurs-id is geen toegang, ook niet met all");
assert(!canAccessClient(["greentech"], "green"), "geen deelstring-match");
assert(!canAccessClient(["greentech"], "greentech-2"), "geen prefix-match");

// ── Het beurs-id uit een verzoek ───────────────────────────────────────────

const qs = (s: string) => new URLSearchParams(s);
assert(clientIdFromPath("/api/geo", qs("client_id=greentech")) === "greentech", "client_id uit de querystring");
assert(clientIdFromPath("/api/geo", qs("clientId=greentech")) === "greentech", "clientId werkt ook");
assert(clientIdFromPath("/client/aquatech", qs("")) === "aquatech", "het beurs-id uit het paginapad");
assert(clientIdFromPath("/client/aqua%20tech", qs("")) === "aqua tech", "url-encoding gaat eraf");
assert(clientIdFromPath("/client/aquatech/detail", qs("")) === "aquatech", "een subpad verstoort niet");
assert(clientIdFromPath("/portfolio", qs("")) === null, "geen beurs-id is null");
assert(clientIdFromPath("/clients", qs("")) === null, "/clients is geen /client/<id>");
// De querystring wint van het pad: zo kan een handler niet met een ander id verder werken
// dan waar de middleware op heeft gecontroleerd.
assert(clientIdFromPath("/client/aquatech", qs("client_id=greentech")) === "greentech", "de querystring wint");

// ── Rechten per API-pad ────────────────────────────────────────────────────

assert(capabilityForApi("/api/admin/users", "GET") === "user:manage", "de gebruikerslijst is admin, ook lezen");
assert(capabilityForApi("/api/admin/users", "PATCH") === "user:manage", "rol wijzigen is admin");
assert(capabilityForApi("/api/users", "GET") === "user:manage" && capabilityForApi("/api/invite", "POST") === "user:manage", "users en invite zijn admin");
assert(capabilityForApi("/api/connections/meta", "GET") === "connection:manage", "koppelingen, ook lezen");
assert(capabilityForApi("/api/health/client", "GET") === "system:ops", "health is techniek");
assert(capabilityForApi("/api/eval/replay", "POST") === "system:ops", "de eval-harness is techniek");

assert(capabilityForApi("/api/sync", "POST") === "sync:run", "een sync starten vergt sync:run");
assert(capabilityForApi("/api/sync", "GET") === "client:read", "de sync-status mag iedereen lezen");

assert(capabilityForApi("/api/analysis/meta-creatives", "GET") === "insight:brand", "creatie-inzichten zijn merk");
assert(capabilityForApi("/api/analysis/google-video", "GET") === "insight:brand", "video is merk");
assert(capabilityForApi("/api/analysis/budget-allocation", "GET") === "insight:performance", "budget is performance");
assert(capabilityForApi("/api/analysis/bid-strategy", "GET") === "insight:performance", "biedingen zijn performance");
assert(capabilityForApi("/api/second-opinion", "GET") === "insight:performance", "de second opinion is performance");
assert(capabilityForApi("/api/analysis/monthly", "POST") === "analysis:run", "een analyse draaien vergt analysis:run");
assert(capabilityForApi("/api/analysis/meta-creatives", "POST") === "analysis:run", "ook een merk-analyse draaien");

// De vangnetregel: een route zonder eigen regel valt niet in het ruimste recht.
assert(capabilityForApi("/api/nieuw-endpoint", "GET") === "client:read", "een onbekende read is client:read");
assert(capabilityForApi("/api/nieuw-endpoint", "POST") === "settings:write", "een onbekende write is minstens settings:write");
assert(!can("viewer", capabilityForApi("/api/nieuw-endpoint", "POST")), "een viewer muteert geen onbekende route");
assert(!can("brand_strateeg", capabilityForApi("/api/analysis/budget-allocation", "GET")), "de brand-strateeg komt niet bij budget");
assert(!can("it", capabilityForApi("/api/second-opinion", "GET")), "IT komt niet bij de second opinion");

// Een prefix mag niet per ongeluk een langere naam meepakken.
assert(capabilityForApi("/api/synchronisatie-extern", "POST") === "settings:write", "/api/sync matcht niet op /api/synchronisatie-extern");
assert(capabilityForApi("/api/administratie", "GET") === "client:read", "/api/admin matcht niet op /api/administratie");

// Elke rol moet ergens binnenkomen, anders is hij onbruikbaar.
for (const role of ROLES) {
  const bereikbaar = CAPABILITIES.some((c: Capability) => can(role as Role, c));
  assert(bereikbaar, `${role} heeft minstens een recht`);
}

// ── Padclassificatie ───────────────────────────────────────────────────────

assert(isPublicPath("/login"), "/login is publiek");
assert(isPublicPath("/auth/callback") && isPublicPath("/auth/reset"), "auth-callbacks zijn publiek");
assert(isPublicPath("/_next/static/chunk.js") && isPublicPath("/favicon.ico"), "Next-internals zijn publiek");
assert(isPublicPath("/logo.png") && isPublicPath("/fonts/inter.woff2"), "statische assets zijn publiek");
// Fase 5: '/' is de nieuwe publieke marketingpagina (Hero + Global Platform Pulse), niet meer de
// ingelogde cockpit -- die staat op /vandaag en blijft, net als elke andere app-pagina, niet
// publiek. /api/public/platform-pulse levert de aggregaat-cijfers voor diezelfde pagina en moet
// dus ook zonder sessie werken; andere API-routes blijven dicht.
assert(isPublicPath("/"), "de marketingpagina is publiek (Fase 5)");
assert(isPublicPath("/api/public/platform-pulse"), "de platform-pulse-aggregaten zijn publiek (Fase 5)");
// Fase 7: de rest van de marketingsite. Dit ontbrak toen O1_AUTH_ENFORCED voor het eerst
// overwogen werd -- zonder deze regels zou een bezoeker zonder sessie op /pricing, /faq of
// /blog meteen naar /login zijn gestuurd, dezelfde fout als bij '/' in Fase 5.
assert(isPublicPath("/pricing") && isPublicPath("/faq"), "pricing en faq zijn publiek (Fase 7)");
assert(isPublicPath("/blog") && isPublicPath("/blog/gemiddelde-cpa-verkeerde-vraag"), "blog en blogartikelen zijn publiek (Fase 7)");
assert(isPublicPath("/demo") && isPublicPath("/api/public/demo-request"), "de demo-CTA en zijn formulierroute zijn publiek (Fase 7)");
assert(!isPublicPath("/vandaag") && !isPublicPath("/dashboard"), "de ingelogde app is niet publiek");
assert(!isPublicPath("/api/analysis/monthly"), "API-routes zijn niet publiek");
assert(!isPublicPath("/api/public/god-mode"), "alleen platform-pulse is publiek, niet elk /api/public-pad per ongeluk");
assert(!isPublicPath("/api/sync/cron"), "cron is geen publiek pad (eigen secret-patroon)");

assert(isCronPath("/api/sync/cron") && isCronPath("/api/sync/cron/daily"), "cron-paden herkend");
assert(!isCronPath("/api/sync") && !isCronPath("/api/sync/linkedin"), "gewone sync-routes zijn geen cron");
// Bug van 17 augustus 2026: deze functie matchte alleen /api/sync/cron, niet /api/cron/* --
// waardoor de middleware /api/cron/evaluate-hypotheses en /api/cron/evaluate-code-rood achter de
// inlogwal zette in plaats van door te laten naar hun eigen CRON_SECRET-check. Live tegen
// productie bevestigd (curl: /api/sync/cron gaf 200, /api/cron/evaluate-code-rood gaf 401).
assert(
  isCronPath("/api/cron/evaluate-hypotheses") && isCronPath("/api/cron/evaluate-code-rood") &&
    isCronPath("/api/cron/process-action-queue") && isCronPath("/api/cron/trigger-sops"),
  "alle vier de routes onder /api/cron/ zijn cron-paden",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

// Gedragstest: het zaad (lib/overzicht/zaadbak.ts, zaad-server.ts) en de lezers die het gebruiken.
// Draaien: tsx lib/overzicht/__zaad_test.ts
//
// Wat er was. De klantpagina stuurde alleen het skelet; de twee lezingen waar het eerste
// kerncijfer op wacht (de blended route en de client_settings-rij) vertrokken pas uit de browser,
// nadat het script geladen en gehydrateerd was. Nu start de server ze terwijl hij de pagina
// stuurt, en gebruikt de eerste lezer in de browser dat antwoord in plaats van een eigen verzoek.
//
// Wat hier vastligt:
// - de bak: eenmalig, alleen in de browser, niets met een belofte die hij al kende, en een
//   afgewezen of lege belofte geeft `undefined` (de lezer doet dan zijn gewone verzoek);
// - de leeftijd: getoetst bij het NEMEN, tegen het moment van zaaien op één klok. Een zaad dat
//   langer dan een minuut is blijven liggen wordt niet meer uitgegeven, ook niet als de belofte
//   allang was opgelost;
// - de server leest alleen bij een documentverzoek, en "geen data" reist mee als antwoord;
// - de server: dezelfde toets als de routes (recht en scope) zodra de afdwinging aan staat, door
//   JSON heen zoals over de lijn, en bij elke fout null in plaats van een afwijzing;
// - loadClientSettingsRij: met zaad geen verzoek en dezelfde uitkomst (ook "geen rij"), zonder
//   bruikbaar zaad het gewone verzoek, en na vergeetClientSettingsRij weer de route;
// - kijkClientSettingsRij: de rij uit de cache zonder verzoek, undefined als er niets vers is;
// - de bedrading: de pagina start de lezing zonder erop te wachten, en het dashboard zaait vóór
//   de hooks hun eerste verzoek doen.
//
// De blended hook met zaad staat in lib/api/__blended_client_data_hook_test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../decision/__fake_supabase";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const onafgehandeld: unknown[] = [];
process.on("unhandledRejection", (e) => { onafgehandeld.push(e); });

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-fetch: telt de lezingen van client_settings per klant ──────────────────────────────────
const RIJ = { client_id: "x", kpi_targets: { conversionsMode: "absolute", conversionsAbsolute: 2600 }, channel_conversion_config: { meta_ads: ["leads"] } };
const gelezen: Record<string, number> = {};
const kapot = new Set<string>();
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  if (!u.startsWith("/api/data/client_settings")) return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
  const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as { clientId?: string };
  const id = vraag.clientId ?? "";
  gelezen[id] = (gelezen[id] ?? 0) + 1;
  return kapot.has(id)
    ? ({ ok: false, status: 500, json: async () => ({ error: "kapot" }) } as Response)
    : ({ ok: true, status: 200, json: async () => ({ data: { ...RIJ, client_id: id, bron: "route" } }) } as Response);
}) as typeof fetch;
const rust = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function zetBrowser(): void {
  const opslag = new Map<string, string>();
  const doc = { cookie: "" };
  Object.assign(globalThis, {
    window: { document: doc },
    document: doc,
    localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
  });
}

async function main() {
  const { maakZaadbak, ZAAD_VERS_MS } = await import("./zaadbak");
  const vers = <T,>(waarde: T) => Promise.resolve({ waarde });

  console.log("De bak doet niets op de server (geen window)");
  {
    const bak = maakZaadbak<number>();
    bak.zaai("a", vers(1));
    check("zonder window wordt er niet gezaaid", bak.neem("a") === null);
  }

  zetBrowser();

  console.log("De belofte uit de serverstroom is een thenable waarvan then niets teruggeeft");
  {
    // Zo levert React een belofte-prop van de server aan de browser. Een ketting direct op zo'n
    // thenable is `undefined`; de eerste versie viel daar in de browser op om (de hele pagina).
    const bak = maakZaadbak<number>();
    const thenable = { then(ok: (z: { waarde: number }) => void) { setTimeout(() => ok({ waarde: 7 }), 1); } };
    bak.zaai("t", thenable as unknown as Promise<{ waarde: number }>);
    const uit = bak.neem("t");
    check("neem geeft een echte Promise terug", uit instanceof Promise);
    check("... met de waarde van de server", (await uit) === 7);
  }

  console.log("De bak in de browser: eenmalig, en alleen wat bruikbaar is");
  {
    const bak = maakZaadbak<number>();
    const belofte = vers(7);
    bak.zaai("a", belofte);
    const eerste = bak.neem("a");
    check("het zaad geeft de waarde", (await eerste) === 7);
    check("een tweede keer nemen: weg", bak.neem("a") === null);
    bak.zaai("a", belofte);
    check("dezelfde belofte opnieuw zaaien doet niets", bak.neem("a") === null);

    bak.zaai("leeg", Promise.resolve(null));
    check("null van de server: undefined (de lezer vraagt het zelf)", (await bak.neem("leeg")) === undefined);
    bak.zaai("stuk", Promise.reject(new Error("de stroom brak af")));
    check("een afgewezen belofte: undefined, geen fout", (await bak.neem("stuk")) === undefined);
    bak.zaai("niets", null);
    bak.zaai("niets", undefined);
    check("geen belofte: niets gezaaid", bak.neem("niets") === null);
    bak.zaai("weg", vers(9));
    bak.vergeet("weg");
    check("na vergeet is het zaad weg", bak.neem("weg") === null);
    // Een waarde die zelf null of 0 is, is een geldig antwoord en geen "geen zaad".
    const metNull = maakZaadbak<{ rij: null }>();
    metNull.zaai("n", vers({ rij: null }));
    check("een omhulsel met null erin komt door", JSON.stringify(await metNull.neem("n")) === '{"rij":null}');
    await rust();
    check("geen onafgehandelde afwijzing", onafgehandeld.length === 0, String(onafgehandeld[0]));
  }

  // ── De leeftijd: bij het nemen, op één klok ─────────────────────────────────────────────────
  // De toets stond bij het oplossen van de belofte, tegen een tijdstempel van de server. Een zaad
  // dat daarna bleef liggen (de hook was al gemount en haalde niet opnieuw op) had geen grens meer:
  // een lezer van minuten later kreeg het als vers. En twee klokken vergelijken maakte bij een
  // browser die een minuut voor- of achterloopt elk zaad altijd te oud of altijd vers.
  console.log("De leeftijd van het zaad: getoetst bij het nemen");
  {
    let klok = 1_000_000;
    const bak = maakZaadbak<number>(() => klok);
    bak.zaai("a", vers(1));
    await rust(); // de belofte is allang opgelost: dat mag niets uitmaken
    klok += ZAAD_VERS_MS - 1;
    check("net binnen de minuut: het zaad", (await bak.neem("a")) === 1);

    bak.zaai("b", vers(2));
    await rust();
    klok += ZAAD_VERS_MS + 1000; // 61 seconden later
    check("61 seconden na het zaaien: geen zaad meer (de lezer doet zijn gewone verzoek)", bak.neem("b") === null);
    check("en het is ook echt weg, niet alleen overgeslagen", (klok -= ZAAD_VERS_MS + 1000, bak.neem("b")) === null);

    bak.zaai("c", vers(3));
    klok -= 5000;
    check("de klok is teruggezet: niet vers", bak.neem("c") === null);

    // De klok van de server speelt niet mee: er is geen tijdstempel van de server meer om tegen te toetsen.
    bak.zaai("d", Promise.resolve({ waarde: 4, opServer: klok - 10 * 60 * 1000 } as { waarde: number }));
    check("een tijdstempel van de server (een andere klok) bepaalt niets", (await bak.neem("d")) === 4);
  }

  // ── De server ───────────────────────────────────────────────────────────────────────────────
  const { startOverzichtZaad } = await import("./zaad-server");
  const { fetchBlendedHistoricalData } = await import("../api/blended-historical");
  const database = (): FakeSupabase => {
    const sb = new FakeSupabase();
    sb.seed("accounts", [{ id: "acc-z", client_id: "klant-z", name: "Z", source: "google_ads", external_id: "1", agency_id: "a" }]);
    sb.seed("client_settings", [{ client_id: "klant-z", channel_conversion_config: null, kpi_targets: { conversionsAbsolute: 2600 }, sector: undefined }]);
    sb.seed("fact_core", [{ account_id: "acc-z", channel: "google", level: "account", grain: "month", period_start: "2026-01-01", impressions: 1, clicks: 1, cost: 100, conversions: 5, conv_value: 50 }]);
    sb.seed("ads_account_monthly", [{ client_id: "klant-z", month: "2026-01-01" }]);
    sb.seed("client_sync_status", [{ client_id: "klant-z", last_successful_sync_at: "2026-02-02T05:00:00Z" }]);
    return sb;
  };
  const alsDb = (sb: FakeSupabase) => sb as unknown as SupabaseClient;
  const ALLES = "all" as never;
  const gebruiker = (role: string, scope: unknown) => async () => ({ role, scope }) as never;
  // De Google-route: in de blokken hieronder een die faalt (zonder Google Ads-sleutels), zodat ze
  // de echte route niet laden; de Google-lezing zelf heeft een eigen blok.
  const geenGoogle = async () => Response.json({ error: "Google Ads API not configured" }, { status: 500 });

  console.log("De server: zonder afdwinging leest hij, en het antwoord is dat van de route (door JSON heen)");
  {
    const zaad = startOverzichtZaad("klant-z", { afgedwongen: false, database: alsDb(database()) , googleRoute: geenGoogle });
    check("de aanroep geeft meteen beloften terug", typeof zaad.blended.then === "function" && typeof zaad.instellingen.then === "function");
    const [b, i] = await Promise.all([zaad.blended, zaad.instellingen]);
    const direct = await fetchBlendedHistoricalData(alsDb(database()), "klant-z");
    check("het blended zaad is het antwoord van de route", !!b && JSON.stringify(b.waarde) === JSON.stringify(direct), JSON.stringify(b?.waarde).slice(0, 120));
    check("zonder tijdstempel van de server: de versheid toetst de browser op zijn eigen klok", !!b && Object.keys(b).join(",") === "waarde");
    check("de instellingen: de hele rij van deze klant", (i?.waarde.rij as unknown as { client_id?: string } | null)?.client_id === "klant-z" && JSON.stringify(i?.waarde.rij?.kpi_targets) === '{"conversionsAbsolute":2600}', JSON.stringify(i));
    check("door JSON heen: geen undefined-velden", !!i?.waarde.rij && !Object.prototype.hasOwnProperty.call(i.waarde.rij, "sector"));
  }

  console.log("De server: een klant zonder rij krijgt 'geen rij', een klant zonder data krijgt 'geen data' als antwoord");
  {
    const zaad = startOverzichtZaad("onbekend", { afgedwongen: false, database: alsDb(database()) , googleRoute: geenGoogle });
    // Eerder null: de browser vroeg de route dan alsnog (404) en pas daarna vertrok het
    // kanalenproefje. Nu reist de uitkomst mee, met de melding van de route zelf.
    const { geenBlendedDataFout } = await import("../api/blended-historical");
    check("blended: het lichaam van de 404 van de route, als antwoord",
      JSON.stringify((await zaad.blended)?.waarde) === JSON.stringify({ error: geenBlendedDataFout("onbekend") }) && geenBlendedDataFout("onbekend") === 'Geen blended data voor "onbekend"',
      JSON.stringify(await zaad.blended));
    const i = await zaad.instellingen;
    check("instellingen: een zaad met rij null", !!i && i.waarde.rij === null, JSON.stringify(i));
  }

  console.log("De server: met afdwinging dezelfde toets als de routes");
  {
    const sb = database();
    const lees = (g: () => Promise<never>) => startOverzichtZaad("klant-z", { afgedwongen: true, gebruiker: g, database: alsDb(sb) , googleRoute: geenGoogle });
    const ingelogd = lees(gebruiker("admin", ALLES));
    const { can, canAccessClient } = await import("../auth/roles");
    check("voorwaarde: een admin met alle klanten mag lezen", can("admin" as never, "client:read") && canAccessClient(ALLES, "klant-z"));
    check("een gebruiker met het recht en de klant in scope: zaad", (await ingelogd.blended) !== null && (await ingelogd.instellingen) !== null);
    const niemand = lees((async () => null) as never);
    check("niet ingelogd: geen zaad", (await niemand.blended) === null && (await niemand.instellingen) === null);
    const andereKlant = lees(gebruiker("admin", ["andere-klant"]));
    check("voorwaarde: die scope geeft geen toegang tot klant-z", !canAccessClient(["andere-klant"], "klant-z"));
    check("de klant buiten de scope: geen zaad", (await andereKlant.blended) === null && (await andereKlant.instellingen) === null);
    const zonderRol = lees(gebruiker(null as never, ALLES));
    check("zonder rol (geen recht): geen zaad", (await zonderRol.blended) === null && (await zonderRol.instellingen) === null);
    const gooit = lees((async () => { throw new Error("sessie kapot"); }) as never);
    check("de sessie lezen faalt: geen zaad, geen afwijzing", (await gooit.blended) === null && (await gooit.instellingen) === null);
  }

  console.log("De server: een fout wordt null, geen afwijzing en geen eigen foutmelding");
  {
    const sb = database();
    sb.faalOp("client_settings", "kapot");
    const zaad = startOverzichtZaad("klant-z", { afgedwongen: false, database: alsDb(sb) , googleRoute: geenGoogle });
    check("blended (leest client_settings mee): null", (await zaad.blended) === null);
    check("instellingen: null", (await zaad.instellingen) === null);
    const zonderDb = startOverzichtZaad("klant-z", { afgedwongen: false, database: null , googleRoute: geenGoogle });
    check("zonder database: null", (await zonderDb.blended) === null && (await zonderDb.instellingen) === null);
    await rust();
    check("geen onafgehandelde afwijzing", onafgehandeld.length === 0, String(onafgehandeld[0]));
  }

  console.log("De server: de Google-route, in dit proces, met dezelfde toets");
  {
    const gevraagd: string[] = [];
    const LICHAAM = { currentYear: 2026, historicalYears: [], currentYearMonthly: [{ month: 1, conversions: 5 }], leeg: undefined, niets: Number.NaN };
    const route = (status: number, lichaam: unknown) => async (customerId: string) => { gevraagd.push(customerId); return Response.json(lichaam, { status }); };
    const lees = (deps: Parameters<typeof startOverzichtZaad>[1]) => startOverzichtZaad("gads-555", { database: alsDb(database()), ...deps });
    const goed = await lees({ afgedwongen: false, googleRoute: route(200, LICHAAM) }).google;
    check("geslaagd: het lichaam van de route, door JSON heen zoals over de lijn", JSON.stringify(goed?.waarde) === JSON.stringify(LICHAAM) && !!goed && !Object.prototype.hasOwnProperty.call(goed.waarde, "leeg") && goed.waarde.niets === null, JSON.stringify(goed));
    check("met hetzelfde klantnummer als de browser vraagt (zonder gads-)", gevraagd.at(-1) === "555", gevraagd.join(","));
    check("een foutstatus: geen zaad (de browser vraagt zelf, met de eigen melding)", (await lees({ afgedwongen: false, googleRoute: route(500, { error: "kapot" }) }).google) === null);
    check("een lichaam met error bij status 200: geen zaad", (await lees({ afgedwongen: false, googleRoute: route(200, { error: "x" }) }).google) === null);
    check("de route gooit: geen zaad, geen afwijzing", (await lees({ afgedwongen: false, googleRoute: async () => { throw new Error("weg"); } }).google) === null);
    const voor = gevraagd.length;
    const buiten = await lees({ afgedwongen: true, gebruiker: gebruiker("admin", ["andere-klant"]), googleRoute: route(200, LICHAAM) }).google;
    check("een klant buiten de scope: geen zaad, en de route wordt niet eens gevraagd", buiten === null && gevraagd.length === voor);
    const niemand = await lees({ afgedwongen: true, gebruiker: (async () => null) as never, googleRoute: route(200, LICHAAM) }).google;
    check("niet ingelogd: geen zaad", niemand === null && gevraagd.length === voor);
    const binnen = await lees({ afgedwongen: true, gebruiker: gebruiker("admin", ALLES), googleRoute: route(200, LICHAAM) }).google;
    check("met het recht en de klant in scope: zaad", binnen !== null && gevraagd.length === voor + 1);
    await rust();
    check("geen onafgehandelde afwijzing", onafgehandeld.length === 0, String(onafgehandeld[0]));
  }

  console.log("De server leest alleen bij een documentverzoek");
  {
    const { isDocumentVerzoek } = await import("./zaad-server");
    check("een documentverzoek (eerste bezoek, herlaad): ja", isDocumentVerzoek("document") === true);
    check("een fetch van de router (een beursklik, een klant openen): nee", isDocumentVerzoek("empty") === false);
    check("een browser die de kop niet stuurt: nee (dan de gewone verzoeken)", isDocumentVerzoek(null) === false && isDocumentVerzoek(undefined) === false);
    check("een iframe of iets anders: nee", isDocumentVerzoek("iframe") === false);
  }

  // ── De client_settings-rij met zaad ─────────────────────────────────────────────────────────
  const cs = await import("../client-settings");
  const { loadClientSettingsRij, loadClientSettings, zaaiClientSettingsRij, kijkClientSettingsRij, vergeetClientSettingsRij } = cs;

  console.log("loadClientSettingsRij met zaad: geen verzoek, dezelfde uitkomst");
  {
    check("vóór alles: kijk geeft undefined", kijkClientSettingsRij("s-zaad") === undefined);
    zaaiClientSettingsRij("s-zaad", vers({ rij: { ...RIJ, client_id: "s-zaad", bron: "server" } as never }));
    const [a, b, instellingen] = await Promise.all([loadClientSettingsRij("s-zaad"), loadClientSettingsRij("s-zaad"), loadClientSettings("s-zaad")]);
    check("geen verzoek aan /api/data/client_settings", gelezen["s-zaad"] === undefined, String(gelezen["s-zaad"]));
    check("de lezers krijgen de rij van de server, zonder fout", a.error === null && (a.data as unknown as { bron: string }).bron === "server" && a.data === b.data);
    check("loadClientSettings leest er het opgeslagen doel uit", instellingen.kpiTargets.conversionsAbsolute === 2600 && instellingen.kpiDoelenOpgeslagen === true);
    check("de rij staat in de cache: kijk geeft hem zonder verzoek", kijkClientSettingsRij("s-zaad") === a.data && gelezen["s-zaad"] === undefined);
    await loadClientSettingsRij("s-zaad");
    check("een latere lezer: nog steeds geen verzoek", gelezen["s-zaad"] === undefined);

    console.log("Na vergeetClientSettingsRij: de route, niet opnieuw het zaad");
    vergeetClientSettingsRij("s-zaad");
    check("kijk is weer undefined", kijkClientSettingsRij("s-zaad") === undefined);
    const na = await loadClientSettingsRij("s-zaad");
    check("één verzoek, met het antwoord van de route", gelezen["s-zaad"] === 1 && (na.data as unknown as { bron: string }).bron === "route", JSON.stringify([gelezen["s-zaad"], na.data]));
  }

  console.log("Een klant zonder rij: 'geen rij' is een antwoord, ook uit het zaad");
  {
    zaaiClientSettingsRij("s-geen", vers({ rij: null }));
    const uit = await loadClientSettingsRij("s-geen");
    check("data null, geen fout, geen verzoek", uit.data === null && uit.error === null && gelezen["s-geen"] === undefined);
    check("kijk geeft null (bekend: geen rij), niet undefined", kijkClientSettingsRij("s-geen") === null);
  }

  console.log("Zonder bruikbaar zaad: het gewone verzoek, met zijn eigen fout");
  {
    zaaiClientSettingsRij("s-leeg", Promise.resolve(null));
    const uit = await loadClientSettingsRij("s-leeg");
    check("null van de server: één verzoek, de rij van de route", gelezen["s-leeg"] === 1 && (uit.data as unknown as { bron: string }).bron === "route");

    kapot.add("s-fout");
    zaaiClientSettingsRij("s-fout", Promise.reject(new Error("de stroom brak af")));
    const fout = await loadClientSettingsRij("s-fout");
    check("een afgewezen zaad: de fout van de route, niet in de cache", gelezen["s-fout"] === 1 && fout.error?.message === "kapot" && kijkClientSettingsRij("s-fout") === undefined, JSON.stringify(fout));

    // Een zaad dat is blijven liggen: 61 seconden later doet de lezer zijn gewone verzoek.
    const echteNow = Date.now;
    zaaiClientSettingsRij("s-laat", vers({ rij: { ...RIJ, client_id: "s-laat", bron: "server" } as never }));
    await rust();
    try {
      Date.now = () => echteNow() + ZAAD_VERS_MS + 1000;
      const laat = await loadClientSettingsRij("s-laat");
      check("zaaien, 61 seconden later lezen: het gewone verzoek, niet het zaad", gelezen["s-laat"] === 1 && (laat.data as unknown as { bron: string }).bron === "route", JSON.stringify([gelezen["s-laat"], laat.data]));
    } finally {
      Date.now = echteNow;
    }
    vergeetClientSettingsRij("s-laat");

    // Staat de rij er al, dan vervangt een later zaad niets.
    zaaiClientSettingsRij("s-leeg", vers({ rij: { ...RIJ, client_id: "s-leeg", bron: "server" } as never }));
    const blijft = await loadClientSettingsRij("s-leeg");
    check("een zaad voor een klant met een verse rij wordt genegeerd", (blijft.data as unknown as { bron: string }).bron === "route" && gelezen["s-leeg"] === 1);
    await rust();
    check("geen onafgehandelde afwijzing", onafgehandeld.length === 0, String(onafgehandeld[0]));
  }

  // ── De bedrading ────────────────────────────────────────────────────────────────────────────
  console.log("De bedrading");
  {
    const bron = (pad: string) => readFileSync(join(import.meta.dirname, "..", "..", pad), "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    const pagina = bron("app/(app)/client/[clientId]/page.tsx");
    check("de pagina start de lezing zonder erop te wachten, en alleen bij een documentverzoek",
      /const zaad = isDocumentVerzoek\(koppen\.get\("sec-fetch-dest"\)\) \? startOverzichtZaad\(clientId\) : null;/.test(pagina) && !/await\s+startOverzichtZaad|await\s+zaad/.test(pagina));
    check("en geeft de beloften door aan het dashboard (null zonder zaad)", /blendedVanServer=\{zaad\?\.blended \?\? null\}/.test(pagina) && /instellingenVanServer=\{zaad\?\.instellingen \?\? null\}/.test(pagina));
    const dash = bron("components/dashboard/client-dashboard.tsx");
    const zaait = dash.indexOf("zaaiBlendedClientData(client.id, blendedVanServer);");
    const zaaitRij = dash.indexOf("zaaiClientSettingsRij(client.id, instellingenVanServer);");
    const hook = dash.indexOf("useBlendedClientData(client.id)");
    const google = dash.indexOf("useClientData(client.id)");
    check("het dashboard zaait vóór de hooks die het eerste verzoek doen", zaait > 0 && zaaitRij > 0 && zaait < hook && zaaitRij < hook && zaait < google, [zaait, zaaitRij, hook, google].join(","));
    const server = bron("lib/overzicht/zaad-server.ts");
    check("de server toetst het recht van de routes die hij vervangt",
      server.includes('capabilityForApi("/api/blended/client-data", "GET")') && server.includes('readPolicyFor("client_settings")?.capability'));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

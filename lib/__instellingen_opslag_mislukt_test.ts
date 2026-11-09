// Regressietest: Instellingen als het opslaan mislukt, als de gebruiker typt terwijl het lezen van
// client_settings nog loopt, en bij een klant zonder rij (ClientSettingsPanel in
// components/dashboard/client-settings.tsx, saveClientSettings en loadClientSettings in
// lib/client-settings.ts, ClientDataProvider in lib/client-data-provider.tsx).
// Draaien: tsx lib/__instellingen_opslag_mislukt_test.ts
//
// Wat er misging.
// 1. handleSave riep invalidateClientCache aan vóór de foutcontrole. Dat stuurt "client-data-refresh",
//    useClientData zet de data op null, het dashboard unmount de provider en het paneel, en de melding
//    "Niet opgeslagen in de database" stond één frame op een paneel dat meteen verdween; na het
//    ophalen kwam het terug zonder melding. En saveClientSettings vulde cache en localStorage al vóór
//    de schrijfactie, dus dashboard en paneel toonden het niet-opgeslagen doel als "jaardoel".
// 2. Het init-effect van het paneel draait ook als de provider opnieuw samenvoegt na een lezing die
//    niets nieuws bracht (of mislukte), en zette dan alle velden terug: wie typte terwijl het lezen
//    nog liep (elke terugkerende bezoeker, en iedereen vlak na een opslag), zag zijn invoer
//    terugspringen.
// 3. Een klant zonder client_settings-rij kwam nooit in de cache; na een wissel A -> B -> A sloot de
//    provider het hele dashboard opnieuw achter het laadvlak tot de lezing terug was.
//
// De andere paneeltests hebben een nep-window met dispatchEvent: noop, waardoor het pad via
// "client-data-refresh" daar nooit draaide. Hier zijn de gebeurtenissen echt: een luisteraarlijst per
// type, zoals in een browser. Het echte paneel in de echte provider op een nep-DOM; fetch is nep, en
// het opslaan schrijft naar een lijst in deze test.

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// loadClientSettings en saveClientSettings praten alleen met de database als er een browser-Supabase is.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-DOM: genoeg voor een paneel met tekst, invoervelden en knoppen ───────────────────────
const noop = () => {};
class Leeg {}
type Knoop = Record<string, unknown> & { childNodes: Knoop[]; attrs: Record<string, unknown>; tagName: string; _t: string; _nv: string };
function maakKnoop(nodeType: number, tag = "DIV"): Knoop {
  const n = {
    nodeType, nodeName: tag, tagName: tag, namespaceURI: "http://www.w3.org/1999/xhtml",
    addEventListener: noop, removeEventListener: noop,
    setAttribute(k: string, v: unknown) { n.attrs[k] = v; }, removeAttribute: noop,
    appendChild(c: Knoop) { n.childNodes.push(c); return c; },
    removeChild(c: Knoop) { n.childNodes = n.childNodes.filter((x) => x !== c); return c; },
    // Op volgorde invoegen: de invoervelden worden hieronder in boomvolgorde gelezen.
    insertBefore(c: Knoop, voor: Knoop | null) { const i = voor ? n.childNodes.indexOf(voor) : -1; if (i < 0) n.childNodes.push(c); else n.childNodes.splice(i, 0, c); return c; },
    style: { setProperty: noop, removeProperty: noop }, ownerDocument: null as unknown, childNodes: [] as Knoop[],
    get firstChild() { return n.childNodes[0] ?? null; }, attrs: {} as Record<string, unknown>,
    _t: "", get textContent() { return n._t; }, set textContent(v: string) { n._t = String(v); },
    _nv: "", get nodeValue() { return n._nv; }, set nodeValue(v: string) { n._nv = String(v); },
  } as unknown as Knoop;
  // Base UI kijkt met instanceof of een knop een echt element is.
  Object.setPrototypeOf(n, Leeg.prototype);
  return n;
}
const doc = maakKnoop(9) as Knoop & Record<string, unknown>;
Object.assign(doc, {
  activeElement: null, cookie: "", documentElement: maakKnoop(1, "HTML"),
  createElement: (t: string) => Object.assign(maakKnoop(1, String(t).toUpperCase()), { ownerDocument: doc }),
  createElementNS: (_: string, t: string) => Object.assign(maakKnoop(1, String(t).toUpperCase()), { ownerDocument: doc }),
  createTextNode: (t: string) => Object.assign(maakKnoop(3, "#text"), { ownerDocument: doc, _nv: String(t) }),
});
const opslag = new Map<string, string>();
// Echte gebeurtenissen: invalidateClientCache stuurt "client-data-refresh" via window.dispatchEvent,
// en useClientData luistert ernaar. Met een noop hier zou een verversing nooit iets doen.
const luisteraars: Record<string, Array<(e: unknown) => void>> = {};
const gestuurd: string[] = [];
(globalThis as { CustomEvent?: unknown }).CustomEvent ??= class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail; } };
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
  window: {
    document: doc, location: { search: "", pathname: "/", href: "http://x/", hostname: "x" },
    addEventListener(t: string, f: (e: unknown) => void) { (luisteraars[t] ??= []).push(f); },
    removeEventListener(t: string, f: (e: unknown) => void) { luisteraars[t] = (luisteraars[t] ?? []).filter((g) => g !== f); },
    dispatchEvent(e: { type: string }) { gestuurd.push(e.type); for (const f of [...(luisteraars[e.type] ?? [])]) f(e); return true; },
    getSelection: () => null,
    HTMLIFrameElement: Leeg, HTMLElement: Leeg, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  },
  document: doc, HTMLElement: Leeg, HTMLInputElement: Leeg, Element: Leeg, Node: Leeg,
});

// De wachttijd van de provider (3 s) versneld: alleen een timer van precies die duur.
const echteTimeout = globalThis.setTimeout;
let wachtMs = -1;
globalThis.setTimeout = ((f: () => void, ms?: number, ...rest: unknown[]) =>
  echteTimeout(f, ms === wachtMs ? 400 : ms, ...rest)) as typeof setTimeout;

// ── Nep-fetch: client_settings antwoordt per klant pas als de test het zegt; schrijven wordt onthouden ──
const maand = (m: number, c: number) => ({ month: m, conversions: c, revenue: 21000, adSpend: 11000, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 });
const CLIENT_DATA = {
  customerId: "x", currentYear: 2026, realizedThroughMonth: 7, dataStand: null,
  targetCurrentYear: { conversions: 1938, revenue: 282062, adSpend: 139860 },
  historicalYears: [{ year: 2025, monthly: Array.from({ length: 12 }, (_, i) => maand(i + 1, 147)), weekly: [] }],
  currentYearMonthly: Array.from({ length: 7 }, (_, i) => maand(i + 1, 150)), currentYearWeekly: [],
};
// Opgeslagen (de vorm van demo-greentech): 2.600 conversies vast, CPA € 45.
const KPI_2600 = { conversionsMode: "absolute", conversionsAbsolute: 2600, revenueMode: "absolute", revenueAbsolute: 0, conversionsGrowthPct: 0, revenueGrowthPct: 0, cpaTarget: 45, roasTarget: 0 };
const SLEUTEL = "rm-dashboard-settings-";
const rijen = new Map<string, Record<string, unknown> | null>();
const wachtend = new Map<string, Array<(ok: boolean) => void>>();
const geschreven: { url: string; body: unknown }[] = [];
let schrijfFaalt = false;
const antwoord = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
  const u = String(url);
  if (init?.method && init.method !== "GET") {
    geschreven.push({ url: u, body: JSON.parse(init.body ?? "null") });
    if (u.includes("client_settings") && schrijfFaalt) return antwoord({ error: "db kapot" }, false);
    return antwoord({ data: null });
  }
  if (u.startsWith("/api/data/client_settings")) {
    const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as { clientId?: string };
    const id = vraag.clientId ?? "";
    return new Promise<Response>((klaar) => {
      const lijst = wachtend.get(id) ?? [];
      lijst.push((ok) => klaar(ok ? antwoord({ data: rijen.get(id) ?? null }) : antwoord({ error: "kapot" }, false)));
      wachtend.set(id, lijst);
    });
  }
  if (u.startsWith("/api/data/")) return antwoord({ data: [] });
  // De data komt niet meteen, zoals bij een echte route. Antwoordt hij in dezelfde microtaak als de
  // verversing, dan bundelt React "data op null" en "data terug" tot één render en verdwijnt het
  // paneel nooit; dan had de oude volgorde in handleSave (verversen vóór de foutcontrole) hier
  // niets laten zien.
  if (u.includes("/api/google-ads/client-data")) { await rust(50); return antwoord(CLIENT_DATA); }
  return antwoord({});
}) as typeof fetch;
const laatLos = (id: string, ok = true) => { const l = wachtend.get(id) ?? []; wachtend.delete(id); for (const f of l) f(ok); return l.length; };
const leesLoopt = (id: string) => (wachtend.get(id) ?? []).length;
const rust = (ms = 60) => new Promise((r) => echteTimeout(r, ms));
const tekstVan = (n: Knoop): string => (n._t || n._nv || "") + n.childNodes.map(tekstVan).join("");
const inBoom = (n: Knoop): Knoop[] => [n, ...n.childNodes.flatMap(inBoom)];
const props = (n: Knoop) => Object.entries(n).find(([k]) => k.startsWith("__reactProps$"))?.[1] as Record<string, unknown> | undefined;
const invoerWaarden = (h: Knoop) => inBoom(h).filter((n) => n.tagName === "INPUT").map((n) => String((n as { value?: unknown }).value ?? n.attrs.value ?? ""));
const vindInvoer = (h: Knoop, waarde: string) => inBoom(h).find((n) => n.tagName === "INPUT" && String((n as { value?: unknown }).value ?? n.attrs.value ?? "") === waarde);
const typ = (n: Knoop | undefined, waarde: string) => (props(n as Knoop)?.onChange as ((e: unknown) => void) | undefined)?.({ target: { value: waarde }, currentTarget: { value: waarde } });
const klikOpslaan = (h: Knoop) => {
  const knop = inBoom(h).find((n) => n.tagName === "BUTTON" && /Instellingen opslaan/.test(tekstVan(n)));
  (props(knop as Knoop)?.onClick as ((e: unknown) => void) | undefined)?.({ preventDefault: noop, stopPropagation: noop, isPropagationStopped: () => false, isDefaultPrevented: () => false, currentTarget: knop, target: knop, nativeEvent: {}, button: 0, detail: 1 });
  return !!knop;
};
const foutZichtbaar = (h: Knoop) => /Niet opgeslagen in de database/.test(tekstVan(h));
const paneelStaat = (h: Knoop) => /Instellingen opslaan/.test(tekstVan(h));
const terugkerend = (id: string) => {
  rijen.set(id, { kpi_targets: KPI_2600 });
  opslag.set(SLEUTEL + id, JSON.stringify({ clientId: id, conversionActions: [], conversionLagDays: 3, kpiTargets: KPI_2600, kpiDoelenOpgeslagen: true }));
};

async function main() {
  const { createElement, useState } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ClientDataProvider, useClientDataState, INSTELLINGEN_WACHT_MS } = await import("./client-data-provider");
  wachtMs = INSTELLINGEN_WACHT_MS;
  const { useClientData } = await import("./use-client-data");
  const cs = await import("./client-settings");
  const { ClientSettingsPanel } = await import("../components/dashboard/client-settings");

  // Het dashboard in het klein: de provider mount pas als de data er is, en verdwijnt zodra
  // invalidateClientCache de data op null zet (zoals client-dashboard.tsx).
  let doel: { conversions: number; adSpend: number } | undefined;
  function Doel() { doel = useClientDataState()?.data?.targetCurrentYear; return null; }
  let zetKlant: (id: string) => void = noop;
  function Dashboard({ start }: { start: string }) {
    const [klant, setKlant] = useState(start);
    zetKlant = setKlant;
    const clientData = useClientData(klant);
    return clientData.data
      ? createElement(ClientDataProvider, { clientId: klant, children: [createElement(Doel, { key: "doel" }), createElement(ClientSettingsPanel, { key: `paneel-${klant}`, clientId: klant, clientName: "x", kaarten: ["kpi"] })] })
      : createElement("div", null, "dashboard-laadt");
  }
  const monteer = (start: string) => {
    const h = (doc.createElement as (t: string) => Knoop)("div");
    const root = createRoot(h as unknown as Element);
    root.render(createElement(Dashboard, { start }));
    return { h, root };
  };

  console.log("Opslaan mislukt: melding en invoer blijven staan, cache en localStorage ongemoeid");
  {
    const ID = "gads-mislukt";
    terugkerend(ID);
    const { h, root } = monteer(ID);
    await rust(200); laatLos(ID); await rust(200);
    check("voorwaarde: het paneel toont het opgeslagen doel", JSON.stringify(invoerWaarden(h)) === '["2600","45"]', JSON.stringify(invoerWaarden(h)));
    typ(vindInvoer(h, "2600"), "2500"); await rust(100);
    check("voorwaarde: de gebruiker typte 2.500", JSON.stringify(invoerWaarden(h)) === '["2500","45"]', JSON.stringify(invoerWaarden(h)));
    schrijfFaalt = true;
    const verversingenVoor = gestuurd.filter((t) => t === "client-data-refresh").length;
    check("voorwaarde: de opslaanknop is er", klikOpslaan(h));
    // Op elk meetmoment: de melding staat er, het paneel is niet weg, de invoer staat er nog.
    for (const ms of [0, 10, 50, 200, 500]) {
      await rust(ms);
      check(`+${ms} ms: de melding "Niet opgeslagen" is zichtbaar`, foutZichtbaar(h), tekstVan(h).slice(0, 40));
      check(`+${ms} ms: het paneel is niet verdwenen`, paneelStaat(h), tekstVan(h).slice(0, 40));
      check(`+${ms} ms: de invoer staat er nog (2.500, 45)`, JSON.stringify(invoerWaarden(h)) === '["2500","45"]', JSON.stringify(invoerWaarden(h)));
    }
    check("geen verversing: client-data-refresh is niet gestuurd", gestuurd.filter((t) => t === "client-data-refresh").length === verversingenVoor, String(gestuurd.length));
    check("geen tweede lezing van client_settings", leesLoopt(ID) === 0, String(leesLoopt(ID)));
    const cache = cs.getClientSettings(ID);
    check("de cache houdt het opgeslagen doel (2.600), niet het mislukte", cache.kpiTargets.conversionsAbsolute === 2600 && cache.kpiDoelenOpgeslagen === true, JSON.stringify(cache.kpiTargets));
    check("localStorage ook", JSON.parse(opslag.get(SLEUTEL + ID) ?? "{}").kpiTargets?.conversionsAbsolute === 2600);
    check("het dashboard rekent nog met 2.600", doel?.conversions === 2600, JSON.stringify(doel));
    check("niets naar client_targets geschreven", geschreven.filter((g) => g.url.includes("client_targets")).length === 0);
    check("één poging op client_settings", geschreven.filter((g) => g.url.includes("client_settings")).length === 1);

    console.log("Daarna lukt het opslaan wel: cache gevuld, verversing, doelen naar client_targets");
    schrijfFaalt = false;
    rijen.set(ID, { kpi_targets: { ...KPI_2600, conversionsAbsolute: 2500 } });
    klikOpslaan(h);
    await rust(50);
    check("de melding is weg", !foutZichtbaar(h), tekstVan(h).slice(0, 40));
    check("client-data-refresh is gestuurd", gestuurd.filter((t) => t === "client-data-refresh").length === verversingenVoor + 1, String(gestuurd.length));
    const na = cs.getClientSettings(ID);
    check("de cache heeft 2.500, opgeslagen", na.kpiTargets.conversionsAbsolute === 2500 && na.kpiDoelenOpgeslagen === true, JSON.stringify(na.kpiTargets));
    check("localStorage ook", JSON.parse(opslag.get(SLEUTEL + ID) ?? "{}").kpiTargets?.conversionsAbsolute === 2500);
    await rust(100);
    const targets = geschreven.filter((g) => g.url.includes("client_targets"));
    check("de CPA gaat naar client_targets", targets.some((g) => JSON.stringify(g.body).includes('"cpa"')), JSON.stringify(targets).slice(0, 200));
    // De verversing laat het paneel opnieuw mounten en opnieuw lezen; na die lezing staat het nieuwe doel er.
    await rust(200); laatLos(ID); await rust(200);
    check("na de verversing toont het paneel 2.500 zonder melding", JSON.stringify(invoerWaarden(h)) === '["2500","45"]' && !foutZichtbaar(h), JSON.stringify(invoerWaarden(h)));
    check("en het dashboard rekent met 2.500", doel?.conversions === 2500, JSON.stringify(doel));
    root.unmount(); await rust(50);
  }

  console.log("Typen terwijl het lezen nog loopt: het antwoord zet de invoer niet terug");
  for (const [label, ok] of [["het antwoord komt", true], ["het lezen mislukt", false]] as const) {
    const ID = ok ? "gads-typt-ok" : "gads-typt-fout";
    terugkerend(ID);
    const { h, root } = monteer(ID);
    await rust(200);
    check(`${label}: voorwaarde: het lezen loopt nog en het paneel staat er (cache)`, leesLoopt(ID) === 1 && paneelStaat(h), `${leesLoopt(ID)} / ${tekstVan(h).slice(0, 30)}`);
    typ(vindInvoer(h, "2600"), "2500"); await rust(100);
    check(`${label}: voorwaarde: 2.500 getypt`, JSON.stringify(invoerWaarden(h)) === '["2500","45"]', JSON.stringify(invoerWaarden(h)));
    laatLos(ID, ok); await rust(250);
    check(`${label}: de invoer staat er nog (2.500, 45)`, JSON.stringify(invoerWaarden(h)) === '["2500","45"]', JSON.stringify(invoerWaarden(h)));
    check(`${label}: het dashboard rekent met het opgeslagen doel (2.600)`, doel?.conversions === 2600, JSON.stringify(doel));
    root.unmount(); await rust(50);
  }

  console.log("Een late lezing die wel iets nieuws brengt, vult nog steeds in (de reparatie uit ronde vier)");
  {
    // Eerste bezoek: geen cache. Na de wachttijd rendert de provider met de standaard; het antwoord
    // komt daarna, en het paneel hoort dan het opgeslagen doel te tonen (lib/__instellingen_paneel_laat_test.ts).
    const ID = "gads-laat";
    rijen.set(ID, { kpi_targets: KPI_2600 });
    const { h, root } = monteer(ID);
    await rust(600);
    check("voorwaarde: na de wachttijd toont het paneel de standaard (+10%)", /ten opzichte van vorig jaar/.test(tekstVan(h)), tekstVan(h).slice(0, 40));
    laatLos(ID); await rust(250);
    check("na het late antwoord toont het paneel 2.600 en 45", JSON.stringify(invoerWaarden(h)) === '["2600","45"]', JSON.stringify(invoerWaarden(h)));
    root.unmount(); await rust(50);
  }

  console.log("Klant zonder rij: na A -> B -> A geen laadvlak meer");
  {
    const A = "gads-zonder-rij", B = "gads-met-rij";
    rijen.set(A, null); rijen.set(B, { kpi_targets: KPI_2600 });
    const { h, root } = monteer(A);
    await rust(200);
    // De poort rendert het laadvlak van de pagina (components/ui/laadvlak.tsx); zijn schermlezertekst
    // is wat ervan in de tekst overblijft.
    check("eerste bezoek aan A: de provider wacht op het lezen", /cijfers worden geladen/.test(tekstVan(h)), tekstVan(h).slice(0, 30));
    laatLos(A); await rust(150);
    check("na het lezen (geen rij): de terugval staat in de cache", cs.heeftGecachteInstellingen(A));
    check("en geldt niet als ingevoerd doel", cs.kpiDoelenIngevoerd(cs.getClientSettings(A)) === false);
    check("niet in localStorage: daar hoort wat echt gelezen of opgeslagen is", opslag.get(SLEUTEL + A) === undefined);
    zetKlant(B); await rust(200); laatLos(B); await rust(150);
    zetKlant(A); await rust(200);
    check("terug naar A: het dashboard staat er meteen, geen laadvlak", !/cijfers worden geladen/.test(tekstVan(h)) && paneelStaat(h), tekstVan(h).slice(0, 30));
    check("terug naar A: het routedoel (1.938), niet dat van B", doel?.conversions === 1938, JSON.stringify(doel));
    laatLos(A); await rust(100);
    root.unmount(); await rust(50);
  }

  console.log("Een mislukte lezing komt niet in de cache");
  {
    const F = "gads-lezen-faalt";
    const lezing = cs.loadClientSettings(F);
    await rust(20);
    laatLos(F, false);
    const uit = await lezing;
    check("de terugval komt terug", uit.kpiDoelenOpgeslagen === false);
    check("maar staat niet in de cache: na een fout is er niets bekend", !cs.heeftGecachteInstellingen(F));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

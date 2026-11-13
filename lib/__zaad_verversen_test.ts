// Gedragstest: het HELE klantdashboard op een nep-DOM, met het zaad van de server (de kerncijfers
// die de server al in de HTML zet, components/dashboard/band-uit-zaad.tsx).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__zaad_verversen_test.ts
//
// Waarom. Twee fouten uit de review van de eerste versie, allebei in gedrag en niet in een functie:
//
// 1. HET ZAAD BLEEF DE TERUGVAL VOOR ELKE LAADSTAND. Sla iemand in de instellingen een andere
//    conversieselectie op, dan roept client-settings.tsx invalidateClientCache aan en laadt de
//    Google-route opnieuw. De band stond dan weer in de laadstand, en toonde de cijfers van de
//    paginalaad: "Conversies 1.534 ... CPA € 33", tot de route antwoordde en ze sprongen naar
//    "7.534 ... € 8". Cijfers van een selectie die niet meer geldt, gepresenteerd als de huidige.
//    Vast: het zaad geldt tot de band één keer zelf klaar was; daarna het laadvlak, zoals vóór het
//    zaad. In beide weergaven, want ze delen het mechanisme (PeriodSummary zolangLaden).
//
// 2. DE OPBOUW OVER CIJFERS DIE ER AL STONDEN. De nieuwe weergave onderdrukte de opbouw pas als de
//    Suspense-grens van het zaad zelf een effect draaide. Antwoordt de stroom later dan het script
//    laadt, dan kunnen de hooks eerder klaar zijn dan die grens, en liep dat effect nooit. Nu beslist
//    de bovenkant bij zijn eerste render: bood het dashboard zaad aan, dan geen opbouw. Hier met
//    een zaad dat pas NA de mount binnenkomt, en als controle zonder zaad, waar de opbouw wél speelt
//    (anders zei "geen opbouw" niets: de detector moet hem kunnen zien).

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Een kleine DOM die zijn boom bijhoudt, zodat de getoonde tekst te lezen is ─────────────────
// Elke klasse die ooit "opbouw" bevatte, wordt onthouden: de opbouw is een CSS-klasse.
let opbouwGezien = false;
const noteerKlasse = (v: string) => { if (/(^|\s)opbouw(\s|$)/.test(v)) opbouwGezien = true; };
type Stijl = Record<string, unknown>;
class N {
  childNodes: N[] = []; parentNode: N | null = null; attrs: Record<string, string> = {}; style: Stijl = {};
  ownerDocument: unknown; namespaceURI = "http://www.w3.org/1999/xhtml"; _text = "";
  nodeType: number; nodeName: string;
  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType; this.nodeName = nodeName;
    this.style.setProperty = (k: string, v: string) => { this.style[k] = v; };
    this.style.removeProperty = (k: string) => { delete this.style[k]; };
  }
  get tagName() { return this.nodeName; }
  get firstChild(): N | null { return this.childNodes[0] ?? null; }
  get lastChild(): N | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): N | null { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; }
  appendChild(c: N) { c.parentNode?.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore(c: N, ref: N | null) { c.parentNode?.removeChild(c); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); c.parentNode = this; return c; }
  removeChild(c: N) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); if (k === "class") noteerKlasse(String(v)); }
  setAttributeNS(_: string, k: string, v: string) { this.setAttribute(k, v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  hasAttribute(k: string) { return k in this.attrs; }
  addEventListener() {} removeEventListener() {}
  get nodeValue() { return this._text; } set nodeValue(v: string) { this._text = v; }
  get data() { return this._text; } set data(v: string) { this._text = v; }
  get textContent(): string { return this.nodeType === 3 ? this._text : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v: string) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (v !== "" && v != null) { const t = new N(3, "#text"); t._text = String(v); this.appendChild(t); } }
  focus() {} blur() {} getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  contains() { return false; } querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; }
  get classList() { return { add() {}, remove() {}, contains: () => false, toggle() {} }; }
  set className(v: string) { this.attrs.class = v; noteerKlasse(v); } get className() { return this.attrs.class ?? ""; }
  set innerHTML(_: string) { this.childNodes = []; }
}
const doc = Object.assign(new N(9, "#document"), {
  createElement: (t: string) => { const n = new N(1, t.toUpperCase()); n.ownerDocument = doc; return n; },
  createElementNS: (_: string, t: string) => { const n = new N(1, t); n.ownerDocument = doc; return n; },
  createTextNode: (s: string) => { const n = new N(3, "#text"); n._text = s; n.ownerDocument = doc; return n; },
  createComment: (s: string) => { const n = new N(8, "#comment"); n._text = s; return n; },
  activeElement: null, cookie: "", documentElement: new N(1, "HTML"), body: new N(1, "BODY"), head: new N(1, "HEAD"),
  getElementById: () => null, hidden: false, visibilityState: "visible",
});
const opslag = new Map<string, string>();
const ls = { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); }, clear: () => opslag.clear(), key: () => null, length: 0 };
const luisteraars = new Map<string, Set<(e: Event) => void>>();
const win: Record<string, unknown> = {
  document: doc, localStorage: ls, sessionStorage: ls, getSelection: () => null, HTMLIFrameElement: class {},
  location: { pathname: "/client/gads-1", search: "", href: "http://x/client/gads-1", origin: "http://x" },
  history: { replaceState() {}, pushState() {}, state: null },
  addEventListener: (t: string, f: (e: Event) => void) => { if (!luisteraars.has(t)) luisteraars.set(t, new Set()); luisteraars.get(t)!.add(f); },
  removeEventListener: (t: string, f: (e: Event) => void) => { luisteraars.get(t)?.delete(f); },
  dispatchEvent: (e: Event) => { for (const f of luisteraars.get(e.type) ?? []) f(e); return true; },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (t: ReturnType<typeof setInterval>) => clearInterval(t),
  setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  innerWidth: 1280, innerHeight: 900, scrollTo() {}, getComputedStyle: () => ({ getPropertyValue: () => "" }),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  navigator: { userAgent: "node" },
};
win.window = win; win.self = win;
Object.assign(globalThis, {
  window: win, document: doc, localStorage: ls, sessionStorage: ls, ResizeObserver: win.ResizeObserver,
  IntersectionObserver: win.IntersectionObserver, requestAnimationFrame: win.requestAnimationFrame,
  cancelAnimationFrame: win.cancelAnimationFrame, HTMLElement: N, Element: N, Node: N,
});
if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class<T> extends Event { detail: T; constructor(t: string, o?: { detail: T }) { super(t); this.detail = o?.detail as T; } };
}
// Recharts meldt dat zijn grafiek hier geen maat heeft; dat is de nep-DOM, niet de pagina.
const waarschuw = console.warn;
console.warn = (...a: unknown[]) => { if (!String(a[0]).includes("of chart should be greater than 0")) waarschuw(...a); };

// ── De antwoorden ─────────────────────────────────────────────────────────────────────────────
// `f` verschuift de conversies: f = 500 is het antwoord NA een andere conversieselectie.
const maand = (m: number, f: number) => ({ month: m, conversions: 100 + m * 3 + f, revenue: 9000 + m * 110 + f * 7, adSpend: 4000 + m * 37 + f, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 });
function google(f: number) {
  return {
    currentYear: 2026, realizedThroughMonth: 10, targetCurrentYear: { conversions: 1650, revenue: 0, adSpend: 50000 },
    historicalYears: [2024, 2025].map((year) => ({ year, monthly: Array.from({ length: 12 }, (_, i) => maand(i + 1, year - 2020 + f)), weekly: [] })),
    currentYearMonthly: Array.from({ length: 10 }, (_, i) => maand(i + 1, 9 + f)), currentYearWeekly: [],
    dataStand: { laatsteVolleMaand: "2026-10", partieel: null, dataTot: "2026-10-31", uitgesloten: [] },
  };
}
const BLENDED = {
  currentYear: 2026, realizedThroughMonth: 10, targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 }, historicalYears: [], currentYearMonthly: [],
  dataStand: { laatsteVolleMaand: "2026-10", partieel: null, dataTot: "2026-10-31", uitgesloten: [], bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: true }] },
  perKanaal: [{ kanaal: "google", vanaf: null, maanden: [] }],
};

// fetch: de Google-route geeft het NIEUWE antwoord, maar pas als de test hem loslaat. De blended
// route antwoordt meteen (voor de controle zonder zaad); al het andere is een 404.
let laatGoogleLos: (() => void) | null = null;
let googleVerzoeken = 0;
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  if (u.includes("/api/google-ads/client-data")) {
    googleVerzoeken += 1;
    await new Promise<void>((r) => { laatGoogleLos = r; });
    return { ok: true, status: 200, json: async () => google(500) } as unknown as Response;
  }
  if (u.includes("/api/blended")) return { ok: true, status: 200, json: async () => BLENDED } as unknown as Response;
  return { ok: false, status: 404, json: async () => ({ error: "nee" }), text: async () => "" } as unknown as Response;
}) as typeof fetch;

const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Zoals React een belofte kent die hij al vervuld zag (de stroom van de server is binnen). */
function vervuld<T>(w: T): Promise<T> {
  const p = Promise.resolve(w) as Promise<T> & { status?: string; value?: T };
  p.status = "fulfilled"; p.value = w;
  return p;
}

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { SearchParamsContext, PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { ClientDashboard } = await import("@/components/dashboard/client-dashboard");
  const { invalidateClientCache } = await import("./use-client-data");
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  const PERIODE = { preset: "last_12m", custom: null, comparison: "previous_year" };

  // Elk geval een eigen klant: de cache van useClientData leeft per module, niet per boom.
  function toon(id: string, weergave: "vertrouwd" | "nieuw", zaad: { google: Promise<unknown>; blended: Promise<unknown> } | null) {
    const container = doc.createElement("div");
    const root = createRoot(container as unknown as Element, { onRecoverableError: () => {} });
    root.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(PathnameContext.Provider, { value: `/client/${id}` },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams("") as never },
          createElement(ClientDashboard, {
            client: { id, name: id, source: "google-ads" } as never,
            bewaardeWeergave: weergave === "nieuw" ? "nieuw" : null,
            blendedVanServer: (zaad?.blended ?? null) as never,
            instellingenVanServer: (zaad ? vervuld({ waarde: { rij: null } }) : null) as never,
            googleVanServer: (zaad?.google ?? null) as never,
            periodeVanServer: PERIODE as never,
            vandaagVanServer: "2026-11-13",
          })))));
    // De kerncijfers: van "Conversies" tot en met de CPA.
    const kern = () => {
      const t = container.textContent;
      const i = t.search(/Conversies/);
      if (i < 0) return null;
      const j = t.indexOf("CPA", i);
      return t.slice(i, j < 0 ? i + 160 : j + 8);
    };
    return { root, kern };
  }

  // ── 1. De opbouw van het eerste bezoek (nieuwe weergave) ───────────────────────────────────
  // EERST: "eerste bezoek" geldt per sessie (lib/beweging.ts, op moduleniveau). Speelde een
  // eerder geval de opbouw, dan zou dit geval hem niet meer kunnen spelen, en zei de check niets.
  // Het zaad komt pas NA de mount binnen (de stroom van de server is trager dan het script). De
  // route hoeft dan niet: de hooks nemen het zaad zodra het er is.
  console.log("Opbouw, zaad dat na de mount binnenkomt");
  {
    opslag.clear(); opbouwGezien = false; googleVerzoeken = 0;
    let geef: () => void = () => {};
    const later = new Promise<void>((r) => { geef = r; });
    const zaad = { google: later.then(() => ({ waarde: google(0) })), blended: later.then(() => ({ waarde: BLENDED })) };
    const { root, kern } = toon("gads-1201", "nieuw", zaad);
    await wacht(100);
    geef();
    await wacht(400);
    check("de cijfers staan er, uit het zaad", /1\.534/.test(kern() ?? "") && googleVerzoeken === 0, `${kern()} / ${googleVerzoeken}`);
    check("en er is geen opbouw gespeeld over cijfers die al in de HTML stonden", !opbouwGezien);
    root.unmount();
  }
  // Controle: zonder zaad speelt de opbouw bij het eerste bezoek wel (sessionStorage is leeg en de
  // vorige mount markeerde hem niet als gezien). Anders bewees de check hierboven niets.
  console.log("Opbouw, controle zonder zaad");
  {
    opbouwGezien = false; googleVerzoeken = 0;
    const { root, kern } = toon("gads-1202", "nieuw", null);
    await wacht(150);
    (laatGoogleLos as (() => void) | null)?.();
    await wacht(400);
    check("de cijfers komen van de route", /7\.534/.test(kern() ?? "") && googleVerzoeken === 1, `${kern()} / ${googleVerzoeken}`);
    check("en de opbouw speelt", opbouwGezien);
    root.unmount();
  }

  // ── 2. Verversen na een andere conversieselectie: niet de cijfers van de paginalaad ─────────
  for (const [id, weergave] of [["gads-1101", "vertrouwd"], ["gads-1102", "nieuw"]] as const) {
    console.log(`Verversen, ${weergave} weergave`);
    googleVerzoeken = 0;
    const { root, kern } = toon(id, weergave, { google: vervuld({ waarde: google(0) }), blended: vervuld({ waarde: BLENDED }) });
    await wacht(300);
    const geladen = kern();
    check(`[${weergave}] na het laden de kerncijfers, uit het zaad (geen verzoek aan de route)`, geladen !== null && /1\.534/.test(geladen) && googleVerzoeken === 0, `${geladen} / ${googleVerzoeken}`);
    // De gebruiker slaat een andere conversieselectie op (client-settings.tsx).
    invalidateClientCache(id);
    await wacht(150);
    const tijdens = kern();
    check(`[${weergave}] tijdens het verversen geen cijfers van de paginalaad, maar het laadvlak`, tijdens === null, String(tijdens));
    // Minstens één: elke useClientData in de boom luistert zelf naar de ververs (al zo vóór het zaad).
    check(`[${weergave}] en de route wordt echt opnieuw gevraagd`, googleVerzoeken >= 1, String(googleVerzoeken));
    (laatGoogleLos as (() => void) | null)?.();
    await wacht(300);
    const na = kern();
    check(`[${weergave}] daarna de nieuwe cijfers`, na !== null && /7\.534/.test(na), String(na));
    root.unmount();
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

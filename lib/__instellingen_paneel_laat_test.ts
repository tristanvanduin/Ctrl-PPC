// Regressietest: Instellingen als de opgeslagen instellingen pas NA de wachttijd van de provider
// binnenkomen (ClientSettingsPanel in components/dashboard/client-settings.tsx).
// Draaien: tsx lib/__instellingen_paneel_laat_test.ts
//
// Wat er misging. Na INSTELLINGEN_WACHT_MS rendert de provider zijn kinderen met de standaard
// (getClientSettings zonder cache). Komt het antwoord daarna alsnog, dan voegt de provider opnieuw
// samen en toont het dashboard 2.600 en € 45. Het paneel las zijn velden echter alleen in een effect
// op [clientId, conversionActions], en conversionActions houdt bij die samenvoeging dezelfde
// referentie: het paneel bleef "+10% ten opzichte van vorig jaar" tonen, en een klik op "Instellingen
// opslaan" zonder iets te veranderen schreef groei 10 en CPA uit weg over de opgeslagen 2.600 / € 45.
//
// Het echte paneel in de echte provider, op een nep-DOM. Niets verlaat het proces: fetch is nep, en
// het opslaan schrijft naar een lijst in deze test.

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// loadClientSettings vraagt de database alleen als er een browser-Supabase is (uit de omgeving).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-DOM: genoeg voor een paneel met tekst en invoervelden ────────────────────────────────
const noop = () => {};
class Leeg {}
type Knoop = Record<string, unknown> & { childNodes: Knoop[]; attrs: Record<string, unknown>; tagName: string; _t: string; _nv: string };
const alle: Knoop[] = [];
function maakKnoop(nodeType: number, tag = "DIV"): Knoop {
  const n = {
    nodeType, nodeName: tag, tagName: tag, namespaceURI: "http://www.w3.org/1999/xhtml",
    addEventListener: noop, removeEventListener: noop,
    setAttribute(k: string, v: unknown) { n.attrs[k] = v; }, removeAttribute: noop,
    appendChild(c: Knoop) { n.childNodes.push(c); return c; },
    removeChild(c: Knoop) { n.childNodes = n.childNodes.filter((x) => x !== c); return c; },
    insertBefore(c: Knoop) { n.childNodes.push(c); return c; },
    style: { setProperty: noop, removeProperty: noop }, ownerDocument: null as unknown, childNodes: [] as Knoop[],
    get firstChild() { return n.childNodes[0] ?? null; }, attrs: {} as Record<string, unknown>,
    _t: "", get textContent() { return n._t; }, set textContent(v: string) { n._t = String(v); },
    _nv: "", get nodeValue() { return n._nv; }, set nodeValue(v: string) { n._nv = String(v); },
  } as unknown as Knoop;
  // Base UI kijkt met instanceof of een knop een echt element is; zonder dit prototype waarschuwt
  // hij bij elke render dat de knop geen <button> is.
  Object.setPrototypeOf(n, Leeg.prototype);
  alle.push(n);
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
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
  window: {
    document: doc, location: { search: "", pathname: "/", href: "http://x/", hostname: "x" },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, getSelection: () => null,
    HTMLIFrameElement: Leeg, HTMLElement: Leeg, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  },
  document: doc, HTMLElement: Leeg, HTMLInputElement: Leeg, Element: Leeg, Node: Leeg,
});

// De wachttijd van de provider (3 s) versneld: alleen een timer van precies die duur.
const echteTimeout = globalThis.setTimeout;
let wachtMs = -1;
globalThis.setTimeout = ((f: () => void, ms?: number, ...rest: unknown[]) =>
  echteTimeout(f, ms === wachtMs ? 30 : ms, ...rest)) as typeof setTimeout;

// ── Nep-fetch: client_settings antwoordt pas als de test het zegt; schrijven wordt onthouden ──
const maand = (m: number, c: number) => ({ month: m, conversions: c, revenue: 21000, adSpend: 11000, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 });
const CLIENT_DATA = {
  customerId: "x", currentYear: 2026, realizedThroughMonth: 7, dataStand: null,
  targetCurrentYear: { conversions: 1938, revenue: 282062, adSpend: 139860 },
  historicalYears: [{ year: 2025, monthly: Array.from({ length: 12 }, (_, i) => maand(i + 1, 147)), weekly: [] }],
  currentYearMonthly: Array.from({ length: 7 }, (_, i) => maand(i + 1, 150)), currentYearWeekly: [],
};
// Opgeslagen (de vorm van demo-greentech): 2.600 conversies vast, CPA € 45.
const INSTELLINGEN = { kpi_targets: { conversionsMode: "absolute", conversionsAbsolute: 2600, revenueMode: "absolute", revenueAbsolute: 0, conversionsGrowthPct: 0, revenueGrowthPct: 0, cpaTarget: 45, roasTarget: 0 } };
const antwoord = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as Response);
const geschreven: { url: string; body: unknown }[] = [];
let instellingenLos: (() => void)[] = [];
globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
  const u = String(url);
  if (init?.method && init.method !== "GET") { geschreven.push({ url: u, body: JSON.parse(init.body ?? "null") }); return antwoord({ data: null }); }
  if (u.startsWith("/api/data/client_settings")) return new Promise<Response>((klaar) => instellingenLos.push(() => klaar(antwoord({ data: INSTELLINGEN }))));
  if (u.startsWith("/api/data/")) return antwoord({ data: [] });
  if (u.includes("/api/google-ads/client-data")) return antwoord(CLIENT_DATA);
  return antwoord({});
}) as typeof fetch;

const rust = (ms = 40) => new Promise((r) => echteTimeout(r, ms));
const tekstVan = (n: Knoop): string => (n._t || n._nv || "") + n.childNodes.map(tekstVan).join("");

async function main() {
  const { createElement, useState } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ClientDataProvider, useClientDataState, INSTELLINGEN_WACHT_MS } = await import("./client-data-provider");
  wachtMs = INSTELLINGEN_WACHT_MS;
  const { useClientData } = await import("./use-client-data");
  const { ClientSettingsPanel } = await import("../components/dashboard/client-settings");

  const ID = "gads-laat";
  let zetTab: (t: string) => void = noop;
  let doel: { conversions: number; adSpend: number } | undefined;
  function Doel() { doel = useClientDataState()?.data?.targetCurrentYear; return null; }
  function Dashboard() {
    const clientData = useClientData(ID);
    const [tab, setTab] = useState("dashboard");
    zetTab = setTab;
    return clientData.data
      ? createElement(ClientDataProvider, {
        clientId: ID,
        children: [createElement(Doel, { key: "doel" }), tab === "settings" ? createElement(ClientSettingsPanel, { key: "paneel", clientId: ID, clientName: "x", kaarten: ["kpi"] }) : null],
      })
      : null;
  }
  const houder = (doc.createElement as (t: string) => Knoop)("div");
  const root = createRoot(houder as unknown as Element);
  root.render(createElement(Dashboard));
  await rust(200);

  // De wachttijd is om, de instellingen zijn er nog niet: het dashboard rendert met de standaard, en
  // de gebruiker opent Instellingen.
  check("voorwaarde: het verzoek om de instellingen loopt nog", instellingenLos.length > 0, String(instellingenLos.length));
  zetTab("settings");
  await rust(200);
  // Alleen wat nu in de boom hangt: vervangen knopen blijven in `alle` staan.
  const inBoom = (n: Knoop): Knoop[] => [n, ...n.childNodes.flatMap(inBoom)];
  const paneel = () => {
    const invoer = inBoom(houder).filter((n) => n.tagName === "INPUT").map((n) => (n as unknown as { value?: unknown }).value ?? n.attrs.value).filter((v) => v !== undefined && v !== "");
    return { groei: /ten opzichte van vorig jaar/.test(tekstVan(houder)), invoer: invoer.map(String) };
  };
  check("voorwaarde: vóór het antwoord toont het paneel de standaard (+10%)", paneel().groei, JSON.stringify(paneel()));

  // Het antwoord komt alsnog.
  for (const los of instellingenLos) los();
  instellingenLos = [];
  await rust(200);
  check("na het antwoord: het dashboard rekent met 2.600 en € 117.000", doel?.conversions === 2600 && doel?.adSpend === 117000, JSON.stringify(doel));
  const na = paneel();
  check("na het antwoord: het paneel toont het opgeslagen doel (2.600, CPA 45), niet +10%", !na.groei && na.invoer.includes("2600") && na.invoer.includes("45"), JSON.stringify(na));

  // Opslaan zonder iets te veranderen schrijft wat er opgeslagen stond, niet de standaard.
  const knop = inBoom(houder).find((n) => n.tagName === "BUTTON" && /Instellingen opslaan/.test(tekstVan(n)));
  const props = knop && (Object.entries(knop).find(([k]) => k.startsWith("__reactProps$"))?.[1] as { onClick?: (e: unknown) => void } | undefined);
  check("voorwaarde: de opslaanknop is er", typeof props?.onClick === "function");
  props?.onClick?.({ preventDefault: noop, stopPropagation: noop, isPropagationStopped: () => false, isDefaultPrevented: () => false, currentTarget: knop, target: knop, nativeEvent: {}, button: 0, detail: 1 });
  await rust(200);
  const rij = geschreven.find((g) => g.url.includes("/api/data/client_settings"))?.body as { op?: string; rows?: { kpi_targets?: Record<string, unknown> }[] } | undefined;
  check("voorwaarde: opslaan schrijft client_settings", rij?.op === "upsert", JSON.stringify(rij)?.slice(0, 200));
  const kpi = rij?.rows?.[0]?.kpi_targets;
  check("opslaan zonder wijziging: conversies blijven vast op 2.600", kpi?.conversionsMode === "absolute" && kpi?.conversionsAbsolute === 2600, JSON.stringify(kpi));
  check("opslaan zonder wijziging: de CPA blijft € 45", kpi?.cpaTarget === 45, JSON.stringify(kpi));

  root.unmount();
  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

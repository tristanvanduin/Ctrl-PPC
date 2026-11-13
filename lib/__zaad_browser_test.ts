// Gedragstest in de browser (een echte React-boom op een nep-DOM): het Google-zaad in useClientData
// en de periodecookie van de PeriodProvider, de twee browserkanten van de kerncijfers die de server
// al in de HTML zet (components/dashboard/band-uit-zaad.tsx).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__zaad_browser_test.ts
//
// Waarom. De server leest de Google-route nu zelf, voor de kerncijfers in de HTML
// (components/dashboard/band-uit-zaad.tsx). Vroeg de browser hem daarna nog eens, dan las de server
// alles dubbel (bij een live klant twee keer de Google Ads API). Wat hier vastligt:
// - met zaad: GEEN verzoek, en dezelfde staat als van de route (googleDataUitAntwoord);
// - een zaad dat niets bruikbaars draagt (null): het gewone verzoek, één keer;
// - na invalidateClientCache (opslaan van de instellingen) de route, niet het oude zaad;
// - een zaad voor een klant met een vers antwoord in de cache wordt genegeerd.
//
// En de PeriodProvider (lib/period/period-context.tsx): de server kiest het venster van de cijfers
// uit een cookie, dus moet de browser die cookie gelijk houden met localStorage. Wat hier vastligt:
// - na het lezen van localStorage staat dezelfde keuze in de cookie, onder het pad van de klant;
// - ook zonder bewaarde keuze (dan de standaard: de server weet dan dat het de standaard is);
// - een nieuwe keuze gaat naar localStorage EN de cookie;
// - zonder bewaarInCookie (het portfolio) geen cookie;
// - de eerste render staat op de keuze van de server (beginKeuze), niet op de standaard.

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-DOM: alleen wat createRoot nodig heeft voor een boom zonder DOM-knopen ─────────────
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
// document.cookie zoals de browser hem schrijft: elke regel zet één cookie, de rest blijft staan.
const koekjes = new Map<string, string>();
const doc = {
  ...knoop(9), activeElement: null, createElement: () => ({ ...knoop(1), ownerDocument: doc }),
  get cookie(): string { return [...koekjes.values()].map((r) => r.split(";")[0]).join("; "); },
  set cookie(regel: string) { koekjes.set(regel.split("=")[0], regel); },
};
const opslag = new Map<string, string>();
const localStorage = { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } };
const luisteraars = new Map<string, Set<(e: Event) => void>>();
Object.assign(globalThis, {
  window: {
    document: doc, getSelection: () => null, HTMLIFrameElement: class {}, localStorage,
    location: { pathname: "/client/gads-9", search: "" },
    addEventListener: (t: string, f: (e: Event) => void) => { if (!luisteraars.has(t)) luisteraars.set(t, new Set()); luisteraars.get(t)!.add(f); },
    removeEventListener: (t: string, f: (e: Event) => void) => { luisteraars.get(t)?.delete(f); },
    dispatchEvent: (e: Event) => { for (const f of luisteraars.get(e.type) ?? []) f(e); return true; },
  },
  document: doc,
  localStorage,
});
if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class<T> extends Event { detail: T; constructor(t: string, o?: { detail: T }) { super(t); this.detail = o?.detail as T; } };
}

// ── Nep-fetch: telt de verzoeken aan de Google-route per klantnummer ────────────────────────
const verzoeken: Record<string, number> = {};
const ANTWOORD = {
  currentYear: 2026,
  realizedThroughMonth: 2,
  targetCurrentYear: { conversions: 100, revenue: 0, adSpend: 1000 },
  historicalYears: [],
  currentYearMonthly: [1, 2].map((month) => ({ month, conversions: 10, revenue: 50, adSpend: 100, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 })),
  currentYearWeekly: [],
  dataStand: { laatsteVolleMaand: "2026-02", partieel: null, dataTot: "2026-02-28", uitgesloten: [] },
  campaigns: [{ campaignId: "c" }],
};
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  const nr = u.split("customerId=")[1] ?? "";
  verzoeken[nr] = (verzoeken[nr] ?? 0) + 1;
  return { ok: true, status: 200, json: async () => ({ ...ANTWOORD, bron: "route" }) } as unknown as Response;
}) as typeof fetch;

async function tot(waar: () => boolean): Promise<void> {
  const eind = Date.now() + 10_000;
  while (!waar() && Date.now() < eind) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
}

interface Staat { data: { dataStand?: unknown } | null; loading: boolean; error: string | null; campaigns?: unknown[] }

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useClientData, zaaiClientData, invalidateClientCache, googleDataUitAntwoord } = await import("./use-client-data");

  const staten: Record<string, Staat> = {};
  function Lezer({ naam, clientId }: { naam: string; clientId: string }) {
    staten[naam] = useClientData(clientId) as unknown as Staat;
    return null;
  }
  const mount = (naam: string, clientId: string) => {
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(Lezer, { naam, clientId }));
    return root;
  };
  const vers = <T,>(waarde: T) => Promise.resolve({ waarde });

  console.log("Met zaad: geen verzoek, dezelfde staat als van de route");
  {
    zaaiClientData("gads-111", vers({ ...ANTWOORD, bron: "server" }));
    const root = mount("a", "gads-111");
    await tot(() => staten.a?.loading === false);
    check("geen verzoek aan de Google-route", (verzoeken["111"] ?? 0) === 0, JSON.stringify(verzoeken));
    check("de data uit het zaad", !!staten.a?.data && staten.a.error === null && (staten.a.campaigns?.length ?? 0) === 1);
    const verwacht = googleDataUitAntwoord("gads-111", ANTWOORD);
    check("dezelfde reeks als googleDataUitAntwoord op dat antwoord", JSON.stringify(staten.a?.data) === JSON.stringify(verwacht));
    root.unmount();
  }

  console.log("Zaad zonder bruikbaar antwoord: het gewone verzoek, één keer");
  {
    zaaiClientData("gads-222", Promise.resolve(null));
    const root = mount("b", "gads-222");
    await tot(() => staten.b?.loading === false);
    check("één verzoek, met het antwoord van de route", verzoeken["222"] === 1 && !!staten.b?.data, JSON.stringify(verzoeken));
    root.unmount();
  }

  console.log("Na invalidateClientCache: de route, niet het oude zaad");
  {
    zaaiClientData("gads-333", vers({ ...ANTWOORD }));
    const root = mount("c", "gads-333");
    await tot(() => staten.c?.loading === false);
    check("eerst uit het zaad", (verzoeken["333"] ?? 0) === 0);
    invalidateClientCache("gads-333");
    await tot(() => verzoeken["333"] === 1 && staten.c?.loading === false);
    check("daarna één verzoek aan de route", verzoeken["333"] === 1, JSON.stringify(verzoeken));
    root.unmount();
  }

  console.log("Een zaad voor een klant met een vers antwoord in de cache wordt genegeerd");
  {
    // gads-222 staat sinds hierboven in de cache (van de route).
    zaaiClientData("gads-222", vers({ ...ANTWOORD, currentYearMonthly: [] }));
    const root = mount("d", "gads-222");
    await tot(() => staten.d?.loading === false);
    check("de cache, geen nieuw verzoek en niet het zaad", verzoeken["222"] === 1 && JSON.stringify(staten.d?.data) === JSON.stringify(staten.b?.data));
    root.unmount();
  }

  // ── De periodecookie ──────────────────────────────────────────────────────────────────────
  const { PeriodProvider, usePeriod } = await import("./period/period-context");
  const { PERIODE_COOKIE, periodeUitCookie } = await import("./period/periode-cookie");
  let periode: ReturnType<typeof usePeriod> | null = null;
  const eersteRender: string[] = [];
  function Kijker() {
    periode = usePeriod();
    eersteRender.push(periode.preset);
    return null;
  }
  const cookieKeuze = () => {
    const regel = koekjes.get(PERIODE_COOKIE);
    return regel ? periodeUitCookie(regel.split(";")[0].slice(PERIODE_COOKIE.length + 1)) : null;
  };
  const provider = (props: Record<string, unknown>) => {
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(PeriodProvider, { scope: "client-gads-9", ...props } as never, createElement(Kijker)));
    return root;
  };

  console.log("PeriodProvider: de cookie volgt localStorage");
  {
    opslag.set("rm-periode-client-gads-9", JSON.stringify({ preset: "last_3m", custom: null, comparison: "same_period_last_year" }));
    eersteRender.length = 0;
    const root = provider({ bewaarInCookie: true, beginKeuze: { preset: "last_6m", custom: null, comparison: "previous_period" } });
    await tot(() => (periode as { preset?: string } | null)?.preset === "last_3m");
    check("de eerste render staat op de keuze van de server, niet op de standaard", eersteRender[0] === "last_6m", eersteRender.join(","));
    check("daarna de bewaarde keuze uit localStorage", (periode as { preset?: string } | null)?.preset === "last_3m");
    check("en die staat nu ook in de cookie", JSON.stringify(cookieKeuze()) === JSON.stringify({ preset: "last_3m", custom: null, comparison: "same_period_last_year" }), String(koekjes.get(PERIODE_COOKIE)));
    check("onder het pad van deze klant", /path=\/client\/gads-9;/.test(koekjes.get(PERIODE_COOKIE) ?? ""), String(koekjes.get(PERIODE_COOKIE)));
    (periode as unknown as { set: (p: string, c: null, v: string) => void }).set("last_12m", null, "previous_period");
    await tot(() => (periode as { preset?: string } | null)?.preset === "last_12m");
    check("een nieuwe keuze: in localStorage en in de cookie", cookieKeuze()?.preset === "last_12m" && cookieKeuze()?.comparison === "previous_period"
      && JSON.parse(opslag.get("rm-periode-client-gads-9") ?? "{}").preset === "last_12m");
    root.unmount();
  }

  console.log("PeriodProvider: zonder bewaarde keuze de standaard in de cookie; zonder bewaarInCookie niets");
  {
    opslag.clear(); koekjes.clear();
    const root = provider({ bewaarInCookie: true });
    await tot(() => koekjes.has(PERIODE_COOKIE));
    check("niets bewaard: de standaard in de cookie", cookieKeuze()?.preset === "last_12m", String(koekjes.get(PERIODE_COOKIE)));
    root.unmount();
    koekjes.clear();
    const zonder = provider({});
    await tot(() => periode !== null);
    (periode as unknown as { set: (p: string, c: null, v: string) => void }).set("last_3m", null, "previous_period");
    await tot(() => (periode as { preset?: string } | null)?.preset === "last_3m");
    check("zonder bewaarInCookie: wel localStorage, geen cookie", !koekjes.has(PERIODE_COOKIE) && JSON.parse(opslag.get("rm-periode-client-gads-9") ?? "{}").preset === "last_3m");
    zonder.unmount();
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

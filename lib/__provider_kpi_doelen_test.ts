// Regressietest: de KPI-doelen op het Google-tabblad (ClientDataProvider, lib/client-data-provider.tsx).
// Draaien: tsx lib/__provider_kpi_doelen_test.ts
//
// Wat er misging. De provider voegde de opgeslagen doelen (Instellingen) één keer samen met de data,
// meteen bij het mounten, en startte loadClientSettings pas daarna, zonder erop te wachten. Bij een
// eerste bezoek (lege localStorage: een nieuw apparaat, een privévenster) las mergeKpiTargets dan de
// standaard, en kwamen de instellingen binnen zonder dat er nog iets samenvoegde. Het Google-tabblad
// toonde het routedoel (vorig jaar +10%) terwijl er in Instellingen 2.600 conversies en een CPA van
// € 45 stonden; pas na een herlaadbeurt klopte het. De blended hook wacht sinds stap 0 wel op de
// instellingen (lib/use-blended-client-data.ts), dus "Alle kanalen" gaf 2.600 en het Google-tabblad
// 1.938. Voor een klant met alleen Google was het geen race: het dashboard mount de provider pas als
// de data er is (client-dashboard.tsx), dus het verzoek om de instellingen vertrok altijd te laat.
//
// De provider draait echt (react-dom/client), op een nep-DOM, een nep-localStorage en een nep-fetch
// waarvan de test bepaalt welk antwoord eerst komt.

// Een module, geen script: zonder import of export deelt tsc de namen hieronder met elk ander testscript.
export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// loadClientSettings vraagt de database alleen als er een browser-Supabase is; die komt uit de
// omgeving. Zonder die variabelen las deze test nooit instellingen en zei hij niets.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-DOM: alleen wat createRoot nodig heeft voor een boom zonder DOM-knopen ─────────────
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
const doc = { ...knoop(9), activeElement: null, cookie: "", createElement: () => ({ ...knoop(1), ownerDocument: doc }) };
// Lege localStorage: het eerste bezoek. getClientSettings valt dan terug op de standaarddoelen.
const opslag = new Map<string, string>();
Object.assign(globalThis, {
  window: { document: doc, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, getSelection: () => null, HTMLIFrameElement: class {} },
  document: doc,
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
});

// ── Nep-fetch: elk verzoek wacht tot de test hem loslaat ─────────────────────────────────────
const maand = (m: number, c: number) => ({ month: m, conversions: c, revenue: 21000, adSpend: 11000, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 });
// De vorm van de Google-route: het routedoel is vorig jaar +10% (1.938 conversies, € 139.860 kosten).
const CLIENT_DATA = {
  customerId: "x", currentYear: 2026, realizedThroughMonth: 7, dataStand: null,
  targetCurrentYear: { conversions: 1938, revenue: 282062, adSpend: 139860 },
  historicalYears: [{ year: 2025, monthly: Array.from({ length: 12 }, (_, i) => maand(i + 1, 147)), weekly: [] }],
  currentYearMonthly: Array.from({ length: 7 }, (_, i) => maand(i + 1, 150)),
  currentYearWeekly: [],
};
// Opgeslagen in Instellingen (de vorm van demo-greentech): 2.600 conversies per jaar, CPA € 45.
const INSTELLINGEN = {
  kpi_targets: { conversionsMode: "absolute", conversionsAbsolute: 2600, revenueMode: "absolute", revenueAbsolute: 0, conversionsGrowthPct: 0, revenueGrowthPct: 0, cpaTarget: 45, roasTarget: 0 },
};
type Wachtend = { soort: "client-data" | "instellingen"; klant: string; los: (ok?: boolean) => void };
let wachtend: Wachtend[] = [];
globalThis.fetch = ((url: string) => {
  const u = String(url);
  if (u.startsWith("/api/data/client_settings")) {
    const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as { clientId?: string };
    return new Promise((klaar) => wachtend.push({
      soort: "instellingen", klant: vraag.clientId ?? "",
      los: (ok = true) => klaar({ ok, status: ok ? 200 : 500, json: async () => (ok ? { data: INSTELLINGEN } : { error: "kapot" }) } as Response),
    }));
  }
  const klant = `gads-${decodeURIComponent(u.split("customerId=")[1] ?? "")}`;
  return new Promise((klaar) => wachtend.push({
    soort: "client-data", klant,
    los: () => klaar({ ok: true, status: 200, json: async () => CLIENT_DATA } as Response),
  }));
}) as typeof fetch;

const rust = () => new Promise((r) => setTimeout(r, 20));
/** Laat de wachtende verzoeken van één soort los (en wat daaruit volgt), en wacht tot React klaar is. */
async function beantwoord(soort: Wachtend["soort"], ok = true): Promise<void> {
  await rust();
  const nu = wachtend.filter((w) => w.soort === soort);
  wachtend = wachtend.filter((w) => w.soort !== soort);
  for (const w of nu) w.los(ok);
  await rust();
}

interface Doel { conversions: number; revenue: number; adSpend: number }

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ClientDataProvider, useClientDataState, useForecast } = await import("./client-data-provider");
  const { useClientData } = await import("./use-client-data");

  // Wat het blad bij de laatste render zag. Het blad meldt het via een functie, zodat de render zelf
  // niets buiten zijn eigen bereik verandert.
  const gezien: { doel: Doel | null; prognose: { conv: number | null; spend: number | null } } = { doel: null, prognose: { conv: null, spend: null } };
  // ELK doel dat het blad ooit zag, in volgorde: een tussenstand met het routedoel is ook fout.
  let alleDoelen: (Doel | null)[] = [];
  const meld = (doel: Doel | null, prognose: { conv: number | null; spend: number | null }) => { gezien.doel = doel; gezien.prognose = prognose; alleDoelen.push(doel); };
  function Lezer({ melden }: { melden: typeof meld }) {
    const st = useClientDataState();
    const fc = useForecast();
    melden((st?.data?.targetCurrentYear as Doel | undefined) ?? null, { conv: fc?.conversions.kpi.annualTarget ?? null, spend: fc?.adSpend.kpi.annualTarget ?? null });
    return null;
  }
  const Blad = () => createElement(Lezer, { melden: meld });
  // Via een functie gelezen: na "gezien.doel = null" vernauwt tsc het veld anders tot null.
  const zag = (): Doel | null => gezien.doel;
  // Zoals client-dashboard.tsx: eerst de eigen useClientData, de provider pas als er data is.
  function Dashboard({ clientId }: { clientId: string }) {
    const clientData = useClientData(clientId);
    return clientData.data ? createElement(ClientDataProvider, { clientId, children: createElement(Blad) }) : null;
  }
  const mount = (el: ReturnType<typeof createElement>) => {
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(el);
    return root;
  };
  const verwacht = (d: Doel | null) => d?.conversions === 2600 && d?.adSpend === 2600 * 45;

  // Het routedoel (vorig jaar +10%): wat het blad NOOIT mag zien als er een doel is opgeslagen.
  const isRoutedoel = (d: Doel | null) => d?.conversions === 1938 || d?.adSpend === 139860;

  console.log("De volgorde van het dashboard: de provider mount als de data er al is");
  {
    gezien.doel = null;
    alleDoelen = [];
    const root = mount(createElement(Dashboard, { clientId: "gads-111" }));
    await beantwoord("client-data");
    // De samenvoeging na de instellingen maakte het eindgetal goed, maar de kinderen renderden al met
    // de eerste samenvoeging: de standaard, want de localStorage is leeg. Het Google-tabblad toonde
    // zo bij elk eerste bezoek 1.938 en € 139.860, en sprong daarna naar 2.600 en € 117.000.
    check("voorwaarde: het verzoek om de instellingen loopt", wachtend.some((w) => w.soort === "instellingen" && w.klant === "gads-111"));
    check("zolang de instellingen er niet zijn, rendert er niets met een doel", alleDoelen.every((d) => d === null), JSON.stringify(alleDoelen));
    await beantwoord("instellingen");
    check("na de instellingen: het doel uit Instellingen (2.600 conversies, 2.600 x € 45 kosten)", verwacht(zag()), JSON.stringify(zag()));
    check("en de prognose rekent tegen datzelfde doel", gezien.prognose.conv === 2600 && gezien.prognose.spend === 117000, JSON.stringify(gezien.prognose));
    check("het blad zag het routedoel nooit, ook niet even", !alleDoelen.some(isRoutedoel), JSON.stringify(alleDoelen));
    root.unmount();
  }

  console.log("Een volgend bezoek: de instellingen staan al in de cache, de kinderen wachten niet");
  {
    gezien.doel = null;
    alleDoelen = [];
    const root = mount(createElement(Dashboard, { clientId: "gads-111" }));
    await beantwoord("client-data");
    check("met instellingen in de cache: meteen het doel uit Instellingen", verwacht(zag()), JSON.stringify(alleDoelen));
    await beantwoord("instellingen");
    check("en nooit het routedoel", !alleDoelen.some(isRoutedoel), JSON.stringify(alleDoelen));
    root.unmount();
  }

  console.log("De provider los: de data eerst, de instellingen later");
  {
    gezien.doel = null;
    alleDoelen = [];
    const root = mount(createElement(ClientDataProvider, { clientId: "gads-222", children: createElement(Blad) }));
    await beantwoord("client-data");
    await beantwoord("instellingen");
    check("instellingen na de data: toch het doel uit Instellingen", verwacht(zag()), JSON.stringify(zag()));
    check("instellingen na de data: nooit het routedoel", !alleDoelen.some(isRoutedoel), JSON.stringify(alleDoelen));
    root.unmount();
  }

  console.log("De provider los: de instellingen eerst");
  {
    gezien.doel = null;
    const root = mount(createElement(ClientDataProvider, { clientId: "gads-333", children: createElement(Blad) }));
    await beantwoord("instellingen");
    await beantwoord("client-data");
    check("instellingen vóór de data: het doel uit Instellingen", verwacht(zag()), JSON.stringify(zag()));
    root.unmount();
  }

  console.log("Het lezen van de instellingen faalt");
  {
    gezien.doel = null;
    const root = mount(createElement(Dashboard, { clientId: "gads-444" }));
    await beantwoord("client-data");
    await beantwoord("instellingen", false);
    check("dan het routedoel, zonder fout", zag()?.conversions === 1938 && zag()?.adSpend === 139860, JSON.stringify(zag()));
    root.unmount();
  }

  console.log("Het lezen van de instellingen blijft hangen");
  {
    // De provider omvat elk tabblad, ook Instellingen. Zonder grens bleef een verzoek dat nooit
    // antwoordt het hele dashboard op "Data ophalen..." houden.
    const { INSTELLINGEN_WACHT_MS } = await import("./client-data-provider");
    gezien.doel = null;
    alleDoelen = [];
    const root = mount(createElement(Dashboard, { clientId: "gads-555" }));
    await beantwoord("client-data");
    check("voorwaarde: het verzoek om de instellingen hangt", wachtend.some((w) => w.soort === "instellingen" && w.klant === "gads-555"));
    check("eerst nog niets met een doel", alleDoelen.every((d) => d === null), JSON.stringify(alleDoelen));
    await new Promise((r) => setTimeout(r, INSTELLINGEN_WACHT_MS + 100));
    check("na de wachttijd rendert het dashboard toch, met het routedoel", zag()?.conversions === 1938, JSON.stringify(zag()));
    await beantwoord("instellingen");
    check("komt het antwoord later alsnog, dan het doel uit Instellingen", verwacht(zag()), JSON.stringify(zag()));
    root.unmount();
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

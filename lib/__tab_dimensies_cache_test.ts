// De eigen dimensies van een kanaaltab (wereldkaart, uitsplitsingen, video) kosten bij een tweede
// bezoek geen verzoek. Draaien: tsx --tsconfig ./tsconfig.json lib/__tab_dimensies_cache_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Een wissel van kanaaltab unmount de hele weergave. useGeoBreakdown, BreakdownDonuts en
// ChannelVideoPerformance haalden daarom bij elke mount opnieuw op, en de twee uitsplitsingskaarten
// op Meta (levering en doelgroep) deden elk dezelfde query. Gemeten: zes verzoeken bij elke wissel
// naar Meta, ook de tweede en de derde keer. Het meetscript was de enige die het telde.
//
// Nu lezen ze alle drie via lib/data-access/bron-cache.ts. Wat hier vastligt, met de ECHTE hook en
// de ECHTE componenten (react-dom/client op een nep-DOM, een nep-fetch die telt):
//
// - twee BreakdownDonuts naast elkaar doen ÉÉN lezing van meta_breakdown_daily, en beide tonen
//   hun eigen groep uit dezelfde rijen;
// - een tweede mount binnen de cachetijd doet geen verzoek en toont meteen de kaart;
// - useGeoBreakdown: één verzoek (land en staat samen, voor dit ene kanaal) bij de eerste mount,
//   nul bij de tweede, en de allereerste render heeft de landen al; een niveau dat op de server
//   mislukt neemt het andere niet mee en komt niet in de cache;
// - ChannelVideoPerformance: één lezing van de dagrijen en één van de namen, daarna geen;
// - een mislukte lezing toont niets en staat niet in de cache: de volgende mount probeert opnieuw;
// - na vergeetBronnen (wat de syncbadge aanroept) leest elk blok opnieuw.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// BreakdownDonuts toont niets zonder browser-Supabase (voor LinkedIn leest hij er de labeltabel
// mee); die komt uit de omgeving.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-DOM: wat createRoot nodig heeft; moet er staan VOORDAT react-dom geladen wordt ───────
//
// De knopen onthouden hun tekst: zo is te zien WAT een kaart toont, niet alleen dat hij iets
// ophaalde. `teksten` is alles wat sinds de laatste `wisTeksten()` als tekst is gezet.
const noop = () => {};
let teksten: string[] = [];
const wisTeksten = () => { teksten = []; };
const getoond = (deel: string) => teksten.some((t) => t.includes(deel));
function knoop(nodeType: number) {
  const k = {
    nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
    style: { setProperty: noop } as Record<string, unknown>, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
  };
  let tekst = "";
  for (const veld of ["textContent", "nodeValue"]) {
    Object.defineProperty(k, veld, { get: () => tekst, set: (v: unknown) => { tekst = String(v ?? ""); if (tekst) teksten.push(tekst); } });
  }
  return k;
}
const doc = {
  ...knoop(9), activeElement: null, cookie: "",
  createElement: () => ({ ...knoop(1), ownerDocument: doc }),
  createElementNS: () => ({ ...knoop(1), ownerDocument: doc }),
  createTextNode: (t: string) => { if (t) teksten.push(String(t)); return Object.assign(knoop(3), { ownerDocument: doc }); },
};
// De spread hierboven kopieert de getters als waarden; elementen krijgen daarom hun eigen knoop.
doc.createElement = () => Object.assign(knoop(1), { ownerDocument: doc });
doc.createElementNS = () => Object.assign(knoop(1), { ownerDocument: doc });
const opslag = new Map<string, string>();
const localStorage = { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } };
Object.assign(globalThis, {
  window: {
    document: doc, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, getSelection: () => null,
    HTMLIFrameElement: class {}, localStorage, sessionStorage: localStorage, location: { search: "", pathname: "/" },
  },
  document: doc,
  localStorage,
});

// ── Nep-fetch: telt per bron en per klant; de test bepaalt wanneer er geantwoord wordt ───────
type Vraag = { clientId?: string; select?: string; filters?: { column: string; value: string }[] };
const verzoeken: Record<string, number> = {};
const geteld = (sleutel: string) => verzoeken[sleutel] ?? 0;
let wachtend: { sleutel: string; los: () => void }[] = [];
/** Klanten waarvoor /api/geo de staten niet kon lezen (null voor dat ene niveau). */
const halfKapot = new Set<string>();
/** Bronnen die een fout teruggeven: "tabel:klant" of "geo:klant". */
const kapot = new Set<string>();

const BREAKDOWN = [
  // Levering: twee plaatsingen. Doelgroep: twee leeftijden. Eén tabel, beide groepen.
  { breakdown_type: "platform_position", breakdown_value: "feed", spend: 300, conversions: 6, impressions: 9000, link_clicks: 120 },
  { breakdown_type: "platform_position", breakdown_value: "reels", spend: 100, conversions: 1, impressions: 4000, link_clicks: 30 },
  { breakdown_type: "age", breakdown_value: "25-34", spend: 250, conversions: 5, impressions: 8000, link_clicks: 100 },
  { breakdown_type: "age", breakdown_value: "45-54", spend: 150, conversions: 2, impressions: 5000, link_clicks: 50 },
];
const VIDEO_DAGEN = [
  { entity_id: "c-1", impressions: 5000, spend: 80, video_thruplay: 400, hook_rate: 0.3, hold_rate: 0.1 },
  { entity_id: "c-1", impressions: 4000, spend: 70, video_thruplay: 300, hook_rate: 0.2, hold_rate: 0.1 },
];
const NAMEN = [{ campaign_id: "c-1", name: "Voorjaarsvideo" }];
const GEO: Record<string, unknown[]> = {
  country: [
    { code: "NL", impressions: 1000, clicks: 50, cost: 100, conversions: 5, conversionsValue: 500 },
    { code: "US", impressions: 800, clicks: 30, cost: 90, conversions: 2, conversionsValue: 200 },
  ],
  region: [{ code: "CA", impressions: 400, clicks: 15, cost: 45, conversions: 1, conversionsValue: 100 }],
};

// De land x kanaal-matrix (/api/geo/channels) en de maandrijen per campagne (ads_campaign_monthly).
const MATRIX = [
  { country: "NL", channel: "search", impressions: 1000, clicks: 50, cost: 100, conversions: 5, conversionsValue: 500 },
  { country: "DE", channel: "search", impressions: 800, clicks: 30, cost: 90, conversions: 2, conversionsValue: 200 },
];
const CAMPAGNEMAANDEN = [
  { month: "2026-10-01", campaign_type: "SEARCH", campaign_name: "Merk NL", cost: 300, conversions: 6, conversions_value: 600, impressions: 3000, clicks: 90 },
  { month: "2026-10-01", campaign_type: "PERFORMANCE_MAX", campaign_name: "Shopping breed", cost: 700, conversions: 14, conversions_value: 2100, impressions: 9000, clicks: 210 },
];

const json = (lichaam: unknown, status = 200) => new Response(JSON.stringify(lichaam), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = ((url: string) => {
  const u = String(url);
  let sleutel: string;
  let antwoord: () => Response;
  if (u.startsWith("/api/geo/channels")) {
    const klant = new URLSearchParams(u.split("?")[1] ?? "").get("clientId") ?? "";
    sleutel = `matrix:${klant}`;
    antwoord = () => (kapot.has(sleutel) ? json({ error: "kapot" }, 500) : json({ cells: MATRIX }));
  } else if (u.startsWith("/api/geo")) {
    const p = new URLSearchParams(u.split("?")[1] ?? "");
    const klant = p.get("clientId") ?? ""; const level = p.get("level") ?? "";
    sleutel = `geo:${p.get("channel")}:${level}:${klant}`;
    // level=beide: één antwoord met de landen en de staten van dit ene kanaal. Een niveau dat op
    // de server mislukte komt als null (`halfKapot`).
    antwoord = () => (kapot.has(`geo:${klant}`) ? json({ error: "kapot" }, 500)
      : level === "beide" ? json({ niveaus: { country: GEO.country, region: halfKapot.has(klant) ? null : GEO.region } })
        : json({ rows: GEO[level] ?? [] }));
  } else if (u.startsWith("/api/data/")) {
    const tabel = decodeURIComponent(u.slice("/api/data/".length).split("?")[0]);
    const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as Vraag;
    const klant = vraag.clientId ?? "";
    sleutel = `${tabel}:${klant}`;
    const rijen = tabel === "meta_breakdown_daily" ? BREAKDOWN : tabel === "meta_campaign_daily" ? VIDEO_DAGEN : tabel === "meta_campaigns" ? NAMEN
      : tabel === "ads_campaign_monthly" ? CAMPAGNEMAANDEN : [];
    antwoord = () => (kapot.has(sleutel) ? json({ error: "kapot" }, 500) : json({ data: rijen }));
    if (tabel === "meta_breakdown_daily" || tabel === "meta_campaign_daily") {
      check(`${tabel}: de lezing vraagt de laatste 60 dagen`, vraag.filters?.length === 1 && vraag.filters[0].column === "date", JSON.stringify(vraag.filters));
    }
  } else {
    // Alles daarbuiten (de browser-Supabase): geen rijen.
    sleutel = `anders:${u.split("?")[0]}`;
    antwoord = () => json([]);
  }
  verzoeken[sleutel] = (verzoeken[sleutel] ?? 0) + 1;
  return new Promise<Response>((klaar) => wachtend.push({ sleutel, los: () => klaar(antwoord()) }));
}) as typeof fetch;

// Wachten tot het STIL is, niet op de klok. Een vaste 20 ms was onder vier parallelle tests te kort
// voor render plus effect: de test faalde dan op "één verzoek onderweg" terwijl de code klopte.
// Stil = het aantal verzoeken en de wachtrij veranderen vijf tikken achter elkaar niet.
const tik = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stand = () => `${Object.values(verzoeken).reduce((a, b) => a + b, 0)}/${wachtend.length}`;
async function rust(): Promise<void> {
  let vorige = stand(), gelijk = 0;
  for (let i = 0; i < 200 && gelijk < 5; i++) {
    await tik(10);
    const nu = stand();
    if (nu === vorige) gelijk += 1; else { gelijk = 0; vorige = nu; }
  }
}
async function beantwoordAlles(): Promise<void> {
  for (let i = 0; i < 6 && wachtend.length > 0; i++) {
    const nu = wachtend; wachtend = [];
    for (const w of nu) w.los();
    await rust();
  }
  await rust();
}
const onderweg = (sleutel: string) => wachtend.filter((w) => w.sleutel === sleutel).length;

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { BreakdownDonuts } = await import("../components/dashboard/breakdown-donuts");
  const { ChannelVideoPerformance } = await import("../components/dashboard/channel-video-performance");
  const { useGeoBreakdown } = await import("./geo/use-geo-breakdown");
  const { vergeetBronnen } = await import("./data-access/bron-cache");

  const maakRoot = () => createRoot(doc.createElement() as unknown as Element);
  const ontkoppel = async (root: { unmount(): void }) => { root.unmount(); await rust(); };

  // ── BreakdownDonuts ────────────────────────────────────────────────────────────────────────
  const donuts = (clientId: string) => {
    const root = maakRoot();
    root.render(createElement("div", null,
      createElement(BreakdownDonuts, { key: "l", clientId, channel: "meta", groep: "levering" }),
      createElement(BreakdownDonuts, { key: "d", clientId, channel: "meta", groep: "doelgroep" })));
    return root;
  };

  console.log("Twee BreakdownDonuts naast elkaar: één lezing van meta_breakdown_daily");
  {
    wisTeksten();
    const root = donuts("klant-1");
    await rust();
    check("één verzoek onderweg voor twee kaarten", geteld("meta_breakdown_daily:klant-1") === 1 && onderweg("meta_breakdown_daily:klant-1") === 1,
      `${geteld("meta_breakdown_daily:klant-1")} verzoeken, ${onderweg("meta_breakdown_daily:klant-1")} onderweg`);
    check("zolang het loopt staat er geen uitsplitsing", !getoond("Reels") && !getoond("25-34"));
    await beantwoordAlles();
    check("na het antwoord nog steeds één verzoek", geteld("meta_breakdown_daily:klant-1") === 1, String(geteld("meta_breakdown_daily:klant-1")));
    check("de leveringskaart toont zijn plaatsingen", getoond("Waar gaat het budget heen") && getoond("Reels") && getoond("Plaatsing"), teksten.slice(-12).join(" | "));
    check("de doelgroepkaart toont zijn leeftijden, uit dezelfde rijen", getoond("Doelgroepen") && getoond("25-34") && getoond("Leeftijd"), teksten.slice(-12).join(" | "));
    await ontkoppel(root);

    console.log("Een tweede bezoek binnen de cachetijd: geen verzoek, de kaart staat er meteen");
    wisTeksten();
    const terug = donuts("klant-1");
    await rust();
    check("geen nieuw verzoek", geteld("meta_breakdown_daily:klant-1") === 1 && wachtend.length === 0, `${geteld("meta_breakdown_daily:klant-1")} verzoeken, ${wachtend.length} onderweg`);
    check("beide kaarten staan er zonder dat er iets beantwoord is", getoond("Reels") && getoond("25-34"), teksten.slice(-12).join(" | "));
    await ontkoppel(terug);

    console.log("Een andere klant: een eigen lezing");
    const ander = donuts("klant-2");
    await rust();
    check("één verzoek voor de andere klant, geen extra voor de eerste", geteld("meta_breakdown_daily:klant-2") === 1 && geteld("meta_breakdown_daily:klant-1") === 1);
    await beantwoordAlles();
    await ontkoppel(ander);

    console.log("Na vergeetBronnen (de sync): opnieuw lezen");
    vergeetBronnen("klant-1|");
    const naSync = donuts("klant-1");
    await rust();
    check("klant-1 leest opnieuw, één keer voor beide kaarten", geteld("meta_breakdown_daily:klant-1") === 2 && onderweg("meta_breakdown_daily:klant-1") === 1, String(geteld("meta_breakdown_daily:klant-1")));
    await beantwoordAlles();
    await ontkoppel(naSync);
    const klant2 = donuts("klant-2");
    await rust();
    check("klant-2 is niet vergeten", geteld("meta_breakdown_daily:klant-2") === 1 && wachtend.length === 0, String(geteld("meta_breakdown_daily:klant-2")));
    await ontkoppel(klant2);

    console.log("Een mislukte lezing staat niet in de cache");
    kapot.add("meta_breakdown_daily:klant-fout");
    wisTeksten();
    const fout = donuts("klant-fout");
    await rust();
    await beantwoordAlles();
    check("de kaarten tonen dan niets (zoals voorheen)", !getoond("Reels") && !getoond("25-34"), teksten.join(" | "));
    await ontkoppel(fout);
    kapot.delete("meta_breakdown_daily:klant-fout");
    wisTeksten();
    const hersteld = donuts("klant-fout");
    await rust();
    check("de volgende mount probeert het opnieuw", geteld("meta_breakdown_daily:klant-fout") === 2, String(geteld("meta_breakdown_daily:klant-fout")));
    await beantwoordAlles();
    check("en toont dan de uitsplitsing", getoond("Reels") && getoond("25-34"));
    await ontkoppel(hersteld);
  }

  // ── useGeoBreakdown ────────────────────────────────────────────────────────────────────────
  type GeoStaat = ReturnType<typeof useGeoBreakdown>;
  const geo: Record<string, GeoStaat[]> = {};
  type GeoKanaal = NonNullable<Parameters<typeof useGeoBreakdown>[0]["channel"]>;
  function GeoLezer({ naam, clientId, enabled, kanaal = "meta" }: { naam: string; clientId: string; enabled?: boolean; kanaal?: GeoKanaal }) {
    (geo[naam] ??= []).push(useGeoBreakdown({ clientId, channel: kanaal, enabled }));
    return null;
  }
  const geoMount = (...lezers: { naam: string; clientId: string; enabled?: boolean; kanaal?: GeoKanaal }[]) => {
    const root = maakRoot();
    root.render(createElement("div", null, ...lezers.map((l) => createElement(GeoLezer, { key: l.naam, ...l }))));
    return root;
  };
  const laatste = (naam: string) => geo[naam][geo[naam].length - 1];
  // Elk verzoek naar /api/geo voor deze klant, welk kanaal of niveau ook: zo telt een terugval op
  // de oude losse verzoeken (land en staat apart) gewoon mee.
  const geoVerzoeken = (klant: string) => Object.keys(verzoeken).filter((k) => k.startsWith("geo:") && k.endsWith(`:${klant}`)).reduce((s, k) => s + verzoeken[k], 0);

  console.log("useGeoBreakdown: eerste mount één verzoek voor land en staat samen");
  {
    const root = geoMount({ naam: "kaart", clientId: "klant-1" }, { naam: "lijst", clientId: "klant-1" });
    await rust();
    // Hier stonden er twee (land en staat elk een eigen verzoek), bij elke eerste wissel van kanaal.
    check("twee lezers, samen één verzoek met beide niveaus", geteld("geo:meta:beide:klant-1") === 1 && geoVerzoeken("klant-1") === 1,
      `${geteld("geo:meta:beide:klant-1")} gebundeld, ${geoVerzoeken("klant-1")} in totaal`);
    check("beide laden", laatste("kaart").laden && laatste("lijst").laden);
    await beantwoordAlles();
    check("beide hebben de landen en de staten", laatste("kaart").countries.length === 2 && laatste("lijst").states.length === 1 && !laatste("kaart").laden && !laatste("lijst").laden);
    check("de VS-verdieping werkt op de gecachte rijen", laatste("kaart").canDrillUs === true);
    await ontkoppel(root);

    console.log("useGeoBreakdown: een tweede mount binnen de cachetijd doet geen verzoek");
    const terug = geoMount({ naam: "terug", clientId: "klant-1" });
    await rust();
    check("geen verzoek", geoVerzoeken("klant-1") === 1 && wachtend.length === 0, `${geoVerzoeken("klant-1")} verzoeken, ${wachtend.length} onderweg`);
    check("de ALLEREERSTE render heeft de landen al, zonder laadstaat", geo.terug[0].laden === false && geo.terug[0].countries.length === 2 && geo.terug[0].states.length === 1,
      JSON.stringify({ laden: geo.terug[0].laden, landen: geo.terug[0].countries.length }));
    await ontkoppel(terug);

    console.log("useGeoBreakdown: uit = geen verzoek; een ander kanaal of een andere klant leest zelf");
    const uit = geoMount({ naam: "uit", clientId: "klant-3", enabled: false });
    await rust();
    check("enabled = false doet geen verzoek", geoVerzoeken("klant-3") === 0 && wachtend.length === 0);
    await ontkoppel(uit);
    const ander = geoMount({ naam: "ander", clientId: "klant-2" });
    await rust();
    check("een andere klant: een eigen verzoek, en eerst een laadstaat", geoVerzoeken("klant-2") === 1 && geo.ander[0].laden === true && geo.ander[0].countries.length === 0);
    await beantwoordAlles();
    await ontkoppel(ander);

    console.log("useGeoBreakdown: na de cachetijd, en na vergeetBronnen, opnieuw");
    const echteNow = Date.now;
    try {
      Date.now = () => echteNow() + 5 * 60 * 1000 + 1;
      const laat = geoMount({ naam: "laat", clientId: "klant-1" });
      await rust();
      check("na vijf minuten: opnieuw een verzoek", geoVerzoeken("klant-1") === 2, String(geoVerzoeken("klant-1")));
      await beantwoordAlles();
      await ontkoppel(laat);
    } finally {
      Date.now = echteNow;
    }
    // Het antwoord van zojuist is op de verschoven klok bewaard; vergeten maakt de proef zuiver.
    vergeetBronnen("klant-1|");
    const naSync = geoMount({ naam: "naSync", clientId: "klant-1" });
    await rust();
    check("na vergeetBronnen: opnieuw een verzoek", geoVerzoeken("klant-1") === 3, String(geoVerzoeken("klant-1")));
    await beantwoordAlles();
    await ontkoppel(naSync);

    console.log("useGeoBreakdown: een storing is een lege kaart, niet vijf minuten lang");
    kapot.add("geo:klant-fout");
    const fout = geoMount({ naam: "fout", clientId: "klant-fout" });
    await rust();
    await beantwoordAlles();
    check("lege kaart, niet meer ladend", laatste("fout").countries.length === 0 && laatste("fout").laden === false);
    await ontkoppel(fout);
    kapot.delete("geo:klant-fout");
    const hersteld = geoMount({ naam: "hersteld", clientId: "klant-fout" });
    await rust();
    check("de volgende mount vraagt opnieuw", geoVerzoeken("klant-fout") === 2, String(geoVerzoeken("klant-fout")));
    await beantwoordAlles();
    check("en krijgt de landen", laatste("hersteld").countries.length === 2);
    await ontkoppel(hersteld);
  }

  // ── Elk kanaal leest alleen zichzelf; een half antwoord toont wat er is en blijft uit de cache ──
  console.log("useGeoBreakdown: Alle kanalen leest alleen zichzelf, en een niveau dat mislukt neemt het andere niet mee");
  {
    const alle = geoMount({ naam: "alle", clientId: "klant-alle", kanaal: "blended" });
    await rust();
    check("Alle kanalen: één verzoek, voor blended alleen (niet alle kanalen in één antwoord)",
      geteld("geo:blended:beide:klant-alle") === 1 && geoVerzoeken("klant-alle") === 1, String(geoVerzoeken("klant-alle")));
    await beantwoordAlles();
    check("Alle kanalen heeft zijn landen en staten", laatste("alle").countries.length === 2 && laatste("alle").states.length === 1 && !laatste("alle").laden);
    await ontkoppel(alle);
    const meta = geoMount({ naam: "na-alle-meta", clientId: "klant-alle", kanaal: "meta" });
    await rust();
    check("een kanaal daarna leest zelf: één eigen verzoek", geteld("geo:meta:beide:klant-alle") === 1 && geoVerzoeken("klant-alle") === 2, String(geoVerzoeken("klant-alle")));
    await beantwoordAlles();
    await ontkoppel(meta);

    // De staten mislukken op de server (null), de landen niet: voorheen twee losse verzoeken die
    // los van elkaar faalden. De kaart toont de landen, en de volgende mount probeert het opnieuw.
    halfKapot.add("klant-half");
    const half = geoMount({ naam: "half", clientId: "klant-half" });
    await rust();
    await beantwoordAlles();
    check("de landen staan er, de staten zijn leeg, en er wordt niet meer geladen",
      laatste("half").countries.length === 2 && laatste("half").states.length === 0 && laatste("half").laden === false,
      JSON.stringify({ landen: laatste("half").countries.length, staten: laatste("half").states.length }));
    check("zonder staten geen VS-verdieping", laatste("half").canDrillUs === false);
    await ontkoppel(half);
    halfKapot.delete("klant-half");
    const heel = geoMount({ naam: "heel", clientId: "klant-half" });
    await rust();
    check("het halve antwoord staat niet in de cache: de volgende mount vraagt opnieuw", geoVerzoeken("klant-half") === 2 && geo.heel[0].laden === true, String(geoVerzoeken("klant-half")));
    await beantwoordAlles();
    check("en krijgt nu ook de staten", laatste("heel").states.length === 1 && laatste("heel").canDrillUs === true);
    await ontkoppel(heel);
  }

  // ── ChannelVideoPerformance ────────────────────────────────────────────────────────────────
  const video = (clientId: string) => {
    const root = maakRoot();
    root.render(createElement(ChannelVideoPerformance, { clientId, channel: "meta" }));
    return root;
  };

  console.log("ChannelVideoPerformance: de dagrijen en de namen één keer per (klant, kanaal)");
  {
    wisTeksten();
    const root = video("klant-1");
    await rust();
    check("één lezing van de dagrijen en één van de namen", geteld("meta_campaign_daily:klant-1") === 1 && geteld("meta_campaigns:klant-1") === 1,
      `${geteld("meta_campaign_daily:klant-1")} dagrijen, ${geteld("meta_campaigns:klant-1")} namen`);
    await beantwoordAlles();
    check("de kaart toont de campagne bij naam", getoond("Voorjaarsvideo"), teksten.slice(-10).join(" | "));
    await ontkoppel(root);

    wisTeksten();
    const terug = video("klant-1");
    await rust();
    check("tweede bezoek: geen verzoek", geteld("meta_campaign_daily:klant-1") === 1 && geteld("meta_campaigns:klant-1") === 1 && wachtend.length === 0);
    check("en de kaart staat er meteen", getoond("Voorjaarsvideo"), teksten.slice(-10).join(" | "));
    await ontkoppel(terug);

    console.log("ChannelVideoPerformance: zonder namen de campagne-id's, en de namen opnieuw proberen");
    kapot.add("meta_campaigns:klant-namen");
    wisTeksten();
    const zonder = video("klant-namen");
    await rust();
    await beantwoordAlles();
    check("de kaart staat er, met de id in plaats van de naam", getoond("c-1") && !getoond("Voorjaarsvideo"), teksten.slice(-10).join(" | "));
    await ontkoppel(zonder);
    kapot.delete("meta_campaigns:klant-namen");
    wisTeksten();
    const metNamen = video("klant-namen");
    await rust();
    check("de volgende mount leest alleen de namen opnieuw (de dagrijen stonden er al)",
      geteld("meta_campaigns:klant-namen") === 2 && geteld("meta_campaign_daily:klant-namen") === 1,
      `${geteld("meta_campaigns:klant-namen")} namen, ${geteld("meta_campaign_daily:klant-namen")} dagrijen`);
    await beantwoordAlles();
    check("en toont dan de naam", getoond("Voorjaarsvideo"));
    await ontkoppel(metNamen);

    console.log("ChannelVideoPerformance: na vergeetBronnen opnieuw");
    vergeetBronnen("klant-1|");
    const naSync = video("klant-1");
    await rust();
    check("beide lezingen opnieuw", geteld("meta_campaign_daily:klant-1") === 2 && geteld("meta_campaigns:klant-1") === 2);
    await beantwoordAlles();
    await ontkoppel(naSync);
  }

  // ── GeoChannelMatrix en CampaignTypeSplit: de twee blokken van het Google-tabblad zonder cache ─
  // Allebei lazen bij ELKE mount opnieuw (een kale fetch, state per mount): elk bezoek aan het
  // Google-tabblad kostte twee verzoeken, ook direct terug vanaf een ander kanaal. En de ring las
  // bij een wissel tussen Campagnetype en Campagne nog een keer exact dezelfde query.
  const { GeoChannelMatrix } = await import("../components/dashboard/geo-channel-matrix");
  const { CampaignTypeSplit } = await import("../components/dashboard/campaign-type-split");
  const matrix = (clientId: string) => { const root = maakRoot(); root.render(createElement(GeoChannelMatrix, { clientId })); return root; };
  const ring = (clientId: string, toon: ("type" | "campagne")[]) => {
    const root = maakRoot();
    root.render(createElement(CampaignTypeSplit, { clientId, toon }));
    return root;
  };

  console.log("GeoChannelMatrix: één lezing per klant, een tweede bezoek doet geen verzoek");
  {
    const eerste = matrix("klant-1");
    await rust();
    check("het eerste bezoek: één verzoek", geteld("matrix:klant-1") === 1 && onderweg("matrix:klant-1") === 1, String(geteld("matrix:klant-1")));
    await beantwoordAlles();
    await ontkoppel(eerste);
    wisTeksten();
    const terug = matrix("klant-1");
    await rust();
    check("het tweede bezoek: geen verzoek", geteld("matrix:klant-1") === 1 && wachtend.length === 0, `${geteld("matrix:klant-1")} verzoeken, ${wachtend.length} onderweg`);
    check("en geen laadtekst: de matrix staat er meteen", !getoond("laden") && !getoond("Laden"), teksten.slice(0, 8).join(" | "));
    await ontkoppel(terug);
    vergeetBronnen("klant-1|");
    const naSync = matrix("klant-1");
    await rust();
    check("na vergeetBronnen (de sync): opnieuw lezen", geteld("matrix:klant-1") === 2, String(geteld("matrix:klant-1")));
    await beantwoordAlles();
    await ontkoppel(naSync);

    kapot.add("matrix:klant-fout");
    const fout = matrix("klant-fout");
    await rust();
    await beantwoordAlles();
    await ontkoppel(fout);
    kapot.delete("matrix:klant-fout");
    const hersteld = matrix("klant-fout");
    await rust();
    check("een storing staat niet in de cache: de volgende mount leest opnieuw", geteld("matrix:klant-fout") === 2, String(geteld("matrix:klant-fout")));
    await beantwoordAlles();
    await ontkoppel(hersteld);
  }

  console.log("CampaignTypeSplit: één lezing per klant, ook voor Campagnetype en Campagne samen");
  {
    const S = "ads_campaign_monthly:klant-1";
    wisTeksten();
    const perType = ring("klant-1", ["type"]);
    await rust();
    check("het eerste bezoek: één verzoek", geteld(S) === 1 && onderweg(S) === 1, String(geteld(S)));
    await beantwoordAlles();
    check("de ring toont de campagnetypes", getoond("Performance Max") || getoond("PERFORMANCE_MAX") || getoond("Search") || getoond("Zoeken"), teksten.slice(-14).join(" | "));
    const totaalType = teksten.filter((t) => t.includes("€")).join(" | ");
    await ontkoppel(perType);

    // Dezelfde rijen, nu per campagne (het andere tabblad van de kaart): geen nieuwe lezing.
    wisTeksten();
    const perCampagne = ring("klant-1", ["campagne"]);
    await rust();
    check("per campagne, na per type: geen verzoek", geteld(S) === 1 && wachtend.length === 0, `${geteld(S)} verzoeken, ${wachtend.length} onderweg`);
    check("de ring toont de campagnes bij naam, uit dezelfde rijen", getoond("Merk NL") && getoond("Shopping breed"), teksten.slice(-14).join(" | "));
    await ontkoppel(perCampagne);

    wisTeksten();
    const terug = ring("klant-1", ["type"]);
    await rust();
    check("een tweede bezoek: geen verzoek, en dezelfde bedragen", geteld(S) === 1 && teksten.filter((t) => t.includes("€")).join(" | ") === totaalType,
      `${geteld(S)} | ${teksten.filter((t) => t.includes("€")).join(" | ")} tegen ${totaalType}`);
    await ontkoppel(terug);

    vergeetBronnen("klant-1|");
    const naSync = ring("klant-1", ["type"]);
    await rust();
    check("na vergeetBronnen (de sync): opnieuw lezen", geteld(S) === 2, String(geteld(S)));
    await beantwoordAlles();
    await ontkoppel(naSync);

    kapot.add("ads_campaign_monthly:klant-fout");
    const fout = ring("klant-fout", ["type"]);
    await rust();
    await beantwoordAlles();
    await ontkoppel(fout);
    kapot.delete("ads_campaign_monthly:klant-fout");
    wisTeksten();
    const hersteld = ring("klant-fout", ["type"]);
    await rust();
    check("een mislukte lezing staat niet in de cache", geteld("ads_campaign_monthly:klant-fout") === 2, String(geteld("ads_campaign_monthly:klant-fout")));
    await beantwoordAlles();
    await ontkoppel(hersteld);
  }

  // ── De bedrading: de sync vergeet de dimensies, en niemand houdt een eigen cache bij ────────
  console.log("De bedrading");
  {
    const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bron = (pad: string) => zonderCommentaar(readFileSync(join(import.meta.dirname, "..", pad), "utf8"));
    const badge = bron("components/dashboard/sync-status-badge.tsx");
    check("de syncbadge vergeet de dimensies van de klant, vóór hij de pagina laat herladen",
      /vergeetBronnen\(`\$\{clientId\}\|`\);\s*onSyncComplete\?\.\(\);/.test(badge));
    // De tweede (en laatste) plek waar de browser een sync start: de backfill bij de koppelingen.
    // Zonder dit toonden de blokken na een backfill nog tot vijf minuten de rijen van ervoor.
    const koppelingen = bron("components/settings/kanaal-koppelingen-sectie.tsx");
    check("de backfill bij de koppelingen vergeet de dimensies van de klant ook",
      /Backfill klaar[\s\S]{0,120}vergeetBronnen\(`\$\{clientId\}\|`\);\s*onGewijzigd\(\);/.test(koppelingen));
    for (const pad of ["lib/geo/use-geo-breakdown.ts", "components/dashboard/breakdown-donuts.tsx", "components/dashboard/channel-video-performance.tsx",
      "components/dashboard/geo-channel-matrix.tsx", "components/dashboard/campaign-type-split.tsx"]) {
      const tekst = bron(pad);
      check(`${pad} leest via maakBronCache, zonder eigen Map`, /maakBronCache</.test(tekst) && !/new Map<string, \{[^}]*timestamp/.test(tekst));
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

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
// - useGeoBreakdown: twee verzoeken (land en staat) bij de eerste mount, nul bij de tweede, en de
//   allereerste render heeft de landen al;
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

const json = (lichaam: unknown, status = 200) => new Response(JSON.stringify(lichaam), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = ((url: string) => {
  const u = String(url);
  let sleutel: string;
  let antwoord: () => Response;
  if (u.startsWith("/api/geo")) {
    const p = new URLSearchParams(u.split("?")[1] ?? "");
    const klant = p.get("clientId") ?? ""; const level = p.get("level") ?? "";
    sleutel = `geo:${p.get("channel")}:${level}:${klant}`;
    antwoord = () => (kapot.has(`geo:${klant}`) ? json({ error: "kapot" }, 500) : json({ rows: GEO[level] ?? [] }));
  } else if (u.startsWith("/api/data/")) {
    const tabel = decodeURIComponent(u.slice("/api/data/".length).split("?")[0]);
    const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as Vraag;
    const klant = vraag.clientId ?? "";
    sleutel = `${tabel}:${klant}`;
    const rijen = tabel === "meta_breakdown_daily" ? BREAKDOWN : tabel === "meta_campaign_daily" ? VIDEO_DAGEN : tabel === "meta_campaigns" ? NAMEN : [];
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
  function GeoLezer({ naam, clientId, enabled }: { naam: string; clientId: string; enabled?: boolean }) {
    (geo[naam] ??= []).push(useGeoBreakdown({ clientId, channel: "meta", enabled }));
    return null;
  }
  const geoMount = (...lezers: { naam: string; clientId: string; enabled?: boolean }[]) => {
    const root = maakRoot();
    root.render(createElement("div", null, ...lezers.map((l) => createElement(GeoLezer, { key: l.naam, ...l }))));
    return root;
  };
  const laatste = (naam: string) => geo[naam][geo[naam].length - 1];
  const geoVerzoeken = (klant: string) => geteld(`geo:meta:country:${klant}`) + geteld(`geo:meta:region:${klant}`);

  console.log("useGeoBreakdown: eerste mount twee verzoeken (land en staat)");
  {
    const root = geoMount({ naam: "kaart", clientId: "klant-1" }, { naam: "lijst", clientId: "klant-1" });
    await rust();
    check("twee lezers, één verzoek per niveau", geteld("geo:meta:country:klant-1") === 1 && geteld("geo:meta:region:klant-1") === 1,
      `${geteld("geo:meta:country:klant-1")} land, ${geteld("geo:meta:region:klant-1")} staat`);
    check("beide laden", laatste("kaart").laden && laatste("lijst").laden);
    await beantwoordAlles();
    check("beide hebben de landen en de staten", laatste("kaart").countries.length === 2 && laatste("lijst").states.length === 1 && !laatste("kaart").laden && !laatste("lijst").laden);
    check("de VS-verdieping werkt op de gecachte rijen", laatste("kaart").canDrillUs === true);
    await ontkoppel(root);

    console.log("useGeoBreakdown: een tweede mount binnen de cachetijd doet geen verzoek");
    const terug = geoMount({ naam: "terug", clientId: "klant-1" });
    await rust();
    check("geen verzoek", geoVerzoeken("klant-1") === 2 && wachtend.length === 0, `${geoVerzoeken("klant-1")} verzoeken, ${wachtend.length} onderweg`);
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
    check("een andere klant: eigen verzoeken, en eerst een laadstaat", geoVerzoeken("klant-2") === 2 && geo.ander[0].laden === true && geo.ander[0].countries.length === 0);
    await beantwoordAlles();
    await ontkoppel(ander);

    console.log("useGeoBreakdown: na de cachetijd, en na vergeetBronnen, opnieuw");
    const echteNow = Date.now;
    try {
      Date.now = () => echteNow() + 5 * 60 * 1000 + 1;
      const laat = geoMount({ naam: "laat", clientId: "klant-1" });
      await rust();
      check("na vijf minuten: opnieuw twee verzoeken", geoVerzoeken("klant-1") === 4, String(geoVerzoeken("klant-1")));
      await beantwoordAlles();
      await ontkoppel(laat);
    } finally {
      Date.now = echteNow;
    }
    // Het antwoord van zojuist is op de verschoven klok bewaard; vergeten maakt de proef zuiver.
    vergeetBronnen("klant-1|");
    const naSync = geoMount({ naam: "naSync", clientId: "klant-1" });
    await rust();
    check("na vergeetBronnen: opnieuw twee verzoeken", geoVerzoeken("klant-1") === 6, String(geoVerzoeken("klant-1")));
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
    check("de volgende mount vraagt opnieuw", geoVerzoeken("klant-fout") === 4, String(geoVerzoeken("klant-fout")));
    await beantwoordAlles();
    check("en krijgt de landen", laatste("hersteld").countries.length === 2);
    await ontkoppel(hersteld);
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

  // ── De bedrading: de sync vergeet de dimensies, en niemand houdt een eigen cache bij ────────
  console.log("De bedrading");
  {
    const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bron = (pad: string) => zonderCommentaar(readFileSync(join(import.meta.dirname, "..", pad), "utf8"));
    const badge = bron("components/dashboard/sync-status-badge.tsx");
    check("de syncbadge vergeet de dimensies van de klant, vóór hij de pagina laat herladen",
      /vergeetBronnen\(`\$\{clientId\}\|`\);\s*onSyncComplete\?\.\(\);/.test(badge));
    for (const pad of ["lib/geo/use-geo-breakdown.ts", "components/dashboard/breakdown-donuts.tsx", "components/dashboard/channel-video-performance.tsx"]) {
      const tekst = bron(pad);
      check(`${pad} leest via maakBronCache, zonder eigen Map`, /maakBronCache</.test(tekst) && !/new Map<string, \{[^}]*timestamp/.test(tekst));
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

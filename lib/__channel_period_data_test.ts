// Test voor de KPI-band: de data van Meta, LinkedIn en Microsoft (lib/use-channel-period-data.ts) en
// wat de band ervan maakt (components/dashboard/period-summary.tsx).
//
// Waarom hij er is.
//
// 1. Hoe vaak de dagtabellen worden opgehaald, en dat er nooit een getal met de verkeerde
//    conversieselectie in beeld komt. De drie fetches hingen aan [clientId, convConfig], en
//    convConfig werd vervangen zodra client_settings binnen was -- door een NIEUW object, ook als er
//    niets was opgeslagen. Elke tabel werd daardoor twee keer opgehaald: 7 verzoeken per
//    paginabezoek waar 4 volstaan. En wie een eigen selectie had opgeslagen, zag eerst even het
//    getal van de standaardselectie.
// 2. Het venster: "nu min 730 dagen" knipte de eerste vergelijkingsmaand af, en die telde mee
//    alsof hij compleet was. Nu vanaf de eerste van de maand, 24 maanden terug.
// 3. De vergelijking per kanaal: bij "Alle kanalen" telde een kanaal dat vorig jaar nog niet liep
//    als groei (de demo: +89% kosten), zonder één woord uitleg.
//
// De hook wordt echt gemount met react-dom/client, op een nep-DOM die net genoeg is voor een
// component dat null rendert. Een pure test van de rekenfuncties had (1) niet gezien: de fout zat
// in de effect-afhankelijkheden, niet in de som. De band zelf wordt met react-dom/server
// gerenderd, binnen de echte PeriodProvider.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientHistoricalData } from "./types";
import type { ChannelPeriodData } from "./use-channel-period-data";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Nep-DOM: alleen wat createRoot nodig heeft voor een boom zonder DOM-knopen ─────────────
// Moet er staan VOORDAT react-dom geladen wordt; die kijkt bij het laden of er een DOM is.
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
const doc = { ...knoop(9), activeElement: null, createElement: () => ({ ...knoop(1), ownerDocument: doc }) };
// Een echte EventTarget als window: de band luistert naar het opslaan van de kanaalselectie.
const venster = new EventTarget();
Object.assign(venster, { document: doc, getSelection: () => null, HTMLIFrameElement: class {} });
Object.assign(globalThis, { window: venster, document: doc });

// ── Nep-fetch: telt per tabel, onthoudt de vraag, en de test bepaalt wanneer wat antwoordt ──
interface Vraag { select: string; filters?: { op: string; column: string; value?: unknown }[]; order?: { column: string; ascending?: boolean }; limit?: number }
const verzoeken: Record<string, number> = {};
const vragen: Record<string, Vraag> = {};
const alleVragen: Record<string, Vraag[]> = {};
let wachtend: { tabel: string; los: () => void }[] = [];
let opgeslagen: unknown = null;
// Tabellen die met een HTTP 500 antwoorden (een netwerkfout, time-out of serverfout).
const faalt = new Set<string>();
// Per tabel het verzoek (1 = de eerste pagina) dat met een HTTP 500 antwoordt.
const faaltVerzoek = new Map<string, number>();
const RIJEN: Record<string, Record<string, unknown>[]> = {
  // Twee dagen; de laatste dag is wat de band als eind van de data neemt.
  meta_account_daily: [
    { date: "2026-08-01", impressions: 1000, link_clicks: 40, spend: 100, conversions: 10, leads: 5, conversion_value: 500 },
    { date: "2026-08-26", impressions: 100, link_clicks: 4, spend: 10, conversions: 0, leads: 0, conversion_value: 0 },
  ],
  // Standaardselectie: one_click_leads + external_website_conversions = 27. Alleen lead-formulieren: 20.
  linkedin_account_daily: [{ date: "2026-08-01", impressions: 500, clicks: 20, spend: 200, one_click_leads: 20, external_website_conversions: 7, post_click_conversions: 3, conversion_value: 0 }],
  microsoft_account_daily: [{ date: "2026-07-31", impressions: 300, clicks: 10, spend: 50, conversions: 4, conversion_value: 80 }],
};
// Zoals de route: gte/lte op datum, sorteren, en hooguit `limit` rijen -- het plafond van 1000
// rijen per antwoord zit in PostgREST zelf, dus een vraag zonder limit krijgt er ook niet meer.
const PLAFOND = 1000;
function alsDeRoute(rijen: Record<string, unknown>[], v: Vraag): Record<string, unknown>[] {
  let uit = rijen.filter((r) => (v.filters ?? []).every((f) =>
    f.op === "gte" ? String(r[f.column]) >= String(f.value) : f.op === "lte" ? String(r[f.column]) <= String(f.value) : true));
  if (v.order) {
    const k = v.order.column, op = v.order.ascending === false ? -1 : 1;
    uit = [...uit].sort((a, b) => (String(a[k]) < String(b[k]) ? -op : String(a[k]) > String(b[k]) ? op : 0));
  }
  return uit.slice(0, Math.min(v.limit ?? PLAFOND, PLAFOND));
}
globalThis.fetch = ((url: string) => {
  const [pad, zoek] = String(url).split("?");
  const tabel = decodeURIComponent(pad.split("/api/data/")[1]);
  verzoeken[tabel] = (verzoeken[tabel] ?? 0) + 1;
  const dezeFaalt = faalt.has(tabel) || faaltVerzoek.get(tabel) === verzoeken[tabel];
  const vraag = JSON.parse(decodeURIComponent(zoek.slice("q=".length))) as Vraag;
  vragen[tabel] ??= vraag;
  (alleVragen[tabel] ??= []).push(vraag);
  return new Promise((klaar) => wachtend.push({
    tabel,
    los: () => klaar(dezeFaalt ? ({ ok: false, status: 500, json: async () => ({ error: "boom" }) } as Response) : {
      ok: true, status: 200,
      json: async () => ({ data: tabel === "client_settings" ? { channel_conversion_config: opgeslagen } : alsDeRoute(RIJEN[tabel] ?? [], vraag) }),
    } as Response),
  }));
}) as typeof fetch;

const rust = () => new Promise((r) => setTimeout(r, 20));
async function beantwoord(welke: (tabel: string) => boolean): Promise<void> {
  const nu = wachtend.filter((w) => welke(w.tabel));
  wachtend = wachtend.filter((w) => !welke(w.tabel));
  for (const w of nu) w.los();
  await rust();
}
// Eerst wachten tot er iets te beantwoorden is (hooguit een seconde). Met alleen de vaste rust van
// 20 ms had de hook onder load (meerdere testbestanden tegelijk) zijn verzoeken soms nog niet gedaan,
// en dan beantwoordde dit niets en faalde het eerste scenario helemaal.
async function beantwoordAlles(): Promise<void> {
  const eind = Date.now() + 1000;
  while (wachtend.length === 0 && Date.now() < eind) await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 10 && wachtend.length > 0; i++) await beantwoord(() => true);
}

function conversies(d: ClientHistoricalData | null): number | null {
  if (!d) return null;
  let s = 0;
  for (const m of d.currentYearData) if (m) s += m.conversions;
  for (const jaar of Object.values(d.historicalYears)) for (const m of jaar) s += m.conversions;
  return s;
}

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { useChannelPeriodData } = await import("./use-channel-period-data");
  const { monthsAgo } = await import("./reporting-date");
  const { addMonths, lastCompleteMonth, monthsIn, formatMonth, formatRange, resolveComparison, resolvePeriod } = await import("./period/period-range");
  const { bouwHistorischeData, samenvoegen } = await import("./period/kanaal-maanden");
  const { alsBronReeks } = await import("./period/apply-period");
  const { PeriodProvider } = await import("./period/period-context");
  const { PeriodSummary } = await import("../components/dashboard/period-summary");

  const google: ClientHistoricalData = { clientId: "t", targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 }, historicalYears: {}, currentYearData: Array(12).fill(null), currentYear: 2026 };

  type Kanaal = "linkedin" | "blended" | "google";
  let gezien: (number | null)[] = [];
  let laatst: ChannelPeriodData | null = null;
  function Kpi({ channel, clientId = "t" }: { channel: Kanaal; clientId?: string }) {
    const r = useChannelPeriodData({ clientId, channel, googleData: google });
    laatst = r;
    const v = conversies(r.data);
    if (gezien.at(-1) !== v) gezien.push(v);
    return null;
  }
  const mount = (channel: Kanaal) => {
    for (const k of Object.keys(verzoeken)) delete verzoeken[k];
    for (const k of Object.keys(vragen)) delete vragen[k];
    for (const k of Object.keys(alleVragen)) delete alleVragen[k];
    wachtend = []; gezien = []; laatst = null;
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(Kpi, { channel }));
    return root;
  };
  const nu = (): ChannelPeriodData => laatst!;

  // 1. Niets opgeslagen -- de situatie van elke klant vandaag. Eén verzoek per tabel.
  {
    opgeslagen = null;
    const root = mount("blended");
    await rust();
    await beantwoordAlles();
    assert(verzoeken.client_settings === 1, `client_settings één keer (was ${verzoeken.client_settings})`);
    for (const t of ["meta_account_daily", "linkedin_account_daily", "microsoft_account_daily"]) {
      assert(verzoeken[t] === 1, `${t} één keer opgehaald, niet opnieuw na client_settings (was ${verzoeken[t]})`);
    }
    assert(gezien.at(-1) === 15 + 27 + 4, `blended telt Meta + LinkedIn + Microsoft op (kreeg ${gezien.at(-1)})`);
    // Bij "Alle kanalen" gaan de losse kanalen mee, zodat de vergelijking per kanaal kan paren.
    assert(JSON.stringify(nu().bronnen?.map((b) => b.naam)) === JSON.stringify(["google", "meta", "linkedin", "microsoft"]),
      `bronnen zijn de vier kanalen (kreeg ${JSON.stringify(nu().bronnen?.map((b) => b.naam))})`);
    assert(nu().laatsteDag.meta === "2026-08-26" && nu().laatsteDag.linkedin === "2026-08-01" && nu().laatsteDag.microsoft === "2026-07-31",
      `laatsteDag is per kanaal de nieuwste rij (kreeg ${JSON.stringify(nu().laatsteDag)})`);

    // Het venster: vanaf de eerste van de maand, 36 maanden terug, in Amsterdam (monthsAgo). Eerst
    // 24: te kort voor "Vorig jaar" tegen het jaar daarvoor (tot januari van twee jaar terug) en
    // voor de laatste twaalf maanden zodra de data achterloopt. De band noemde de laadgrens dan
    // "de data begint in november 2024" bij een kanaal dat al sinds 2023 liep (review [5], [41]).
    const sinds = monthsAgo(36);
    for (const t of ["meta_account_daily", "linkedin_account_daily", "microsoft_account_daily"]) {
      const f = vragen[t]?.filters?.find((x) => x.column === "date" && x.op === "gte");
      assert(f?.value === sinds && sinds.endsWith("-01"), `${t} vanaf ${sinds} (kreeg ${JSON.stringify(f?.value)})`);
      // Nieuwste eerst, en per pagina van 1000: dat is het plafond van /api/data.
      assert(vragen[t]?.order?.column === "date" && vragen[t]?.order?.ascending === false, `${t} nieuwste eerst`);
      assert(vragen[t]?.limit === 1000, `${t} vraagt een pagina van 1000 (kreeg ${vragen[t]?.limit})`);
    }
    assert(nu().geladenVanaf?.meta === sinds.slice(0, 7), `de laadgrens komt mee (kreeg ${JSON.stringify(nu().geladenVanaf)})`);
    const bronMeta = nu().bronnen?.find((b) => b.naam === "meta");
    assert(bronMeta?.vanaf === "2026-08" && bronMeta?.geladenVanaf === sinds.slice(0, 7),
      `de Meta-bron draagt zijn eerste volle maand en de laadgrens (kreeg ${JSON.stringify([bronMeta?.vanaf, bronMeta?.geladenVanaf])})`);
    assert(nu().bronnen?.find((b) => b.naam === "microsoft")?.vanaf === "2026-08",
      "Microsoft begint op 31 juli: zijn eerste volle maand is augustus");
    // Google heeft ook een laadgrens: de route haalt vanaf 1 januari, HISTORIE_JAREN jaar terug. Zonder
    // die grens "begon" een account dat al sinds 2015 loopt in januari 2021, en zei de band "Google Ads
    // (sinds januari 2021) ... liep het nog niet" over een jaar dat niet geladen was.
    const { HISTORIE_JAREN } = await import("./api/google-vergelijking");
    const googleGrens = `${google.currentYear - HISTORIE_JAREN}-01`;
    assert(nu().bronnen?.find((b) => b.naam === "google")?.geladenVanaf === googleGrens,
      `de Google-bron draagt de laadgrens van de route, ${googleGrens} (kreeg ${JSON.stringify(nu().bronnen?.find((b) => b.naam === "google")?.geladenVanaf)})`);
    // Dezelfde select-lijst als elke andere lezer van de dagtabel (dagbronSelect): alle
    // selecteerbare conversievelden, plus de vaste tellers.
    const metaSelect = vragen.meta_account_daily?.select ?? "";
    assert(["impressions", "link_clicks", "conversions", "leads"].every((v) => metaSelect.includes(v)), `Meta leest via dagbronSelect (kreeg "${metaSelect}")`);
    assert((vragen.linkedin_account_daily?.select ?? "").includes("post_click_conversions"), "LinkedIn leest ook het niet-standaard conversieveld");
    root.unmount();
  }

  // 2. Een eigen selectie opgeslagen, en de dagrijen zijn eerder binnen dan client_settings.
  //    Dan mag er geen moment zijn waarop de KPI-rij het getal van de standaardselectie toont.
  {
    opgeslagen = { linkedin_ads: ["one_click_leads"] };
    const root = mount("linkedin");
    await rust();
    await beantwoord((t) => t !== "client_settings");
    assert(gezien.every((v) => v === null), `nog geen getal zolang de selectie onbekend is (zag ${JSON.stringify(gezien)})`);
    await beantwoordAlles();
    assert(gezien.at(-1) === 20, `LinkedIn telt de opgeslagen selectie: 20 lead-formulieren (kreeg ${gezien.at(-1)})`);
    assert(!gezien.includes(27), `de standaardselectie (27) is nooit in beeld geweest (zag ${JSON.stringify(gezien)})`);
    assert(verzoeken.linkedin_account_daily === 1, `ook met een opgeslagen selectie één verzoek (was ${verzoeken.linkedin_account_daily})`);
    // Hier stond "op een kanaaltab geen bronnen". Dan bouwde comparePeriods zelf een bron zonder
    // eerste volle maand, en paarde de negen dagen juli 2025 van Microsoft tegen een volle juli
    // 2026: "+244%" op de Microsoft-tab (review [0]). Nu één bron, met die grens erbij.
    const b = nu().bronnen;
    assert(b?.length === 1 && b[0].naam === "totaal" && b[0].vanaf === "2026-08" && b[0].geladenVanaf === monthsAgo(36).slice(0, 7),
      `op een kanaaltab één bron met vanaf en laadgrens (kreeg ${JSON.stringify(b?.map((x) => [x.naam, x.vanaf, x.geladenVanaf]))})`);
    root.unmount();
  }

  // 2a. De Google-tab: één bron met de laadgrens van de route, net als de andere kanaaltabs. Eerst
  //     null, en dan bouwde comparePeriods zelf een bron zonder grens: "de data begint in januari
  //     2021" en "nieuw in deze periode" bij een account dat al jaren liep, over 2020, dat de route
  //     niet ophaalt.
  {
    opgeslagen = null;
    const root = mount("google");
    await rust();
    await beantwoordAlles();
    const { HISTORIE_JAREN } = await import("./api/google-vergelijking");
    const b = nu().bronnen;
    assert(nu().data === google, "de Google-tab toont de Google-data");
    assert(b?.length === 1 && b[0].naam === "totaal" && b[0].geladenVanaf === `${google.currentYear - HISTORIE_JAREN}-01`,
      `op de Google-tab één bron met de laadgrens van de route (kreeg ${JSON.stringify(b?.map((x) => [x.naam, x.vanaf, x.geladenVanaf]))})`);
    root.unmount();
  }

  // 2b. Na het opslaan van de selectie in Instellingen (de band blijft gemount): opnieuw lezen.
  //     Eerst hield de band de oude selectie vast tot een herlaadbeurt, terwijl het Jaaroverzicht
  //     eronder de nieuwe toonde (review [4], [22], [40]).
  {
    opgeslagen = null;
    const root = mount("linkedin");
    await rust();
    await beantwoordAlles();
    assert(gezien.at(-1) === 27, `voor opslaan: de standaardselectie, 27 (kreeg ${gezien.at(-1)})`);
    opgeslagen = { linkedin_ads: ["one_click_leads"] };
    const mod = (await import("./use-channel-period-data")) as { meldKanaalselectieOpgeslagen?: (clientId: string) => void };
    if (typeof mod.meldKanaalselectieOpgeslagen !== "function") assert(false, "meldKanaalselectieOpgeslagen bestaat");
    else {
      mod.meldKanaalselectieOpgeslagen("andere-klant");
      await rust();
      assert(verzoeken.client_settings === 1, `een andere klant: niets opnieuw (was ${verzoeken.client_settings})`);
      mod.meldKanaalselectieOpgeslagen("t");
    }
    await rust();
    await beantwoordAlles();
    assert(verzoeken.client_settings === 2, `na opslaan leest de band de selectie opnieuw (was ${verzoeken.client_settings})`);
    assert(gezien.at(-1) === 20, `en toont de nieuwe selectie: 20 lead-formulieren (kreeg ${gezien.at(-1)})`);
    assert(!gezien.slice(1).includes(null), `zonder tussendoor leeg te vallen (zag ${JSON.stringify(gezien)})`);
    root.unmount();
  }

  // 2c. Meer rijen dan het plafond van /api/data (1000 per antwoord). Eerst één verzoek zonder
  //     paginering: twee Meta-accounts over twee jaar zijn ~1460 rijen, er kwamen er 1000, en de
  //     afgeknipte oudste maand paarde als volle maand (+13,3% op vlakke data, review [1]).
  {
    const eerder = RIJEN.meta_account_daily;
    const vlak: Record<string, unknown>[] = [];
    // Twee accounts, elke dag sinds de laadgrens tot en met 2026-08-26: ruim boven de 1000 rijen.
    for (let d = new Date(`${monthsAgo(36)}T00:00:00Z`); d <= new Date("2026-08-26T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const dag = d.toISOString().slice(0, 10);
      for (const entity_id of ["a1", "a2"]) vlak.push({ date: dag, entity_id, impressions: 10, link_clicks: 1, spend: 1, conversions: 1, leads: 0, conversion_value: 0 });
    }
    RIJEN.meta_account_daily = vlak;
    opgeslagen = null;
    const root = mount("blended");
    await rust();
    await beantwoordAlles();
    const metaVragen = alleVragen.meta_account_daily ?? [];
    assert(metaVragen.length >= 2, `meer dan één pagina (kreeg ${metaVragen.length})`);
    const tweede = metaVragen[1]?.filters?.find((f) => f.op === "lte");
    assert(typeof tweede?.value === "string", `de volgende pagina loopt t/m de oudste dag van de vorige (kreeg ${JSON.stringify(metaVragen[1]?.filters)})`);
    // Elke rij precies één keer: twee per dag, ook op de dag op de paginagrens. De optelling van
    // "Alle kanalen", met 1 kosten per Meta-rij plus LinkedIn (200) en Microsoft (50) uit RIJEN.
    const samen = nu().data;
    const kosten = (samen?.currentYearData ?? []).reduce((s, m) => s + (m?.adSpend ?? 0), 0)
      + Object.values(samen?.historicalYears ?? {}).flat().reduce((s, m) => s + (m?.adSpend ?? 0), 0);
    assert(Math.round(kosten) - 250 === vlak.length, `alle ${vlak.length} Meta-rijen precies één keer (kreeg ${Math.round(kosten) - 250})`);
    assert(nu().bronnen?.find((b) => b.naam === "meta")?.vanaf === monthsAgo(36).slice(0, 7),
      "de eerste geladen maand is volledig, dus geen valse start");
    RIJEN.meta_account_daily = eerder;
    root.unmount();
  }

  // 3. Klantwissel: de cijfers van de vorige klant blijven niet staan tot de nieuwe binnen zijn.
  {
    opgeslagen = null;
    const root = mount("linkedin");
    await rust();
    await beantwoordAlles();
    assert(gezien.at(-1) === 27, `klant t: LinkedIn 27 (kreeg ${gezien.at(-1)})`);
    root.render(createElement(Kpi, { channel: "linkedin", clientId: "u" }));
    await rust();
    assert(gezien.at(-1) === null, `na de wissel geen getal van de vorige klant (zag ${JSON.stringify(gezien)})`);
    await beantwoordAlles();
    assert(gezien.at(-1) === 27, `klant u: LinkedIn 27 zodra zijn rijen binnen zijn (kreeg ${gezien.at(-1)})`);
    root.unmount();
  }

  // ── 4. De band zelf ──────────────────────────────────────────────────────────────────────
  //
  // Data die stopt drie maanden vóór de kalender, met daarin een kanaal dat pas na de
  // vergelijkingsperiode begon (Meta), een dat erbinnen begon (Microsoft) en een dat nooit liep
  // (LinkedIn). Relatief aan vandaag gebouwd, zodat de test over een jaar nog hetzelfde zegt.
  const kalender = lastCompleteMonth();
  const M = addMonths(kalender, -3);
  const maanden = (vanaf: string, tot: string, w: number) =>
    monthsIn({ start: vanaf, end: tot }).map((k) => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), conversions: w, revenue: w * 10, adSpend: w * 5 }));
  const g = bouwHistorischeData("t", maanden(addMonths(M, -35), M, 10));
  const meta = bouwHistorischeData("t", maanden(addMonths(M, -5), M, 4));
  const microsoft = bouwHistorischeData("t", maanden(addMonths(M, -15), M, 2));
  const linkedin = bouwHistorischeData("t", []);
  const blend = samenvoegen("t", [g, meta, linkedin, microsoft]);
  const bronnen = [alsBronReeks("google", g), alsBronReeks("meta", meta), alsBronReeks("linkedin", linkedin), alsBronReeks("microsoft", microsoft)];
  const partieel = addMonths(M, 1);
  const stand = { laatsteVolleMaand: M, partieel: { maand: partieel, tmDag: 26, dagenInMaand: 31 }, dataTot: `${partieel}-26` };
  const band = (props: Record<string, unknown>, dataStand: typeof stand | null) =>
    renderToStaticMarkup(createElement(PeriodProvider, { scope: "t", dataStand, children: createElement(PeriodSummary, props as never) }));
  const vergelijking = resolveComparison(resolvePeriod("last_12m", null, addMonths(M, 1)), "same_period_last_year")!;

  {
    const html = band({ data: blend, bronnen }, stand);
    // Gepaard: Google 12 tegen 12, Microsoft alleen de 4 paren vanaf zijn start; Meta valt erbuiten.
    // Conversies dan 128 tegen 128. Ongepaard (zoals voorheen) was het 168 tegen 128: +31,3%.
    assert(!html.includes("+31,3%"), "de band rekent de kanalen die vorig jaar nog niet liepen niet als groei");
    assert(html.includes("0,0%"), "gepaard is de verandering 0%");
    const notitie = /<p class="([^"]*)">([^<]*staat wel in de totalen[^<]*)<\/p>/.exec(html);
    assert(notitie !== null, "een regel zegt welk kanaal niet in het percentage zit");
    assert(!!notitie && !notitie[1].includes("amber"), `die regel is neutraal, niet amber (class "${notitie?.[1]}")`);
    const tekst = notitie?.[2] ?? "";
    assert(tekst.includes(`Meta (sinds ${formatMonth(addMonths(M, -5))}) staat wel in de totalen, maar niet in het percentage`), `Meta genoemd met zijn start (kreeg "${tekst}")`);
    assert(tekst.includes(`in ${formatRange(vergelijking)} liep het nog niet`), `met de vergelijkingsperiode erbij (kreeg "${tekst}")`);
    assert(tekst.includes(`Microsoft Ads (sinds ${formatMonth(addMonths(M, -15))}) telt in het percentage alleen mee`), `Microsoft als deels gepaard (kreeg "${tekst}")`);
    // Hier stond "alleen mee over de maanden met data in beide perioden". Dat klopt niet zodra een
    // kanaal na zijn start pauzeert: die maanden tellen als nul, en horen dat ook (review [6]).
    // Daarna "alleen mee vanaf de eigen eerste volle maand, in beide perioden", en dat was ook
    // onwaar: een paar telt pas als ook de VERGELIJKINGSmaand na de start ligt, dus van de twaalf
    // maanden hier tellen er vier. Microsoft begon op M-15; M-11 t/m M-4 liggen daarna en tellen
    // toch niet. Op de demo draaide het teken om (Google -6,9%, de zin beschreef +4,0%).
    const ms4 = `${formatRange({ start: addMonths(M, -3), end: M })} tegen ${formatRange({ start: addMonths(M, -15), end: addMonths(M, -12) })}`;
    assert(tekst.includes(`telt in het percentage alleen mee over ${ms4}; een maand zonder data daarin telt als nul.`),
      `de deels-zin noemt de maanden die echt vergeleken worden (kreeg "${tekst}")`);
    assert(!tekst.includes("vanaf de eigen eerste volle maand"), `niet meer "vanaf de eigen eerste volle maand" (kreeg "${tekst}")`);
    assert(!tekst.includes("maanden met data in beide perioden"), `niet meer "maanden met data in beide perioden" (kreeg "${tekst}")`);
    assert(!tekst.includes("LinkedIn") && !tekst.includes("Google"), `kanalen die gewoon meetellen of nooit liepen staan er niet in (kreeg "${tekst}")`);
    const standRegel = `Data t/m 26 ${formatMonth(partieel)}; de periode loopt t/m ${formatMonth(M)}.`;
    assert(html.includes(standRegel), `de datastandregel staat er: "${standRegel}"`);
    const standP = new RegExp(`<p class="([^"]*)">${standRegel.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}</p>`).exec(html);
    assert(!!standP && !standP[1].includes("amber"), "de datastandregel is neutraal");
  }

  {
    // Eén kanaal dat pas na de vergelijkingsperiode begon: er valt niets te paren. Dan is het
    // "nieuw in deze periode", niet "geen vergelijking mogelijk" -- het grote getal staat er wel.
    const html = band({ data: meta }, stand);
    assert((html.match(/nieuw in deze periode/g) ?? []).length === 3, `drie keer "nieuw in deze periode" (kreeg ${(html.match(/nieuw in deze periode/g) ?? []).length})`);
    assert(!html.includes("geen vergelijking mogelijk"), "niet \"geen vergelijking mogelijk\"");
    assert(html.includes(`In ${formatRange(vergelijking)} is er nog geen data om tegen af te zetten; de data begint in ${formatMonth(addMonths(M, -5))}.`),
      "bij één bron een regel zonder kanaalnaam");
    // Met een laadgrens ruim vóór de vergelijkingsperiode: die is geladen en leeg, dus echt nieuw.
    const geladenLeeg = band({ data: meta, bronnen: [alsBronReeks("totaal", meta, null, addMonths(M, -35))] }, stand);
    assert((geladenLeeg.match(/nieuw in deze periode/g) ?? []).length === 3, `geladen en leeg: drie keer "nieuw" (kreeg ${(geladenLeeg.match(/nieuw in deze periode/g) ?? []).length})`);
  }

  {
    // "nieuw in deze periode" las het GEPAARDE vorige totaal, en dat is ook nul als er niets te
    // paren viel terwijl het kanaal er wel was. De demo-Microsoft-tab: negen dagen juli 2025 in de
    // vergelijkingsperiode (€ 297 kosten), en toch drie keer "nieuw", met eronder "de data begint
    // halverwege juli 2025". Zelfde val op de laadgrens: een vergelijkingsperiode die niet geladen
    // is, is niet leeg maar onbekend.
    const tel = (h: string, t: string) => (h.match(new RegExp(t, "g")) ?? []).length;
    const deelsMaand = bouwHistorischeData("t", maanden(addMonths(M, -12), M, 2));
    const ms = band({ data: deelsMaand, bronnen: [alsBronReeks("totaal", deelsMaand, addMonths(M, -11), addMonths(M, -35))] }, stand);
    assert(tel(ms, "nieuw in deze periode") === 0, `data in de vergelijkingsperiode: niet "nieuw" (kreeg ${tel(ms, "nieuw in deze periode")})`);
    assert(tel(ms, "geen vergelijking mogelijk") === 3, `maar "geen vergelijking mogelijk" (kreeg ${tel(ms, "geen vergelijking mogelijk")})`);
    assert(ms.includes(`In ${formatRange(vergelijking)} is er nog geen volle maand om tegen af te zetten; de data begint halverwege ${formatMonth(addMonths(M, -12))}.`),
      `de regel eronder legt het uit (kreeg "${/In [^<]*af te zetten[^<]*/.exec(ms)?.[0]}")`);

    const vanafGrens = bouwHistorischeData("t", maanden(addMonths(M, -11), M, 4));
    const grens = band({ data: vanafGrens, bronnen: [alsBronReeks("totaal", vanafGrens, null, addMonths(M, -11))] }, stand);
    assert(tel(grens, "nieuw in deze periode") === 0, `vergelijkingsperiode niet geladen: niet "nieuw" (kreeg ${tel(grens, "nieuw in deze periode")})`);
    assert(grens.includes(`In ${formatRange(vergelijking)} is geen data geladen; de band laadt vanaf ${formatMonth(addMonths(M, -11))}.`),
      `de regel eronder zegt dat hij niet geladen is (kreeg "${/In [^<]*geladen[^<]*/.exec(grens)?.[0]}")`);
  }

  {
    // Eén bron die vóór de vergelijkingsperiode-eind begon: het percentage telt vanaf zijn start,
    // en een maand zonder data daarna als nul. De oude zin ("alleen maanden met data in beide
    // perioden") was onwaar zodra er een pauze in zat (review [6]).
    const start = formatMonth(addMonths(M, -15));
    const html = band({ data: microsoft }, stand);
    // Hier stond "Het percentage telt alleen maanden vanaf <start> in beide perioden", terwijl
    // alleen de laatste vier maanden meetelden: een paar telt pas als ook de vergelijkingsmaand na
    // de start ligt. Nu de maanden zelf.
    const vier = `${formatRange({ start: addMonths(M, -3), end: M })} met ${formatRange({ start: addMonths(M, -15), end: addMonths(M, -12) })}`;
    assert(html.includes(`Het percentage vergelijkt ${vier}; de data begint in ${start}. Een maand zonder data daarin telt als nul.`),
      `één bron: de vergeleken maanden, de reden, en nul daarin (kreeg "${/Het percentage[^<]*/.exec(html)?.[0]}")`);
    assert(!html.includes("in beide perioden"), `niet meer "vanaf ... in beide perioden" (kreeg "${/Het percentage[^<]*/.exec(html)?.[0]}")`);

    // De start valt op de laadgrens: dan is dat niet het begin van de data (review [5], [41]).
    const geladen = band({ data: microsoft, bronnen: [alsBronReeks("totaal", microsoft, null, addMonths(M, -15))] }, stand);
    assert(geladen.includes(`Het percentage vergelijkt ${vier}; de band laadt vanaf ${start}.`) && !geladen.includes("de data begint in"),
      `op de laadgrens: "de band laadt vanaf", niet "de data begint in" (kreeg "${/Het percentage[^<]*/.exec(geladen)?.[0]}")`);
    const blendGeladen = band({ data: blend, bronnen: [bronnen[0], bronnen[1], bronnen[2], alsBronReeks("microsoft", microsoft, null, addMonths(M, -15))] }, stand);
    assert(blendGeladen.includes(`Microsoft Ads (geladen vanaf ${start})`) && !blendGeladen.includes(`Microsoft Ads (sinds ${start})`),
      `alle kanalen: "geladen vanaf", niet "sinds" (kreeg "${/[^>]*staat wel in de totalen[^<]*/.exec(blendGeladen)?.[0]}")`);

    // Een partiële eerste maand (Microsoft vanaf de 23e): de eerste volle maand erbij noemen.
    const volle = formatMonth(addMonths(M, -14));
    const partieelBlend = band({ data: blend, bronnen: [bronnen[0], bronnen[1], bronnen[2], alsBronReeks("microsoft", microsoft, addMonths(M, -14))] }, stand);
    assert(partieelBlend.includes(`Microsoft Ads (sinds ${start}, volledig vanaf ${volle})`),
      `partiële eerste maand genoemd (kreeg "${/[^>]*staat wel in de totalen[^<]*/.exec(partieelBlend)?.[0]}")`);
    const partieelTab = band({ data: microsoft, bronnen: [alsBronReeks("totaal", microsoft, addMonths(M, -14))] }, stand);
    const drie = `${formatRange({ start: addMonths(M, -2), end: M })} met ${formatRange({ start: addMonths(M, -14), end: addMonths(M, -12) })}`;
    assert(partieelTab.includes(`Het percentage vergelijkt ${drie}; de data begint halverwege ${start}.`) && !partieelTab.includes(volle + " in beide"),
      `op de tab: vanaf de eerste volle maand, met waarom (kreeg "${/Het percentage[^<]*/.exec(partieelTab)?.[0]}")`);
  }

  {
    // Maanden zonder rij NA de start zijn gemeten nullen: de totalen en het percentage tellen ze als
    // nul, en de zin erboven zegt dat. De amberregel eronder zei toch "geen data geladen ... die
    // tellen hierboven niet mee", direct onder "telt als nul" (review [6]). Twee vormen: een bron die
    // twee maanden pauzeerde, en een die halverwege de periode stopte terwijl de stand doorloopt (de
    // LinkedIn-tab met een gezonde sync, review [3]).
    const sleutel = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, "0")}`;
    const p1 = addMonths(M, -7), p2 = addMonths(M, -6);
    const pauze = bouwHistorischeData("t", maanden(addMonths(M, -17), M, 10).filter((m) => sleutel(m) !== p1 && sleutel(m) !== p2));
    const html = band({ data: pauze }, stand);
    const tekst = (h: string) => h.replace(/<[^>]+>/g, " | ");
    // "daarin" en niet meer "daarna": de zin noemt nu de vergeleken maanden zelf (zie hierboven).
    assert(/een maand zonder data daarin telt als nul/i.test(html), `de zin over het percentage staat er (kreeg "${tekst(html)}")`);
    assert(!html.includes("tellen hierboven niet mee") && !html.includes("geen data geladen"),
      `pauze na de start: niet "geen data geladen ... tellen hierboven niet mee" (kreeg "${tekst(html)}")`);
    const zin = `Voor 2 maanden is er geen data (${formatMonth(p1, true)} t/m ${formatMonth(p2, true)}); na de start van de data zijn dat maanden zonder activiteit, en die tellen hierboven als nul.`;
    assert(html.includes(zin), `de pauze heet een gemeten nul: "${zin}" (kreeg "${tekst(html)}")`);
    const pauzeP = /<p class="([^"]*)">Voor 2 maanden is er geen data/.exec(html);
    assert(!!pauzeP && !pauzeP[1].includes("amber"), `die regel is uitleg, niet amber (class "${pauzeP?.[1]}")`);

    const gestopt = bouwHistorischeData("t", maanden(addMonths(M, -35), addMonths(M, -7), 10));
    const stop = band({ data: gestopt }, stand);
    assert(!stop.includes("tellen hierboven niet mee") && !stop.includes("geen data geladen"),
      `gestopt binnen de stand: niet "geen data geladen" (kreeg "${tekst(stop)}")`);
    assert(stop.includes(`Voor 7 maanden is er geen data (${formatMonth(addMonths(M, -6), true)} t/m ${formatMonth(M, true)}); na de start van de data zijn dat maanden zonder activiteit`),
      `gestopt: de zeven maanden daarna zijn gemeten nullen (kreeg "${tekst(stop)}")`);

    // Vóór de start ZONDER bekende laadgrens blijft het "niet geladen": dan weet de band niet of die
    // maanden er niet waren of niet zijn opgehaald (Meta begon pas in de periode).
    const kort = (k: string) => formatMonth(k, true);
    const voor = band({ data: meta }, stand);
    assert(voor.includes(`Voor 6 maanden is geen data geladen (${kort(addMonths(M, -11))} t/m ${kort(addMonths(M, -6))}); die tellen hierboven niet mee.`),
      `vóór de start zonder laadgrens: de amberregel zoals hij was (kreeg "${tekst(voor)}")`);
    assert(!voor.includes("maanden zonder activiteit"), "vóór de start geen gemeten nul");

    // MET een laadgrens daarvóór zijn die maanden wel geladen, en is er alleen nog geen data. De
    // demo-Meta-tab zei "Voor 7 maanden is geen data geladen (aug 2025 t/m feb 2026); die tellen
    // hierboven niet mee", direct onder "de data begint halverwege maart 2026", terwijl de band
    // vanaf november 2023 laadt.
    const geladenVoor = band({ data: meta, bronnen: [alsBronReeks("totaal", meta, null, addMonths(M, -35))] }, stand);
    const voorZin = `Voor 6 maanden is er geen data (${kort(addMonths(M, -11))} t/m ${kort(addMonths(M, -6))}): de data begint pas in ${formatMonth(addMonths(M, -5))}.`;
    assert(geladenVoor.includes(voorZin) && !geladenVoor.includes("geen data geladen"), `geladen vóór de start: "${voorZin}" (kreeg "${tekst(geladenVoor)}")`);
    const voorP = /<p class="([^"]*)">Voor 6 maanden is er geen data/.exec(geladenVoor);
    assert(!!voorP && !voorP[1].includes("amber"), `die regel is uitleg, niet amber (class "${voorP?.[1]}")`);
    const metaEen = bouwHistorischeData("t", maanden(addMonths(M, -10), M, 4));
    const een = band({ data: metaEen, bronnen: [alsBronReeks("totaal", metaEen, null, addMonths(M, -35))] }, stand);
    assert(een.includes(`Voor ${formatMonth(addMonths(M, -11))} is er geen data: de data begint pas in ${formatMonth(addMonths(M, -10))}.`) && !een.includes("geen data geladen"),
      `één maand vóór de start (kreeg "${tekst(een)}")`);

    // Valt de laadgrens midden in die maanden, dan is alleen het stuk ervóór "niet geladen".
    const deels = band({ data: meta, bronnen: [alsBronReeks("totaal", meta, null, addMonths(M, -8))] }, stand);
    assert(deels.includes(`Voor 3 maanden is geen data geladen (${kort(addMonths(M, -11))} t/m ${kort(addMonths(M, -9))}); die tellen hierboven niet mee.`)
      && deels.includes(`Voor 3 maanden is er geen data (${kort(addMonths(M, -8))} t/m ${kort(addMonths(M, -6))}): de data begint pas in ${formatMonth(addMonths(M, -5))}.`),
      `laadgrens in de periode: gesplitst (kreeg "${tekst(deels)}")`);

    // Bij een optelling telt de LAATSTE laadgrens: daarvóór is niet elk kanaal geladen, en weet de
    // band dus niet of de maand leeg was. Een bron zonder laadgrens maakt het onbekend.
    const leegKanaal = bouwHistorischeData("t", []);
    const som = samenvoegen("t", [meta, leegKanaal]);
    const somBand = band({ data: som, bronnen: [alsBronReeks("meta", meta, null, addMonths(M, -35)), alsBronReeks("linkedin", leegKanaal, null, addMonths(M, -8))] }, stand);
    assert(somBand.includes(`Voor 3 maanden is geen data geladen (${kort(addMonths(M, -11))} t/m ${kort(addMonths(M, -9))})`)
      && somBand.includes(`Voor 3 maanden is er geen data (${kort(addMonths(M, -8))} t/m ${kort(addMonths(M, -6))})`),
      `alle kanalen: de laatste laadgrens (kreeg "${tekst(somBand)}")`);
    const somOnbekend = band({ data: som, bronnen: [alsBronReeks("meta", meta, null, addMonths(M, -35)), alsBronReeks("linkedin", leegKanaal)] }, stand);
    assert(somOnbekend.includes(`Voor 6 maanden is geen data geladen (${kort(addMonths(M, -11))} t/m ${kort(addMonths(M, -6))})`) && !somOnbekend.includes("is er geen data ("),
      `alle kanalen, een bron zonder laadgrens: niet geladen (kreeg "${tekst(somOnbekend)}")`);
  }

  {
    // Zonder datastand (het portfolio) en bij een stand die gewoon de kalender volgt: geen regel.
    // Een gedeeltelijke LOPENDE maand is normaal (elke live klant, elke dag) en geen bericht waard.
    const zonder = band({ data: g }, null);
    assert(!zonder.includes("Data t/m"), "zonder datastand geen datastandregel");
    const lopend = addMonths(kalender, 1);
    const live = band({ data: g }, { laatsteVolleMaand: kalender, partieel: { maand: lopend, tmDag: 13, dagenInMaand: 30 }, dataTot: `${lopend}-13` });
    assert(!live.includes("Data t/m"), "een gedeeltelijke lopende maand geeft geen datastandregel");
    assert(!live.includes("niet in het percentage") && !live.includes("beide perioden"), "volledige historie: geen paarregel");
  }

  // ── 4b. De eerste pagina van een dagtabel faalt ─────────────────────────────────────────
  //
  // dbSelect geeft dan { data: [], error }. De controle op een fout sloeg de eerste pagina over (er
  // was nog geen `tot`), en dan las nul rijen als "minder dan een pagina": alles geladen, vanaf de
  // laadgrens van 36 maanden terug. De band zei daarop "er is nog geen enkele maand met data",
  // neutraal, direct onder "Data t/m 25 augustus", bij een Meta met 167 rijen in de database. Het
  // amberkleurige "geen data geladen" van vóór die laadgrens-regel was waar.
  {
    opgeslagen = null;
    faalt.add("linkedin_account_daily");
    const root = mount("linkedin");
    await rust();
    await beantwoordAlles();
    const grens = nu().geladenVanaf?.linkedin;
    assert(grens !== undefined && grens !== null && grens > lastCompleteMonth() && grens > addMonths(lastCompleteMonth(), 1),
      `mislukte eerste pagina: de laadgrens ligt ná de lopende maand, niets is geladen (kreeg ${JSON.stringify(nu().geladenVanaf)})`);
    const html = band({ data: nu().data, bronnen: nu().bronnen }, stand);
    assert(html.includes("is geen data geladen") && !html.includes("nog geen enkele maand met data"),
      `de band zegt "geen data geladen", niet "nog geen enkele maand met data" (kreeg "${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600)}")`);
    faalt.delete("linkedin_account_daily");
    root.unmount();
  }

  // ── 4c. Op "Alle kanalen" faalt de eerste pagina van één kanaal ─────────────────────────
  //
  // Gerepareerd op de kanaaltab (4b), niet op "Alle kanalen": daar heeft Meta dan geen rijen en een
  // laadgrens ná de periode. bronStart geeft null, gepaardeTotalen slaat hem over, en Google vult elke
  // maand, dus ontbrekendeMaanden vindt niets. De band toonde een totaal zonder Meta, als "alle
  // kanalen", zonder één regel erover.
  {
    opgeslagen = null;
    faalt.add("meta_account_daily");
    const root = mount("blended");
    await rust();
    await beantwoordAlles();
    const uit = nu();
    const zin = (html: string) => (/<p class="[^"]*amber[^"]*">(?:<svg[^]*?<\/svg>)?([^<]*kon[^<]*niet geladen[^<]*)<\/p>/.exec(html) ?? [])[1] ?? "";
    const metG = band({ data: uit.data, bronnen: uit.bronnen }, stand);
    assert(zin(metG) === "Meta kon niet geladen worden en telt hierboven niet mee.",
      `een mislukte Meta-lezing staat in amber in de band (kreeg "${metG.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600)}")`);
    faalt.add("linkedin_account_daily");
    const root2 = mount("blended");
    await rust();
    await beantwoordAlles();
    const twee = band({ data: nu().data, bronnen: nu().bronnen }, stand);
    assert(zin(twee) === "Meta en LinkedIn konden niet geladen worden en tellen hierboven niet mee.", `twee kanalen in één zin (kreeg "${zin(twee)}")`);
    faalt.delete("meta_account_daily");
    faalt.delete("linkedin_account_daily");
    // En zonder fout geen regel.
    const root3 = mount("blended");
    await rust();
    await beantwoordAlles();
    assert(zin(band({ data: nu().data, bronnen: nu().bronnen }, stand)) === "", "zonder leesfout geen regel");
    root.unmount(); root2.unmount(); root3.unmount();
  }

  // ── 4d. Een LATERE pagina faalt ──────────────────────────────────────────────────────────
  //
  // Dan zijn de rijen nieuwer dan de oudste dag van de vorige pagina binnen, en de maand van die dag
  // maar deels. Die halve maand bleef staan, met de laadgrens een maand later: de eerste maand met
  // data lag dan vóór de laadgrens, en de band las de laadfout als de start van de data ("de data
  // begint halverwege april 2025"), telde de halve maand als een volle, en zei over het jaar ervoor
  // "er is nog geen data". De eerste maand met data hoort de laadgrens te zijn.
  {
    const { bronStart } = await import("./period/apply-period");
    const eerder = RIJEN.meta_account_daily;
    const vlak: Record<string, unknown>[] = [];
    for (let d = new Date(`${monthsAgo(36)}T00:00:00Z`); d <= new Date("2026-08-26T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const dag = d.toISOString().slice(0, 10);
      for (const entity_id of ["a1", "a2"]) vlak.push({ date: dag, entity_id, impressions: 10, link_clicks: 1, spend: 1, conversions: 1, leads: 0, conversion_value: 0 });
    }
    RIJEN.meta_account_daily = vlak;
    opgeslagen = null;
    faaltVerzoek.set("meta_account_daily", 2);
    const root = mount("blended");
    await rust();
    await beantwoordAlles();
    const grens = nu().geladenVanaf.meta;
    const bron = nu().bronnen?.find((b) => b.naam === "meta");
    assert(grens !== null && grens > monthsAgo(36).slice(0, 7), `voorwaarde: de tweede pagina faalde, de laadgrens schoof op (kreeg ${grens})`);
    assert(!!bron && bronStart(bron).start === grens, `de eerste maand met data is de laadgrens, geen halve maand ervoor (kreeg start ${bron ? bronStart(bron).start : "-"}, grens ${grens})`);
    root.unmount();

    // De Meta-tab: één bron, dus de zin zonder kanaalnaam.
    faaltVerzoek.set("meta_account_daily", 2);
    const losRoot = createRoot(doc.createElement() as unknown as Element);
    for (const k of Object.keys(verzoeken)) delete verzoeken[k];
    wachtend = []; laatst = null;
    function MetaKpi() { laatst = useChannelPeriodData({ clientId: "t", channel: "meta", googleData: google }); return null; }
    losRoot.render(createElement(MetaKpi));
    await rust();
    await beantwoordAlles();
    const html = band({ data: nu().data, bronnen: nu().bronnen }, stand).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert(!html.includes("halverwege"), `de band noemt de laadfout geen start "halverwege" (kreeg "${(html.match(/[^.]*halverwege[^.]*\./) ?? [""])[0]}")`);
    assert(html.includes(`de band laadt vanaf ${formatMonth(grens!)}`), `de band zegt vanaf waar hij geladen heeft (kreeg "${html.slice(0, 700)}")`);
    losRoot.unmount();
    faaltVerzoek.delete("meta_account_daily");
    RIJEN.meta_account_daily = eerder;
  }

  // ── 5. Zelfde diagnose, ander blok: de bronnen van KanaalHealthRanking ──────────────────
  //
  // Zonder score gaf de ranking de KanaalScoreBron-kinderen los terug, met score zette hij ze
  // BINNEN de kaart-<div>. Andere boom, dus React haalde ze bij de eerste score weg en zette ze
  // opnieuw neer: een tweede ronde /api/analysis/channel-forecast (6 verzoeken in plaats van 3).
  // Het onderdeel mounten vraagt de hele ClientDataProvider met de Google-route erachter; dit leest
  // de bron, als vangnet en niet als gedragstest.
  {
    const ranking = readFileSync(join(import.meta.dirname, "..", "components/dashboard/kanaal-health-ranking.tsx"), "utf8");
    assert(!/return bronnen;/.test(ranking), "de ranking geeft de bronnen niet los terug zonder fragment");
    assert(/if \(rijen\.length === 0\) return <>\{bronnen\}<\/>;/.test(ranking), "zonder score: de bronnen als eerste kind van een fragment");
    assert(/return \(\s*<>\s*\{bronnen\}\s*<div className="@container/.test(ranking), "met score: de bronnen ook als eerste kind van een fragment, vóór de kaart");
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

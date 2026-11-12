// Gedragstest: wat een wissel van kanaal of periode op het Overzicht aan werk kost.
// Draaien: tsx lib/__overzicht_wissel_test.ts
//
// Wat er was (meting 2026-11-12, nieuwe weergave op de demo): de eerste zichtbare reactie op een
// kanaalwissel na 154 ms tegen een norm van 100, per wissel één lange taak (76 tot 141 ms, bij een
// vier keer tragere processor 443 tot 1076 ms) en 13 gemiste beeldjes. De oorzaken in de code:
// - de klik brak in één synchrone render het oude kanaaltabblad af en bouwde het nieuwe op, vóór
//   de gekozen kaart kon oplichten;
// - elke wissel rendert ClientDashboard twee keer (de klik, daarna Next op het gewijzigde adres),
//   en zonder memo bouwde de tweede render alles nog een keer;
// - ChannelDataProvider begon bij elke mount zonder conversieselectie en bouwde het tabblad van
//   Meta, LinkedIn en Microsoft daardoor twee keer op, ook als de rij al in de cache stond;
// - useChannelPeriodData gaf elke render een nieuw object terug;
// - tussenTekst maakte per kerncijfer per beeldje een nieuwe Intl.NumberFormat.
//
// Wat hier vastligt:
// - ChannelDataProvider: met de rij in de cache heeft de ALLEREERSTE render de rijen al;
// - useChannelPeriodData: hetzelfde object zolang er niets verandert;
// - de vijf tabbladen en de bovenkant staan in memo; het tabblad volgt een uitgesteld kanaal en
//   staat gedimd met aria-busy zolang het achterloopt; de bovenkant krijgt het kanaal direct;
// - tussenTekst geeft dezelfde tekst als met een verse Intl.NumberFormat;
// - het uitstel geldt alleen in de nieuwe weergave: met de schakelaar uit volgt het tabblad direct;
// - /api/geo met level=beide geeft per niveau dezelfde rijen als de losse verzoeken, voor één
//   kanaal per verzoek (alle kanalen in één antwoord bestaat bewust niet).

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-DOM: alleen wat createRoot nodig heeft; moet er staan VOORDAT react-dom geladen wordt ─
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
const doc = { ...knoop(9), activeElement: null, cookie: "", createElement: () => ({ ...knoop(1), ownerDocument: doc }) };
const opslag = new Map<string, string>();
const localStorage = { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } };
Object.assign(globalThis, {
  window: { document: doc, addEventListener: noop, removeEventListener: noop, getSelection: () => null, HTMLIFrameElement: class {}, localStorage },
  document: doc,
  localStorage,
});

// ── Nep-fetch: de blended route en de client_settings-rij, meteen beantwoord ───────────────────
const BLENDED = {
  currentYear: 2026,
  realizedThroughMonth: 9,
  targetCurrentYear: { conversions: 100, revenue: 0, adSpend: 1000 },
  historicalYears: [],
  currentYearMonthly: Array.from({ length: 9 }, (_, i) => ({
    month: i + 1, conversions: 10, revenue: 0, adSpend: 100, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0,
  })),
  dataStand: { laatsteVolleMaand: "2026-09", partieel: null, verwachteMaand: "2026-10", maandenAchter: 1, dataTot: "2026-09-30", uitgesloten: [] },
  perKanaal: [
    { kanaal: "google", maanden: [{ month: "2026-09", conversions: 10, revenue: 0, adSpend: 100 }] },
    { kanaal: "meta", vanaf: "2026-01", laatsteDag: "2026-09-30", maanden: [{ month: "2026-09", conversions: 4, revenue: 0, adSpend: 40, impressions: 100, clicks: 10 }], recenteDagen: [] },
  ],
  clientTargets: [],
};
const verzoeken: Record<string, number> = {};
globalThis.fetch = (async (url: string) => {
  const pad = String(url).split("?")[0];
  verzoeken[pad] = (verzoeken[pad] ?? 0) + 1;
  const lichaam = pad === "/api/blended/client-data" ? BLENDED
    : pad === "/api/data/client_settings" ? { data: { channel_conversion_config: { meta_ads: ["leads"] } } }
      : { data: [] };
  return { ok: true, status: 200, json: async () => lichaam } as Response;
}) as typeof fetch;

const rust = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function tot(waar: () => boolean, ms = 3000): Promise<boolean> {
  const eind = Date.now() + ms;
  while (!waar() && Date.now() < eind) await rust(5);
  return waar();
}

async function main() {
  const React = await import("react");
  const { createElement } = React;
  const { createRoot } = await import("react-dom/client");
  const maakRoot = () => createRoot(doc.createElement() as unknown as Element);

  // ── ChannelDataProvider ─────────────────────────────────────────────────────────────────────
  console.log("ChannelDataProvider: met de rij in de cache heeft de eerste render de rijen al");
  {
    const { ChannelDataProvider, useKanaalData } = await import("../components/dashboard/channel-data-provider");
    const { useBlendedClientData } = await import("./use-blended-client-data");
    const { kijkClientSettingsRij, vergeetClientSettingsRij } = await import("./client-settings");
    type KanaalData = ReturnType<typeof useKanaalData>;

    // Het laden van het Overzicht: de route en de rij komen binnen en staan daarna in hun cache.
    let route: ReturnType<typeof useBlendedClientData> | null = null;
    function Band() { route = useBlendedClientData("klant-w"); return null; }
    const band = maakRoot();
    band.render(createElement(Band));
    check("voorwaarde: de route is geladen", await tot(() => route?.loading === false && route.error === null), JSON.stringify(route));
    check("voorwaarde: de rij staat in de cache", await tot(() => kijkClientSettingsRij("klant-w") !== undefined));

    // De wissel naar Meta: het tabblad mount.
    const renders: KanaalData[] = [];
    function Tab() { renders.push(useKanaalData()); return null; }
    const tab = maakRoot();
    tab.render(createElement(ChannelDataProvider, { clientId: "klant-w", channel: "meta", children: createElement(Tab) }));
    await tot(() => renders.length > 0);
    await rust(60);
    // Hier stond bij de eerste render `rijen: null` (de laadstaat), en pas na het effect de rijen:
    // het hele tabblad werd twee keer opgebouwd.
    check("de ALLEREERSTE render heeft de rijen en de maanden, geen laadstaat",
      renders[0]?.rijen !== null && renders[0]?.maanden !== null && renders[0]?.maanden?.length === 1 && renders[0]?.forecast !== null,
      JSON.stringify({ rijen: renders[0]?.rijen, maanden: renders[0]?.maanden?.length, forecast: renders[0]?.forecast }));
    check("met de opgeslagen conversieselectie van de klant, niet de standaard",
      renders[0]?.convVan({ convFields: { leads: 3, conversions: 5 } } as never) === 3, String(renders[0]?.convVan({ convFields: { leads: 3, conversions: 5 } } as never)));
    check("geen enkele render in de laadstaat", renders.every((r) => r.rijen !== null), String(renders.map((r) => r.rijen === null)));
    check("het kostte geen verzoek", verzoeken["/api/blended/client-data"] === 1 && verzoeken["/api/data/client_settings"] === 1, JSON.stringify(verzoeken));
    tab.unmount();

    // Een koude start (de rij is er niet): dan wacht de selectie, zoals voorheen.
    vergeetClientSettingsRij("klant-w");
    const koud: KanaalData[] = [];
    function KoudTab() { koud.push(useKanaalData()); return null; }
    const koudRoot = maakRoot();
    koudRoot.render(createElement(ChannelDataProvider, { clientId: "klant-w", channel: "meta", children: createElement(KoudTab) }));
    check("zonder rij in de cache: eerst de laadstaat, daarna de rijen",
      await tot(() => koud.length > 1 && koud[0].rijen === null && koud[koud.length - 1].rijen !== null), String(koud.map((r) => r.rijen === null)));
    koudRoot.unmount();
    band.unmount();
    await rust();
  }

  // ── useChannelPeriodData ────────────────────────────────────────────────────────────────────
  console.log("useChannelPeriodData: hetzelfde object zolang er niets verandert");
  {
    const { useChannelPeriodData } = await import("./use-channel-period-data");
    const { useBlendedClientData } = await import("./use-blended-client-data");
    const gezien: unknown[] = [];
    function Band({ tik }: { tik: number }) {
      void tik;
      const route = useBlendedClientData("klant-w");
      gezien.push(useChannelPeriodData({ clientId: "klant-w", channel: "meta", googleData: null, route }));
      return null;
    }
    const root = maakRoot();
    root.render(createElement(Band, { tik: 0 }));
    await tot(() => gezien.length > 0);
    await rust(60);
    const voor = gezien.length;
    // De tweede render van een wissel: de ouder rendert opnieuw, aan de invoer verandert niets.
    root.render(createElement(Band, { tik: 1 }));
    await tot(() => gezien.length > voor);
    await rust(40);
    check("de hook rendert opnieuw", gezien.length > voor, `${voor} -> ${gezien.length}`);
    check("en geeft hetzelfde object terug", gezien.length > voor && gezien[gezien.length - 1] === gezien[voor - 1]);
    root.unmount();
    await rust();
  }

  // ── De tabbladen en de bovenkant in memo; het tabblad volgt een uitgesteld kanaal ───────────
  console.log("De tabbladen en de bovenkant staan in memo");
  {
    const MEMO = Symbol.for("react.memo");
    const isMemo = (c: unknown) => (c as { $$typeof?: symbol } | null)?.$$typeof === MEMO;
    const { MetaView } = await import("../components/dashboard/meta-view");
    const { LinkedInView } = await import("../components/dashboard/linkedin-view");
    const { MicrosoftView } = await import("../components/dashboard/microsoft-view");
    const { GoogleView } = await import("../components/dashboard/google-view");
    const { CrossChannelView } = await import("../components/dashboard/cross-channel-view");
    const { OverzichtBovenkant } = await import("../components/dashboard/overzicht-bovenkant");
    for (const [naam, c] of Object.entries({ MetaView, LinkedInView, MicrosoftView, GoogleView, CrossChannelView, OverzichtBovenkant })) {
      check(`${naam} is een memo-component`, isMemo(c));
    }
    // Een memo slaat de render over als de props dezelfde zijn: de tweede render van een wissel.
    let teller = 0;
    const Zwaar = React.memo(function Zwaar(_: { kanalen: readonly string[]; opKlik: () => void }) { teller += 1; return null; });
    const vast: string[] = [];
    const klik = () => {};
    function Ouder({ tik, stabiel }: { tik: number; stabiel: boolean }) {
      void tik;
      return createElement(Zwaar, stabiel ? { kanalen: vast, opKlik: klik } : { kanalen: [], opKlik: () => {} });
    }
    const root = maakRoot();
    root.render(createElement(Ouder, { tik: 0, stabiel: true }));
    await tot(() => teller === 1);
    root.render(createElement(Ouder, { tik: 1, stabiel: true }));
    await rust(40);
    check("met vaste props (één lege lijst, een vaste functie): geen tweede render", teller === 1, String(teller));
    root.render(createElement(Ouder, { tik: 2, stabiel: false }));
    await rust(40);
    check("met `?? []` en een inline functie rendert hij wel opnieuw (waarom het dashboard die vast zet)", teller === 2, String(teller));
    root.unmount();
  }

  console.log("Het dashboard: de bovenkant direct, het tabblad uitgesteld en gemarkeerd");
  {
    const dash = readFileSync(join(import.meta.dirname, "..", "components/dashboard/client-dashboard.tsx"), "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    check("het kanaal voor het tabblad is uitgesteld", /const kanaalUitgesteld = useDeferredValue\(channel\);/.test(dash));
    // Met de schakelaar uit wisselt het tabblad in dezelfde render als de tabs en de band, zoals het
    // deed: de oude weergave mag alleen sneller worden, en een moment met de band van het ene
    // kanaal boven het tabblad van het andere is anders.
    check("maar alleen in de nieuwe weergave: de oude volgt het kanaal direct",
      /const kanaalOnder: Channel = nieuweWeergave \? kanaalUitgesteld : channel;/.test(dash));
    const blok = /<SectieKopBijeen\.Provider value=\{nieuweWeergave\}>([\s\S]*?)<\/SectieKopBijeen\.Provider>/.exec(dash)?.[1] ?? "";
    for (const [kanaal, comp] of [["meta", "MetaView"], ["linkedin", "LinkedInView"], ["microsoft", "MicrosoftView"], ["blended", "CrossChannelView"], ["google", "GoogleView"]]) {
      check(`${comp} volgt kanaalOnder`, new RegExp(`\\{kanaalOnder === "${kanaal}" && \\(?\\s*<${comp}\\b`).test(blok), blok.slice(0, 200));
    }
    check("geen tabblad kiest nog op het directe kanaal", !/\{channel === "/.test(blok));
    check("zolang het achterloopt: gedimd en aria-busy", /aria-busy=\{onderLooptAchter \|\| undefined\}/.test(blok) && /onderLooptAchter \? "opacity-60" : ""/.test(blok)
      && /const onderLooptAchter = kanaalOnder !== channel;/.test(dash));
    const boven = /<OverzichtBovenkant([\s\S]*?)\/>/.exec(dash)?.[1] ?? "";
    check("de bovenkant (kaarten, tegels, grafiek) krijgt het kanaal direct", /channel=\{channel\}/.test(boven) && !/kanaalOnder/.test(boven), boven.slice(0, 160));
    check("met vaste functies als props", /onKies=\{setChannel\}/.test(boven) && /onBeoordeel=\{naarBeoordelen\}/.test(boven)
      && /const naarBeoordelen = useCallback\(\(\) => setActiveTab\("outcomes"\), \[\]\);/.test(dash));
    check("CrossChannelView krijgt één vaste lege lijst, geen `?? []`", /kanalen=\{kanalen \?\? GEEN_KANALEN\}/.test(blok) && /const GEEN_KANALEN: Kanaal\[\] = \[\];/.test(dash));
    check("de KPI-band en de periode lezen het directe kanaal", /useChannelPeriodData\(\{ clientId: client\.id, channel, /.test(dash));
  }

  // ── tussenTekst ─────────────────────────────────────────────────────────────────────────────
  console.log("tussenTekst: dezelfde tekst als met een verse opmaak");
  {
    const { tussenTekst } = await import("./beweging");
    const vers = (waarde: number, decimalen: number, groepen: boolean) =>
      new Intl.NumberFormat("nl-NL", { minimumFractionDigits: decimalen, maximumFractionDigits: decimalen, useGrouping: groepen }).format(waarde);
    check("hele getallen met groepen", tussenTekst("1.000", "2.000", 0.5) === vers(1500, 0, true), tussenTekst("1.000", "2.000", 0.5));
    check("met een voor- en achtervoegsel", tussenTekst("€ 1.200", "€ 2.400", 0.25) === `€ ${vers(1500, 0, true)}`, tussenTekst("€ 1.200", "€ 2.400", 0.25));
    check("met decimalen", tussenTekst("1,50", "2,50", 0.5) === vers(2, 2, true), tussenTekst("1,50", "2,50", 0.5));
    check("een percentage", tussenTekst("10%", "20%", 0.5) === `${vers(15, 0, true)}%`, tussenTekst("10%", "20%", 0.5));
    check("herhaald: steeds dezelfde uitkomst", [0.1, 0.5, 0.9].every((t) => tussenTekst("1.000", "9.000", t) === tussenTekst("1.000", "9.000", t)));
    check("aan het eind letterlijk het doel", tussenTekst("1.000", "2.000", 1) === "2.000");
  }

  // ── /api/geo: beide niveaus in één antwoord, per kanaal ─────────────────────────────────────
  console.log("/api/geo: level=beide geeft dezelfde rijen als de losse verzoeken");
  {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../app/api/geo/route");
    const vraag = async (qs: string) => {
      const res = await GET(new NextRequest(`http://localhost/api/geo?clientId=demo-greentech&${qs}`));
      return { status: res.status, lichaam: await res.json() as { rows?: unknown[]; niveaus?: Record<string, unknown[] | null>; channel?: string; evidence?: string } };
    };
    let rijen = 0;
    for (const channel of ["google", "meta", "linkedin", "blended"]) {
      const paar = await vraag(`channel=${channel}&level=beide`);
      for (const level of ["country", "region"]) {
        const los = await vraag(`channel=${channel}&level=${level}`);
        rijen += los.lichaam.rows?.length ?? 0;
        check(`${channel}/${level}: beide == los`, Array.isArray(paar.lichaam.niveaus?.[level]) && JSON.stringify(paar.lichaam.niveaus?.[level]) === JSON.stringify(los.lichaam.rows));
      }
      check(`${channel}: level=beide geeft dit kanaal, met precies de twee niveaus`,
        paar.lichaam.channel === channel && Object.keys(paar.lichaam.niveaus ?? {}).sort().join() === "country,region");
    }
    check("voorwaarde: de vergelijking ging over echte rijen", rijen > 0, String(rijen));
    check("het losse verzoek is wat het was (rows, evidence)", (await vraag("channel=google&level=country")).lichaam.evidence === "demo");
    // Alle kanalen in één antwoord is teruggedraaid: acht lezingen bij het eerste laden in plaats
    // van twee, ook voor een klant met alleen Google, en niet gemeten op een echte klant.
    check("channel=alle bestaat niet: een 400, zoals elk onbekend kanaal", (await vraag("channel=alle&level=beide")).status === 400);
    check("een onbekend kanaal blijft een 400", (await vraag("channel=tiktok&level=beide")).status === 400);
    check("een onbekend niveau blijft een 400", (await vraag("channel=google&level=stad")).status === 400);
    // Een niveau dat mislukt neemt het andere niet mee: elk in een eigen vangnet, met null.
    const route = readFileSync(join(import.meta.dirname, "..", "app/api/geo/route.ts"), "utf8");
    check("elk niveau heeft zijn eigen vangnet (null bij een fout)", /resolveGeo\(\{ clientId, channel, level \}\)\.catch\(\(e\) => \{[\s\S]{0,160}return null;/.test(route));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

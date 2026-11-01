// Regressietest: useBlendedClientData (lib/use-blended-client-data.ts), de hook achter het
// Jaaroverzicht, de Pacing en de datastand van de KPI-band op "Alle kanalen".
// Draaien: tsx lib/api/__blended_client_data_hook_test.ts
//
// Wat hier vastligt:
// - twee gelijktijdige mounts (de KPI-band en het tabblad) doen ÉÉN verzoek, niet twee;
// - enabled = false doet geen verzoek (een klant met één kanaal heeft geen blended weergave);
// - dataStand en perKanaal uit de route komen door;
// - na een fout is een nieuw verzoek mogelijk (het lopende verzoek blijft niet hangen);
// - na vergeetBlendedClientData (opslaan van de conversieselectie) vraagt een nieuwe mount opnieuw,
//   en een verzoek dat vóór het vergeten vertrok zet zijn oude antwoord niet meer in de cache;
// - ook in de ENE render na een wissel (uit -> aan, of een andere klant) klopt de staat: geen
//   "klaar zonder data" en geen cijfers van de vorige klant, ook niet vóórdat het effect draait.
// De hook draait echt (react-dom/client), op een nep-DOM en een nep-fetch.

// Een module, geen script: zonder import of export op het hoogste niveau deelt tsc de namen
// hieronder (passed, check, main) met elk ander testscript in het project.
export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
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
// `cookie`: de kpi-doelen (mergeKpiTargets -> client-settings) laden de browser-Supabase, en die
// leest bij het opstarten document.cookie.
const doc = { ...knoop(9), activeElement: null, cookie: "", createElement: () => ({ ...knoop(1), ownerDocument: doc }) };
Object.assign(globalThis, {
  window: { document: doc, addEventListener: noop, removeEventListener: noop, getSelection: () => null, HTMLIFrameElement: class {} },
  document: doc,
});

// ── Nep-fetch: telt per klant, en de test bepaalt wanneer er geantwoord wordt ───────────────
const verzoeken: Record<string, number> = {};
let wachtend: { klant: string; los: () => void }[] = [];
const ANTWOORD = {
  currentYear: 2026,
  realizedThroughMonth: 7,
  targetCurrentYear: { conversions: 100, revenue: 0, adSpend: 1000 },
  historicalYears: [],
  currentYearMonthly: Array.from({ length: 7 }, (_, i) => ({
    month: i + 1, conversions: 10, revenue: 0, adSpend: 100, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0,
  })),
  dataStand: {
    laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 },
    verwachteMaand: "2026-10", maandenAchter: 3, dataTot: "2026-08-25", uitgesloten: [],
  },
  perKanaal: [{ kanaal: "google" as const, maanden: [{ month: "2026-01", conversions: 10, revenue: 0, adSpend: 100 }] }],
};
// Een eigen antwoord voor een klant; de rest krijgt ANTWOORD.
const ANTWOORD_PER: Record<string, unknown> = {};
// client_settings (loadClientSettings, waar de hook op wacht voordat hij de doelen samenvoegt) per
// klant een opgeslagen rij, in dezelfde wachtrij: zo kiest een test welk antwoord eerst komt.
const INSTELLINGEN: Record<string, unknown> = {};
globalThis.fetch = ((url: string) => {
  if (String(url).startsWith("/api/data/client_settings")) {
    const vraag = JSON.parse(decodeURIComponent(String(url).split("?q=")[1] ?? "{}")) as { clientId?: string };
    const id = vraag.clientId ?? "";
    return new Promise((klaar) => wachtend.push({
      klant: `instellingen:${id}`,
      los: () => klaar({ ok: true, status: 200, json: async () => ({ data: INSTELLINGEN[id] ?? null }) } as Response),
    }));
  }
  const klant = decodeURIComponent(String(url).split("clientId=")[1] ?? "");
  verzoeken[klant] = (verzoeken[klant] ?? 0) + 1;
  return new Promise((klaar) => wachtend.push({
    klant,
    los: () => klaar({
      ok: !klant.startsWith("fout"), status: klant.startsWith("fout") ? 404 : 200,
      json: async () => (klant.startsWith("fout") ? { error: `Geen blended data voor "${klant}"` } : ANTWOORD_PER[klant] ?? ANTWOORD),
    } as Response),
  }));
}) as typeof fetch;

const rust = () => new Promise((r) => setTimeout(r, 20));
async function beantwoordAlles(): Promise<void> {
  for (let i = 0; i < 5 && wachtend.length > 0; i++) {
    const nu = wachtend; wachtend = [];
    for (const w of nu) w.los();
    await rust();
  }
}

interface Staat {
  data: unknown; dataStand?: { laatsteVolleMaand: string | null } | null; perKanaal?: unknown[] | null; loading: boolean; error: string | null;
  forecast?: { conversions: { kpi: { adjustedAnnual: number; realizedThroughMonth: number } } } | null;
}

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const hookModule = await import("../use-blended-client-data");
  const { useBlendedClientData } = hookModule;
  const gebruik = useBlendedClientData as (clientId: string, enabled?: boolean) => Staat;
  // Als losse lookup: tegen een versie zonder deze export wordt dat een FAIL, geen crash.
  const vergeet = (hookModule as { vergeetBlendedClientData?: (clientId: string) => void }).vergeetBlendedClientData;

  const staten: Record<string, Staat> = {};
  function Lezer({ naam, clientId, enabled }: { naam: string; clientId: string; enabled?: boolean }) {
    staten[naam] = enabled === undefined ? gebruik(clientId) : gebruik(clientId, enabled);
    return null;
  }
  const mount = (...lezers: { naam: string; clientId: string; enabled?: boolean }[]) => {
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement("div", null, ...lezers.map((l) => createElement(Lezer, { key: l.naam, ...l }))));
    return root;
  };

  console.log("Twee gelijktijdige mounts: één verzoek");
  {
    const root = mount({ naam: "band", clientId: "c1" }, { naam: "tab", clientId: "c1" });
    await rust();
    check("beide laden", staten.band?.loading === true && staten.tab?.loading === true, JSON.stringify([staten.band, staten.tab]));
    await beantwoordAlles();
    check("één verzoek voor twee lezers", verzoeken.c1 === 1, String(verzoeken.c1));
    check("beide hebben de data", staten.band?.data != null && staten.tab?.data != null && !staten.band.loading && !staten.tab.loading);
    check("dataStand komt door", staten.band?.dataStand?.laatsteVolleMaand === "2026-07" && staten.tab?.dataStand?.laatsteVolleMaand === "2026-07", JSON.stringify(staten.band?.dataStand));
    check("perKanaal komt door", Array.isArray(staten.tab?.perKanaal) && staten.tab!.perKanaal!.length === 1, JSON.stringify(staten.tab?.perKanaal));
    // De prognose voor "Alle kanalen" is de som per kanaal (lib/forecast-som.ts), één keer per
    // ophaalronde berekend en met de rest gecachet: beide lezers krijgen hetzelfde object. Eerder
    // rekende elke lezer zelf computeForecast op de optelling, en die telde de kanaalmix als groei.
    const { blendedForecastUitKanalen } = await import("../forecast-som");
    const { buildClientDataFromApi } = await import("./adapter");
    const verwacht = blendedForecastUitKanalen("c1", ANTWOORD.perKanaal.map((k) => ({ ...k, vanaf: null })),
      buildClientDataFromApi("c1", ANTWOORD.historicalYears, ANTWOORD.currentYearMonthly, [], ANTWOORD.targetCurrentYear, 2026, 7), 7);
    check("de hook geeft de prognose mee: de som per kanaal",
      staten.tab?.forecast?.conversions.kpi.adjustedAnnual === verwacht.conversions.kpi.adjustedAnnual
        && staten.tab?.forecast?.conversions.kpi.realizedThroughMonth === 7,
      JSON.stringify([staten.tab?.forecast?.conversions.kpi, verwacht.conversions.kpi.adjustedAnnual]));
    check("één keer berekend: beide lezers hetzelfde object", staten.band?.forecast != null && staten.band.forecast === staten.tab?.forecast);
    root.unmount();

    const root2 = mount({ naam: "later", clientId: "c1" });
    await rust();
    check("een latere mount binnen de cachetijd: geen nieuw verzoek, meteen klaar",
      verzoeken.c1 === 1 && staten.later?.loading === false && staten.later?.dataStand?.laatsteVolleMaand === "2026-07", JSON.stringify([verzoeken.c1, staten.later?.loading]));
    root2.unmount();
  }

  console.log("enabled = false: niets ophalen");
  {
    const root = mount({ naam: "uit", clientId: "c2", enabled: false });
    await rust();
    await beantwoordAlles();
    check("geen verzoek", (verzoeken.c2 ?? 0) === 0, String(verzoeken.c2));
    check("lege, niet-ladende staat", staten.uit?.data === null && staten.uit?.loading === false && staten.uit?.error === null
      && staten.uit?.dataStand === null && staten.uit?.perKanaal === null, JSON.stringify(staten.uit));
    root.unmount();
  }

  console.log("Een fout: melden, en daarna opnieuw kunnen vragen");
  {
    const root = mount({ naam: "f1", clientId: "fout-1" });
    await rust();
    await beantwoordAlles();
    check("de foutmelding van de route", staten.f1?.error === 'Geen blended data voor "fout-1"' && staten.f1?.loading === false, JSON.stringify(staten.f1));
    root.unmount();
    const root2 = mount({ naam: "f2", clientId: "fout-1" });
    await rust();
    await beantwoordAlles();
    check("een nieuwe mount vraagt opnieuw (het mislukte verzoek blijft niet hangen)", verzoeken["fout-1"] === 2, String(verzoeken["fout-1"]));
    root2.unmount();
  }

  console.log("Na het opslaan van de selectie: de cache vergeten");
  {
    check("vergeetBlendedClientData bestaat", typeof vergeet === "function");
    const root = mount({ naam: "v1", clientId: "c3" });
    await rust();
    await beantwoordAlles();
    root.unmount();
    vergeet?.("c3");
    const root2 = mount({ naam: "v2", clientId: "c3" });
    await rust();
    check("na het vergeten vraagt een nieuwe mount opnieuw (niet vijf minuten de oude selectie)",
      verzoeken.c3 === 2 && staten.v2?.loading === true, JSON.stringify([verzoeken.c3, staten.v2?.loading]));
    await beantwoordAlles();
    root2.unmount();

    // Een verzoek dat onderweg is op het moment van opslaan, draagt nog de oude selectie.
    const root3 = mount({ naam: "v3", clientId: "c4" });
    await rust();
    vergeet?.("c4");
    await beantwoordAlles();
    root3.unmount();
    const root4 = mount({ naam: "v4", clientId: "c4" });
    await rust();
    check("een antwoord van vóór het vergeten komt niet in de cache", verzoeken.c4 === 2, String(verzoeken.c4));
    await beantwoordAlles();
    root4.unmount();
  }

  console.log("De route antwoordt vóór client_settings: het opgeslagen doel komt in de cache");
  {
    // De hook voegt de KPI-doelen samen en cachet het resultaat vijf minuten. Wachtte hij niet op
    // loadClientSettings, dan hing het doel af van wat er eerder binnen was: hier het doel van de
    // route (100), of vóór de standaardgroei van 0 zelfs 110, in plaats van de opgeslagen 5.000.
    INSTELLINGEN.c7 = { kpi_targets: { conversionsMode: "absolute", conversionsAbsolute: 5000 } };
    const root = mount({ naam: "doel", clientId: "c7" });
    await rust();
    const route = wachtend.filter((w) => w.klant === "c7");
    wachtend = wachtend.filter((w) => w.klant !== "c7");
    for (const w of route) w.los();
    await rust();
    check("de route is binnen, de instellingen nog niet: nog geen data", route.length === 1 && staten.doel?.loading === true && staten.doel?.data == null,
      JSON.stringify([route.length, staten.doel?.loading]));
    await beantwoordAlles();
    const doel = (s: Staat | undefined) => (s?.data as { targetCurrentYear?: { conversions: number } } | null)?.targetCurrentYear?.conversions;
    check("daarna het opgeslagen doel, niet dat van de route", doel(staten.doel) === 5000, String(doel(staten.doel)));
    root.unmount();
    const root2 = mount({ naam: "doel2", clientId: "c7" });
    await rust();
    check("en zo staat het in de cache", verzoeken.c7 === 1 && doel(staten.doel2) === 5000, JSON.stringify([verzoeken.c7, doel(staten.doel2)]));
    root2.unmount();
  }

  console.log("Een bron in uitgesloten: de prognose telt hem na zijn dag als nul");
  {
    // LinkedIn houdt het venster niet tegen (gepauzeerd met een gezonde sync): de band zegt "vanaf
    // die dag telt het als nul", dus de prognose hoort hem dan ook niet door te trekken.
    const maanden = (n: number) => Array.from({ length: 7 }, (_, i) => ({ month: `2026-0${i + 1}`, conversions: n, revenue: n * 10, adSpend: n * 5 }));
    const antwoord = {
      ...ANTWOORD,
      currentYearMonthly: ANTWOORD.currentYearMonthly.map((m) => ({ ...m, conversions: 15 })),
      dataStand: { ...ANTWOORD.dataStand, uitgesloten: ["linkedin"] },
      perKanaal: [{ kanaal: "google", vanaf: null, maanden: maanden(10) }, { kanaal: "linkedin", vanaf: null, maanden: maanden(5) }],
    };
    ANTWOORD_PER.c8 = antwoord;
    const root = mount({ naam: "stop", clientId: "c8" });
    await rust();
    await beantwoordAlles();
    const { blendedForecastUitKanalen } = await import("../forecast-som");
    const { buildClientDataFromApi } = await import("./adapter");
    const samen = buildClientDataFromApi("c8", [], antwoord.currentYearMonthly, [], ANTWOORD.targetCurrentYear, 2026, 7);
    const met = blendedForecastUitKanalen("c8", antwoord.perKanaal as never, samen, 7, ["linkedin"]);
    const zonder = blendedForecastUitKanalen("c8", antwoord.perKanaal as never, samen, 7);
    const aug = (f: unknown) => (f as { conversions: { points: { forecast: number | null }[] } } | null | undefined)?.conversions.points[7].forecast;
    check("de hook geeft uitgesloten door aan de prognose", aug(staten.stop?.forecast) === aug(met) && aug(met) !== aug(zonder),
      JSON.stringify([aug(staten.stop?.forecast), aug(met), aug(zonder)]));
    root.unmount();
  }

  console.log("De render direct na een wissel");
  {
    // Elke render vastleggen, niet alleen de laatste: de fout zat in de render vóór het effect.
    const log: Staat[] = [];
    let props: { clientId: string; enabled: boolean } = { clientId: "c5", enabled: false };
    function Logger() { log.push(gebruik(props.clientId, props.enabled)); return null; }
    const root = createRoot(doc.createElement() as unknown as Element);
    const teken = () => root.render(createElement(Logger, { key: "vast" }));
    teken();
    await rust();
    check("uit: lege, niet-ladende staat", log.at(-1)?.loading === false && log.at(-1)?.data === null);

    // Uit -> aan, zoals in client-dashboard zodra de kanalen bekend zijn.
    const vanaf = log.length;
    props = { clientId: "c5", enabled: true };
    teken();
    await rust();
    const eersteNaAan = log[vanaf];
    check("uit -> aan: de eerste render laadt al (geen \"klaar zonder datastand\")",
      eersteNaAan?.loading === true && eersteNaAan.data === null, JSON.stringify(eersteNaAan));
    await beantwoordAlles();
    check("uit -> aan: daarna de data", log.at(-1)?.loading === false && log.at(-1)?.data != null);

    // Een andere klant: de eerste render toont niet de cijfers van c5.
    const voorWissel = log.length;
    props = { clientId: "c6", enabled: true };
    teken();
    await rust();
    const eersteNaWissel = log[voorWissel];
    check("klantwissel: de eerste render toont niet de vorige klant",
      eersteNaWissel?.data === null && eersteNaWissel.loading === true, JSON.stringify(eersteNaWissel));
    await beantwoordAlles();

    // Aan -> uit: meteen leeg, ook zonder effect.
    const voorUit = log.length;
    props = { clientId: "c6", enabled: false };
    teken();
    await rust();
    check("aan -> uit: meteen leeg", log[voorUit]?.data === null && log[voorUit]?.loading === false, JSON.stringify(log[voorUit]));
    root.unmount();
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

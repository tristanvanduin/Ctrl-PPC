// Invariant: wat een kanaaltab (Meta, LinkedIn, Microsoft) toont, is wat "Alle kanalen" voor dat
// kanaal toont. Draaien: tsx --tsconfig ./tsconfig.json lib/__kanaaltab_gelijk_tabobject_test.ts
//
// Waarom hij er is. Tot fase 1, stap 5 las elk scherm zijn eigen bron: de health-badge op de tab en
// de ranking op "Alle kanalen" vroegen elk een prognose aan een aparte route (fact_core, de
// standaardselectie, gerealiseerd t/m de vorige kalendermaand), terwijl het Jaaroverzicht op
// dezelfde tab uit de dagtabel met de selectie van de klant kwam. Twee cijfers voor hetzelfde
// kanaal, en geen test die het zag, want elk cijfer klopte met zijn eigen bron.
//
// Nu is er één object per kanaal per ophaalronde (useBlendedClientData.perKanaalTab), en deze test
// legt vast dat de schermen dát lezen:
//
//   (b) de badge op de tab (via ChannelDataProvider) en de ranking op "Alle kanalen" krijgen
//       hetzelfde tab-object: identiteit, geen "ongeveer gelijk". Eén verzoek voor allebei.
//       Een kanaal zonder emmers is "leeg": geen score, geen crash, wel een regel met de reden.
//   (c) de maandtabel op de tab telt de tellers van perKanaal[kanaal].maanden, één op één, en dat
//       zijn de dagrijen met de selectie van de klant. De pacing houdt zijn kaart zonder recente
//       dagen; de campagnelezingen van de maandprestaties komen alleen met een gekozen beurs.
//   bron: niets importeert de oude hook nog, en hij en zijn route bestaan niet meer.
//
// De rijen gaan door de ECHTE routefunctie (fetchBlendedHistoricalData op een nep-Supabase) en door
// JSON heen, zoals over de lijn; de hook en de provider draaien echt (react-dom/client op een
// nep-DOM), de kaarten worden met react-dom/server gerenderd.
//
// De datums hangen aan vandaag: de hook rekent met de rapportagedatum en die is niet vast te
// zetten. De rijen lopen daarom van 520 dagen terug t/m gisteren.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBlendedHistoricalData } from "./api/blended-historical";
import { FakeSupabase } from "./decision/__fake_supabase";
import { buildChannelForecast, tabStandUitRoute } from "./analysis/channel-forecast-data";
import { addDays, today } from "./reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-DOM: wat createRoot nodig heeft; moet er staan VOORDAT react-dom geladen wordt ───────
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
// createElementNS en createTextNode erbij: de maandprestaties renderen echte elementen (iconen,
// tekst), niet alleen een component dat null teruggeeft.
const doc = {
  ...knoop(9), activeElement: null, cookie: "",
  createElement: () => ({ ...knoop(1), ownerDocument: doc }),
  createElementNS: () => ({ ...knoop(1), ownerDocument: doc }),
  createTextNode: () => ({ ...knoop(3), ownerDocument: doc }),
};
Object.assign(globalThis, {
  window: { document: doc, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, getSelection: () => null, HTMLIFrameElement: class {} },
  document: doc,
});

// ── De klant: Meta en Microsoft met dagrijen, LinkedIn zonder ────────────────────────────────
//
// Meta telt bij deze klant ALLEEN leads (de standaard is conversies + leads): zo is te zien dat
// de tab en "Alle kanalen" de selectie van de klant tellen en niet de standaard.
const VANDAAG = today();
const DEZE_MAAND = VANDAAG.slice(0, 7);
const JAAR = VANDAAG.slice(0, 4);
const SELECTIE = { meta_ads: ["leads"] };
type Rij = Record<string, unknown>;

const metaRijen: Rij[] = [];
const microsoftRijen: Rij[] = [];
for (let i = 520; i >= 1; i--) {
  const date = addDays(VANDAAG, -i);
  const dag = Number(date.slice(8, 10));
  // De maand telt mee in elk cijfer: anders zijn alle maanden van 31 dagen gelijk, en dan ziet de
  // test een verwisselde maand niet.
  const mnd = Number(date.slice(5, 7));
  metaRijen.push({
    client_id: "klant-t", date, entity_id: "m1",
    impressions: 1000 + dag * 10 + mnd * 7, link_clicks: 20 + dag + mnd, spend: 40 + dag + mnd * 3,
    conversions: 3, leads: 1 + ((dag + mnd) % 3), conversion_value: 100 + dag,
  });
  microsoftRijen.push({
    client_id: "klant-t", date, entity_id: "b1",
    impressions: 300 + dag, clicks: 9, spend: 12, conversions: 1, conversion_value: 30,
  });
}
const DOEL_META = 5000;

function nepDatabase(): FakeSupabase {
  const sb = new FakeSupabase();
  sb.seed("accounts", [{ id: "acc-t", client_id: "klant-t", name: "T", source: "google_ads", external_id: "1", agency_id: "a" }]);
  sb.seed("client_settings", [{ client_id: "klant-t", channel_conversion_config: SELECTIE }]);
  sb.seed("meta_account_daily", metaRijen);
  sb.seed("microsoft_account_daily", microsoftRijen);
  sb.seed("client_targets", [
    { client_id: "klant-t", channel: "meta_ads", metric: "conversions", target_value: DOEL_META, valid_from: `${JAAR}-01-01`, valid_to: null },
  ]);
  return sb;
}

// ── Nep-fetch: de route en /api/data, met een telling per pad ────────────────────────────────
const verzoeken: Record<string, number> = {};
const ANTWOORD: Record<string, unknown> = {};
// Staat hier een lijst, dan wacht de route tot de test hem loslaat: zo is "de route laadt nog" een
// toestand die de test zelf vasthoudt, en niet een kwestie van op tijd kijken.
let vastgehouden: (() => void)[] | null = null;
globalThis.fetch = (async (url: string) => {
  const pad = String(url).split("?")[0];
  verzoeken[pad] = (verzoeken[pad] ?? 0) + 1;
  const json = (lichaam: unknown) => ({ ok: true, status: 200, json: async () => lichaam }) as Response;
  if (pad === "/api/blended/client-data") {
    const klant = decodeURIComponent(String(url).split("clientId=")[1] ?? "");
    if (vastgehouden) await new Promise<void>((los) => vastgehouden!.push(los));
    return json(ANTWOORD[klant] ?? { error: `Geen blended data voor "${klant}"` });
  }
  if (pad === "/api/data/client_settings") return json({ data: { client_id: "klant-t", channel_conversion_config: SELECTIE } });
  return json({ data: [] });
}) as typeof fetch;

const rust = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** Wacht tot de voorwaarde waar is (hooguit vijf seconden): geen vaste pauze die op een drukke
 *  machine te kort is. Geeft terug of het gelukt is. */
async function tot(voorwaarde: () => boolean, ms = 5000): Promise<boolean> {
  const eind = Date.now() + ms;
  while (!voorwaarde() && Date.now() < eind) await rust(10);
  return voorwaarde();
}

async function main() {
  const React = await import("react");
  const { createElement } = React;
  const { createRoot } = await import("react-dom/client");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { useBlendedClientData } = await import("./use-blended-client-data");
  const { ChannelDataProvider, KanaalDataContext, useKanaalData } = await import("../components/dashboard/channel-data-provider");
  const { ChannelPerformance, volleMaandenUitTellers, eur, fmt } = await import("../components/dashboard/channel-performance");
  const { ChannelHealthBadge } = await import("../components/dashboard/channel-health-badge");
  const { ChannelPacing } = await import("../components/dashboard/channel-pacing");
  const { KanaalHealthRanking, kanaalScores } = await import("../components/dashboard/kanaal-health-ranking");
  type KanaalData = ReturnType<typeof useKanaalData>;
  type Route = ReturnType<typeof useBlendedClientData>;

  const tekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(el).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Het antwoord van de route, door JSON heen zoals over de lijn. "klant-oud" is hetzelfde
  // antwoord waarin Microsoft geen emmers draagt (een antwoord van vóór dat veld).
  const uitkomst = await fetchBlendedHistoricalData(nepDatabase() as unknown as SupabaseClient, "klant-t", VANDAAG);
  check("voorwaarde: de route geeft Meta en Microsoft met emmers, LinkedIn niet",
    !!uitkomst && uitkomst.perKanaal.map((k) => k.kanaal).join() === "meta,microsoft" && uitkomst.perKanaal.every((k) => !!k.emmers),
    JSON.stringify(uitkomst?.perKanaal.map((k) => [k.kanaal, !!k.emmers])));
  if (!uitkomst) throw new Error("de route gaf niets terug");
  ANTWOORD["klant-t"] = JSON.parse(JSON.stringify(uitkomst));
  ANTWOORD["klant-oud"] = JSON.parse(JSON.stringify({
    ...uitkomst,
    perKanaal: uitkomst.perKanaal.map((k) => (k.kanaal === "microsoft" ? { kanaal: k.kanaal, vanaf: k.vanaf, maanden: k.maanden } : k)),
  }));

  // ── (b) Badge en ranking: hetzelfde object ─────────────────────────────────────────────────
  console.log("(b) De badge op de tab en de ranking op Alle kanalen lezen hetzelfde tab-object");
  let tab: KanaalData | null = null;
  let ranking: Route | null = null;
  function VangTab() { tab = useKanaalData(); return null; }
  function VangRanking({ clientId }: { clientId: string }) { ranking = useBlendedClientData(clientId, true); return null; }
  const leesTab = () => tab as KanaalData | null;
  const leesRanking = () => ranking as Route | null;
  {
    vastgehouden = [];
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(React.Fragment, null,
      createElement(ChannelDataProvider, { clientId: "klant-t", channel: "meta", children: createElement(VangTab) }),
      createElement(VangRanking, { clientId: "klant-t" }),
    ));
    // De route is gevraagd en de selectie is binnen, maar het antwoord van de route nog niet.
    await tot(() => (vastgehouden?.length ?? 0) > 0 && (verzoeken["/api/data/client_settings"] ?? 0) > 0);
    await rust(60);
    check("zolang de route laadt: de tab laadt (forecast null), geen 'leeg'",
      leesTab()?.forecast === null && leesTab()?.rijen === null && leesRanking()?.loading === true, JSON.stringify([leesTab()?.forecast, leesRanking()?.loading]));
    const los = vastgehouden; vastgehouden = null;
    for (const f of los) f();
    check("de tab en de ranking krijgen het antwoord", await tot(() => leesTab()?.forecast != null && leesRanking()?.loading === false));
    check("één verzoek aan de route voor de tab en de ranking samen", verzoeken["/api/blended/client-data"] === 1, String(verzoeken["/api/blended/client-data"]));
    check("de tab vraagt zelf geen dagtabel, geen client_targets en geen prognoseroute meer",
      !Object.keys(verzoeken).some((p) => /_account_daily|client_targets|channel-forecast/.test(p)), JSON.stringify(verzoeken));

    const opTab = leesTab()?.forecast;
    const inRanking = leesRanking()?.perKanaalTab?.meta;
    check("de tab heeft een tab-object voor Meta", !!opTab && opTab !== "leeg", JSON.stringify(opTab === "leeg" ? opTab : !!opTab));
    check("identiteit: de tab en de ranking lezen HETZELFDE object", !!opTab && opTab === inRanking);
    if (opTab && opTab !== "leeg" && inRanking && inRanking !== "leeg") {
      const scores = kanaalScores(["meta", "linkedin", "microsoft"], null, leesRanking()!);
      const metaRij = scores.rijen.find((r) => r.kanaal === "meta");
      check("de score in de ranking IS de score van de badge (hetzelfde HealthScore-object)", metaRij?.health === opTab.health);
      check("Microsoft staat nu ook in de ranking (de oude route gaf er nooit iets voor terug)", scores.rijen.some((r) => r.kanaal === "microsoft"));
      check("LinkedIn (geen rijen bij de route): niet beoordeeld, niet weggelaten en niet 'laden'",
        scores.nietBeoordeeld.join() === "linkedin" && scores.laden.length === 0, JSON.stringify(scores));
      check("de health is zonder Google's hygiëne (niet beoordeeld voor dit kanaal)",
        opTab.health.factors.find((f) => f.name === "Hygiëne")?.assessed === false);

      // Wat er in beeld komt: dezelfde score op beide schermen.
      const badge = tekst(createElement(KanaalDataContext.Provider, { value: leesTab()! }, createElement(ChannelHealthBadge, { clientId: "klant-t", channel: "meta" })));
      const kaart = tekst(createElement(KanaalHealthRanking, { clientId: "klant-t", kanalen: ["meta", "linkedin", "microsoft"] }));
      const cijfer = opTab.health.grade === "?" ? "—" : String(opTab.health.total);
      check("de badge toont die score", badge.includes("Account Health") && badge.includes(cijfer), badge.slice(0, 200));
      check("de ranking toont Meta met die score", new RegExp(`Meta ${cijfer}\\b`).test(kaart), kaart.slice(0, 300));
      check("de ranking noemt LinkedIn 'niet beoordeeld' met de reden", /LinkedIn niet beoordeeld: geen dagcijfers/.test(kaart), kaart.slice(0, 600));

      // Het object is wat de tab altijd rekende: buildChannelForecast op de dagrijen met de selectie
      // van de klant, het client_targets-doel en de stand van de route (tabStandUitRoute).
      const { dataTot, gestopt } = tabStandUitRoute(uitkomst.dataStand, "meta");
      const verwacht = buildChannelForecast(
        "klant-t",
        metaRijen.map((r) => ({ date: String(r.date), spend: Number(r.spend), revenue: Number(r.conversion_value), conv: Number(r.leads) })),
        [{ channel: "meta_ads", metric: "conversions", targetValue: DOEL_META, validFrom: `${JAAR}-01-01`, validTo: null }],
        "meta_ads", VANDAAG, dataTot, { gestopt },
      );
      check("het jaardoel komt uit client_targets", opTab.forecast.conversions.kpi.annualTarget === DOEL_META, String(opTab.forecast.conversions.kpi.annualTarget));
      check("dezelfde prognose als de tab uit zijn eigen dagrijen rekende (selectie, doel, datastand)",
        !!verwacht && JSON.stringify(opTab.forecast) === JSON.stringify(verwacht.forecast),
        JSON.stringify([opTab.forecast.conversions.kpi.adjustedAnnual, verwacht?.forecast.conversions.kpi.adjustedAnnual]));
    }

    // Laden is iets anders dan geen score.
    const onderweg = kanaalScores(["google", "meta"], null, { perKanaalTab: null, loading: true });
    check("zolang de route laadt: 'laden', niet 'niet beoordeeld'", onderweg.laden.join() === "meta" && onderweg.nietBeoordeeld.join() === "google", JSON.stringify(onderweg));
    root.unmount();
  }

  console.log("(b) Een kanaal zonder emmers: 'leeg', geen score, geen crash");
  {
    tab = null; ranking = null;
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(React.Fragment, null,
      createElement(ChannelDataProvider, { clientId: "klant-oud", channel: "microsoft", children: createElement(VangTab) }),
      createElement(VangRanking, { clientId: "klant-oud" }),
    ));
    check("het antwoord komt binnen", await tot(() => leesTab()?.forecast != null && leesRanking()?.loading === false));
    check("de hook zet 'leeg' voor het kanaal zonder emmers", leesRanking()?.perKanaalTab?.microsoft === "leeg", JSON.stringify(leesRanking()?.perKanaalTab?.microsoft === "leeg"));
    check("de tab toont 'leeg' (geen dagcijfers), niet eeuwig laden", leesTab()?.forecast === "leeg");
    const scores = kanaalScores(["meta", "microsoft"], null, leesRanking()!);
    check("de ranking: Microsoft niet beoordeeld, Meta gewoon met score",
      scores.nietBeoordeeld.join() === "microsoft" && scores.rijen.map((r) => r.kanaal).join() === "meta", JSON.stringify(scores));
    const badge = renderToStaticMarkup(createElement(KanaalDataContext.Provider, { value: leesTab()! }, createElement(ChannelHealthBadge, { clientId: "klant-oud", channel: "microsoft" })));
    check("de badge rendert dan niets (geen score om te tonen)", badge === "", badge.slice(0, 80));
    root.unmount();
  }

  // ── (c) De maandtabel op de tab == de tellers van perKanaal ────────────────────────────────
  console.log("(c) De maandtabel op de tab telt de tellers van perKanaal, met de selectie van de klant");
  {
    tab = null; ranking = null;
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(React.Fragment, null,
      createElement(ChannelDataProvider, { clientId: "klant-t", channel: "meta", children: createElement(VangTab) }),
      createElement(VangRanking, { clientId: "klant-t" }),
    ));
    check("het antwoord komt binnen", await tot(() => leesTab()?.rijen != null && leesRanking()?.loading === false));
    const data = leesTab();
    const reeks = leesRanking()?.perKanaal?.find((k) => k.kanaal === "meta");
    check("de tab draagt de maanden van perKanaal: hetzelfde object als op Alle kanalen", !!data?.maanden && data.maanden === reeks?.maanden);

    // Onafhankelijk nageteld uit de dagrijen: de zes laatste volle maanden, leads als conversie.
    const perMaand = new Map<string, { impressions: number; clicks: number; spend: number; conv: number }>();
    for (const r of metaRijen) {
      const m = String(r.date).slice(0, 7);
      const a = perMaand.get(m) ?? { impressions: 0, clicks: 0, spend: 0, conv: 0 };
      a.impressions += Number(r.impressions); a.clicks += Number(r.link_clicks); a.spend += Number(r.spend); a.conv += Number(r.leads);
      perMaand.set(m, a);
    }
    const verwacht = [...perMaand.entries()].filter(([m]) => m < DEZE_MAAND).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    const tabel = volleMaandenUitTellers(data?.maanden ?? [], DEZE_MAAND);
    check("zes volle maanden, de lopende maand niet", tabel.length === 6 && tabel.every(([m]) => m < DEZE_MAAND), JSON.stringify(tabel.map(([m]) => m)));
    check("de tellers per maand zijn de dagrijen met de selectie van de klant (leads), niet de standaard",
      JSON.stringify(tabel) === JSON.stringify(verwacht), JSON.stringify([tabel[0], verwacht[0]]));

    // En zo staat het op het scherm: elke maand met zijn vier optelbare cijfers.
    const scherm = data ? tekst(createElement(KanaalDataContext.Provider, { value: data }, createElement(ChannelPerformance, { clientId: "klant-t", channel: "meta" }))) : "";
    // `tekst` maakt van elke witruimte één spatie, ook van de harde spatie na het euroteken.
    // Een rij is: spend, vertoningen, klikken, CTR (een verhouding, hier niet nageteld), conversies.
    const plat = (s: string) => s.replace(/\s+/g, " ");
    const cijfers = (a: { impressions: number; clicks: number; spend: number; conv: number }) =>
      `${plat(eur(a.spend))} ${fmt(a.impressions)} ${fmt(a.clicks)} % ${fmt(a.conv, 1)} `;
    const tabelTekst = scherm.slice(scherm.indexOf("Per maand")).replace(/ [\d,]+% /g, " % ");
    const plekken = verwacht.map(([, a]) => tabelTekst.indexOf(cijfers(a)));
    check("de maandtabel toont die tellers, per maand op één rij", scherm.includes("Per maand") && plekken.every((p) => p >= 0),
      `${JSON.stringify(verwacht.map(([m, a], i) => [m, plekken[i], cijfers(a)]))} | ${tabelTekst.slice(0, 400)}`);
    check("nieuwste maand bovenaan", plekken.every((p, i) => i === 0 || p < plekken[i - 1]), JSON.stringify(plekken));
    check("de kolomkop noemt de selectie van de klant", scherm.includes("Leads") && !scherm.includes("Aankopen / conversies"), scherm.slice(0, 200));

    // De recente dagen dekken de pacing en de 28-dagenvensters, niet de hele historie.
    check("de dagrijen op de tab zijn alleen de recente (hooguit ~2 maanden), de historie zit in de maanden",
      !!data?.rijen && data.rijen.length > 0 && data.rijen.length <= 62 && data.maanden!.length >= 17, `${data?.rijen?.length} / ${data?.maanden?.length}`);

    // De pacing houdt zijn kaart als er geen recente dagen zijn (de demo: data t/m 26 augustus).
    const pacing = data ? tekst(createElement(KanaalDataContext.Provider, { value: { ...data, rijen: [] } }, createElement(ChannelPacing, {}))) : "";
    check("zonder recente dagen: de pacing-kaart staat er, met 'Geen vorige maand'", pacing.includes("Pacing") && pacing.includes("Geen vorige maand"), pacing.slice(0, 200));
    root.unmount();
  }

  console.log("(c) De campagnedagrijen en -namen alleen met een gekozen beurs");
  {
    for (const k of Object.keys(verzoeken)) delete verzoeken[k];
    // VangTab ernaast: zo weet de test wanneer de maandprestaties hun data hebben.
    const mount = (geoClone: string | null) => {
      tab = null;
      const root = createRoot(doc.createElement() as unknown as Element);
      root.render(createElement(ChannelDataProvider, { clientId: "klant-t", channel: "meta", children: createElement(React.Fragment, null,
        createElement(VangTab), createElement(ChannelPerformance, { clientId: "klant-t", channel: "meta", geoClone })) }));
      return root;
    };
    const zonder = mount(null);
    check("voorwaarde: de maandprestaties hebben hun data", await tot(() => leesTab()?.rijen != null));
    await rust(80);
    check("zonder beurs: geen enkele lezing van de campagnetabellen (en de route uit de cache)",
      Object.keys(verzoeken).every((p) => p === "/api/data/client_settings"), JSON.stringify(verzoeken));
    zonder.unmount();
    const met = mount("XYZ");
    await tot(() => (verzoeken["/api/data/meta_campaign_daily"] ?? 0) > 0 && (verzoeken["/api/data/meta_campaigns"] ?? 0) > 0);
    await rust(80);
    check("met een beurs: één keer de campagnedagrijen en één keer de namen",
      verzoeken["/api/data/meta_campaign_daily"] === 1 && verzoeken["/api/data/meta_campaigns"] === 1 && !("/api/data/meta_account_daily" in verzoeken), JSON.stringify(verzoeken));
    met.unmount();
  }

  // ── Bron: de oude hook en zijn route zijn weg ──────────────────────────────────────────────
  console.log("Bron: niets importeert de oude prognosehook, en hij en zijn route bestaan niet meer");
  {
    const wortel = join(import.meta.dirname, "..");
    // In stukken, zodat deze test zichzelf niet vindt.
    const naam = ["use", "channel", "forecast"].join("-");
    const route = ["api", "analysis", "channel-forecast"].join("/");
    // De IMPORTREGEL, niet de functienaam: forecast-table.tsx heeft een lokale functie die toevallig
    // net zo heet als de export van de oude hook.
    const importRegel = new RegExp(`from\\s+["'][^"']*/${naam}["']|import\\(\\s*["'][^"']*/${naam}["']`);
    const bestanden: string[] = [];
    const loop = (map: string) => {
      for (const e of readdirSync(map, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const pad = join(map, e.name);
        if (e.isDirectory()) loop(pad);
        else if (/\.(ts|tsx|mjs)$/.test(e.name)) bestanden.push(pad);
      }
    };
    for (const map of ["app", "components", "lib", "scripts"]) if (existsSync(join(wortel, map))) loop(join(wortel, map));
    check("voorwaarde: de bron is gevonden", bestanden.length > 200, String(bestanden.length));
    const importeurs = bestanden.filter((p) => importRegel.test(readFileSync(p, "utf8")));
    check("geen enkel bestand importeert de oude hook", importeurs.length === 0, importeurs.join(", "));
    const vragers = bestanden.filter((p) => new RegExp(`fetch\\([^)]*/${route}`).test(readFileSync(p, "utf8")));
    check("geen enkel bestand vraagt de oude route nog op", vragers.length === 0, vragers.join(", "));
    check("de hook bestaat niet meer", !existsSync(join(wortel, "lib", "analysis", `${naam}.ts`)));
    check("de route bestaat niet meer", !existsSync(join(wortel, "app", ...route.split("/"), "route.ts")));
    // compute-targets blijft: de rapporten en Code Rood rekenen ermee.
    check("lib/analysis/compute-targets.ts blijft (rapporten, Code Rood)", existsSync(join(wortel, "lib", "analysis", "compute-targets.ts")));

    const provider = readFileSync(join(wortel, "components/dashboard/channel-data-provider.tsx"), "utf8");
    check("de provider haalt zelf geen tabellen meer op", !/dbSelect|\bfetch\(/.test(provider));
    const badge = readFileSync(join(wortel, "components/dashboard/channel-health-badge.tsx"), "utf8");
    check("de badge leest de provider en rekent zelf geen score", /useKanaalData\(\)/.test(badge) && !/computeHealthScore\(/.test(badge));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

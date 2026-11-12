// De kanaalring (CampaignTypeSplit, tabblad Kanaal) doet geen eigen lezing meer.
// Draaien: tsx --tsconfig ./tsconfig.json lib/__kanaalring_bron_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De ring las blended_account_monthly, naast de lezing die het tabblad "Alle kanalen" eromheen al
// deed: twee verzoeken bij elk bezoek, en een ring die de standaardselectie van conversies telde
// en Microsoft niet kende. Nu krijgt hij de maandrijen per kanaal mee (dezelfde rijen als de
// kanaaltabel), of leest hij ze, op de Google-weergave, uit de gedeelde blended historie.
//
// Wat hier vastligt, met het ECHTE component (react-dom/client op een nep-DOM):
// - met `kanaalRijen` doet de kaart geen enkel verzoek en staat de ring er in de eerste render;
// - hij volgt de gekozen periode (bewust aangepast in fase 2; hij koos eerst zelf een venster van
//   ongeveer 90 dagen en stond stil als de periode verzet werd): een maand van vóór de periode
//   telt niet mee in het totaal, de lopende maand ook niet, en een kortere periode geeft een
//   kleiner totaal zonder verzoek;
// - Microsoft staat in de ring;
// - `kanaalRijen={null}` (de aanroeper laadt nog) is een laadvlak, geen lege ring en geen verzoek;
// - zonder `kanaalRijen` en met Kanaal als enige tabblad leest hij de gedeelde historie
//   (/api/blended/client-data), niet de view;
// - op het starttabblad Campagnetype (de Google-weergave) doet hij alleen zijn eigen lezing van
//   ads_campaign_monthly: de historie wordt pas gevraagd als iemand Kanaal kiest.

import { addMonths } from "./period/period-range";
import { today } from "./reporting-date";
import type { KanaalMaandRij } from "./cross-channel/kanaal-maandrijen";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// ── Nep-DOM: wat createRoot nodig heeft; moet er staan VOORDAT react-dom geladen wordt ───────
// De knopen onthouden hun tekst, zodat te zien is wat de kaart toont.
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
  createElement: (): unknown => null, createElementNS: (): unknown => null,
  createTextNode: (t: string) => { if (t) teksten.push(String(t)); return Object.assign(knoop(3), { ownerDocument: doc }); },
};
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

// ── De rijen ─────────────────────────────────────────────────────────────────────────────────
// De standaardperiode is de laatste twaalf VOLLE maanden: VORIGE (de laatste volle maand) en de
// maand vijf terug liggen erin; de lopende maand en een maand van dertien terug niet. Onder
// "laatste 3 maanden" valt ook de maand van vijf terug weg.
const DEZE = today().slice(0, 7);
const VORIGE = addMonths(DEZE, -1);
const VIJF_TERUG = addMonths(DEZE, -5);
const VOOR_PERIODE = addMonths(DEZE, -13);
const rij = (maand: string, channel: KanaalMaandRij["channel"], spend: number, conversions: number): KanaalMaandRij =>
  ({ month: `${maand}-01`, channel, impressions: spend * 10, clicks: spend, spend, conversions, conversion_value: 0 });
const RIJEN: KanaalMaandRij[] = [
  rij(DEZE, "google_ads", 7000, 70),
  rij(VORIGE, "google_ads", 600, 30), rij(VORIGE, "meta_ads", 250, 10), rij(VORIGE, "microsoft_ads", 150, 5),
  rij(VIJF_TERUG, "google_ads", 430, 20),
  rij(VOOR_PERIODE, "google_ads", 90000, 900),
];
const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const IN_VENSTER = 600 + 250 + 150 + 430;
// Dit bedrag komt in de weergave over twaalf maanden nergens voor (het totaal is daar 1.430, Google
// alleen 1.030): staat het er, dan heeft de ring de kortere periode overgenomen.
const IN_DRIE_MAANDEN = 600 + 250 + 150;

// ── Nep-fetch: telt per pad ──────────────────────────────────────────────────────────────────
const verzoeken: Record<string, number> = {};
const geteld = (pad: string) => verzoeken[pad] ?? 0;
const totaal = () => Object.values(verzoeken).reduce((s, n) => s + n, 0);
const JAAR = Number(DEZE.slice(0, 4));
const ROUTE = {
  currentYear: JAAR,
  realizedThroughMonth: 0,
  targetCurrentYear: { conversions: 100, revenue: 0, adSpend: 1000 },
  historicalYears: [],
  currentYearMonthly: [],
  dataStand: null,
  perKanaal: [
    { kanaal: "google", vanaf: null, maanden: [{ month: VORIGE, conversions: 30, revenue: 0, adSpend: 600, impressions: 6000, clicks: 600 }] },
    { kanaal: "linkedin", vanaf: VORIGE, maanden: [{ month: VORIGE, conversions: 4, revenue: 0, adSpend: 200, impressions: 2000, clicks: 200 }] },
  ],
  clientTargets: [],
};
globalThis.fetch = (async (url: string) => {
  const pad = String(url).split("?")[0];
  verzoeken[pad] = (verzoeken[pad] ?? 0) + 1;
  const json = (lichaam: unknown) => new Response(JSON.stringify(lichaam), { status: 200, headers: { "content-type": "application/json" } });
  if (pad === "/api/blended/client-data") return json(ROUTE);
  if (pad === "/api/data/client_settings") return json({ data: null });
  if (pad === "/api/data/ads_campaign_monthly") {
    return json({ data: [{ month: `${DEZE}-01`, campaign_type: "SEARCH", campaign_name: "Merk", cost: 500, conversions: 25, conversions_value: 0, impressions: 5000, clicks: 400 }] });
  }
  return json({ data: [] });
}) as typeof fetch;

const rust = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function tot(voorwaarde: () => boolean, ms = 3000): Promise<boolean> {
  const eind = Date.now() + ms;
  while (!voorwaarde() && Date.now() < eind) await rust(10);
  return voorwaarde();
}

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { CampaignTypeSplit } = await import("../components/dashboard/campaign-type-split");
  const maakRoot = () => createRoot(doc.createElement() as unknown as Element);

  console.log("Met kanaalRijen: geen verzoek, en de ring staat er in de eerste render");
  {
    wisTeksten();
    const root = maakRoot();
    // flushSync: alleen de eerste render, vóórdat er een effect of een antwoord tussen kan komen.
    flushSync(() => root.render(createElement(CampaignTypeSplit, { clientId: "klant-r", toon: ["kanaal"], kanaalRijen: RIJEN })));
    check("de ring staat er meteen, met de kanalen bij naam", getoond("Spend per kanaal") && getoond("Google Ads") && getoond("Meta"), teksten.slice(0, 12).join(" | "));
    check("Microsoft staat in de ring", getoond("Microsoft Ads"), teksten.join(" | "));
    check("geen laadtekst", !getoond("wordt geladen") && !getoond("Bezig met laden"), teksten.join(" | "));
    check("het totaal telt alleen de maanden van de periode", getoond(eur(IN_VENSTER)) && !getoond(eur(IN_VENSTER + 90000)), teksten.filter((t) => t.includes("€")).join(" | "));
    check("de lopende maand telt niet mee: de periode eindigt op de laatste volle maand", !getoond(eur(IN_VENSTER + 7000)), teksten.filter((t) => t.includes("€")).join(" | "));
    check("de kop zegt dat de ring de periode volgt", teksten.some((t) => t.startsWith("volgt periode")), teksten.slice(0, 6).join(" | "));
    await rust(50);
    check("geen enkel verzoek", totaal() === 0, JSON.stringify(verzoeken));
    root.unmount();
    await rust();
  }

  console.log("De ring volgt de gekozen periode, zonder verzoek");
  {
    // De echte PeriodProvider, met "laatste 3 maanden" als bewaarde keuze: die komt in een effect
    // binnen, dus de ring staat eerst op twaalf maanden en schuift dan. Wachten op die toestand,
    // niet op een tijd.
    const { PeriodProvider } = await import("./period/period-context");
    opslag.set("rm-periode-ring", JSON.stringify({ preset: "last_3m", custom: null, comparison: "none" }));
    wisTeksten();
    const root = maakRoot();
    root.render(createElement(PeriodProvider, {
      scope: "ring",
      children: createElement(CampaignTypeSplit, { clientId: "klant-r", toon: ["kanaal"], kanaalRijen: RIJEN }),
    }));
    const geschoven = await tot(() => getoond(eur(IN_DRIE_MAANDEN)));
    check("onder 'laatste 3 maanden' valt de maand van vijf terug weg", geschoven, teksten.filter((t) => t.includes("€")).join(" | "));
    check("nog steeds geen enkel verzoek", totaal() === 0, JSON.stringify(verzoeken));
    root.unmount();
    opslag.delete("rm-periode-ring");
    await rust();
  }

  console.log("kanaalRijen = null: de aanroeper laadt nog");
  {
    wisTeksten();
    const root = maakRoot();
    flushSync(() => root.render(createElement(CampaignTypeSplit, { clientId: "klant-r", toon: ["kanaal"], kanaalRijen: null })));
    check("een laadvlak, geen ring", getoond("wordt geladen") && !getoond("Google Ads"), teksten.join(" | "));
    await rust(50);
    check("en nog steeds geen verzoek", totaal() === 0, JSON.stringify(verzoeken));
    root.unmount();
    await rust();
  }

  console.log("Zonder kanaalRijen, alleen het tabblad Kanaal: de gedeelde historie, niet de view");
  {
    wisTeksten();
    const root = maakRoot();
    root.render(createElement(CampaignTypeSplit, { clientId: "klant-h", toon: ["kanaal"] }));
    const klaar = await tot(() => getoond("LinkedIn"));
    check("de ring toont de kanalen uit perKanaal", klaar && getoond("Google Ads"), teksten.slice(-12).join(" | "));
    check("één lezing van /api/blended/client-data", geteld("/api/blended/client-data") === 1, JSON.stringify(verzoeken));
    check("geen lezing van blended_account_monthly of ads_campaign_monthly",
      geteld("/api/data/blended_account_monthly") === 0 && geteld("/api/data/ads_campaign_monthly") === 0, JSON.stringify(verzoeken));
    root.unmount();
    await rust();

    // Een tweede kaart voor dezelfde klant leest de cache van de hook: geen verzoek erbij.
    const terug = maakRoot();
    wisTeksten();
    flushSync(() => terug.render(createElement(CampaignTypeSplit, { clientId: "klant-h", toon: ["kanaal"] })));
    check("een tweede bezoek: de ring staat er meteen", getoond("LinkedIn"), teksten.join(" | "));
    await rust(50);
    check("zonder nieuw verzoek aan de route", geteld("/api/blended/client-data") === 1, JSON.stringify(verzoeken));
    terug.unmount();
    await rust();
  }

  console.log("De Google-weergave (starttabblad Campagnetype): alleen de eigen lezing");
  {
    const voor = geteld("/api/blended/client-data");
    wisTeksten();
    const root = maakRoot();
    root.render(createElement(CampaignTypeSplit, { clientId: "klant-g" }));
    const klaar = await tot(() => getoond("Search"));
    check("de ring per campagnetype staat er", klaar && getoond("Spend per campagnetype"), teksten.slice(-12).join(" | "));
    check("één lezing van ads_campaign_monthly", geteld("/api/data/ads_campaign_monthly") === 1, JSON.stringify(verzoeken));
    check("de historie wordt niet gevraagd zolang niemand Kanaal kiest", geteld("/api/blended/client-data") === voor, JSON.stringify(verzoeken));
    check("en de view nooit", geteld("/api/data/blended_account_monthly") === 0, JSON.stringify(verzoeken));
    root.unmount();
    await rust();
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

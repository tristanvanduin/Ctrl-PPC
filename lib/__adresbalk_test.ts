// Het kanaal en de periode in de adresbalk (bouwplan fase 2).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__adresbalk_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De kanaalkeuze was React-state en de periode stond alleen in localStorage: een herlaad sprong
// terug naar "Alle kanalen", en een link naar "Meta over de laatste drie maanden" bestond niet.
// Nu staan beide in de adresbalk. Wat hier vastligt:
//
// - de rondreis: wat geschreven wordt, komt er bij een herlaad precies zo weer uit, voor het
//   kanaal en voor elke periodekeuze (presets, een eigen bereik, elke vergelijking);
// - de terugval: een kanaal dat niet bestaat of dat deze klant niet heeft valt terug zoals
//   geldigeKeuze dat bij een klik doet, en het adres wordt rechtgezet;
// - ?geo= en ?demo= blijven staan, wat er ook geschreven wordt;
// - en andersom: een beurs kiezen in de zijbalk (een echte link, geen pushState) neemt het
//   kanaal, de periode, de vergelijking en ?demo= mee. Die link was een vast
//   `/client/<id>?geo=<afk>`; sinds de adresbalk de bron is, gooide hij daarmee de kanaalkeuze weg;
// - de wissel is history.pushState of replaceState, geen navigatie (en dus geen serverwerk);
// - de hook erachter (useUrlKeuze) zet de keuze meteen, neemt een verandering van buiten over
//   (Terug, een link) en negeert de verouderde echo van een eigen eerdere klik;
// - de PeriodProvider: de adresbalk gaat voor de bewaarde keuze, een keuze komt in de adresbalk,
//   en zonder koppeling (het portfolio) verandert er niets.
//
// De hook en de provider worden echt gemount (react-dom/client op een nep-DOM). Het klantdashboard
// is te groot om te mounten; daar leest de test de bron, als vangnet voor de bedrading.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KANAAL_PARAM, kanaalUitUrl, kanaalkeuzeUitUrl, kanaalParamRechtgezet, geldigeKeuze, type Kanaal,
} from "./kanalen/beschikbaar";
import { PERIODE_PARAM, VERGELIJK_PARAM, periodeUitParams, zetPeriodeParams, schonePeriodeKeuze } from "./period/periode-url";
import { PERIOD_PRESETS, COMPARISON_MODES, type PeriodeKeuze } from "./period/period-range";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-browser: een adresbalk met geschiedenis, en genoeg DOM voor createRoot ────────────────
// Moet er staan VOORDAT react-dom geladen wordt.
const noop = () => {};
function knoop(nodeType: number) {
  return {
    nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
    style: { setProperty: noop } as Record<string, unknown>, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
    textContent: "", nodeValue: "",
  };
}
const doc = {
  ...knoop(9), activeElement: null, cookie: "",
  createElement: (): unknown => null, createElementNS: (): unknown => null,
  createTextNode: () => Object.assign(knoop(3), { ownerDocument: doc }),
};
doc.createElement = () => Object.assign(knoop(1), { ownerDocument: doc });
doc.createElementNS = () => Object.assign(knoop(1), { ownerDocument: doc });

const adres = { pathname: "/client/demo-greentech", search: "", hash: "" };
const geschiedenis: { hoe: "push" | "replace"; url: string }[] = [];
function zetAdres(hoe: "push" | "replace", url: string): void {
  geschiedenis.push({ hoe, url });
  const [pad, zoek = ""] = url.split("?");
  adres.pathname = pad;
  adres.search = zoek ? `?${zoek}` : "";
}
const opslag = new Map<string, string>();
let opslagSchrijfacties = 0;
const localStorage = {
  getItem: (k: string) => opslag.get(k) ?? null,
  setItem: (k: string, v: string) => { opslag.set(k, v); opslagSchrijfacties += 1; },
  removeItem: (k: string) => { opslag.delete(k); },
};
Object.assign(globalThis, {
  window: {
    document: doc, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, getSelection: () => null,
    HTMLIFrameElement: class {}, localStorage, location: adres,
    history: {
      pushState: (_s: unknown, _t: string, url: string) => zetAdres("push", url),
      replaceState: (_s: unknown, _t: string, url: string) => zetAdres("replace", url),
    },
  },
  document: doc,
  localStorage,
});

const rust = (ms = 10) => new Promise((r) => setTimeout(r, ms));
/** Wacht op een toestand, nooit op een vaste tijd; geeft terug of hij bereikt is. */
async function tot(voorwaarde: () => boolean, ms = 3000): Promise<boolean> {
  const eind = Date.now() + ms;
  while (!voorwaarde() && Date.now() < eind) await rust();
  return voorwaarde();
}

async function main() {
  const { leesAdresbalk, schrijfAdresbalk, useUrlKeuze, beursAdres, GEO_PARAM } = await import("./adresbalk");

  // ── Het kanaal: lezen, terugvallen, rechtzetten ──────────────────────────────────────────────
  console.log("Het kanaal uit ?kanaal=");
  {
    const alle: Kanaal[] = ["google", "meta", "linkedin", "microsoft"];
    check("een bestaand kanaal wordt gelezen", alle.every((k) => kanaalUitUrl(k) === k));
    check("niets, leeg of onzin is geen kanaal", kanaalUitUrl(null) === null && kanaalUitUrl("") === null
      && kanaalUitUrl("tiktok") === null && kanaalUitUrl("blended") === null && kanaalUitUrl("META") === null);

    const drie: Kanaal[] = ["google", "meta", "linkedin"];
    check("een kanaal dat de klant heeft, wordt getoond", kanaalkeuzeUitUrl("meta", drie) === "meta");
    check("zonder kanaal: Alle kanalen", kanaalkeuzeUitUrl(null, drie) === "blended");
    check("een kanaal dat de klant NIET heeft valt terug op Alle kanalen", kanaalkeuzeUitUrl("microsoft", drie) === "blended");
    check("een klant met één kanaal toont dat kanaal, wat er ook staat",
      kanaalkeuzeUitUrl("meta", ["google"]) === "google" && kanaalkeuzeUitUrl(null, ["linkedin"]) === "linkedin");
    check("een klant zonder kanalen: Alle kanalen (de lege staat)", kanaalkeuzeUitUrl("meta", []) === "blended");
    // Dezelfde regel als bij een klik: de terugval is geldigeKeuze, geen tweede variant ervan.
    const gevallen: (Kanaal | null)[] = [null, ...alle];
    const lijsten: Kanaal[][] = [[], ["google"], ["meta"], drie, alle, ["google", "microsoft"]];
    check("de terugval is voor elke combinatie precies geldigeKeuze",
      lijsten.every((l) => gevallen.every((u) => kanaalkeuzeUitUrl(u, l) === geldigeKeuze(u ?? "blended", l))));
    check("zolang de kanalen onbekend zijn geldt het adres zoals het er staat (geen flits van Alle kanalen)",
      kanaalkeuzeUitUrl("meta", null) === "meta" && kanaalkeuzeUitUrl(null, null) === "blended");

    check("rechtzetten: een geldig kanaal blijft staan", kanaalParamRechtgezet("meta", drie) === "meta");
    check("rechtzetten: een onbekend kanaal gaat weg", kanaalParamRechtgezet("tiktok", drie) === null);
    check("rechtzetten: een kanaal dat de klant niet heeft gaat weg", kanaalParamRechtgezet("microsoft", drie) === null);
    check("rechtzetten: bij één kanaal is er geen kiezer en dus geen parameter", kanaalParamRechtgezet("google", ["google"]) === null);
  }

  // ── De adresbalk schrijven ───────────────────────────────────────────────────────────────────
  console.log("schrijfAdresbalk: de rest blijft staan, en het is geen navigatie");
  {
    adres.search = "?demo=1&geo=GRT";
    geschiedenis.length = 0;
    schrijfAdresbalk((p) => p.set(KANAAL_PARAM, "meta"), "push");
    const p = leesAdresbalk();
    check("het kanaal staat erin", p.get(KANAAL_PARAM) === "meta", adres.search);
    check("?demo= en ?geo= staan er nog", p.get("demo") === "1" && p.get("geo") === "GRT", adres.search);
    check("als pushState, op hetzelfde pad", geschiedenis.length === 1 && geschiedenis[0].hoe === "push"
      && geschiedenis[0].url.startsWith("/client/demo-greentech?"), JSON.stringify(geschiedenis));

    // De rondreis: wat er nu staat is wat een herlaad leest.
    check("herlaad: hetzelfde kanaal", kanaalkeuzeUitUrl(kanaalUitUrl(new URLSearchParams(adres.search).get(KANAAL_PARAM)), ["google", "meta"]) === "meta");
    check("herlaad bij een klant zonder Meta: Alle kanalen", kanaalkeuzeUitUrl(kanaalUitUrl(new URLSearchParams(adres.search).get(KANAAL_PARAM)), ["google", "linkedin"]) === "blended");

    schrijfAdresbalk((q) => q.set(KANAAL_PARAM, "meta"), "push");
    check("dezelfde waarde nog eens schrijven maakt geen geschiedenis", geschiedenis.length === 1, JSON.stringify(geschiedenis));

    schrijfAdresbalk((q) => zetPeriodeParams(q, { preset: "last_3m", custom: null, comparison: "previous_period" }), "replace");
    const q = leesAdresbalk();
    check("de periode erbij als replaceState", geschiedenis.length === 2 && geschiedenis[1].hoe === "replace", JSON.stringify(geschiedenis));
    check("kanaal, periode, vergelijking, demo en geo naast elkaar",
      q.get(KANAAL_PARAM) === "meta" && q.get(PERIODE_PARAM) === "last_3m" && q.get(VERGELIJK_PARAM) === "previous_period"
      && q.get("demo") === "1" && q.get("geo") === "GRT", adres.search);

    schrijfAdresbalk((r) => r.delete(KANAAL_PARAM), "push");
    check("terug naar Alle kanalen haalt alleen het kanaal weg", !leesAdresbalk().has(KANAAL_PARAM)
      && leesAdresbalk().get(PERIODE_PARAM) === "last_3m" && leesAdresbalk().get("geo") === "GRT", adres.search);

    adres.search = "?kanaal=meta";
    geschiedenis.length = 0;
    schrijfAdresbalk((r) => r.delete(KANAAL_PARAM), "replace");
    check("zonder parameters blijft het kale pad over, zonder vraagteken", geschiedenis[0]?.url === "/client/demo-greentech", JSON.stringify(geschiedenis));
  }

  // ── De beurslink uit de zijbalk ──────────────────────────────────────────────────────────────
  console.log("beursAdres: een beurs kiezen verzet alleen de beurs");
  {
    const pad = "/client/demo-greentech";
    const drie: Kanaal[] = ["google", "meta", "linkedin"];
    /** Wat het dashboard na de klik op zo'n link uit het adres leest. */
    const naKlik = (href: string) => {
      const [hetPad, zoek = ""] = href.split("?");
      const p = new URLSearchParams(zoek);
      return {
        pad: hetPad, geo: p.get(GEO_PARAM), demo: p.get("demo"),
        kanaal: kanaalkeuzeUitUrl(kanaalUitUrl(p.get(KANAAL_PARAM)), drie),
        periode: periodeUitParams(p),
      };
    };

    // Op Meta, drie maanden tegen de vorige periode, in de demo: precies de toestand uit de klacht.
    const opMeta = new URLSearchParams("demo=1&kanaal=meta&periode=last_3m&vergelijk=previous_period");
    const naarGrt = naKlik(beursAdres(pad, opMeta, "GRT"));
    check("de beurs staat in het adres, op hetzelfde pad", naarGrt.pad === pad && naarGrt.geo === "GRT", JSON.stringify(naarGrt));
    check("het kanaal overleeft de beurskeuze (geen terugval op Alle kanalen)", naarGrt.kanaal === "meta", JSON.stringify(naarGrt));
    check("de periode en de vergelijking ook",
      JSON.stringify(naarGrt.periode) === JSON.stringify({ preset: "last_3m", custom: null, comparison: "previous_period" }), JSON.stringify(naarGrt.periode));
    check("en ?demo= blijft staan", naarGrt.demo === "1");
    check("de parameters van de aanroeper blijven ongemoeid (useSearchParams is alleen-lezen)",
      opMeta.toString() === "demo=1&kanaal=meta&periode=last_3m&vergelijk=previous_period", opMeta.toString());

    // Van de ene beurs naar de andere: één ?geo=, geen tweede erbij.
    const opGrt = new URLSearchParams(beursAdres(pad, opMeta, "GRT").split("?")[1]);
    const naarGra = beursAdres(pad, opGrt, "GRA");
    check("een andere beurs vervangt de vorige", new URLSearchParams(naarGra.split("?")[1]).getAll(GEO_PARAM).join() === "GRA", naarGra);
    check("en het kanaal staat er nog steeds", naKlik(naarGra).kanaal === "meta" && naKlik(naarGra).periode?.preset === "last_3m", naarGra);

    // Terug naar het hele event (de klantnaam in de zijbalk): alleen de beurs gaat weg.
    const heleEvent = naKlik(beursAdres(pad, opGrt, null));
    check("terug naar het hele event haalt alleen de beurs weg",
      heleEvent.geo === null && heleEvent.kanaal === "meta" && heleEvent.periode?.preset === "last_3m"
      && heleEvent.periode?.comparison === "previous_period" && heleEvent.demo === "1", JSON.stringify(heleEvent));

    check("een eigen bereik overleeft de link ongeschonden",
      JSON.stringify(naKlik(beursAdres(pad, new URLSearchParams("periode=2026-03..2026-08&vergelijk=none"), "GRT")).periode)
      === JSON.stringify({ preset: "custom", custom: { start: "2026-03", end: "2026-08" }, comparison: "none" }));
    check("zonder parameters: alleen de beurs, en zonder beurs het kale pad",
      beursAdres(pad, new URLSearchParams(""), "GRT") === `${pad}?geo=GRT` && beursAdres(pad, new URLSearchParams(""), null) === pad
      && beursAdres(pad, new URLSearchParams("geo=GRT"), null) === pad);
    check("op Alle kanalen komt er geen kanaal bij", !beursAdres(pad, new URLSearchParams("periode=last_6m"), "GRT").includes(KANAAL_PARAM));

    // Een kanaal dat de klant niet heeft, wordt door de link niet goedgepraat: het gaat mee zoals
    // het er staat, en het dashboard valt terug zoals bij elke andere lezing van het adres.
    check("een onbeschikbaar kanaal in het adres valt na de klik nog steeds terug",
      naKlik(beursAdres(pad, new URLSearchParams("kanaal=microsoft"), "GRT")).kanaal === "blended");
  }

  // ── De periode: rondreis ─────────────────────────────────────────────────────────────────────
  console.log("De periode in ?periode= en ?vergelijk=");
  {
    const keuzes: PeriodeKeuze[] = [];
    for (const comparison of COMPARISON_MODES) {
      for (const preset of PERIOD_PRESETS) {
        if (preset !== "custom") keuzes.push({ preset, custom: null, comparison });
      }
      keuzes.push({ preset: "custom", custom: { start: "2026-03", end: "2026-08" }, comparison });
      keuzes.push({ preset: "custom", custom: { start: "2025-11", end: "2025-11" }, comparison });
    }
    const rond = keuzes.map((k) => {
      const p = new URLSearchParams("demo=1&geo=GRT");
      zetPeriodeParams(p, k);
      // Via de tekst, zoals een herlaad: de waarde moet de adresbalk overleven.
      return { k, terug: periodeUitParams(new URLSearchParams(p.toString())), rest: p.get("demo") === "1" && p.get("geo") === "GRT" };
    });
    const mis = rond.filter((r) => JSON.stringify(r.terug) !== JSON.stringify(r.k));
    check(`rondreis voor alle ${keuzes.length} keuzes (presets, eigen bereik, elke vergelijking)`, mis.length === 0, JSON.stringify(mis[0]));
    check("de andere parameters blijven staan", rond.every((r) => r.rest));

    const p = new URLSearchParams();
    zetPeriodeParams(p, { preset: "last_12m", custom: null, comparison: "same_period_last_year" });
    check("de standaardperiode staat er voluit in, de standaardvergelijking niet", p.toString() === "periode=last_12m", p.toString());
    zetPeriodeParams(p, { preset: "custom", custom: { start: "2026-08", end: "2026-03" }, comparison: "none" });
    check("een omgekeerd eigen bereik wordt rechtgezet", p.get(PERIODE_PARAM) === "2026-03..2026-08" && p.get(VERGELIJK_PARAM) === "none", p.toString());
    zetPeriodeParams(p, null);
    check("null haalt beide weg", p.toString() === "", p.toString());

    const lees = (zoek: string) => periodeUitParams(new URLSearchParams(zoek));
    check("zonder periode zegt de adresbalk niets", lees("") === null && lees("geo=GRT") === null);
    check("een losse vergelijking telt niet", lees("vergelijk=none") === null);
    check("onzin is geen periode", lees("periode=gisteren") === null && lees("periode=custom") === null
      && lees("periode=2026-13..2026-14") === null && lees("periode=2026-03") === null);
    check("een onbekende vergelijking valt terug op de standaard",
      JSON.stringify(lees("periode=last_6m&vergelijk=altijd")) === JSON.stringify({ preset: "last_6m", custom: null, comparison: "same_period_last_year" }));
    check("een preset draagt geen eigen bereik (één vaste vorm)",
      JSON.stringify(schonePeriodeKeuze({ preset: "last_3m", custom: { start: "2026-01", end: "2026-02" }, comparison: "none" }))
      === JSON.stringify({ preset: "last_3m", custom: null, comparison: "none" }));
  }

  // ── useUrlKeuze ──────────────────────────────────────────────────────────────────────────────
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const maakRoot = () => createRoot(doc.createElement() as unknown as Element);

  console.log("useUrlKeuze: direct, van buiten, en de verouderde echo");
  {
    // `balk` is de adresbalk zelf (direct bijgewerkt door pushState); `uitReact` is wat
    // useSearchParams al weet, en dat loopt bij Next een render achter.
    const balk = { waarde: "meta" as string | null };
    const geschreven: (string | null)[] = [];
    const gezien: (string | null)[] = [];
    let kies: (v: string | null) => void = noop;
    function Proef({ uitReact }: { uitReact: string | null }) {
      const [waarde, k] = useUrlKeuze<string>({
        waarde: uitReact,
        leesNu: () => balk.waarde,
        schrijf: (v) => { balk.waarde = v; geschreven.push(v); },
      });
      kies = k;
      gezien.push(waarde);
      return null;
    }
    const root = maakRoot();
    const render = (uitReact: string | null) => flushSync(() => root.render(createElement(Proef, { uitReact })));
    const nu = () => gezien[gezien.length - 1];

    render("meta");
    check("de eerste render is de adresbalk (geen flits van de standaard)", gezien[0] === "meta", JSON.stringify(gezien));
    await rust();
    check("en hij schrijft niets bij het laden", geschreven.length === 0, JSON.stringify(geschreven));

    flushSync(() => kies("google"));
    check("een keuze geldt meteen, vóór de adresbalk terug is", nu() === "google", JSON.stringify(gezien.slice(-3)));
    check("en staat in de adresbalk", balk.waarde === "google" && geschreven.join() === "google", JSON.stringify(geschreven));
    render("google");
    await rust();
    check("komt de adresbalk terug met dezelfde waarde, dan verandert er niets", nu() === "google");

    // Twee snelle keuzes; React laat de adresbalk eerst nog als de eerste zien.
    flushSync(() => kies("linkedin"));
    flushSync(() => kies("microsoft"));
    render("linkedin");
    await rust();
    check("de verouderde echo van de eerste klik wordt genegeerd", nu() === "microsoft", JSON.stringify(gezien.slice(-4)));
    render("microsoft");
    await rust();
    check("en de tweede blijft staan", nu() === "microsoft");

    // Van buiten: Terug zet de adresbalk en React allebei op de oude waarde.
    balk.waarde = "meta";
    render("meta");
    check("een verandering van buiten (Terug, een link) wordt overgenomen", await tot(() => nu() === "meta"), JSON.stringify(gezien.slice(-3)));
    balk.waarde = null;
    render(null);
    check("ook naar 'niets' (Alle kanalen)", await tot(() => nu() === null), JSON.stringify(gezien.slice(-3)));
    check("van buiten overnemen schrijft niet terug", geschreven.join() === "google,linkedin,microsoft", JSON.stringify(geschreven));
    root.unmount();
    await rust();
  }

  // ── De PeriodProvider met de adresbalk ───────────────────────────────────────────────────────
  console.log("PeriodProvider: de adresbalk gaat voor, en een keuze komt erin");
  {
    const { PeriodProvider, usePeriod } = await import("./period/period-context");
    const { monthCount } = await import("./period/period-range");
    type Staat = ReturnType<typeof usePeriod>;
    let laatste: Staat | null = null;
    function Lezer() { laatste = usePeriod(); return null; }
    const koppeling = () => ({
      waarde: periodeUitParams(new URLSearchParams(adres.search)),
      leesNu: () => periodeUitParams(leesAdresbalk()),
      schrijf: (k: PeriodeKeuze | null) => schrijfAdresbalk((p) => zetPeriodeParams(p, k), "replace"),
    });
    const mount = (scope: string, metAdres: boolean) => {
      const root = maakRoot();
      const render = () => flushSync(() => root.render(createElement(PeriodProvider, {
        scope, ...(metAdres ? { adres: koppeling() } : {}), children: createElement(Lezer),
      })));
      render();
      return { root, render };
    };
    const staat = () => laatste as Staat | null;

    // De adresbalk zegt drie maanden, het geheugen zes: de adresbalk gaat voor.
    opslag.clear();
    opslag.set("rm-periode-a", JSON.stringify({ preset: "last_6m", custom: null, comparison: "none" }));
    adres.search = "?demo=1&periode=last_3m&vergelijk=previous_period";
    geschiedenis.length = 0;
    const a = mount("a", true);
    check("de eerste render staat al op de adresbalk", staat()?.preset === "last_3m" && staat()?.comparison === "previous_period", JSON.stringify(staat()?.preset));
    check("drie maanden, met de vergelijking uit de adresbalk", monthCount(staat()!.range) === 3 && staat()!.compareRange !== null);
    check("en wordt de bewaarde keuze van deze klant", await tot(() => (opslag.get("rm-periode-a") ?? "").includes("last_3m")), opslag.get("rm-periode-a"));
    check("laden schrijft niets in de adresbalk", geschiedenis.length === 0, JSON.stringify(geschiedenis));

    // Een keuze: meteen van kracht, in de adresbalk (replace), en ?demo= blijft staan.
    flushSync(() => staat()!.set("last_6m", null, "previous_period"));
    check("een keuze geldt meteen", staat()?.preset === "last_6m" && monthCount(staat()!.range) === 6);
    check("en staat in de adresbalk, als replaceState, met ?demo= erbij",
      geschiedenis.length === 1 && geschiedenis[0].hoe === "replace" && leesAdresbalk().get(PERIODE_PARAM) === "last_6m"
      && leesAdresbalk().get("demo") === "1", JSON.stringify(geschiedenis));
    a.render(); // React haalt de adresbalk in
    await rust();
    check("haalt de adresbalk hem in, dan blijft de keuze staan", staat()?.preset === "last_6m");
    const naKeuze = adres.search;
    a.root.unmount();
    await rust();

    // Herlaad: een nieuwe provider op hetzelfde adres komt in dezelfde toestand terug, ook als
    // het geheugen leeg is (een andere browser, een gedeelde link).
    opslag.clear();
    adres.search = naKeuze;
    laatste = null;
    const b = mount("a", true);
    check("herlaad op hetzelfde adres: dezelfde periode en vergelijking",
      staat()?.preset === "last_6m" && staat()?.comparison === "previous_period" && monthCount(staat()!.range) === 6, JSON.stringify(staat()?.preset));
    b.root.unmount();
    await rust();

    // Een eigen bereik overleeft de rondreis ook.
    adres.search = "";
    laatste = null;
    const c = mount("c", true);
    await rust();
    flushSync(() => staat()!.set("custom", { start: "2025-03", end: "2025-06" }, "none"));
    check("een eigen bereik staat in de adresbalk", leesAdresbalk().get(PERIODE_PARAM) === "2025-03..2025-06" && leesAdresbalk().get(VERGELIJK_PARAM) === "none", adres.search);
    const eigenAdres = adres.search;
    c.root.unmount();
    await rust();
    opslag.clear();
    adres.search = eigenAdres;
    laatste = null;
    const d = mount("c", true);
    check("en komt er bij een herlaad weer uit", staat()?.preset === "custom" && staat()?.range.start === "2025-03" && staat()?.range.end === "2025-06"
      && staat()?.compareRange === null, JSON.stringify(staat()?.range));
    d.root.unmount();
    await rust();

    // Geen periode in de adresbalk: de bewaarde keuze, zoals altijd, en er wordt niets geschreven.
    opslag.clear();
    opslag.set("rm-periode-e", JSON.stringify({ preset: "last_3m", custom: null, comparison: "none" }));
    adres.search = "?geo=GRT";
    geschiedenis.length = 0;
    laatste = null;
    const e = mount("e", true);
    check("zonder periode in de adresbalk geldt de bewaarde keuze", await tot(() => staat()?.preset === "last_3m"), JSON.stringify(staat()?.preset));
    check("en blijft het adres schoon", geschiedenis.length === 0 && adres.search === "?geo=GRT", adres.search);
    // Van buiten: iemand opent een link met een andere periode (useSearchParams en de adresbalk
    // veranderen samen).
    adres.search = "?geo=GRT&periode=this_year";
    e.render();
    check("een link met een periode wordt overgenomen", await tot(() => staat()?.preset === "this_year"), JSON.stringify(staat()?.preset));
    e.root.unmount();
    await rust();

    // Een wissel naar een andere klant via een link zonder periode: dezelfde provider krijgt een
    // nieuwe scope, en de periode uit het adres van de vorige klant mag niet de bewaarde keuze
    // van de nieuwe worden (de lokale echo loopt één render achter op de adresbalk).
    opslag.clear();
    opslag.set("rm-periode-klant-b", JSON.stringify({ preset: "this_year", custom: null, comparison: "none" }));
    adres.search = "?periode=last_3m";
    laatste = null;
    const wisselRoot = maakRoot();
    const toon = (scope: string) => flushSync(() => wisselRoot.render(createElement(PeriodProvider, { scope, adres: koppeling(), children: createElement(Lezer) })));
    toon("klant-a");
    check("voorwaarde: klant A staat op de periode uit zijn adres", await tot(() => (opslag.get("rm-periode-klant-a") ?? "").includes("last_3m")) && staat()?.preset === "last_3m");
    adres.search = "";
    toon("klant-b");
    check("klant B krijgt zijn eigen bewaarde keuze", await tot(() => staat()?.preset === "this_year"), JSON.stringify(staat()?.preset));
    check("en de periode van klant A is niet in zijn geheugen geschreven", !(opslag.get("rm-periode-klant-b") ?? "").includes("last_3m"), opslag.get("rm-periode-klant-b"));
    wisselRoot.unmount();
    await rust();

    // Zonder koppeling (het portfolio): niets in de adresbalk, alleen het geheugen.
    opslag.clear();
    adres.search = "?periode=last_3m";
    geschiedenis.length = 0;
    opslagSchrijfacties = 0;
    laatste = null;
    const f = mount("f", false);
    await rust();
    check("zonder koppeling telt de adresbalk niet mee", staat()?.preset === "last_12m", JSON.stringify(staat()?.preset));
    check("en laden schrijft nergens", opslagSchrijfacties === 0 && geschiedenis.length === 0);
    flushSync(() => staat()!.set("last_6m", null, "none"));
    check("een keuze gaat dan alleen naar het geheugen", staat()?.preset === "last_6m" && (opslag.get("rm-periode-f") ?? "").includes("last_6m") && geschiedenis.length === 0);
    f.root.unmount();
    await rust();
  }

  // ── Bron: de bedrading in het klantdashboard ─────────────────────────────────────────────────
  console.log("Bron: het klantdashboard en lib/adresbalk.ts");
  {
    const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const wortel = join(import.meta.dirname, "..");
    const dash = zonderCommentaar(readFileSync(join(wortel, "components/dashboard/client-dashboard.tsx"), "utf8"));
    const balk = zonderCommentaar(readFileSync(join(wortel, "lib/adresbalk.ts"), "utf8"));
    check("de wissel is de History API van de browser", /window\.history\.pushState\(null, "", url\)/.test(balk) && /window\.history\.replaceState\(null, "", url\)/.test(balk));
    check("lib/adresbalk.ts kent de router niet", !/next\/navigation|useRouter/.test(balk));
    check("het dashboard navigeert niet voor een wissel (geen useRouter, geen router.push of .replace)",
      !/useRouter|router\.(push|replace)\(/.test(dash));
    check("het kanaal komt uit useSearchParams en gaat via useUrlKeuze",
      /const kanaalRuw = searchParams\.get\(KANAAL_PARAM\)/.test(dash) && /useUrlKeuze<Kanaal>\(\{\s*waarde: kanaalUitUrl\(kanaalRuw\)/.test(dash));
    check("de kanaalkeuze is geen eigen state meer", !/useState<Channel>\("blended"\)/.test(dash.split("function InsightsTab")[0]));
    check("wat getoond wordt is afgeleid, met de terugval van geldigeKeuze", /const channel: Channel = kanaalkeuzeUitUrl\(kanaalUitAdres, kanalen\)/.test(dash));
    check("een kanaalwissel is een push, het rechtzetten en de periode een replace",
      /p\.delete\(KANAAL_PARAM\); \}, "push"\)/.test(dash) && /schrijfAdresbalk\(\(p\) => p\.delete\(KANAAL_PARAM\), "replace"\)/.test(dash)
      && /schrijfAdresbalk\(\(p\) => zetPeriodeParams\(p, k\), "replace"\)/.test(dash));
    check("het rechtzetten haalt alleen weg wat niet kan", /kanaalParamRechtgezet\(ruw, kanalen\) === null/.test(dash));
    check("de PeriodProvider krijgt de koppeling met de adresbalk", /<PeriodProvider[^>]*adres=\{periodeAdres\}/.test(dash));
    check("?geo= wordt nog steeds gelezen", /searchParams\.get\(GEO_PARAM\)/.test(dash) && /export const GEO_PARAM = "geo"/.test(balk));

    // De zijbalk is te groot om te mounten (Supabase, toegang, groepen); de bedrading leest de
    // test uit de bron. Het gedrag van de bouwer zelf staat hierboven.
    const zij = zonderCommentaar(readFileSync(join(wortel, "components/layout/sidebar.tsx"), "utf8"));
    check("de beurslink in de zijbalk bouwt op de huidige zoekparameters",
      /href=\{beursAdres\(klantPad, searchParams, v\.abbreviation\)\}/.test(zij));
    check("de link naar het hele event ook, maar alleen binnen de klant die open staat",
      /const heleEvent = isActive \? beursAdres\(klantPad, searchParams, null\) : klantPad/.test(zij) && /href=\{heleEvent\}/.test(zij));
    check("er staat geen vaste ?geo=-link meer in de zijbalk", !/\?geo=/.test(zij), (zij.match(/.*\?geo=.*/) ?? [""])[0]);
    check("de zijbalk leest die parameters uit useSearchParams", /const searchParams = useSearchParams\(\)/.test(zij));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

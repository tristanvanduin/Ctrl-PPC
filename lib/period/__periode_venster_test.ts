// Het periodevenster in de browser: de eigen periode, de kiezer tijdens het laden, en wat de band
// zegt over een kanaal dat het venster niet tegenhoudt.
// Draaien: tsx lib/period/__periode_venster_test.ts
//
// - [2], [42] Een opgeslagen eigen periode werd ongewijzigd doorgegeven. Liep hij voorbij het eind
//   van de data (opgeslagen onder de kalender, op een tab met een latere eindmaand, of terwijl de
//   stand nog laadde), dan telden die maanden als nullen: de demo gaf -26,5% conversies waar
//   -1,5% hoort. Nu geklemd op eindMaand bij het uitrekenen, zonder de opgeslagen keuze te wijzigen.
// - [8] De kiezer toonde tijdens het laden het kalendervenster en sprong daarna.
// - [9] Een kanaal dat het venster niet tegenhoudt (ontkoppeld, of al maanden achter) stond nergens:
//   PeriodDataStand liet `uitgesloten` vallen.
//
// De provider wordt echt gemount (react-dom/client, nep-DOM) omdat de opgeslagen keuze in een effect
// uit localStorage komt; de rest rendert met react-dom/server.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-DOM en localStorage: moet er staan VOORDAT react-dom geladen wordt ─────────────────
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
const doc = { ...knoop(9), activeElement: null, createElement: () => ({ ...knoop(1), ownerDocument: doc }) };
const venster = new EventTarget();
Object.assign(venster, { document: doc, getSelection: () => null, HTMLIFrameElement: class {} });
const opslag = new Map<string, string>();
let schrijfacties = 0;
const localStorage = {
  getItem: (k: string) => opslag.get(k) ?? null,
  setItem: (k: string, v: string) => { schrijfacties += 1; opslag.set(k, v); },
  removeItem: (k: string) => { opslag.delete(k); },
};
Object.assign(globalThis, { window: venster, document: doc, localStorage });

const rust = () => new Promise((r) => setTimeout(r, 60));

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { PeriodProvider, usePeriod } = await import("./period-context");
  const { PeriodSelector } = await import("../../components/dashboard/period-selector");
  const { PeriodSummary } = await import("../../components/dashboard/period-summary");
  const { bouwHistorischeData } = await import("./kanaal-maanden");
  type Periode = ReturnType<typeof usePeriod>;

  const juli = { laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 }, dataTot: "2026-08-25" };

  async function mount(opgeslagen: unknown, dataStand: unknown): Promise<Periode> {
    opslag.clear();
    opslag.set("rm-periode-t", JSON.stringify(opgeslagen));
    schrijfacties = 0;
    let gezien: Periode | null = null;
    const Kijker = () => { gezien = usePeriod(); return null; };
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement(PeriodProvider, { scope: "t", dataStand: dataStand as never, children: createElement(Kijker) }));
    await rust();
    root.unmount();
    return gezien as unknown as Periode;
  }

  console.log("[2] [42] Een eigen periode loopt niet voorbij het eind van de data");
  {
    const p = await mount({ preset: "custom", custom: { start: "2025-11", end: "2026-10" }, comparison: "same_period_last_year" }, juli);
    check("eindmaand juli: de periode stopt op juli", p.range.start === "2025-11" && p.range.end === "2026-07", JSON.stringify(p.range));
    check("de vergelijking volgt de geklemde periode", p.compareRange?.start === "2024-11" && p.compareRange?.end === "2025-07", JSON.stringify(p.compareRange));
    check("de opgeslagen keuze blijft staan (custom t/m oktober)", p.custom?.end === "2026-10" && schrijfacties === 0,
      `${JSON.stringify(p.custom)} schrijfacties=${schrijfacties}`);

    const helemaalErna = await mount({ preset: "custom", custom: { start: "2026-09", end: "2026-10" }, comparison: "none" }, juli);
    check("begint de periode ook na het eind: alleen de laatste volle maand", helemaalErna.range.start === "2026-07" && helemaalErna.range.end === "2026-07",
      JSON.stringify(helemaalErna.range));

    const binnen = await mount({ preset: "custom", custom: { start: "2026-01", end: "2026-06" }, comparison: "none" }, juli);
    check("een periode binnen de data blijft zoals hij is", binnen.range.start === "2026-01" && binnen.range.end === "2026-06", JSON.stringify(binnen.range));

    // Omgekeerd opgeslagen (zetMaand bewaart "Van" na "Tot en met" zoals hij getypt is): de klem
    // keek alleen naar het eind, en resolvePeriod draaide de grenzen daarna om.
    const omgekeerd = await mount({ preset: "custom", custom: { start: "2026-10", end: "2026-07" }, comparison: "same_period_last_year" }, juli);
    check("een omgekeerde eigen periode loopt ook niet voorbij de data", omgekeerd.range.start === "2026-07" && omgekeerd.range.end === "2026-07",
      JSON.stringify(omgekeerd.range));
  }

  console.log("Vorig jaar en dit jaar volgen de kalender, niet het jaar van de data");
  {
    // Een kanaal dat vorig kalenderjaar in september stopte (een tab die beschikbaar.ts bewust houdt):
    // "Vorig jaar" was het jaar daarvoor, en "Dit jaar" januari-september van vorig jaar.
    const { today } = await import("../reporting-date");
    const jaar = Number(today().slice(0, 4));
    const stopte = { laatsteVolleMaand: `${jaar - 1}-09`, partieel: null, dataTot: `${jaar - 1}-09-30` };
    const vorig = await mount({ preset: "last_year", custom: null, comparison: "none" }, stopte);
    check("vorig jaar: het vorige kalenderjaar, t/m de data", vorig.range.start === `${jaar - 1}-01` && vorig.range.end === `${jaar - 1}-09`, JSON.stringify(vorig.range));
    const dit = await mount({ preset: "this_year", custom: null, comparison: "none" }, stopte);
    check("dit jaar: niet de maanden van vorig jaar", !dit.range.start.startsWith(`${jaar - 1}-01`), JSON.stringify(dit.range));
    const gewoon = await mount({ preset: "last_year", custom: null, comparison: "none" }, juli);
    check("met de gewone stand (t/m juli 2026) blijft vorig jaar 2025", gewoon.range.start === "2025-01" && gewoon.range.end === "2025-12", JSON.stringify(gewoon.range));
  }

  console.log("[8] De kiezer toont geen kalendervenster zolang de stand laadt");
  {
    const waarde = { preset: "last_12m" as const, custom: null, comparison: "same_period_last_year" as const, range: { start: "2025-11", end: "2026-10" }, compareRange: { start: "2024-11", end: "2025-10" } };
    const laden = renderToStaticMarkup(createElement(PeriodSelector, { value: waarde, onChange: noop, laden: true } as never));
    check("tijdens het laden: een neutrale tekst, geen maanden", laden.includes("Periode laden") && !laden.includes("2026"), laden);
    check("en niet te openen", /<button[^>]*disabled/.test(laden), laden);
    const klaar = renderToStaticMarkup(createElement(PeriodSelector, { value: waarde, onChange: noop } as never));
    check("daarna gewoon de periode", klaar.includes("oktober 2026") && !klaar.includes("Periode laden"), klaar);

    const dash = readFileSync(join(import.meta.dirname, "..", "..", "components/dashboard/client-dashboard.tsx"), "utf8");
    check("het klantdashboard geeft bandKlaar aan de kiezer", /<DashboardPeriodPicker[^>]*klaar=\{bandKlaar\}/.test(dash));
    check("en de kiezer geeft het door als laden", /laden=\{!klaar\}/.test(dash));
    // Niet periode, wel hetzelfde scherm: het bijschrift boven de jaarprognose op Alle kanalen zei
    // "tegen het geschatte jaardoel (vorig jaar +10%)", ook als er in Instellingen een doel staat
    // (de demo: 2.600 conversies). Het doel komt dan uit mergeKpiTargets, niet uit vorig jaar.
    check("het bijschrift claimt geen geschat doel als er een ingevoerd is",
      !dash.includes("tegen het geschatte jaardoel (vorig jaar +10%)") && dash.includes("ingevoerd in Instellingen"));
    // Dezelfde zin op de Google-tab: ook daar voegt ClientDataProvider de doelen uit Instellingen
    // samen (mergeKpiTargets), dus ook daar is "vorig jaar +10%" alleen de terugval.
    const google = readFileSync(join(import.meta.dirname, "..", "..", "components/dashboard/google-view.tsx"), "utf8");
    check("het Google-bijschrift claimt ook geen geschat doel",
      !google.includes("tegen het geschatte jaardoel (vorig jaar +10%)") && google.includes("tegen het jaardoel (ingevoerd in Instellingen, anders vorig jaar +10%)"));
  }

  console.log("[9] De band noemt een kanaal dat het venster niet tegenhoudt");
  {
    const maanden = [];
    for (let m = 1; m <= 10; m++) maanden.push({ year: 2026, month: m, conversions: 10, revenue: 100, adSpend: 50 });
    for (let m = 1; m <= 12; m++) maanden.push({ year: 2025, month: m, conversions: 10, revenue: 100, adSpend: 50 });
    const data = bouwHistorischeData("t", maanden, 2026);
    const stand = {
      laatsteVolleMaand: "2026-10", partieel: null, dataTot: "2026-10-31",
      uitgeslotenBronnen: [{ bron: "linkedin", dataTot: "2026-05-15" }],
    };
    const html = renderToStaticMarkup(createElement(PeriodProvider, { scope: "x", dataStand: stand, children: createElement(PeriodSummary, { data }) }));
    const tekst = html.replace(/<[^>]+>/g, " ");
    check("LinkedIn met zijn laatste dag, en dat het daarna als nul telt",
      tekst.includes("LinkedIn (geen data na 15 mei 2026)") && tekst.includes("als nul"), tekst.slice(-400));

    // Een kanaal dat al vóór de periode ophield, telt de hele periode als nul: ook noemen.
    opslag.clear();
    const vroeg = { ...stand, uitgeslotenBronnen: [{ bron: "linkedin", dataTot: "2025-03-20" }] };
    const html2 = renderToStaticMarkup(createElement(PeriodProvider, { scope: "y", dataStand: vroeg, children: createElement(PeriodSummary, { data }) }));
    check("ook een kanaal dat al vóór de periode ophield wordt genoemd",
      html2.replace(/<[^>]+>/g, " ").includes("LinkedIn (geen data na 20 maart 2025)"), html2.replace(/<[^>]+>/g, " ").slice(-300));

    // Houdt de periode op vóór de maand waarin het kanaal stopt, dan raakt het de cijfers niet. (Met
    // server-rendering geldt de standaardperiode, t/m oktober; vandaar een kanaal dat in november stopt.)
    const laat = { ...stand, uitgeslotenBronnen: [{ bron: "linkedin", dataTot: "2026-11-15" }] };
    const html3 = renderToStaticMarkup(createElement(PeriodProvider, { scope: "w", dataStand: laat, children: createElement(PeriodSummary, { data }) }));
    check("stopt het kanaal pas na het eind van de periode, dan staat er niets", !html3.includes("geen data na"), html3.replace(/<[^>]+>/g, " ").slice(-300));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

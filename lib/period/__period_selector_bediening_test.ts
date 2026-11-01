// Test voor de bediening van de periodekiezer (components/dashboard/period-selector.tsx).
//
// Waarom hij er is. Het paneel ging alleen dicht met een klik ernaast: Escape deed niets, de knop
// zei niet of het paneel open was (geen aria-expanded/-haspopup/-controls), het paneel had geen
// rol, een preset kiezen liet het paneel openstaan, en de luisteraar op de hele pagina stond er
// ook als het paneel dicht was. De max van de eindmaand rekende in UTC (new Date().toISOString()),
// terwijl de periode zelf in Amsterdam rekent: rond middernacht op de 1e stond de eindmaand boven
// zijn eigen max. En het klantdashboard gaf de jaarlijkse editie nooit door, zodat de waarschuwing
// "voorgaande periode vergelijkt aanloop met nasleep" in productie niet kon verschijnen.
//
// De kiezer wordt echt gemount met react-dom/client, op een kleine nep-DOM. Klikken gaat via de
// props die React op de DOM-knoop zet (de echte onClick van de component), Escape via de
// luisteraar die de component zelf op document registreert. Het klantdashboard is te groot om te
// mounten; daar leest de test de bron, als vangnet en niet als gedragstest.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-DOM: genoeg voor react-dom om een boom met knoppen, invoervelden en SVG neer te zetten ──
// Moet er staan VOORDAT react-dom geladen wordt; die kijkt bij het laden of er een DOM is.
const noop = () => {};
type Luisteraar = (e: unknown) => void;
const docLuisteraars = new Map<string, Set<Luisteraar>>();
let focusOp: Knoop | null = null;
class Knoop {
  nodeType: number; nodeName: string; tagName: string; namespaceURI: string | null;
  childNodes: Knoop[] = []; parentNode: Knoop | null = null; ownerDocument: unknown = null;
  style: Record<string, unknown> = { setProperty: noop, removeProperty: noop };
  attributes: Record<string, string> = {};
  nodeValue: string | null = null; _text = "";
  [k: string]: unknown;
  constructor(type: number, name: string, ns: string | null = null) {
    this.nodeType = type; this.nodeName = name.toUpperCase(); this.tagName = this.nodeName; this.namespaceURI = ns;
  }
  get firstChild(): Knoop | null { return this.childNodes[0] ?? null; }
  get lastChild(): Knoop | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): Knoop | null { if (!this.parentNode) return null; const i = this.parentNode.childNodes.indexOf(this); return this.parentNode.childNodes[i + 1] ?? null; }
  appendChild(c: Knoop) { c.parentNode?.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore(c: Knoop, ref: Knoop | null) { c.parentNode?.removeChild(c); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); c.parentNode = this; return c; }
  removeChild(c: Knoop) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  setAttribute(k: string, v: string) { this.attributes[k] = String(v); }
  setAttributeNS(_ns: string, k: string, v: string) { this.attributes[k] = String(v); }
  removeAttribute(k: string) { delete this.attributes[k]; }
  removeAttributeNS(_ns: string, k: string) { delete this.attributes[k]; }
  getAttribute(k: string) { return this.attributes[k] ?? null; }
  hasAttribute(k: string) { return k in this.attributes; }
  addEventListener = noop; removeEventListener = noop;
  get textContent(): string { return this._text || this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue ?? "" : c.textContent)).join(""); }
  set textContent(v: string) { this._text = v; this.childNodes = []; }
  contains(n: Knoop | null): boolean { for (let k = n; k; k = k.parentNode) if (k === this) return true; return false; }
  focus() { focusOp = this; }
  getRootNode() { return doc; }
}
const doc = new Knoop(9, "#document") as Knoop & Record<string, unknown>;
Object.assign(doc, {
  createElement: (t: string) => { const n = new Knoop(1, t, "http://www.w3.org/1999/xhtml"); n.ownerDocument = doc; return n; },
  createElementNS: (ns: string, t: string) => { const n = new Knoop(1, t, ns); n.ownerDocument = doc; return n; },
  createTextNode: (s: string) => { const n = new Knoop(3, "#text"); n.nodeValue = s; n.ownerDocument = doc; return n; },
  createComment: (s: string) => { const n = new Knoop(8, "#comment"); n.nodeValue = s; n.ownerDocument = doc; return n; },
  activeElement: null, defaultView: null,
  // De luisteraars van de component zelf (mousedown/keydown op document) worden bijgehouden, zodat
  // de test kan zien OF ze er staan en ze kan aanroepen. React's eigen luisteraars hangen aan de
  // container, niet aan document.
  addEventListener: (type: string, f: Luisteraar) => { if (!docLuisteraars.has(type)) docLuisteraars.set(type, new Set()); docLuisteraars.get(type)!.add(f); },
  removeEventListener: (type: string, f: Luisteraar) => { docLuisteraars.get(type)?.delete(f); },
});
const win = { document: doc, addEventListener: noop, removeEventListener: noop, getSelection: () => null, HTMLIFrameElement: function () {}, event: undefined };
doc.defaultView = win;
Object.assign(globalThis, { window: win, document: doc, HTMLIFrameElement: win.HTMLIFrameElement });

function alle(n: Knoop, pred: (k: Knoop) => boolean, uit: Knoop[] = []): Knoop[] {
  if (pred(n)) uit.push(n);
  for (const c of n.childNodes) alle(c, pred, uit);
  return uit;
}
const props = (n: Knoop): Record<string, unknown> => {
  const k = Object.keys(n).find((s) => s.startsWith("__reactProps$"));
  return (k ? n[k] : {}) as Record<string, unknown>;
};
const luistertOp = (type: string) => (docLuisteraars.get(type)?.size ?? 0) > 0;

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { PeriodSelector, resolveSelection } = await import("../../components/dashboard/period-selector");
  const { lastCompleteMonth, PRESET_LABEL, COMPARISON_LABEL } = await import("./period-range");
  type Selectie = ReturnType<typeof resolveSelection>;

  let gekozen: Selectie | null = null;
  const host = (doc.createElement as (t: string) => Knoop)("div");
  const root = createRoot(host as unknown as Element);
  const render = (extra: Record<string, unknown> = {}) => flushSync(() => root.render(createElement(PeriodSelector, {
    value: resolveSelection("last_12m", null, "same_period_last_year"),
    onChange: (v: Selectie) => { gekozen = v; },
    ...extra,
  })));
  render();

  // De knop die het paneel opent is de eerste knop in de boom; het paneel staat erna.
  const trigger = () => alle(host, (k) => k.tagName === "BUTTON")[0];
  const paneel = () => alle(host, (k) => k.attributes.role === "dialog")[0];
  // Een knop die er niet is, is een mislukte check en geen crash: zo ziet een run op de oude code
  // er per controle uit in plaats van als één stacktrace.
  const klik = (n: Knoop | undefined) => { if (n) flushSync(() => (props(n).onClick as () => void)()); };
  const zorgOpen = () => { if (paneel() === undefined) klik(trigger()); };
  const knopMet = (tekst: string) => alle(host, (k) => k.tagName === "BUTTON" && k.textContent.includes(tekst))[0];

  // Dicht.
  check("de knop zegt dat hij een dialoog opent", trigger()?.attributes["aria-haspopup"] === "dialog", JSON.stringify(trigger()?.attributes));
  check("dicht: aria-expanded is false", trigger()?.attributes["aria-expanded"] === "false");
  check("dicht: geen aria-controls naar een paneel dat er niet is", trigger()?.attributes["aria-controls"] === undefined);
  check("dicht: geen luisteraars op de pagina", !luistertOp("mousedown") && !luistertOp("keydown"));

  // Open.
  klik(trigger());
  check("open: aria-expanded is true", trigger().attributes["aria-expanded"] === "true");
  check("open: het paneel is een dialoog met een naam", paneel()?.attributes["aria-label"] === "Periode en vergelijking");
  check("open: aria-controls wijst naar het paneel", !!paneel() && trigger().attributes["aria-controls"] === paneel().attributes.id, `${trigger().attributes["aria-controls"]} vs ${paneel()?.attributes.id}`);
  check("open: luisteraars op de pagina", luistertOp("mousedown") && luistertOp("keydown"));
  check("de actieve preset is ingedrukt", knopMet(PRESET_LABEL.last_12m)?.attributes["aria-pressed"] === "true");
  check("een andere preset niet", knopMet(PRESET_LABEL.last_3m)?.attributes["aria-pressed"] === "false");
  const eind = alle(host, (k) => k.tagName === "INPUT")[1];
  check("de eindmaand mag zonder datastand t/m de laatste volle maand (Amsterdam)", eind?.attributes.max === lastCompleteMonth(), eind?.attributes.max);

  // Escape sluit en geeft de focus terug aan de knop.
  focusOp = null;
  flushSync(() => { for (const f of [...(docLuisteraars.get("keydown") ?? [])]) f({ key: "Escape" }); });
  check("Escape sluit het paneel", paneel() === undefined && trigger().attributes["aria-expanded"] === "false");
  check("Escape zet de focus terug op de knop", focusOp === trigger());
  check("na sluiten geen luisteraars meer", !luistertOp("mousedown") && !luistertOp("keydown"));

  // Een andere toets doet niets.
  zorgOpen();
  flushSync(() => { for (const f of [...(docLuisteraars.get("keydown") ?? [])]) f({ key: "a" }); });
  check("een andere toets laat het paneel open", paneel() !== undefined);

  // Een vergelijking kiezen houdt het paneel open (die verfijn je); een preset sluit het.
  gekozen = null;
  klik(knopMet(COMPARISON_LABEL.previous_period));
  check("een vergelijking kiezen geeft hem door", (gekozen as Selectie | null)?.comparison === "previous_period", JSON.stringify(gekozen));
  check("en houdt het paneel open", paneel() !== undefined);
  gekozen = null;
  klik(knopMet(PRESET_LABEL.last_6m));
  check("een preset kiezen geeft hem door", (gekozen as Selectie | null)?.preset === "last_6m", JSON.stringify(gekozen));
  check("en sluit het paneel", paneel() === undefined);

  // Met een datastand: de eindmaand kan niet voorbij de data.
  render({ maxMaand: "2026-07" });
  zorgOpen();
  check("maxMaand begrenst de eindmaand", alle(host, (k) => k.tagName === "INPUT")[1]?.attributes.max === "2026-07");
  root.unmount();

  // ── Bron: de kiezer en het klantdashboard ─────────────────────────────────────────────────
  const wortel = join(import.meta.dirname, "..", "..");
  const kiezer = readFileSync(join(wortel, "components/dashboard/period-selector.tsx"), "utf8");
  const dash = readFileSync(join(wortel, "components/dashboard/client-dashboard.tsx"), "utf8");
  check("de kiezer rekent de maand niet in UTC", !/new Date\(\)\.toISOString\(\)/.test(kiezer));
  const picker = /function DashboardPeriodPicker[\s\S]*?<PeriodSelector([\s\S]*?)\/>/.exec(dash)?.[1] ?? "";
  check("het klantdashboard geeft de jaarlijkse editie door", picker.includes("jaarlijkseEditie={jaarlijkseEditie}"), picker.slice(0, 120));
  check("en de eindmaand van de presets als max", picker.includes("maxMaand={periode.eindMaand}"));
  check("gevuld uit de cadans van de editie", /<DashboardPeriodPicker[^>]*jaarlijkseEditie=\{upcomingEdition\?\.cadence === "annual"\}/.test(dash));
  check("de editie volgt de gekozen beurs", /useUpcomingEdition\(client\.id, geoClone\)/.test(dash));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

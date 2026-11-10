// Regressietest: de chrome om het Overzicht heen doet bij het laden één /api/me in plaats van
// drie, één code-rood in plaats van twee, en zonder sessie geen sop-dekking/datastand/code-rood.
// Draaien: tsx lib/auth/__use_access_dedupe_test.ts
//
// Wat hier vastligt:
// - twee gelijktijdige mounts van useAccess (zijbalk, logo) delen ÉÉN lopend /api/me-verzoek, en
//   een latere mount binnen de TTL doet er geen bij;
// - zonder sessie (/api/me zegt enforced: false) doen SopDekkingBanner, DatastandBanner en de
//   code-rood-hook GEEN verzoek: die routes geven zonder sessie gegarandeerd 401;
// - met sessie doen ze dat wél, en code-rood één keer voor zijbalk én banner samen;
// - het e-mailadres komt via useAccess door, zodat het gebruikersmenu geen eigen fetch nodig heeft;
// - een mislukt /api/me wordt niet bewaard: de volgende mount probeert opnieuw;
// - na reageer() herlezen alle gemounte code-rood-lezers dezelfde verse ronde.
// Plus BRONTEKST-controles (bewust, zie onderaan): het gebruikersmenu en de zijbalk gebruiken de
// hooks en hebben geen eigen fetch meer; de notities lezen pas als ze in beeld komen.
// De hooks en banners draaien echt (react-dom/client), op een nep-DOM en een nep-fetch.

// Een module, geen script: zonder import of export op het hoogste niveau deelt tsc de namen
// hieronder (passed, check, main) met elk ander testscript in het project.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-DOM: alleen wat createRoot nodig heeft; de geteste componenten renderen hier null ────
// Moet er staan VOORDAT react-dom geladen wordt; die kijkt bij het laden of er een DOM is.
const noop = () => {};
const knoop = (nodeType: number) => ({
  nodeType, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: noop, removeEventListener: noop,
  setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, insertBefore: noop,
  style: {}, ownerDocument: null as unknown, childNodes: [] as unknown[], firstChild: null,
});
// `cookie`: het gebruikersmenu-pad laadt de browser-Supabase, die bij het opstarten document.cookie leest.
const doc = {
  ...knoop(9), activeElement: null, cookie: "",
  createElement: () => ({ ...knoop(1), ownerDocument: doc }),
  createElementNS: () => ({ ...knoop(1), ownerDocument: doc }),
  createTextNode: () => ({ ...knoop(3), ownerDocument: doc }),
};
Object.assign(globalThis, {
  window: { document: doc, addEventListener: noop, removeEventListener: noop, getSelection: () => null, HTMLIFrameElement: class {}, location: { search: "", pathname: "/", href: "http://x/", hostname: "x" } },
  document: doc,
});

// ── Nep-fetch: telt per route, en de test bepaalt wanneer er geantwoord wordt ───────────────
const verzoeken: Record<string, number> = {};
let wachtend: { route: string; los: () => void }[] = [];
let sessie = false;
let meFaalt = false;
const ME_ZONDER = { enforced: false, id: null, email: null, role: null, capabilities: [], scope: [], agencyId: null, whitelabelActief: false, isPlatform: false };
const ME_MET = { enforced: true, id: "u1", email: "eigenaar@bureau.nl", role: "admin", capabilities: ["client:read"], scope: "all", agencyId: "bureau-1", whitelabelActief: true, isPlatform: false };
const MELDING = { id: "m1", clientId: "andere-klant", clientNaam: "Andere klant", licht: "rood", redenen: ["forecast"], gedetecteerdOp: "2026-11-01", status: "open", gereageerdOp: null };
function antwoordVoor(route: string, method: string): unknown {
  if (route === "/api/me") return sessie ? ME_MET : ME_ZONDER;
  if (route === "/api/adoptie/code-rood") return method === "POST" ? { ok: true } : { ok: true, magReageren: true, meldingen: [MELDING] };
  if (route === "/api/tenancy/sop-dekking") return { oordeel: { toestand: "binnen_dekking", aantalMetSops: 1, limiet: 5 }, accounts: [] };
  if (route === "/api/sync/datastand") return { samenvatting: { toestand: "ok", totaal: 1, dood: 0, geen: 0, tekst: null } };
  return { error: `onbekende route ${route}` };
}
globalThis.fetch = ((url: string, init?: { method?: string }) => {
  const route = String(url).split("?")[0];
  const method = init?.method ?? "GET";
  const sleutel = method === "GET" ? route : `${method} ${route}`;
  verzoeken[sleutel] = (verzoeken[sleutel] ?? 0) + 1;
  return new Promise((klaar, faal) => wachtend.push({
    route: sleutel,
    los: () => {
      if (route === "/api/me" && meFaalt) { faal(new Error("netwerkfout")); return; }
      klaar({ ok: true, status: 200, json: async () => antwoordVoor(route, method) } as Response);
    },
  }));
}) as typeof fetch;

const rust = () => new Promise((r) => setTimeout(r, 20));
// Wachten tot een voorwaarde waar is, met een plafond. createRoot rendert asynchroon en de
// suite draait vier tests tegelijk: één vaste tik van 20 ms was daar niet altijd genoeg voor.
async function tot(cond: () => boolean, maxMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (!cond()) { if (Date.now() - start > maxMs) return false; await rust(); }
  return true;
}
async function beantwoordAlles(): Promise<void> {
  // Eerst de effecten van een verse mount laten draaien (met een plafond: sommige scenario's
  // verwachten juist géén verzoek), dan beantwoorden. De antwoorden zetten staat en kunnen
  // vervolgverzoeken starten (de banners wachten op /api/me), dus doorgaan tot het stil blijft.
  await tot(() => wachtend.length > 0, 1500);
  for (let i = 0; i < 6; i++) {
    const nu = wachtend; wachtend = [];
    for (const w of nu) w.los();
    if (!(await tot(() => wachtend.length > 0, 800))) break;
  }
}
function telStand(): Record<string, number> { const s = { ...verzoeken }; for (const k of Object.keys(verzoeken)) delete verzoeken[k]; return s; }

interface Toegang { loading: boolean; unrestricted: boolean; ingelogd: boolean; email: string | null; role: string | null; can: (c: string) => boolean; canAccessClient: (id: string) => boolean }
interface CodeRood { meldingen: { clientId: string }[]; magReageren: boolean; loading: boolean; error: string | null; reageer: (id: string, actie: "accepteren" | "afwijzen") => Promise<void> }

async function main() {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useAccess, vergeetToegang } = await import("./use-access");
  const { useCodeRoodMeldingen } = await import("../adoptie/use-code-rood");
  const { SopDekkingBanner } = await import("../../components/layout/sop-dekking-banner");
  const { DatastandBanner } = await import("../../components/layout/datastand-banner");
  const { CodeRoodBanner } = await import("../../components/dashboard/code-rood-banner");

  const toegang: Record<string, Toegang> = {};
  const codeRood: Record<string, CodeRood> = {};
  function ToegangLezer({ naam }: { naam: string }) { toegang[naam] = useAccess() as unknown as Toegang; return null; }
  function CodeRoodLezer({ naam }: { naam: string }) { codeRood[naam] = useCodeRoodMeldingen() as unknown as CodeRood; return null; }
  const mount = (...kinderen: ReactNode[]) => {
    const root = createRoot(doc.createElement() as unknown as Element);
    root.render(createElement("div", null, ...kinderen));
    return root;
  };
  // De chrome bij het laden: zijbalk + logo (twee useAccess), de twee layout-banners, de
  // dashboardbanner en de zijbalk-lezer van code-rood.
  const chrome = () => mount(
    createElement(ToegangLezer, { key: "zijbalk", naam: "zijbalk" }),
    createElement(ToegangLezer, { key: "logo", naam: "logo" }),
    createElement(SopDekkingBanner, { key: "sop" }),
    createElement(DatastandBanner, { key: "stand" }),
    createElement(CodeRoodBanner, { key: "banner", clientId: "c1" }),
    createElement(CodeRoodLezer, { key: "zijbalk-rood", naam: "zijbalk" }),
  );

  console.log("Zonder sessie: één /api/me, en geen code-rood, sop-dekking of datastand");
  {
    sessie = false;
    const root = chrome();
    await tot(() => wachtend.length > 0);
    check("beide useAccess-lezers laden", toegang.zijbalk?.loading === true && toegang.logo?.loading === true);
    check("één /api/me onderweg voor twee lezers", verzoeken["/api/me"] === 1, JSON.stringify(verzoeken));
    await beantwoordAlles();
    const stand = telStand();
    check("/api/me precies één keer", stand["/api/me"] === 1, JSON.stringify(stand));
    check("geen code-rood zonder sessie", (stand["/api/adoptie/code-rood"] ?? 0) === 0, JSON.stringify(stand));
    check("geen sop-dekking zonder sessie", (stand["/api/tenancy/sop-dekking"] ?? 0) === 0, JSON.stringify(stand));
    check("geen datastand zonder sessie", (stand["/api/sync/datastand"] ?? 0) === 0, JSON.stringify(stand));
    check("beide lezers klaar en open", !toegang.zijbalk.loading && !toegang.logo.loading && toegang.zijbalk.unrestricted && toegang.logo.unrestricted);
    check("niet ingelogd, geen e-mail", toegang.zijbalk.ingelogd === false && toegang.zijbalk.email === null);
    check("open: elk recht en elke klant", toegang.zijbalk.can("settings:write") && toegang.zijbalk.canAccessClient("c1"));
    check("code-rood-lezer klaar, leeg, zonder fout", codeRood.zijbalk?.loading === false && codeRood.zijbalk.meldingen.length === 0 && codeRood.zijbalk.error === null, JSON.stringify(codeRood.zijbalk));
    root.unmount();
    await rust();

    // Een latere mount binnen de TTL (tabwissel, instellingenpaneel) kost geen verzoek.
    const later = mount(createElement(ToegangLezer, { naam: "later" }));
    await tot(() => toegang.later !== undefined);
    check("latere mount: meteen klaar uit de cache", toegang.later?.loading === false && toegang.later.unrestricted === true, JSON.stringify(toegang.later));
    await beantwoordAlles();
    check("latere mount: geen nieuw /api/me", (telStand()["/api/me"] ?? 0) === 0);
    later.unmount();
    await rust();
  }

  console.log("Met sessie: dezelfde verzoeken als voorheen, maar elk één keer");
  {
    vergeetToegang();
    sessie = true;
    const root = chrome();
    await beantwoordAlles();
    const stand = telStand();
    check("/api/me één keer", stand["/api/me"] === 1, JSON.stringify(stand));
    check("code-rood één keer voor banner én zijbalk", stand["/api/adoptie/code-rood"] === 1, JSON.stringify(stand));
    check("sop-dekking één keer", stand["/api/tenancy/sop-dekking"] === 1, JSON.stringify(stand));
    check("datastand één keer", stand["/api/sync/datastand"] === 1, JSON.stringify(stand));
    check("ingelogd, met e-mail en rol", toegang.zijbalk.ingelogd && !toegang.zijbalk.unrestricted && toegang.zijbalk.email === "eigenaar@bureau.nl" && toegang.zijbalk.role === "admin", JSON.stringify(toegang.zijbalk));
    check("rechten uit het antwoord, niet open", toegang.zijbalk.can("client:read") && !toegang.zijbalk.can("settings:write"));
    check("scope all: elke klant", toegang.logo.canAccessClient("c1"));
    check("meldingen bij de zijbalk-lezer", codeRood.zijbalk.meldingen.length === 1 && codeRood.zijbalk.magReageren && !codeRood.zijbalk.loading, JSON.stringify(codeRood.zijbalk));
    root.unmount();
    await rust();
  }

  console.log("Een mislukt /api/me wordt niet bewaard");
  {
    vergeetToegang();
    meFaalt = true;
    const root = mount(createElement(ToegangLezer, { naam: "eerste" }));
    await beantwoordAlles();
    check("na een netwerkfout: klaar en open", toegang.eerste?.loading === false && toegang.eerste.unrestricted === true, JSON.stringify(toegang.eerste));
    root.unmount();
    await rust();
    meFaalt = false;
    const opnieuw = mount(createElement(ToegangLezer, { naam: "tweede" }));
    await beantwoordAlles();
    check("de volgende mount probeert opnieuw", telStand()["/api/me"] === 2);
    check("en krijgt het echte antwoord", toegang.tweede?.ingelogd === true, JSON.stringify(toegang.tweede));
    opnieuw.unmount();
    await rust();
  }

  console.log("Na reageer() herlezen alle lezers dezelfde verse ronde");
  {
    vergeetToegang();
    sessie = true;
    const root = mount(createElement(CodeRoodLezer, { key: "a", naam: "a" }), createElement(CodeRoodLezer, { key: "b", naam: "b" }));
    await beantwoordAlles();
    // De lijst van de vorige ronde is nog vers (TTL): twee nieuwe lezers kosten geen verzoek.
    check("twee lezers, geen nieuw verzoek binnen de TTL", (telStand()["/api/adoptie/code-rood"] ?? 0) === 0 && codeRood.a?.meldingen.length === 1 && codeRood.b?.meldingen.length === 1, JSON.stringify([codeRood.a, codeRood.b]));
    const klaar = codeRood.a.reageer("m1", "accepteren");
    await beantwoordAlles();
    await klaar;
    await rust();
    const stand = telStand();
    check("één POST", stand["POST /api/adoptie/code-rood"] === 1, JSON.stringify(stand));
    check("daarna één verse GET voor beide lezers", stand["/api/adoptie/code-rood"] === 1, JSON.stringify(stand));
    check("beide lezers hebben de lijst, zonder fout", codeRood.a.meldingen.length === 1 && codeRood.b.meldingen.length === 1 && codeRood.a.error === null && codeRood.b.error === null);
    root.unmount();
    await rust();
  }

  // ── BRONTEKST: bewust, want hier telt wat er NIET meer staat. Wie het gebruikersmenu of de
  // zijbalk weer een eigen fetch geeft, of de notities weer bij mount laat lezen, moet dit blok
  // bewust mee veranderen -- dat is de bedoeling.
  console.log("Brontekst: de lezers staan op de hooks, de notities wachten op zichtbaarheid");
  {
    const bron = (pad: string) => readFileSync(join(__dirname, "..", "..", pad), "utf8");
    const menu = bron("components/layout/user-menu.tsx");
    check("gebruikersmenu leest e-mail via useAccess", /const \{ email \} = useAccess\(\)/.test(menu));
    check("gebruikersmenu heeft geen eigen /api/me-fetch", !/fetch\(\s*["']\/api\/me["']/.test(menu));
    check("gebruikersmenu vergeet het antwoord bij uitloggen", /vergeetToegang\(\)/.test(menu));
    const zijbalk = bron("components/layout/sidebar.tsx");
    check("zijbalk gebruikt de code-rood-hook", /useCodeRoodMeldingen\(\)/.test(zijbalk));
    check("zijbalk heeft geen eigen code-rood-fetch", !/fetch\(\s*["']\/api\/adoptie\/code-rood["']/.test(zijbalk));
    const logo = bron("components/layout/sidebar-logo.tsx");
    check("logo leest via useAccess", /useAccess\(\)/.test(logo) && !/fetch\(/.test(logo));
    const layout = bron("app/(app)/layout.tsx");
    check("de layout mount beide banners (de poort geldt dus bij het laden)", /<SopDekkingBanner \/>/.test(layout) && /<DatastandBanner \/>/.test(layout));
    const notities = bron("components/dashboard/client-notes.tsx");
    check("notities lezen pas in beeld", /IntersectionObserver/.test(notities) && /if \(inBeeld\) fetchNotes\(\)/.test(notities));
    check("notities lezen niet meer onvoorwaardelijk bij mount", !/useEffect\(\(\) => \{ fetchNotes\(\); \}/.test(notities));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

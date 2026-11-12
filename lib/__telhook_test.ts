// Een kerncijfer dat naar zijn nieuwe waarde telt (lib/beweging.ts, bouwplan fase 2).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__telhook_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Bij een wissel van kanaal of periode tellen de kerncijfers in hooguit 300 ms naar hun nieuwe
// waarde. Dat is beweging op de belangrijkste getallen van de pagina, en daar mag niets aan
// schuiven:
//
// - de EINDWAARDE is letterlijk de tekst die de aanroeper gaf, nooit een afronding van de telling;
// - bij de EERSTE render telt er niets (de gebruiker deed niets);
// - wie om MINDER BEWEGING vraagt krijgt de nieuwe waarde direct;
// - de telling duurt hooguit 300 ms en loopt in één richting, van wat er stond naar het doel;
// - wat geen getal is ("—"), of van eenheid wisselt, springt in plaats van te tellen.
//
// De hook wordt echt gemount (react-dom/client op een nep-DOM), met een klok die de test zelf
// zet: requestAnimationFrame is hier een wachtrij die per beeldje wordt afgespeeld. Er wordt
// nergens op een tijd gewacht.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Nep-browser: genoeg DOM voor createRoot, een beeldjesklok en de bewegingsvoorkeur ─────────
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

// De beeldjesklok. Elk aangevraagd beeldje wacht tot de test `beeldje(ms)` roept.
let volgnummer = 0;
const wachtrij = new Map<number, (nu: number) => void>();
let afgezegd = 0;
const voorkeur = { minder: false };
Object.assign(globalThis, {
  window: {
    document: doc, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, getSelection: () => null,
    HTMLIFrameElement: class {},
    matchMedia: () => ({ get matches() { return voorkeur.minder; }, addEventListener: noop, removeEventListener: noop }),
  },
  document: doc,
  requestAnimationFrame: (f: (nu: number) => void) => { volgnummer += 1; wachtrij.set(volgnummer, f); return volgnummer; },
  cancelAnimationFrame: (id: number) => { if (wachtrij.delete(id)) afgezegd += 1; },
});

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

async function main() {
  const { DUUR, ontleedGetal, tussenTekst, useTellendeTekst } = await import("./beweging");
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");

  // ── De rekenkern ─────────────────────────────────────────────────────────────────────────────
  console.log("ontleedGetal en tussenTekst");
  {
    check("300 ms is de bovengrens", DUUR.lang === 300);
    const o = (t: string) => ontleedGetal(t);
    check("een kaal getal met duizendtallen", o("1.086")?.getal === 1086 && o("1.086")?.groepen === true && o("1.086")?.decimalen === 0);
    check("een bedrag: het valutateken en de spatie horen bij het voorvoegsel", o(eur(1234))?.getal === 1234 && o(eur(1234))?.voor === eur(1234).replace("1.234", ""));
    check("een verhouding met decimalen en een teken erachter", o("2,41×")?.getal === 2.41 && o("2,41×")?.decimalen === 2 && o("2,41×")?.na === "×");
    check("een percentage", o("12,3%")?.getal === 12.3 && o("12,3%")?.na === "%");
    check("een negatief getal", o("-1.250")?.getal === -1250);
    check("een streepje is geen getal", o("—") === null && o("") === null);
    check("twee getallen in één tekst: niet tellen", o("3 van 5") === null);
    check("een punt als decimaalteken wordt niet als duizendtal gelezen", o("2.5") === null);

    check("aan het eind letterlijk de doeltekst", tussenTekst("1.246", "1.650", 1) === "1.650" && tussenTekst("1.246", "1.650", 1.4) === "1.650");
    check("aan het begin de begintekst, in de opmaak van het doel", tussenTekst("1.246", "1.650", 0) === "1.246");
    check("halverwege het midden, met duizendtallen", tussenTekst("1.246", "1.650", 0.5) === "1.448");
    check("een bedrag houdt zijn valutateken", tussenTekst(eur(1000), eur(2000), 0.5) === eur(1500));
    check("decimalen volgen het doel", tussenTekst("2,00×", "3,00×", 0.25) === "2,25×");
    check("van onder naar boven de duizend komen de punten erbij", tussenTekst("900", "1.100", 0.5) === "1.000");
    check("omlaag tellen werkt net zo", tussenTekst("1.650", "1.246", 0.5) === "1.448");
    check("een jaartal zonder punt blijft zonder punt", tussenTekst("2025", "2027", 0.5) === "2026");
    check("geen getal aan één kant: meteen het doel", tussenTekst("—", eur(12), 0.3) === eur(12) && tussenTekst(eur(12), "—", 0.3) === "—");
    check("een andere eenheid: meteen het doel", tussenTekst(eur(12), "12%", 0.3) === "12%");
  }

  // ── De hook ──────────────────────────────────────────────────────────────────────────────────
  const gezien: string[] = [];
  function Proef({ doel }: { doel: string }) {
    gezien.push(useTellendeTekst(doel));
    return null;
  }
  const maakRoot = () => createRoot(doc.createElement() as unknown as Element);
  const nu = () => gezien[gezien.length - 1];
  /** Speelt het eerstvolgende beeldje af op tijdstip `ms`; false als er geen wacht. */
  const beeldje = (ms: number): boolean => {
    const [id, f] = [...wachtrij.entries()][0] ?? [];
    if (id === undefined || !f) return false;
    wachtrij.delete(id);
    flushSync(() => f(ms));
    return true;
  };
  const getal = (t: string) => ontleedGetal(t)?.getal ?? NaN;

  console.log("Eerste render: geen telling");
  const root = maakRoot();
  const render = (doel: string) => flushSync(() => root.render(createElement(Proef, { doel })));
  {
    render("1.246");
    check("de waarde zelf", gezien.join("|") === "1.246", gezien.join("|"));
    check("en er is geen beeldje aangevraagd", wachtrij.size === 0);
    render("1.246");
    check("dezelfde waarde nog eens: nog steeds niets", wachtrij.size === 0 && nu() === "1.246");
  }

  console.log("Een nieuwe waarde: tellen, hooguit 300 ms, exact uitkomen");
  {
    render("1.650");
    check("vóór het eerste beeldje staat de oude waarde er nog (geen flits van de nieuwe)", nu() === "1.246", gezien.slice(-3).join("|"));
    check("er wacht precies één beeldje", wachtrij.size === 1);
    const stappen: string[] = [];
    // De klok begint bij het eerste beeldje; daarna om de 60 ms.
    for (const ms of [5000, 5060, 5120, 5180, 5240]) { beeldje(ms); stappen.push(nu()); }
    const waarden = stappen.map(getal);
    check("het eerste beeldje is het beginpunt", stappen[0] === "1.246", stappen.join("|"));
    check("onderweg alleen tussenstanden, oplopend", waarden.every((w, i) => w >= 1246 && w < 1650 && (i === 0 || w > waarden[i - 1])), stappen.join("|"));
    check("na 240 ms loopt hij nog", wachtrij.size === 1);
    beeldje(5300);
    check("op 300 ms staat de eindwaarde er, letterlijk", nu() === "1.650", nu());
    check("en daarna wordt er geen beeldje meer aangevraagd", wachtrij.size === 0);
    check("een later beeldje bestaat niet: de telling is klaar", beeldje(5400) === false && nu() === "1.650");
  }

  console.log("Een bedrag met valutateken, en omlaag");
  {
    render(eur(1650));
    check("van eenheid wisselen ('1.650' naar een bedrag) springt", nu() === eur(1650) && wachtrij.size === 0, nu());
    render(eur(980));
    beeldje(0);
    beeldje(150);
    check("halverwege een bedrag tussen de twee, met het valutateken", nu().startsWith(eur(1).replace("1", "")) && getal(nu()) < 1650 && getal(nu()) > 980, nu());
    beeldje(10_000);
    check("een laat beeldje (een haperende browser) komt ook exact uit", nu() === eur(980), nu());
  }

  console.log("Een nieuwe waarde onderweg: verder vanaf de tussenstand");
  {
    render(eur(2000));
    beeldje(0);
    beeldje(150);
    const tussen = getal(nu());
    check("voorwaarde: hij is onderweg", tussen > 980 && tussen < 2000, nu());
    const voor = afgezegd;
    render(eur(500));
    check("het lopende beeldje is afgezegd", afgezegd === voor + 1 && wachtrij.size === 1, `${afgezegd} ${wachtrij.size}`);
    check("hij springt niet terug naar het oude doel of naar het begin", getal(nu()) === tussen, nu());
    beeldje(1000);
    beeldje(1300);
    check("en komt op het nieuwste doel uit", nu() === eur(500) && wachtrij.size === 0, nu());
  }

  console.log("Geen getal: springen");
  {
    render("—");
    check("naar een streepje: direct", nu() === "—" && wachtrij.size === 0);
    render(eur(75));
    check("van een streepje naar een bedrag: direct", nu() === eur(75) && wachtrij.size === 0);
  }

  console.log("Minder beweging: de nieuwe waarde direct");
  {
    root.unmount();
    voorkeur.minder = true;
    gezien.length = 0;
    const stil = maakRoot();
    flushSync(() => stil.render(createElement(Proef, { doel: "1.246" })));
    flushSync(() => stil.render(createElement(Proef, { doel: "1.650" })));
    check("geen tussenstand, geen beeldje", gezien.every((t) => t === "1.246" || t === "1.650") && nu() === "1.650" && wachtrij.size === 0, gezien.join("|"));
    stil.unmount();
    voorkeur.minder = false;
  }

  console.log("Weg tijdens een telling: het beeldje wordt afgezegd");
  {
    gezien.length = 0;
    const kort = maakRoot();
    flushSync(() => kort.render(createElement(Proef, { doel: "10" })));
    flushSync(() => kort.render(createElement(Proef, { doel: "90" })));
    check("voorwaarde: er wacht een beeldje", wachtrij.size === 1);
    const voor = afgezegd;
    flushSync(() => kort.unmount());
    check("na unmount wacht er niets meer", wachtrij.size === 0 && afgezegd === voor + 1, `${wachtrij.size} ${afgezegd - voor}`);
  }

  // ── Bron: Kerncijfer gebruikt de hook ────────────────────────────────────────────────────────
  console.log("Bron: Kerncijfer");
  {
    const wortel = join(import.meta.dirname, "..");
    const tegel = readFileSync(join(wortel, "components/ui/kerncijfer.tsx"), "utf8");
    check("Kerncijfer telt met de gedeelde hook", /import \{ useTellendeTekst \} from "@\/lib\/beweging"/.test(tegel) && /const getoond = useTellendeTekst\(waarde\)/.test(tegel));
    check("en toont wat de hook geeft", /<p className=\{`mt-1\.5 \$\{maat\} \$\{kleur\}`\}>\{getoond\}<\/p>/.test(tegel));
    const beweging = readFileSync(join(wortel, "lib/beweging.ts"), "utf8");
    check("de duur is het token, geen los getal", /\(nu - begin\) \/ DUUR\.lang/.test(beweging));
    check("de voorkeur voor minder beweging wordt gelezen", /!minderNu\.current/.test(beweging) && /useMinderBeweging\(\)/.test(beweging));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

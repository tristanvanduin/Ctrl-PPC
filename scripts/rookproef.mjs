// Browser-rookproef: opent elke hoofdpagina van de demo-klant en faalt op wat tsc, de tests en de
// build per definitie niet zien.
//
// ── WAAROM DIT ER IS ────────────────────────────────────────────────────────
//
// Een renderfout in een onderdeel haalde de hele klantpagina onderuit terwijl tsc, 410 tests en de
// build groen stonden. De twee browserscripts die er waren (meet-overzicht, check-kaartoverloop)
// bezochten alleen het Overzicht en luisterden niet naar pageerror of mislukte antwoorden. Deze
// proef bezoekt Vandaag, Portfolio, Klanten, en per klant elk tabblad in de vertrouwde en de nieuwe
// weergave en elk kanaal, en faalt op:
//   - een pageerror (een fout die niemand ving);
//   - een consolefout (console.error, ook een fout die een error-grens ving en logde);
//   - een antwoord van 500 of hoger, op de pagina zelf of op een verzoek ervandaan;
//   - de foutpagina van Next, of een melding van een van onze error-grenzen (data-foutgrens):
//     een pagina die netjes "er ging iets mis" zegt, is voor een rookproef nog steeds kapot;
//   - een pagina zonder een enkel kerncijfer waar er een hoort (een leeg dashboard zonder fout);
//   - zijwaartse paginascroll op 390 px (de telefoon van de eigenaar).
// Plus: een tabblad waarvan de knop niet te vinden is, telt als fout. Anders toetst de proef
// stilletjes twee keer het Overzicht en noemt dat "Prognose OK".
//
// ── HOE EN WANNEER JE HEM DRAAIT ────────────────────────────────────────────
//
//   npx next build && npx next start -p 3190     (eerst bouwen, zonder draaiende server)
//   node scripts/rookproef.mjs                    (of: scripts/gates.sh browser)
//   node scripts/rookproef.mjs --zelftest         (alleen de zelftest; geen server nodig)
//
// Omgeving: BASIS_URL (http://localhost:3190), DEMO_CLIENT (demo-greentech), CHROMIUM (pad naar de
// browser), WACHT_MS (rust na een navigatie, 6000), ALLEEN (alleen pagina's waarvan de naam deze
// tekst bevat).
//
// ── DE ZELFTEST ─────────────────────────────────────────────────────────────
//
// Een controle die niet kan falen is geen controle. Aan het eind laadt het script een reeks bewust
// kapotte pagina's (zonder server: de browser krijgt ze via page.route op een nep-adres) en eist dat
// elk ervan om de juiste reden wordt afgekeurd, en dat een gezonde pagina wordt goedgekeurd. Keurt
// hij er een niet af, dan faalt het script: dan zei "OK" hierboven niets.

import { laadPlaywright } from "./playwright-laden.mjs";

const { chromium } = laadPlaywright();

const BASIS = process.env.BASIS_URL ?? "http://localhost:3190";
const KLANT = process.env.DEMO_CLIENT ?? "demo-greentech";
const CHROOM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const WACHT = Number(process.env.WACHT_MS ?? 6000);
const ALLEEN = process.env.ALLEEN ?? "";
const BREEDTE = 390;

/**
 * Wat er IN de pagina gemeten wordt. Los van de luisteraars (pageerror, console, antwoorden),
 * die buiten de pagina zitten.
 *
 * Een kerncijfer is een zichtbaar getal in grote letter: tekst met een cijfer erin, hoogstens
 * dertig tekens, met een lettergrootte van 18 px of meer. Dat dekt de Kerncijfer-component in beide
 * maten (text-figure en text-xl) en de cijfers van Portfolio, zonder op een klassenaam te leunen
 * die bij een restyle verandert. 18 en niet 20: op een telefoon verbergt Portfolio de grote cijfers
 * in de kop en toont dezelfde cijfers in kaarten van 18 px; met 20 keurde de proef die pagina af
 * als "leeg" terwijl alle cijfers er stonden.
 */
const MEET = () => {
  const zichtbaar = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
  };
  let kerncijfers = 0;
  const voorbeeld = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("nav, aside, script, style, noscript, template")) continue;
    // Alleen de eigen tekst van het element, niet die van zijn kinderen.
    const eigen = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!eigen || eigen.length > 30 || !/\d/.test(eigen)) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 18 || !zichtbaar(el)) continue;
    kerncijfers += 1;
    if (voorbeeld.length < 3) voorbeeld.push(eigen);
  }
  const tekst = document.body?.innerText ?? "";
  const nextFout =
    /Application error: a (client|server)-side exception has occurred/i.test(tekst) ? "Next: Application error"
      : /^\s*(500|404)\s*\|?\s*(Internal Server Error|This page could not be found)/m.test(tekst) ? "Next: standaard foutpagina"
        : document.querySelector("nextjs-portal") ? "Next: foutoverlay"
          : null;
  const foutgrenzen = [...document.querySelectorAll("[data-foutgrens]")].map((el) => el.getAttribute("data-foutgrens"));
  const doc = document.documentElement;
  return {
    kerncijfers,
    voorbeeld,
    nextFout,
    foutgrenzen,
    overloop: Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0) - doc.clientWidth,
  };
};

/** Zet de luisteraars op een pagina; `verzamel()` geeft wat er sinds de vorige keer binnenkwam. */
function luister(p) {
  let fouten = [];
  p.on("pageerror", (e) => fouten.push(`pageerror: ${String(e.message ?? e).slice(0, 200)}`));
  p.on("console", (m) => { if (m.type() === "error") fouten.push(`consolefout: ${m.text().slice(0, 200)}`); });
  p.on("response", (r) => { if (r.status() >= 500) fouten.push(`antwoord ${r.status()}: ${r.url().replace(BASIS, "").slice(0, 160)}`); });
  p.on("requestfailed", (r) => {
    // Afgebroken door een navigatie is geen fout van de pagina; een verbinding die wegvalt wel.
    const f = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) fouten.push(`verzoek mislukt: ${r.url().replace(BASIS, "").slice(0, 160)} (${f})`);
  });
  return () => { const uit = fouten; fouten = []; return uit; };
}

/** Beoordeelt de pagina zoals hij nu staat. */
/** Hoe lang een pagina na de vaste wachttijd nog krijgt om zijn eerste kerncijfer te tonen. */
const KERNCIJFER_GEDULD_MS = 10000;

async function beoordeel(p, verzamel, { kerncijfer }) {
  let m = await p.evaluate(MEET);
  // Een pagina die zijn cijfers na een eigen verzoek tekent (Portfolio laadt de klantenlijst en
  // daarna de cijfers) kan na de vaste wachttijd nog leeg zijn, vooral vlak na een build. Dan nog
  // tot KERNCIJFER_GEDULD_MS wachten tot er een cijfer staat, voor het oordeel "leeg" valt: een
  // pagina die echt leeg blijft, wordt na die tijd nog steeds afgekeurd.
  for (let t = 0; kerncijfer && m.kerncijfers === 0 && t < KERNCIJFER_GEDULD_MS; t += 500) {
    await p.waitForTimeout(500);
    m = await p.evaluate(MEET);
  }
  const fouten = [...verzamel()];
  if (m.nextFout) fouten.push(m.nextFout);
  for (const g of m.foutgrenzen) fouten.push(`error-grens toont een melding (${g})`);
  if (kerncijfer && m.kerncijfers === 0) fouten.push("geen enkel kerncijfer, terwijl hier cijfers horen");
  if (m.overloop > 1) fouten.push(`zijwaartse scroll: ${m.overloop}px breder dan ${BREEDTE}px`);
  return { fouten, meting: m };
}

/** Naam, adres, knoppen om in te drukken, en of er een kerncijfer hoort. */
function schermen() {
  const klant = (weergave, extra = "") => `${BASIS}/client/${KLANT}?demo=1&weergave=${weergave}${extra}`;
  const uit = [
    ["vandaag", `${BASIS}/vandaag?demo=1`, [], true],
    ["portfolio", `${BASIS}/portfolio?demo=1`, [], true],
    ["klanten", `${BASIS}/clients?demo=1`, [], false],
  ];
  // De tabbladen, met de sectieknop en dan de subknop, zoals check-kaartoverloop ze ook opent.
  // Een kerncijfer hoort op de tabbladen die cijfers tonen; Bevindingen, Sprint, Bestanden en de
  // instellingen tonen tekst en lijsten.
  const tabbladen = [
    ["overzicht", [], true],
    ["campagnes", [/^Prestaties$/, /^Campagnes$/], false],
    ["prognose", [/^Prestaties$/, /^Prognose$/], true],
    ["analyseren", [/Analyse & advies/, /^Analyseren$/], false],
    ["bevindingen", [/Analyse & advies/, /^Bevindingen$/], false],
    ["god-view", [/Analyse & advies/, /^God View$/], false],
    ["second-opinion", [/Analyse & advies/, /^Second opinion$/], false],
    ["sprint", [/Planning & rapportage/, /^Sprint$/], false],
    ["doelen", [/Planning & rapportage/, /Doelen & voortgang/], true],
    ["rapporten", [/Planning & rapportage/, /^Rapporten$/], false],
    // \b en geen $: met mislukte runs heet de knop "Bestanden 3" (client-dashboard.tsx), en juist
    // op de demo met veel mislukte runs gaf een exacte naam dan een onterechte "knop niet gevonden".
    ["bestanden", [/Planning & rapportage/, /^Bestanden\b/], false],
    ["instellingen", [/^Instellingen$/], false],
  ];
  for (const weergave of ["oud", "nieuw"]) {
    for (const [naam, knoppen, kc] of tabbladen) uit.push([`klant ${weergave} ${naam}`, klant(weergave), knoppen, kc]);
    for (const kanaal of ["google", "meta", "linkedin", "microsoft"]) {
      uit.push([`klant ${weergave} kanaal ${kanaal}`, klant(weergave, `&kanaal=${kanaal}`), [], true]);
    }
  }
  return uit.filter(([naam]) => naam.includes(ALLEEN));
}

async function ga(p, url, knoppen) {
  const antwoord = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(WACHT);
  const nietGevonden = [];
  for (const k of knoppen) {
    const knop = p.getByRole("button", { name: k }).first();
    if ((await knop.count()) === 0) { nietGevonden.push(String(k)); continue; }
    await knop.click().catch((e) => nietGevonden.push(`${k} (klik mislukt: ${String(e.message).slice(0, 80)})`));
    await p.waitForTimeout(Math.min(WACHT, 4500));
  }
  return { status: antwoord?.status() ?? 0, nietGevonden };
}

// ── De zelftest ─────────────────────────────────────────────────────────────

const NEP = "http://rookproef.invalid";
const html = (body, kop = "") => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${kop}</head><body style="margin:0">${body}</body></html>`;
const GEZOND = html(`<main><p style="font-size:32px">1.246</p><p>conversies</p></main>`);
const ZELFTEST = [
  { naam: "gezond", body: GEZOND, moet: null },
  { naam: "pageerror", body: html(`<main><p style="font-size:32px">1.246</p></main><script>setTimeout(() => { throw new Error("bewust kapot") }, 0)</script>`), moet: /pageerror/ },
  { naam: "consolefout", body: html(`<main><p style="font-size:32px">1.246</p></main><script>console.error("bewust gelogd")</script>`), moet: /consolefout/ },
  { naam: "antwoord 500", body: html(`<main><p style="font-size:32px">1.246</p></main><script>fetch("${NEP}/api/kapot")</script>`), moet: /antwoord 500/ },
  { naam: "foutpagina van Next", body: html(`<h2>Application error: a client-side exception has occurred (see the browser console for more information).</h2>`), moet: /Application error/, kerncijfer: false },
  { naam: "error-grens", body: html(`<main><p style="font-size:32px">1.246</p><div role="alert" data-foutgrens="het onderdeel Prognose">Er ging iets mis</div></main>`), moet: /error-grens/ },
  { naam: "geen kerncijfer", body: html(`<main><p>Nog geen gegevens</p><p style="font-size:12px">3 klanten</p></main>`), moet: /geen enkel kerncijfer/ },
  { naam: "zijwaartse scroll", body: html(`<main><p style="font-size:32px">1.246</p><div style="width:600px;height:10px"></div></main>`), moet: /zijwaartse scroll/ },
];

async function zelftest(browser) {
  console.log("\nZelftest: bewust kapotte pagina's moeten worden afgekeurd, een gezonde niet.");
  const ctx = await browser.newContext({ viewport: { width: BREEDTE, height: 844 } });
  const p = await ctx.newPage();
  const verzamel = luister(p);
  let mis = 0;
  for (const geval of ZELFTEST) {
    await p.unroute("**/*").catch(() => {});
    await p.route(`${NEP}/**`, (route) => {
      const url = route.request().url();
      if (url.endsWith("/api/kapot")) return route.fulfill({ status: 500, body: "kapot" });
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: geval.body });
    });
    await p.goto(`${NEP}/${encodeURIComponent(geval.naam)}`, { waitUntil: "load" });
    await p.waitForTimeout(300);
    const { fouten } = await beoordeel(p, verzamel, { kerncijfer: geval.kerncijfer ?? true });
    const goed = geval.moet === null ? fouten.length === 0 : fouten.some((f) => geval.moet.test(f));
    if (!goed) mis += 1;
    const uitleg = geval.moet === null
      ? (fouten.length === 0 ? "goedgekeurd" : `ten onrechte afgekeurd: ${fouten.join("; ")}`)
      : (goed ? `afgekeurd (${fouten.find((f) => geval.moet.test(f))})` : `NIET afgekeurd${fouten.length ? `, wel: ${fouten.join("; ")}` : ""}`);
    console.log(`  ${goed ? "OK  " : "FOUT"}  ${geval.naam.padEnd(20)} ${uitleg}`);
  }
  await ctx.close();
  return mis;
}

// ── Hoofdlijn ───────────────────────────────────────────────────────────────

async function main() {
  const alleenZelftest = process.argv.includes("--zelftest");
  const browser = await chromium.launch({ executablePath: CHROOM });
  let fout = 0;

  if (!alleenZelftest) {
    const lijst = schermen();
    console.log(`Rookproef op ${BASIS}, klant ${KLANT}, ${lijst.length} pagina's op ${BREEDTE}px.\n`);
    const ctx = await browser.newContext({ viewport: { width: BREEDTE, height: 844 } });
    const p = await ctx.newPage();
    const verzamel = luister(p);
    for (const [naam, url, knoppen, kerncijfer] of lijst) {
      let fouten;
      try {
        verzamel();
        const { status, nietGevonden } = await ga(p, url, knoppen);
        const uitslag = await beoordeel(p, verzamel, { kerncijfer });
        fouten = uitslag.fouten;
        if (status >= 500) fouten.unshift(`de pagina zelf gaf ${status}`);
        for (const k of nietGevonden) fouten.push(`knop ${k} niet gevonden: dit tabblad is niet getoetst`);
      } catch (e) {
        fouten = [`kon de pagina niet openen: ${String(e.message).slice(0, 160)}`];
      }
      // Dezelfde melding in twintig verzoeken is een bevinding.
      fouten = [...new Set(fouten)];
      fout += fouten.length > 0 ? 1 : 0;
      console.log(`  ${fouten.length === 0 ? "OK  " : "FOUT"}  ${naam}`);
      for (const f of fouten.slice(0, 8)) console.log(`          ${f}`);
      if (fouten.length > 8) console.log(`          en ${fouten.length - 8} meer`);
    }
    await ctx.close();
  }

  const zelftestMis = await zelftest(browser);
  await browser.close();

  if (zelftestMis > 0) {
    console.log(`\n  FOUT  de zelftest keurde ${zelftestMis} geval(len) verkeerd. Dan meet de proef iets anders`);
    console.log("        dan hij beweert, en is elke OK hierboven leeg.");
    process.exit(1);
  }
  if (fout > 0) {
    console.log(`\n  ${fout} pagina('s) afgekeurd.`);
    process.exit(1);
  }
  console.log(alleenZelftest ? "\n  Zelftest in orde (alleen de zelftest gedraaid, geen pagina's)." : "\n  Elke pagina doorstond de rookproef.");
}

main().catch((e) => { console.error(e); process.exit(1); });

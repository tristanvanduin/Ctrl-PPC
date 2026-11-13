// Cijfercontrole: leest in de browser dezelfde kerncijfers op meerdere pagina's af en meldt elk
// verschil dat groter is dan de afronding, met per vergelijking welke twee plekken.
//
// ── WAAROM DIT ER IS ────────────────────────────────────────────────────────
//
// Geen enkele poort legde een totaal op het Overzicht naast hetzelfde totaal elders. De doorlichting
// van 13 november vond juist daar de ernstigste fouten: hetzelfde jaardoel met op de ene plek Google
// alleen en op de andere alle kanalen, een percentage over een deel van de kanalen naast een totaal
// over alle kanalen, Portfolio dat alleen Google toont. De git-geschiedenis heeft het al eens
// gehad ("de weeksync telt dezelfde conversieacties als de maandsync"). Twee routes die elk een
// eigen venster of conversieselectie kiezen geven twee getallen voor dezelfde maand, en niets merkte
// het, want elk getal is op zichzelf plausibel.
//
// ── WAT ER VERGELEKEN WORDT ─────────────────────────────────────────────────
//
// Alle klantpagina's op hetzelfde venster (?periode=last_12m), zodat een verschil geen
// vensterverschil is:
//   1. Overzicht oud tegen Overzicht nieuw: dezelfde tegels (Conversies, Kosten, CPA, ROAS, Omzet).
//   2. Overzicht nieuw: de kanaalkaarten opgeteld tegen de totaaltegel (conversies en kosten).
//   3. Overzicht tegen Campagnes: conversies en kosten, als som van de totaalrijen per kanaal.
//   4. Prognose tegen Doelen & voortgang: het jaardoel (een doel is een invoer, geen berekening:
//      het hoort overal hetzelfde getal te zijn).
//   5. Portfolio (de rij met de link naar de demo-klant) tegen het Overzicht: conversies en kosten.
// "Gelijk" is: het verschil past binnen de afronding van de minst precieze van de twee weergaven
// ("1.246" tegen "1.245,6" is gelijk; "€ 12k" tegen "€ 12.480" ook, "1.246" tegen "1.250" niet).
// Een cijfer dat op een van de twee plekken niet af te lezen is, is NIET GEMETEN en staat bij naam
// in de uitslag. Dat is geen groen: exit 3 als er niets afwijkt maar wel iets niet gemeten is.
//
// ── HOE JE HEM DRAAIT ───────────────────────────────────────────────────────
//
//   npx next build && npx next start -p 3190     (eerst bouwen, zonder draaiende server)
//   node scripts/check-cijfers-gelijk.mjs         (of: scripts/gates.sh browser)
//   node scripts/check-cijfers-gelijk.mjs --zelftest
//
// Omgeving: BASIS_URL, DEMO_CLIENT, CHROMIUM, WACHT_MS, zoals scripts/rookproef.mjs.
//
// ── DE ZELFTEST ─────────────────────────────────────────────────────────────
//
// Aan het eind laadt het script twee nep-pagina's (zonder server, via page.route) met een bewust
// verschil en een verschil dat binnen de afronding valt, en eist dat de controle het eerste meldt en
// het tweede niet. Ook de kanaalkaartsom wordt zo nagespeeld. Faalt de zelftest, dan faalt het script.

import { laadPlaywright } from "./playwright-laden.mjs";

const { chromium } = laadPlaywright();

const BASIS = process.env.BASIS_URL ?? "http://localhost:3190";
const KLANT = process.env.DEMO_CLIENT ?? "demo-greentech";
const CHROOM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const WACHT = Number(process.env.WACHT_MS ?? 8000);
const VENSTER = "last_12m";

// ── Getallen lezen ──────────────────────────────────────────────────────────

/**
 * Leest een getal in nl-NL-notatie, met de stap van de weergave: de kleinste eenheid die er staat.
 * "1.246" → 1246 (stap 1), "€ 45,20" → 45.2 (stap 0.01), "2,41×" → 2.41, "12,3%" → 12.3,
 * "€ 12k" / "12,5 k" → 12000 / 12500 (stap 1000 / 100), "1,2 mln" → 1200000 (stap 100000).
 * null als er geen getal staat ("—", "n.v.t.").
 */
export function leesGetal(tekst) {
  if (typeof tekst !== "string") return null;
  const t = tekst.replace(/ /g, " ").trim();
  const m = /(-|−)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(k|mln|mld)?\b/i.exec(t);
  if (!m) return null;
  const heel = Number(m[2].replace(/\./g, ""));
  const dec = m[3] ?? "";
  const factor = { k: 1e3, mln: 1e6, mld: 1e9 }[(m[4] ?? "").toLowerCase()] ?? 1;
  const teken = m[1] ? -1 : 1;
  const waarde = teken * (heel + (dec ? Number(`0.${dec}`) : 0)) * factor;
  const stap = (dec ? 10 ** -dec.length : 1) * factor;
  return { waarde, stap };
}

/** Gelijk binnen de afronding van de minst precieze weergave (een halve stap, plus wat zwevend stof). */
export function gelijkBinnenAfronding(a, b) {
  const marge = Math.max(a.stap, b.stap) / 2 + 1e-9 * Math.max(Math.abs(a.waarde), Math.abs(b.waarde), 1);
  return Math.abs(a.waarde - b.waarde) <= marge;
}

/** Telt gelezen getallen op; de stap van de som is de grootste stap (de onzekerheid telt mee). */
function som(getallen) {
  return {
    waarde: getallen.reduce((s, g) => s + g.waarde, 0),
    stap: getallen.reduce((s, g) => s + g.stap, 0),
  };
}

// ── Wat er IN de pagina gelezen wordt ───────────────────────────────────────

/**
 * Tegels: elk zichtbaar getal van 18 px of groter, met als label de tekst van het element ervoor
 * (zo staat het in Kerncijfer: een label en daaronder het getal). textContent en niet innerText:
 * de labels staan met CSS in hoofdletters, en dan zou "CONVERSIES" niet "Conversies" zijn.
 * Kanaalkaarten: de beschrijving voor schermlezers (#kanaalkaart-<kanaal>) zegt voluit
 * "Conversies: 1.234 ... Kosten: € 5.678"; dat is stabieler dan de opmaak van de kaart.
 * Tabelrijen: per tabel de koppen, en de rij van de klant. Die rij wordt gekozen op de LINK naar
 * /client/<id>, niet op de tekst: het scorebord toont de naam ("GreenTech (demo)"), en het id staat
 * alleen in de href, die niet in textContent zit. Een eerdere versie zocht het id in de tekst, vond
 * daardoor nooit een rij, en de Portfolio-vergelijking was zo altijd NIET GEMETEN.
 * Totaalrijen: per tabel de rij in tfoot (TotaalRij in data-table.tsx). Campagnes heeft een tabel
 * per kanaal, elk met een eigen totaal; "alle kanalen" is de som daarvan.
 */
const LEES = (klant) => {
  const schoon = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const tegels = [];
  for (const el of document.querySelectorAll("main *, body > div *")) {
    const eigen = schoon([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""));
    if (!eigen || eigen.length > 24 || !/\d/.test(eigen)) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 18 || cs.display === "none" || el.getClientRects().length === 0) continue;
    const label = schoon(el.previousElementSibling?.textContent);
    if (label && label.length <= 40) tegels.push({ label, tekst: eigen });
  }
  const kaarten = [...document.querySelectorAll("[id^='kanaalkaart-']")].map((el) => {
    const t = schoon(el.textContent);
    return {
      kanaal: el.id.replace("kanaalkaart-", ""),
      conversies: /Conversies: ([^,.]*(?:\.\d{3})*)/.exec(t)?.[1] ?? null,
      kosten: /Kosten: (\S{0,3}\s?\d[\d.]*(?:,\d+)?)/.exec(t)?.[1] ?? null,
    };
  });
  const rijen = [];
  const totalen = [];
  const vanKlant = (tr) => {
    const id = klant.toLowerCase();
    for (const a of tr.querySelectorAll("a[href]")) {
      const pad = new URL(a.getAttribute("href"), location.href).pathname.replace(/\/+$/, "").toLowerCase();
      if (pad.endsWith(`/client/${id}`)) return true;
    }
    return schoon(tr.textContent).toLowerCase().includes(id);
  };
  for (const tabel of document.querySelectorAll("table")) {
    const koppen = [...tabel.querySelectorAll("thead th")].map((th) => schoon(th.textContent));
    const alsRij = (tr) => {
      const cellen = [...tr.querySelectorAll("td, th")].map((td) => schoon(td.textContent));
      return Object.fromEntries(koppen.map((k, i) => [k, cellen[i] ?? null]));
    };
    for (const tr of tabel.querySelectorAll("tbody tr")) if (vanKlant(tr)) rijen.push(alsRij(tr));
    const voet = tabel.querySelector("tfoot tr");
    if (voet) totalen.push(alsRij(voet));
  }
  return { tegels, kaarten, rijen, totalen };
};

/** De eerste tegel waarvan het label op het patroon past. */
const tegel = (gelezen, patroon) => gelezen?.tegels.find((t) => patroon.test(t.label)) ?? null;
/** De cel onder een kop die op het patroon past, in de rij van de klant. */
const cel = (gelezen, patroon) => {
  for (const rij of gelezen?.rijen ?? []) {
    const kop = Object.keys(rij).find((k) => patroon.test(k));
    if (kop && rij[kop]) return { label: kop, tekst: rij[kop] };
  }
  return null;
};

/**
 * De som van de totaalrijen, onder de eerste kop die op het patroon past. null als er geen
 * totaalrij is, of als een totaalrij die kolom wel heeft maar er geen getal in staat: een som die
 * stil een tabel overslaat, is een kleiner getal en geen meting.
 */
const totaalSom = (gelezen, patroon) => {
  const getallen = [];
  for (const rij of gelezen?.totalen ?? []) {
    const kop = Object.keys(rij).find((k) => patroon.test(k));
    if (!kop) continue;
    const g = leesGetal(rij[kop]);
    if (!g) return null;
    getallen.push(g);
  }
  return getallen.length > 0 ? { getal: som(getallen), n: getallen.length } : null;
};

// ── De vergelijkingen ───────────────────────────────────────────────────────

const TEGELS = [
  ["Conversies", /^conversies$/i],
  ["Kosten", /^(kosten|spend|ad ?spend|uitgaven)$/i],
  ["CPA", /^cpa$/i],
  ["ROAS", /^roas$/i],
  ["Omzet", /^(omzet|opbrengst|revenue)$/i],
];

/** Elke vergelijking: welke twee plekken, en de twee gelezen teksten (of null). */
function vergelijkingen(p) {
  const uit = [];
  const paar = (wat, plekA, a, plekB, b) => uit.push({ wat, plekA, plekB, a: a?.tekst ?? null, b: b?.tekst ?? null });

  for (const [naam, patroon] of TEGELS) {
    paar(`${naam}`, "Overzicht oud (tegel)", tegel(p.oud, patroon), "Overzicht nieuw (tegel)", tegel(p.nieuw, patroon));
  }

  const kaarten = p.nieuw?.kaarten ?? [];
  const somVan = (veld) => {
    const gelezen = kaarten.map((k) => leesGetal(k[veld]));
    return kaarten.length >= 2 && gelezen.every(Boolean) ? som(gelezen) : null;
  };
  uit.push({ wat: "Conversies", plekA: `kanaalkaarten opgeteld (${kaarten.map((k) => k.kanaal).join("+") || "geen"})`, plekB: "Overzicht nieuw (totaaltegel)",
    aGetal: somVan("conversies"), b: tegel(p.nieuw, /^conversies$/i)?.tekst ?? null });
  uit.push({ wat: "Kosten", plekA: `kanaalkaarten opgeteld (${kaarten.map((k) => k.kanaal).join("+") || "geen"})`, plekB: "Overzicht nieuw (totaaltegel)",
    aGetal: somVan("kosten"), b: tegel(p.nieuw, TEGELS[1][1])?.tekst ?? null });

  // Campagnes: de totaalrijen van de tabellen per kanaal opgeteld. Een tegel met het label
  // Conversies staat op dat tabblad niet, dus een vergelijking op tegels was daar nooit gemeten.
  const campConv = totaalSom(p.campagnes, /^(conversies|conv\.?|leads|aanvragen)\b/i);
  const campKosten = totaalSom(p.campagnes, /^(kosten|spend|uitgaven)\b/i);
  uit.push({ wat: "Conversies", plekA: "Overzicht oud (tegel)", a: tegel(p.oud, /^conversies$/i)?.tekst ?? null,
    plekB: `Campagnes, totaalrijen opgeteld (${campConv?.n ?? 0} tabel(len))`, bGetal: campConv?.getal ?? null });
  uit.push({ wat: "Kosten", plekA: "Overzicht oud (tegel)", a: tegel(p.oud, TEGELS[1][1])?.tekst ?? null,
    plekB: `Campagnes, totaalrijen opgeteld (${campKosten?.n ?? 0} tabel(len))`, bGetal: campKosten?.getal ?? null });

  paar("Jaardoel", "Prognose", tegel(p.prognose, /doel/i), "Doelen & voortgang", tegel(p.doelen, /doel/i));

  paar("Conversies", "Portfolio (rij van de klant)", cel(p.portfolio, /conversies/i), "Overzicht oud (tegel)", tegel(p.oud, /^conversies$/i));
  paar("Kosten", "Portfolio (rij van de klant)", cel(p.portfolio, /kosten|spend/i), "Overzicht oud (tegel)", tegel(p.oud, TEGELS[1][1]));
  return uit;
}

/** Beoordeelt een vergelijking: "gelijk", "verschil" of "niet gemeten", met uitleg. */
function beoordeel(v) {
  const a = v.aGetal ?? leesGetal(v.a);
  const b = v.bGetal ?? leesGetal(v.b);
  const toon = (g, t) => t ?? (g ? String(Math.round(g.waarde * 100) / 100) : "niet af te lezen");
  if (!a || !b) return { uitslag: "niet gemeten", tekst: `${v.plekA}: ${toon(a, v.a)}; ${v.plekB}: ${toon(b, v.b)}` };
  const gelijk = gelijkBinnenAfronding(a, b);
  return { uitslag: gelijk ? "gelijk" : "verschil", tekst: `${v.plekA}: ${toon(a, v.a)}  tegen  ${v.plekB}: ${toon(b, v.b)}` };
}

// ── Pagina's ophalen ────────────────────────────────────────────────────────

async function lees(p, url, knoppen = []) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(WACHT);
  for (const k of knoppen) {
    const knop = p.getByRole("button", { name: k }).first();
    if ((await knop.count()) === 0) return null; // het tabblad is er niet: dan is niets gelezen
    await knop.click();
    await p.waitForTimeout(4500);
  }
  return p.evaluate(LEES, KLANT);
}

async function draai(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const klant = (weergave) => `${BASIS}/client/${KLANT}?demo=1&weergave=${weergave}&periode=${VENSTER}`;
  const gelezen = {
    oud: await lees(p, klant("oud")),
    nieuw: await lees(p, klant("nieuw")),
    campagnes: await lees(p, klant("oud"), [/^Prestaties$/, /^Campagnes$/]),
    prognose: await lees(p, klant("oud"), [/^Prestaties$/, /^Prognose$/]),
    doelen: await lees(p, klant("oud"), [/Planning & rapportage/, /Doelen & voortgang/]),
    portfolio: await lees(p, `${BASIS}/portfolio?demo=1&periode=${VENSTER}`),
  };
  await ctx.close();
  return vergelijkingen(gelezen);
}

// ── De zelftest ─────────────────────────────────────────────────────────────

const NEP = "http://cijfers.invalid";
const tegelHtml = (paren) => paren.map(([l, w]) => `<div><p>${l}</p><p style="font-size:32px">${w}</p></div>`).join("");
const kaartHtml = (kaarten) => kaarten.map(([k, c, e]) => `<span id="kanaalkaart-${k}" style="position:absolute;left:-9999px">Over 12 mnd. Conversies: ${c}, dat is 50 procent van alle kanalen. Kosten: ${e}, 50 procent. CPA: € 40.</span>`).join("");
const campagneTabel = (kanaal, convLabel, spend, conv) =>
  `<h3>${kanaal}</h3><table><thead><tr><th>Campagne</th><th>Spend <span>aandeel</span></th><th>${convLabel} <span>aandeel</span></th><th>CPA</th></tr></thead>` +
  `<tbody><tr><td>${kanaal} | Brand</td><td>${spend}</td><td>${conv}</td><td>€ 40</td></tr></tbody>` +
  `<tfoot><tr><td>Totaal</td><td>${spend}</td><td>${conv}</td><td>€ 40</td></tr></tfoot></table>`;
const portfolioTabel = (rijen) =>
  `<table><thead><tr><th>Klant</th><th>Conversies</th><th>Kosten</th></tr></thead><tbody>` +
  rijen.map(([naam, href, conv, kosten]) => `<tr><td><a href="${href}">${naam}</a></td><td>${conv}</td><td>${kosten}</td></tr>`).join("") +
  `</tbody></table>`;
const pagina = (inhoud) => `<!doctype html><html><body><main>${inhoud}</main></body></html>`;

async function zelftest(browser) {
  console.log("\nZelftest: een bewust verschil moet gemeld worden, een afrondingsverschil niet.");
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const paginas = {
    oud: pagina(tegelHtml([["Conversies", "1.246"], ["Kosten", "€ 49.870"], ["CPA", "€ 40,02"]])),
    // Conversies wijken echt af; CPA verschilt alleen in afronding; kosten in "k"-notatie, binnen de stap.
    nieuw: pagina(tegelHtml([["Conversies", "1.312"], ["Kosten", "€ 50k"], ["CPA", "€ 40"]]) + kaartHtml([["google", "1.000", "€ 40.000"], ["meta", "246", "€ 9.870"]])),
    // Zoals campaigns-per-channel.tsx: een tabel per kanaal, het totaal in tfoot, de kop met bijschrift.
    campagnes: pagina(campagneTabel("Google Ads", "Conversies", "€ 40.000", "1.000") + campagneTabel("LinkedIn", "Leads", "€ 9.870", "246")),
    // Zoals portfolio-scoreboard.tsx: de NAAM in de rij, het id alleen in de href. Een andere klant
    // erboven, zodat een lezer die de eerste rij pakt het verkeerde getal krijgt.
    portfolio: pagina(portfolioTabel([["Andere klant", "/client/iemand-anders", "88", "€ 3.100"], ["GreenTech (demo)", `/client/${KLANT}`, "1.246", "€ 49.870"]])),
  };
  await p.route(`${NEP}/**`, (route) => {
    const naam = new URL(route.request().url()).pathname.slice(1);
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: paginas[naam] ?? pagina("") });
  });
  const lezen = async (naam) => { await p.goto(`${NEP}/${naam}`); return p.evaluate(LEES, KLANT); };
  const v = vergelijkingen({
    oud: await lezen("oud"), nieuw: await lezen("nieuw"),
    campagnes: await lezen("campagnes"), portfolio: await lezen("portfolio"),
  });
  await ctx.close();

  const uitslag = (wat, plekA, plekB = "") => {
    const gevonden = v.find((x) => x.wat === wat && x.plekA.startsWith(plekA) && x.plekB.startsWith(plekB));
    return gevonden ? beoordeel(gevonden).uitslag : "ontbreekt";
  };
  const eisen = [
    ["een echt verschil (1.246 tegen 1.312) wordt gemeld", uitslag("Conversies", "Overzicht oud", "Overzicht nieuw") === "verschil"],
    ["een afrondingsverschil (€ 40,02 tegen € 40) niet", uitslag("CPA", "Overzicht oud", "Overzicht nieuw") === "gelijk"],
    ["€ 49.870 tegen € 50k valt binnen de stap van 1k", uitslag("Kosten", "Overzicht oud", "Overzicht nieuw") === "gelijk"],
    ["kaarten 1.000 + 246 tegen tegel 1.312 wordt gemeld", uitslag("Conversies", "kanaalkaarten") === "verschil"],
    ["kaartkosten € 49.870 tegen tegel € 50k niet", uitslag("Kosten", "kanaalkaarten") === "gelijk"],
    ["een tegel die er niet is, is niet gemeten (en niet gelijk)", uitslag("ROAS", "Overzicht oud", "Overzicht nieuw") === "niet gemeten"],
    ["Campagnes: totaalrijen opgeteld (1.000 + 246) gelijk aan de tegel 1.246", uitslag("Conversies", "Overzicht oud", "Campagnes") === "gelijk"],
    ["Campagnes: kosten uit de totaalrijen opgeteld gelijk aan € 49.870", uitslag("Kosten", "Overzicht oud", "Campagnes") === "gelijk"],
    ["Portfolio: de rij wordt via de link gevonden, niet via de tekst", uitslag("Conversies", "Portfolio") === "gelijk"],
    ["Portfolio: kosten van de juiste rij (niet de eerste)", uitslag("Kosten", "Portfolio") === "gelijk"],
    ["leesGetal: '1.246' is 1246", leesGetal("1.246")?.waarde === 1246],
    ["leesGetal: '€ 45,20' is 45,2 met stap 0,01", leesGetal("€ 45,20")?.waarde === 45.2 && leesGetal("€ 45,20")?.stap === 0.01],
    ["leesGetal: '—' is geen getal", leesGetal("—") === null],
  ];
  let mis = 0;
  for (const [label, goed] of eisen) {
    if (!goed) mis += 1;
    console.log(`  ${goed ? "OK  " : "FOUT"}  ${label}`);
  }
  return mis;
}

// ── Hoofdlijn ───────────────────────────────────────────────────────────────

async function main() {
  const alleenZelftest = process.argv.includes("--zelftest");
  const browser = await chromium.launch({ executablePath: CHROOM });
  let verschil = 0, nietGemeten = 0;

  if (!alleenZelftest) {
    console.log(`Cijfercontrole op ${BASIS}, klant ${KLANT}, venster ${VENSTER}.\n`);
    for (const v of await draai(browser)) {
      const b = beoordeel(v);
      if (b.uitslag === "verschil") verschil += 1;
      if (b.uitslag === "niet gemeten") nietGemeten += 1;
      const teken = b.uitslag === "gelijk" ? "OK  " : b.uitslag === "verschil" ? "FOUT" : "NIET";
      console.log(`  ${teken}  ${v.wat.padEnd(11)} ${b.tekst}`);
    }
  }

  const mis = await zelftest(browser);
  await browser.close();

  if (mis > 0) {
    console.log(`\n  FOUT  de zelftest faalde op ${mis} punt(en): dan zegt "gelijk" hierboven niets.`);
    process.exit(1);
  }
  if (verschil > 0) {
    console.log(`\n  ${verschil} cijfer(s) verschillen tussen twee plekken, meer dan de afronding verklaart.`);
    process.exit(1);
  }
  if (nietGemeten > 0) {
    console.log(`\n  Geen verschil gevonden, maar ${nietGemeten} vergelijking(en) niet gemeten (zie NIET hierboven).`);
    console.log("  Niet gemeten is niet gelijk: het cijfer staat op een van de twee plekken niet, of heet daar anders.");
    process.exit(3);
  }
  console.log(alleenZelftest ? "\n  Zelftest in orde (alleen de zelftest gedraaid)." : "\n  Elk vergeleken cijfer is op beide plekken gelijk.");
}

main().catch((e) => { console.error(e); process.exit(1); });

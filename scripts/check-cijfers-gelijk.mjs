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
//   3. Overzicht nieuw tegen Campagnes nieuw: conversies en kosten uit de totaalrij van de
//      kanaaltotalen (data-cijfer="kanaaltotaal-*"). Alleen in de nieuwe weergave: daar staat die
//      tabel op Campagnes en volgt hij de gekozen periode. De campagnetabellen eronder (en heel
//      Campagnes in de vertrouwde weergave) hebben een vast venster, 90 dagen of hele maanden sinds
//      90 dagen terug, en hun totaal is dus geen 12 maanden: dat naast het Overzicht leggen geeft een
//      verschil dat niets zegt. Een eerdere versie telde die tfoot's op en las er nooit iets.
//   4. Prognose tegen Doelen & voortgang: het jaardoel (een doel is een invoer, geen berekening:
//      het hoort overal hetzelfde getal te zijn), op data-cijfer="jaardoel", per KPI (data-kpi):
//      de Prognose toont het doel van een KPI, Doelen een kaart per KPI. Het stond op beide
//      schermen in kleine tekst ("vs. doel 1.650 (-24%)", "Doel: 1.650"), en de tegellezer zag
//      alleen getallen vanaf 18 px: het jaardoel was zo altijd NIET GEMETEN. Alleen over dezelfde
//      reeks (data-reeks, google of blended): zonder ingevoerd doel schat elke reeks een eigen doel,
//      en Doelen rekent op Google zolang Alle kanalen niet geladen is. Een andere reeks is NIET
//      GEMETEN, geen verschil.
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
// Aan het eind laadt het script nep-pagina's (zonder server, via page.route) met een bewust
// verschil en een verschil dat binnen de afronding valt, en eist dat de controle het eerste meldt en
// het tweede niet. Ook de kanaalkaartsom, de kanaaltotalen op Campagnes en het jaardoel worden zo
// nagespeeld, elk met een pagina die goedgekeurd, een die afgekeurd en een die niet gemeten moet
// worden. Faalt de zelftest, dan faalt het script.

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
 * Gemerkte cijfers: elk zichtbaar element met data-cijfer (en eventueel data-kpi). Dat zet de pagina
 * er zelf op waar een cijfer niet als tegel staat (het jaardoel, de kanaaltotalen op Campagnes): een
 * attribuut verschuift niet mee met de opmaak of de tekst eromheen.
 */
const LEES = (klant) => {
  const schoon = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const tegels = [];
  for (const el of document.querySelectorAll("main *, body > div *")) {
    const eigen = schoon([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""));
    if (!eigen || eigen.length > 24 || !/\d/.test(eigen)) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 18 || cs.display === "none" || el.getClientRects().length === 0) continue;
    // Een verandering ("+6%", "-7,5%") is geen kerncijfer, ook al staat hij groot onder een label:
    // zo las de controle "+6%" als de kosten en vergeleek dat met een bedrag.
    if (/^[+\u2212-]/.test(eigen) || /%$/.test(eigen)) continue;
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
  }
  const cijfers = [...document.querySelectorAll("[data-cijfer]")]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => ({ naam: el.getAttribute("data-cijfer"), kpi: el.getAttribute("data-kpi"), reeks: el.getAttribute("data-reeks"), tekst: schoon(el.textContent) }));
  return { tegels, kaarten, rijen, cijfers };
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

/** Het eerste gemerkte cijfer met deze naam (en, als gegeven, deze KPI). */
const cijfer = (gelezen, naam, kpi = undefined) =>
  gelezen?.cijfers?.find((c) => c.naam === naam && (kpi === undefined || c.kpi === kpi)) ?? null;

// ── De vergelijkingen ───────────────────────────────────────────────────────

const TEGELS = [
  ["Conversies", /^conversies$/i],
  ["Kosten", /^(advertentie)?(kosten|spend|ad ?spend|uitgaven)$/i],
  ["CPA", /^cpa$/i],
  ["ROAS", /^roas$/i],
  ["Omzet", /^(omzet|opbrengst|revenue)$/i],
];

/** Elke vergelijking: welke twee plekken, en de twee gelezen teksten (of null). */
function vergelijkingen(p) {
  const uit = [];
  // `reden`: waarom niet gemeten, als er een kant ontbreekt. `nietVergelijkbaar`: beide kanten staan er,
  // maar gaan niet over hetzelfde (dan is een verschil geen fout, en gelijk ook geen bewijs).
  const paar = (wat, plekA, a, plekB, b, reden = null, nietVergelijkbaar = null) =>
    uit.push({ wat, plekA, plekB, a: a?.tekst ?? null, b: b?.tekst ?? null, reden, nietVergelijkbaar });

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

  // Campagnes: de totaalrij van de kanaaltotalen (cross-channel-view.tsx, alleenTabel), in de nieuwe
  // weergave en dus tegen het Overzicht in de nieuwe weergave. Zie de kop voor waarom de
  // campagnetabellen eronder niet meetellen.
  // De reden noemt de kant die ontbreekt: een regel over de kanaaltotalen terwijl juist het tabblad
  // niet openging of de tegel ontbrak, stuurt de zoektocht de verkeerde kant op.
  for (const [naam, patroon, merk] of [["Conversies", /^conversies$/i, "kanaaltotaal-conversies"], ["Kosten", TEGELS[1][1], "kanaaltotaal-kosten"]]) {
    const a = tegel(p.nieuw, patroon), b = cijfer(p.campagnes, merk);
    const reden = !p.campagnes ? "het tabblad Campagnes kon niet geopend worden (knop Prestaties of Campagnes niet gevonden)"
      : !b ? "geen kanaaltotalen op Campagnes: die staan er alleen in de nieuwe weergave, bij Alle kanalen en met meer dan een kanaal"
        : !a ? `geen tegel ${naam} op Overzicht nieuw` : null;
    paar(naam, "Overzicht nieuw (tegel)", a, "Campagnes nieuw (kanaaltotalen, totaalrij)", b, reden);
  }

  // Het jaardoel: de KPI die de Prognose toont, en op Doelen & voortgang de kaart van diezelfde KPI.
  // Alleen over dezelfde reeks (data-reeks): zonder ingevoerd doel schat elke reeks zijn eigen doel
  // (vorig jaar +10%), en Doelen rekent op Google zolang Alle kanalen niet geladen is.
  const doelPrognose = cijfer(p.prognose, "jaardoel");
  const kpi = doelPrognose?.kpi ?? null;
  const doelDoelen = kpi ? cijfer(p.doelen, "jaardoel", kpi) : null;
  const reeksA = doelPrognose?.reeks ?? "?", reeksB = doelDoelen?.reeks ?? "?";
  paar("Jaardoel", `Prognose (${kpi ?? "geen KPI"}, ${reeksA})`, doelPrognose, `Doelen & voortgang (${kpi ?? "geen KPI"}, ${reeksB})`, doelDoelen,
    !p.prognose ? "het tabblad Prognose kon niet geopend worden (knop Prestaties of Prognose niet gevonden)"
      : !doelPrognose ? "de Prognose toont geen jaardoel (geen doel ingesteld, of de prognose laadde niet)"
        : !p.doelen ? "het tabblad Doelen & voortgang kon niet geopend worden (knop niet gevonden)"
          : `Doelen & voortgang heeft geen kaart met een jaardoel voor ${kpi}`,
    reeksA === "?" || reeksA !== reeksB
      ? `de twee doelen gaan over een andere reeks (Prognose: ${reeksA}, Doelen: ${reeksB}); dan kan het doel terecht verschillen`
      : null);

  // Portfolio toont alleen Google Ads en zegt dat in zijn kop (lib/portfolio-kop.ts). Hij hoort dus
  // gelijk te zijn aan de Google-kaart, niet aan het totaal over alle kanalen: tegen dat totaal
  // stond hier elke klant met meer dan een kanaal als "verschil", terwijl beide schermen klopten.
  const google = p.nieuw?.kaarten.find((k) => k.kanaal === "google");
  paar("Conversies", "Portfolio (rij van de klant, alleen Google)", cel(p.portfolio, /conversies/i), "kanaalkaart Google", google?.conversies ? { label: "Google", tekst: google.conversies } : null);
  paar("Kosten", "Portfolio (rij van de klant, alleen Google)", cel(p.portfolio, /kosten|spend/i), "kanaalkaart Google", google?.kosten ? { label: "Google", tekst: google.kosten } : null);
  return uit;
}

/** Beoordeelt een vergelijking: "gelijk", "verschil" of "niet gemeten", met uitleg. */
function beoordeel(v) {
  const a = v.aGetal ?? leesGetal(v.a);
  const b = v.bGetal ?? leesGetal(v.b);
  const toon = (g, t) => t ?? (g ? String(Math.round(g.waarde * 100) / 100) : "niet af te lezen");
  if (!a || !b) return { uitslag: "niet gemeten", tekst: `${v.plekA}: ${toon(a, v.a)}; ${v.plekB}: ${toon(b, v.b)}${v.reden ? ` (${v.reden})` : ""}` };
  if (v.nietVergelijkbaar) return { uitslag: "niet gemeten", tekst: `${v.plekA}: ${toon(a, v.a)}; ${v.plekB}: ${toon(b, v.b)} (${v.nietVergelijkbaar})` };
  const gelijk = gelijkBinnenAfronding(a, b);
  return { uitslag: gelijk ? "gelijk" : "verschil", tekst: `${v.plekA}: ${toon(a, v.a)}  tegen  ${v.plekB}: ${toon(b, v.b)}` };
}

// ── Pagina's ophalen ────────────────────────────────────────────────────────

/**
 * Opent de pagina, klikt de tabbladen (die hebben geen eigen adres: client-dashboard.tsx houdt het
 * tabblad in state) en leest af. Met `wachtOp` wacht hij daarna tot er een gemerkt cijfer staat, tot
 * WACHT ms: de Prognose en de kanaaltotalen laden hun data pas na de klik, en een vaste pauze die
 * net te kort is, leest als "staat er niet".
 */
async function lees(p, url, knoppen = [], wachtOp = null) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(WACHT);
  for (const k of knoppen) {
    const knop = p.getByRole("button", { name: k }).first();
    if ((await knop.count()) === 0) return null; // het tabblad is er niet: dan is niets gelezen
    await knop.click();
    await p.waitForTimeout(4500);
  }
  if (wachtOp) await p.waitForSelector(wachtOp, { timeout: WACHT }).catch(() => {});
  return p.evaluate(LEES, KLANT);
}

async function draai(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const klant = (weergave) => `${BASIS}/client/${KLANT}?demo=1&weergave=${weergave}&periode=${VENSTER}`;
  const gelezen = {
    oud: await lees(p, klant("oud")),
    nieuw: await lees(p, klant("nieuw")),
    campagnes: await lees(p, klant("nieuw"), [/^Prestaties$/, /^Campagnes$/], "[data-cijfer^='kanaaltotaal-']"),
    prognose: await lees(p, klant("oud"), [/^Prestaties$/, /^Prognose$/], "[data-cijfer='jaardoel']"),
  };
  // Doelen rekent eerst op Google en schakelt over op Alle kanalen zodra die geladen is: wacht op een
  // doel over de reeks van de Prognose, anders leest hij het kortstondige Google-doel.
  const reeks = cijfer(gelezen.prognose, "jaardoel")?.reeks;
  gelezen.doelen = await lees(p, klant("oud"), [/Planning & rapportage/, /Doelen & voortgang/],
    reeks ? `[data-cijfer='jaardoel'][data-reeks='${reeks}']` : "[data-cijfer='jaardoel']");
  gelezen.portfolio = await lees(p, `${BASIS}/portfolio?demo=1&periode=${VENSTER}`);
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
// Zoals de kanaaltotalen in cross-channel-view.tsx: de totaalrij met de gemerkte cijfers.
const kanaaltotalen = (kosten, conv, stijl = "") =>
  `<div style="${stijl}"><h3>Kanaaltotalen</h3><table><thead><tr><th>Kanaal</th><th>Spend</th><th>Klikken</th><th>Conversies</th></tr></thead>` +
  `<tfoot><tr><td>Totaal</td><td><span data-cijfer="kanaaltotaal-kosten">${kosten}</span></td><td>9.000</td>` +
  `<td><span data-cijfer="kanaaltotaal-conversies">${conv}</span></td></tr></tfoot></table></div>`;
// Zoals KpiCard in dgm-view.tsx en ForecastSummaryTiles: het doel in kleine tekst, gemerkt per KPI.
const doelKaart = (kpi, label, doel, reeks = "blended") =>
  `<div><p>${label}</p><p style="font-size:32px">812</p><span style="font-size:11px">Doel: <span data-cijfer="jaardoel" data-kpi="${kpi}" data-reeks="${reeks}">${doel}</span></span></div>`;
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
    // Eerst een verandering onder het label Kosten ("+6%"), dan het bedrag onder "Advertentiekosten",
    // zoals PeriodSummary ze toont: de lezer moet de verandering overslaan en het label herkennen.
    oud: pagina(tegelHtml([["Conversies", "1.246"], ["Kosten", "+6%"], ["Advertentiekosten", "€ 49.870"], ["CPA", "€ 40,02"]])),
    // Conversies wijken echt af; CPA verschilt alleen in afronding; kosten in "k"-notatie, binnen de stap.
    nieuw: pagina(tegelHtml([["Conversies", "1.312"], ["Kosten", "€ 50k"], ["CPA", "€ 40"]]) + kaartHtml([["google", "1.000", "€ 40.000"], ["meta", "246", "€ 9.870"]])),
    // Campagnes in de nieuwe weergave: de kanaaltotalen, en daaronder de campagnetabellen van
    // campaigns-per-channel.tsx met hun eigen (vaste) venster en eigen tfoot. Die tellen niet mee:
    // opgeteld zijn ze 1.246 en € 49.870, en dan zou "gelijk" hieronder niets bewijzen.
    campagnes: pagina(kanaaltotalen("€ 50.120", "1.312") + campagneTabel("Google Ads", "Conversies", "€ 40.000", "1.000") + campagneTabel("LinkedIn", "Leads", "€ 9.870", "246")),
    "campagnes-anders": pagina(kanaaltotalen("€ 61.200", "1.246")),
    // De vertrouwde weergave: alleen campagnetabellen, en een verborgen tabel (zoals achter "Toon als
    // tabel") telt niet als afgelezen.
    "campagnes-oud": pagina(kanaaltotalen("€ 50.120", "1.312", "display:none") + campagneTabel("Google Ads", "Conversies", "€ 40.000", "1.000")),
    prognose: pagina(`<p>Jaarprognose — Conversies</p><p>Gerealiseerd + prognose <span>1.246</span></p><p>vs. doel <span data-cijfer="jaardoel" data-kpi="conversions" data-reeks="blended">1.650</span> (-24%)</p>`),
    "prognose-leeg": pagina(`<p>Blended jaarprognose laadt…</p>`),
    // Een andere KPI eerst, met een ander doel: de lezer moet de kaart van dezelfde KPI kiezen.
    doelen: pagina(doelKaart("cpa", "Kosten per conversie", "€ 45") + doelKaart("conversions", "Conversies", "1.650")),
    "doelen-anders": pagina(doelKaart("conversions", "Conversies", "1.600")),
    "doelen-zonder": pagina(doelKaart("cpa", "Kosten per conversie", "€ 45")),
    // Doelen nog op Google (Alle kanalen niet geladen), met een eigen schatting: geen fout van het doel.
    "doelen-google": pagina(doelKaart("conversions", "Conversies", "1.430", "google")),
    // Hetzelfde getal over een andere reeks is ook geen bewijs van gelijk.
    "doelen-google-gelijk": pagina(doelKaart("conversions", "Conversies", "1.650", "google")),
    // Een Overzicht zonder de tegel Conversies: dan ontbreekt de tegel, niet de kanaaltotalen.
    "nieuw-zonder-conversies": pagina(tegelHtml([["Kosten", "€ 50k"]])),
    // Zoals portfolio-scoreboard.tsx: de NAAM in de rij, het id alleen in de href. Een andere klant
    // erboven, zodat een lezer die de eerste rij pakt het verkeerde getal krijgt.
    portfolio: pagina(portfolioTabel([["Andere klant", "/client/iemand-anders", "88", "€ 3.100"], ["GreenTech (demo)", `/client/${KLANT}`, "1.000", "€ 40.000"]])),
  };
  await p.route(`${NEP}/**`, (route) => {
    const naam = new URL(route.request().url()).pathname.slice(1);
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: paginas[naam] ?? pagina("") });
  });
  const lezen = async (naam) => { await p.goto(`${NEP}/${naam}`); return p.evaluate(LEES, KLANT); };
  const g = {};
  for (const naam of Object.keys(paginas)) g[naam] = await lezen(naam);
  await ctx.close();

  const basis = { oud: g.oud, nieuw: g.nieuw, campagnes: g.campagnes, prognose: g.prognose, doelen: g.doelen, portfolio: g.portfolio };
  const v = vergelijkingen(basis);
  // Dezelfde vergelijkingen met een of meer pagina's vervangen door een variant.
  const uitslagIn = (lijst, wat, plekA, plekB = "") => {
    const gevonden = lijst.find((x) => x.wat === wat && x.plekA.startsWith(plekA) && x.plekB.startsWith(plekB));
    return gevonden ? beoordeel(gevonden).uitslag : "ontbreekt";
  };
  const uitslag = (wat, plekA, plekB = "") => uitslagIn(v, wat, plekA, plekB);
  const met = (vervang, wat, plekA, plekB = "") => uitslagIn(vergelijkingen({ ...basis, ...vervang }), wat, plekA, plekB);
  // De uitleg bij een vergelijking: een NIET GEMETEN moet de kant noemen die ontbreekt.
  const tekstMet = (vervang, wat, plekA, plekB = "") => {
    const gevonden = vergelijkingen({ ...basis, ...vervang }).find((x) => x.wat === wat && x.plekA.startsWith(plekA) && x.plekB.startsWith(plekB));
    return gevonden ? beoordeel(gevonden).tekst : "";
  };
  const campagnesZonderTegel = tekstMet({ nieuw: g["nieuw-zonder-conversies"] }, "Conversies", "Overzicht nieuw", "Campagnes");
  const eisen = [
    ["een echt verschil (1.246 tegen 1.312) wordt gemeld", uitslag("Conversies", "Overzicht oud", "Overzicht nieuw") === "verschil"],
    ["een afrondingsverschil (€ 40,02 tegen € 40) niet", uitslag("CPA", "Overzicht oud", "Overzicht nieuw") === "gelijk"],
    ["€ 49.870 tegen € 50k valt binnen de stap van 1k", uitslag("Kosten", "Overzicht oud", "Overzicht nieuw") === "gelijk"],
    ["kaarten 1.000 + 246 tegen tegel 1.312 wordt gemeld", uitslag("Conversies", "kanaalkaarten") === "verschil"],
    ["kaartkosten € 49.870 tegen tegel € 50k niet", uitslag("Kosten", "kanaalkaarten") === "gelijk"],
    ["een tegel die er niet is, is niet gemeten (en niet gelijk)", uitslag("ROAS", "Overzicht oud", "Overzicht nieuw") === "niet gemeten"],
    ["Campagnes: kanaaltotaal 1.312 gelijk aan de tegel 1.312 (de campagnetabellen tellen niet mee)", uitslag("Conversies", "Overzicht nieuw", "Campagnes") === "gelijk"],
    ["Campagnes: kanaaltotaal € 50.120 tegen € 50k valt binnen de stap", uitslag("Kosten", "Overzicht nieuw", "Campagnes") === "gelijk"],
    ["Campagnes: kanaaltotaal 1.246 tegen de tegel 1.312 wordt gemeld", met({ campagnes: g["campagnes-anders"] }, "Conversies", "Overzicht nieuw", "Campagnes") === "verschil"],
    ["Campagnes: kanaaltotaal € 61.200 tegen € 50k wordt gemeld", met({ campagnes: g["campagnes-anders"] }, "Kosten", "Overzicht nieuw", "Campagnes") === "verschil"],
    ["Campagnes zonder (zichtbare) kanaaltotalen: niet gemeten, ook niet via de tfoot's", met({ campagnes: g["campagnes-oud"] }, "Conversies", "Overzicht nieuw", "Campagnes") === "niet gemeten"
      && met({ campagnes: g["campagnes-oud"] }, "Kosten", "Overzicht nieuw", "Campagnes") === "niet gemeten"],
    ["Campagnes niet geopend: niet gemeten, en de reden noemt het tabblad", met({ campagnes: null }, "Conversies", "Overzicht nieuw", "Campagnes") === "niet gemeten"
      && /tabblad Campagnes kon niet geopend/.test(tekstMet({ campagnes: null }, "Conversies", "Overzicht nieuw", "Campagnes"))],
    ["Campagnes zonder kanaaltotalen: de reden noemt de kanaaltotalen", /geen kanaaltotalen op Campagnes/.test(tekstMet({ campagnes: g["campagnes-oud"] }, "Kosten", "Overzicht nieuw", "Campagnes"))],
    ["Campagnes, tegel ontbreekt: de reden noemt de tegel, niet de kanaaltotalen", /geen tegel Conversies op Overzicht nieuw/.test(campagnesZonderTegel) && !/kanaaltotalen op Campagnes/.test(campagnesZonderTegel)],
    ["Jaardoel: 1.650 tegen de conversiekaart 1.650 is gelijk (niet de CPA-kaart ervoor)", uitslag("Jaardoel", "Prognose (conversions", "Doelen") === "gelijk"],
    ["Jaardoel: Doelen over Google (1.430) tegen Prognose over alle kanalen is niet gemeten, geen verschil", met({ doelen: g["doelen-google"] }, "Jaardoel", "Prognose", "Doelen") === "niet gemeten"
      && /andere reeks/.test(tekstMet({ doelen: g["doelen-google"] }, "Jaardoel", "Prognose", "Doelen"))],
    ["Jaardoel: hetzelfde getal over een andere reeks is ook niet gemeten, geen gelijk", met({ doelen: g["doelen-google-gelijk"] }, "Jaardoel", "Prognose", "Doelen") === "niet gemeten"],
    ["Jaardoel: Prognose niet geopend noemt het tabblad", /tabblad Prognose kon niet geopend/.test(tekstMet({ prognose: null }, "Jaardoel", "Prognose", "Doelen"))],
    ["Jaardoel: 1.650 tegen 1.600 wordt gemeld", met({ doelen: g["doelen-anders"] }, "Jaardoel", "Prognose", "Doelen") === "verschil"],
    ["Jaardoel: geen kaart voor dezelfde KPI is niet gemeten", met({ doelen: g["doelen-zonder"] }, "Jaardoel", "Prognose", "Doelen") === "niet gemeten"],
    ["Jaardoel: geen doel op de Prognose is niet gemeten", met({ prognose: g["prognose-leeg"] }, "Jaardoel", "Prognose", "Doelen") === "niet gemeten"],
    ["Portfolio: de rij wordt via de link gevonden, niet via de tekst", uitslag("Conversies", "Portfolio") === "gelijk"],
    ["Portfolio: kosten van de juiste rij (niet de eerste)", uitslag("Kosten", "Portfolio") === "gelijk"],
    ["een verandering (+6%) is geen kostenbedrag, Advertentiekosten wel", tegel(g.oud, TEGELS[1][1])?.tekst === "€ 49.870"],
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
    console.log(`Cijfercontrole op ${BASIS}, klant ${KLANT}, venster ${VENSTER}.`);
    console.log("Niet vergeleken: de campagnetabellen op Campagnes (vast venster, ze volgen de gekozen periode niet; zie de kop).\n");
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

// Meet of het Overzicht "statisch" aanvoelt, in getallen. Hoort bij het bouwplan van 9 november
// 2026 (bouwplan-overzicht-dynamisch.md): elke fase wordt met dit script vóór en na gemeten.
//
// Gebruik (eerst bouwen, dan een server, nooit bouwen onder een draaiende server; zie AGENTS.md):
//   npx next build && npx next start -p 3190
//   FASE=0-nulmeting node scripts/meet-overzicht.mjs
//
// Omgeving: BASIS_URL (http://localhost:3190), DEMO_CLIENT (demo-greentech), FASE (label in de
// bestandsnaam), THROTTLES ("1,4": CPU-vertraging per run), CHROMIUM (pad naar de browser),
// WEERGAVE ("nieuw": meet de nieuwe bovenkant van fase 3 via ?weergave=nieuw; leeg: de vertrouwde).
// Uitvoer: scripts/metingen/<datum>-<FASE>.json plus een leesbare samenvatting op stdout.
//
// Wat er gemeten wordt, en waarom juist dit:
//   - laden: verzoeken en bytes naar /api, tijd tot het eerste kerncijfer, LCP, CLS, lange taken,
//     paginahoogte en de positie van het eerste kerncijfer (hoe ver je moet scrollen voor een cijfer);
//   - wissel van kanaal en van periode: verzoeken, tijd tot de eerste zichtbare verandering en tot
//     het netwerk stil is, beeldjes per seconde, en het aandeel blokken (secties) dat verandert:
//     een pagina waarvan één blok op twintig beweegt, voelt statisch, hoe mooi dat ene blok ook beweegt;
//   - eerlijkheid: hoeveel verschillende conversietotalen er op de pagina staan (ieder uit een eigen
//     venster) en of er iets permanent beweegt (een pulse die nooit stopt wijst niets meer aan);
//   - vensters (fase 2): welk venster elk blok in zijn kop noemt ("volgt periode", "jaarblok", "vast
//     venster"; het Vensterlabel, data-venster), hoeveel van de blokken met "volgt periode" bij een
//     periodewissel ook echt veranderen (doel >= 90%), en welke conversietotalen in een blok staan
//     dat geen venster noemt (doel 0);
//   - de adresbalk (fase 2): na een kanaal- en een periodewissel de pagina herladen en kijken of
//     hetzelfde kanaal en dezelfde periode terugkomen.
//
// Vaste meetnormen en drempels staan in het bouwplan; dit script oordeelt niet, het meet. Het
// oordeel (per norm gehaald of niet) geeft scripts/oordeel-overzicht.mjs over het bestand dat hier
// uitkomt.
//
// WAT ER OP 12 NOVEMBER AAN DE VENSTERTELLING IS RECHTGEZET, en waarom dat geen flatteren is.
// De telling "volgt periode: N van M veranderd" kwam uit op 50 tot 54 procent, en bijna de helft
// van de stille blokken droeg dat label helemaal niet:
//   - De bronrij (Demodata, Conversielag, Datastand), To-do's en Notities hebben geen venster en
//     staan in geen sectie. De telling zocht voor een blok zonder eigen label het laatste label
//     ERVOOR in de sectie, en viel zonder sectie terug op de hele pagina: zo leenden ze het label
//     van de kanaalkaarten. Een blok krijgt nu alleen een label uit zijn EIGEN sectie; staat het
//     in geen sectie, dan heeft het geen label. De blokken die de stand van nu tonen zeggen dat
//     zelf (data-venster="stand", zie components/ui/vensterlabel.tsx) en tellen als eigen soort.
//   - Een dichtgeklapt blok draagt in zijn kop het venster van wat erin zit, maar toont dicht geen
//     cijfer dat kan veranderen. Die blokken (data-paneel="dicht", data-heel-blok="dicht") staan
//     apart in de uitkomst van een wissel (`dicht`) en tellen daar niet mee in de noemer.
//     DAT ALLEEN WAS EEN VERSOEPELING: het bouwplan zegt "de blokken die 'volgt periode' dragen",
//     niet "de open blokken", en een label op een dicht blok was zo door niets gemeten. Daarom
//     opent de meting ze aan het eind één keer, per tabblad, wisselt dan twee keer van periode en
//     legt vast of elk geopend blok verandert (`dichteVolgers`). Het oordeel toetst dat als een
//     eigen norm (A1b), naast A1 over de open blokken.
// Een blok dat "volgt periode" draagt, open staat en stil blijft, telt nog precies zoals het telde.

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASIS = process.env.BASIS_URL ?? "http://localhost:3190";
const KLANT = process.env.DEMO_CLIENT ?? "demo-greentech";
const FASE = process.env.FASE ?? "meting";
const THROTTLES = (process.env.THROTTLES ?? "1,4").split(",").map(Number);
const MOBIEL = process.env.MOBIEL !== "0";
const CHROOM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
// De nieuwe weergave staat achter een schakelaar per gebruiker (lib/weergave.ts); een schone
// browser heeft die keuze niet, dus de meting zet hem aan via de adresbalk.
const WEERGAVE = process.env.WEERGAVE ?? "";
const URL_KLANT = `${BASIS}/client/${KLANT}?demo=1${WEERGAVE ? `&weergave=${WEERGAVE}` : ""}`;
const RUST_MS = 1200;

const browser = await chromium.launch({ executablePath: CHROOM });
const uit = { datum: new Date().toISOString(), fase: FASE, url: URL_KLANT, runs: [] };

/** Observers die vóór elke navigatie in de pagina staan: LCP, CLS, lange taken, eerste DOM-wijziging en beeldjes. */
const INIT = () => {
  window.__m = { lcp: 0, cls: 0, lang: 0, langN: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m.lang += Math.max(0, e.duration - 50); window.__m.langN++; } }).observe({ type: "longtask", buffered: true });
  // Eerste zichtbare verandering na een handeling: de eerste DOM-mutatie in <main> na __mark().
  window.__mark = () => {
    window.__eerste = null; window.__frames = []; window.__cls0 = window.__m.cls;
    const t0 = performance.now();
    const mo = new MutationObserver(() => { if (window.__eerste === null) { window.__eerste = performance.now() - t0; mo.disconnect(); } });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    let vorige = performance.now();
    const tik = (t) => { window.__frames.push(t - vorige); vorige = t; if (t - t0 < 1500) requestAnimationFrame(tik); };
    requestAnimationFrame(tik);
  };
};

/**
 * Tekst per blok. Een blok is een kaart op het hoogste niveau: een element met een afgeronde rand
 * (rounded-xl/-lg/-2xl plus border, schaduw of kaartachtergrond) dat niet zelf in zo'n kaart zit.
 * Op het Overzicht zijn dat er negentien (band, health, pacing, kaart, weken, verdeling, de vier
 * jaarkaarten, ...); <section> alleen gaf er vijf en miste juist de band. De sleutel is de kop of
 * de eerste regel plus het volgnummer, zodat een blok dat van tekst verandert ook als "veranderd" telt.
 */
const SNAPSHOT = () => {
  const blokken = {};
  const schoon = (s) => s.replace(/\s+/g, " ").trim();
  const main = document.querySelector("main") ?? document.body;
  const isKaart = (el) => /rounded-(xl|lg|2xl)/.test(String(el.className)) && /border|shadow|bg-card/.test(String(el.className));
  const inKaart = (el) => { let q = el.parentElement; while (q && q !== main) { if (isKaart(q)) return true; q = q.parentElement; } return false; };
  let i = 0;
  for (const el of main.querySelectorAll("*")) {
    if (!isKaart(el) || inKaart(el) || el.getClientRects().length === 0) continue;
    i += 1;
    const kop = el.querySelector("h1, h2, h3, h4")?.textContent?.trim() || el.innerText.trim().split("\n")[0] || "";
    blokken[`${i}. ${schoon(kop).slice(0, 50)}`] = schoon(el.innerText).slice(0, 6000);
  }
  return blokken;
};

/**
 * Per blok (dezelfde kaarten als SNAPSHOT): welk venster het noemt en zijn tekst ZONDER dat label.
 *
 * Het label van een blok is het Vensterlabel in de kaart zelf, of anders het laatste label in een
 * kop boven de kaart binnen dezelfde sectie (de sectiekop of een Deelkop: zo dragen de vier
 * jaartegels en de kanaaltabel hun venster). Zonder label: `soort` null, en dan telt elk
 * conversietotaal in dat blok als ongelabeld. Een blok buiten elke sectie leent GEEN label van de
 * rest van de pagina (zie de kop van dit bestand).
 *
 * `soort` "stand": het blok zegt zelf dat het de stand van nu toont en geen venster heeft
 * (data-venster="stand" op de kaart). `dicht`: het blok is een dichtgeklapt paneel of een kaart
 * waarvan de hele inhoud achter een dichte lade zit.
 *
 * De tekst zonder het label: bij een periodewissel verandert de tekst van het label zelf
 * ("volgt periode · jun–aug 2026"). Telde die mee, dan "veranderde" elk gelabeld blok vanzelf en
 * mat de meting het label in plaats van de cijfers.
 *
 * `doe` (alleen voor de meting van de dichte blokken, zie meetDichteVolgers): `{ open: [sleutels] }`
 * klikt de genoemde dichte blokken open, `{ sluit: [sleutels] }` klikt ze weer dicht. In dezelfde
 * functie en niet in een tweede, zodat "welk blok is dit" op één plek wordt bepaald. Zonder `doe`
 * raakt deze functie de pagina niet aan.
 */
const VENSTERS = (doe) => {
  const schoon = (t) => t.replace(/\s+/g, " ").trim();
  const main = document.querySelector("main") ?? document.body;
  const isKaart = (el) => /rounded-(xl|lg|2xl)/.test(String(el.className)) && /border|shadow|bg-card/.test(String(el.className));
  const inKaart = (el) => { let q = el.parentElement; while (q && q !== main) { if (isKaart(q)) return true; q = q.parentElement; } return false; };
  const uit = [];
  const gezien = {};
  for (const el of main.querySelectorAll("*")) {
    if (!isKaart(el) || inKaart(el) || el.getClientRects().length === 0) continue;
    // Een echt Vensterlabel, niet het kenmerk "stand" van een genest blok.
    const LABEL = '[data-venster]:not([data-venster="stand"])';
    const stand = el.getAttribute("data-venster") === "stand";
    let label = stand ? null : el.querySelector(LABEL);
    if (!label && !stand) {
      const sectie = el.closest("section");
      for (const l of sectie?.querySelectorAll(LABEL) ?? []) {
        if (inKaart(l) || isKaart(l)) continue; // het label van een andere kaart
        if (l.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) label = l; // de laatste vóór deze kaart
      }
    }
    let tekst = el.innerText;
    for (const l of el.querySelectorAll(LABEL)) tekst = tekst.split(l.innerText).join(" ");
    tekst = schoon(tekst).slice(0, 6000);
    let kop = el.querySelector("h1, h2, h3, h4")?.innerText ?? tekst.split(" ").slice(0, 6).join(" ");
    for (const l of el.querySelectorAll(LABEL)) kop = kop.split(l.innerText).join(" ");
    kop = schoon(kop).slice(0, 50);
    const dicht = el.getAttribute("data-paneel") === "dicht" || el.querySelector('[data-heel-blok="dicht"]') !== null;
    // Dezelfde kop kan vaker voorkomen (vier tegels "Conversies"); het volgnummer houdt ze uit elkaar.
    gezien[kop] = (gezien[kop] ?? 0) + 1;
    const knopVoor = (stand) => (el.getAttribute("data-paneel") === stand
      ? el.querySelector(`:scope > button[aria-expanded="${stand === "open"}"]`)
      : el.querySelector(`[data-heel-blok="${stand}"]`));
    if (doe?.open?.includes(`${kop} #${gezien[kop]}`) && dicht) knopVoor("dicht")?.click();
    if (doe?.sluit?.includes(`${kop} #${gezien[kop]}`) && !dicht) knopVoor("open")?.click();
    const totalen = [];
    for (const m of tekst.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{3,})\s+conversies\b/gi)) totalen.push(m[1]);
    for (const m of tekst.matchAll(/\bConversies\s+(?:[^\d\s]{0,12}\s)?(\d{1,3}(?:\.\d{3})+|\d{3,})/g)) totalen.push(m[1]);
    uit.push({
      sleutel: `${kop} #${gezien[kop]}`, soort: stand ? "stand" : label?.getAttribute("data-venster") ?? null,
      label: stand ? "stand van nu" : label ? schoon(label.innerText) : null, tekst, dicht,
      conversietotalen: [...new Set(totalen)].filter((v) => !/^20\d\d$/.test(v) && Number(v.replace(/\./g, "")) >= 50),
    });
  }
  return uit;
};

/** Eerlijkheid: verschillende conversietotalen en permanente animaties. */
const EERLIJK = () => {
  const tekst = document.body.innerText;
  // Een getal direct voor het woord "conversies" (geen ander woord ertussen), of het eerste getal
  // op de regel onder het label "Conversies". Jaartallen tellen niet.
  const totalen = new Set();
  for (const m of tekst.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{3,})\s+conversies\b/gi)) totalen.add(m[1]);
  for (const m of tekst.matchAll(/^Conversies\n(?:[^\n\d]{0,12})?(\d{1,3}(?:\.\d{3})+|\d{3,})/gim)) totalen.add(m[1]);
  for (const v of [...totalen]) if (/^20\d\d$/.test(v)) totalen.delete(v);
  const permanent = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.animationName !== "none" && cs.animationIterationCount.includes("infinite") && el.getClientRects().length > 0) {
      permanent.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").filter((c) => /animate|pulse|spin|ping/.test(c)).join(".")}`);
    }
  }
  const datastand = tekst.match(/(?:t\/m|tot en met)\s+\d{1,2}\s+[a-z]{3,9}(?:\s+\d{4})?/i)?.[0] ?? null;
  return { conversietotalen: [...totalen].filter((v) => Number(v.replace(/\./g, "")) >= 50), permanenteAnimaties: permanent.slice(0, 20), datastand };
};

/** Positie en tijd van het eerste kerncijfer: het getal onder het label "Conversies" in de KPI-band. */
const EERSTE_KERNCIJFER = () => {
  const labels = [...document.querySelectorAll("main p, main span, main div")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === "Conversies");
  for (const l of labels) {
    const kaart = l.closest("div");
    const getal = [...(kaart?.parentElement?.querySelectorAll("p, span") ?? [])].find((e) => /^\d[\d.,]*/.test(e.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) >= 18);
    if (getal) { const r = getal.getBoundingClientRect(); return { tekst: getal.textContent.trim(), y: Math.round(r.top + window.scrollY) }; }
  }
  return null;
};

async function run(breedte, hoogte, throttle) {
  const ctx = await browser.newContext({ viewport: { width: breedte, height: hoogte }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await p.addInitScript(INIT);

  let log = [];
  let inflight = 0, laatste = Date.now();
  // Starttijd per verzoek, zodat per pad ook de DUUR bekend is: welke route het eerste kerncijfer
  // tegenhoudt is uit bytes alleen niet af te leiden (fase 1, stap 0).
  const gestart = new Map();
  p.on("request", (r) => { if (r.url().includes("/api/")) { inflight++; laatste = Date.now(); gestart.set(r, Date.now()); } });
  p.on("requestfinished", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    inflight--; laatste = Date.now();
    const ms = gestart.has(r) ? Date.now() - gestart.get(r) : null;
    let bytes = 0; try { bytes = (await (await r.response()).body()).length; } catch {}
    const pad = new URL(u).pathname;
    log.push({ pad: pad.startsWith("/api/data/") ? "data/" + decodeURIComponent(pad.slice(10)) : pad, bytes, ms });
  });
  p.on("requestfailed", (r) => { if (r.url().includes("/api/")) inflight--; });
  const rust = async (max = 25000) => {
    const start = Date.now();
    while (Date.now() - start < max) { if (inflight <= 0 && Date.now() - laatste > RUST_MS) return Date.now() - start - RUST_MS; await p.waitForTimeout(100); }
    return -1;
  };
  const perPad = () => {
    const uitk = {};
    for (const x of log) {
      uitk[x.pad] ??= { n: 0, kb: 0, maxMs: 0, somMs: 0 };
      uitk[x.pad].n++; uitk[x.pad].kb = Math.round((uitk[x.pad].kb + x.bytes / 1024) * 10) / 10;
      if (x.ms != null) { uitk[x.pad].maxMs = Math.max(uitk[x.pad].maxMs, x.ms); uitk[x.pad].somMs += x.ms; }
    }
    return Object.fromEntries(Object.entries(uitk).sort((a, b) => b[1].kb - a[1].kb));
  };
  const apiTotaal = () => ({ verzoeken: log.length, kb: Math.round(log.reduce((a, x) => a + x.bytes, 0) / 1024) });

  const naam = `${breedte}x${hoogte} cpu x${throttle}`;
  const res = { naam, breedte, throttle, laden: {}, wissels: [] };

  // ── Laden ──
  const t0 = Date.now();
  await p.goto(URL_KLANT, { waitUntil: "domcontentloaded" });
  res.laden.domMs = Date.now() - t0;
  await p.getByText(/^Conversies$/).first().waitFor({ timeout: 30000 }).catch(() => {});
  // Het eerste kerncijfer is er als het label een getal onder zich heeft.
  await p.waitForFunction(() => {
    const l = [...document.querySelectorAll("main p, main span, main div")].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Conversies");
    return !!l && /\d/.test(l.closest("div")?.parentElement?.innerText ?? "");
  }, null, { timeout: 30000 }).catch(() => {});
  res.laden.eersteKerncijferMs = Date.now() - t0;
  const rustMs = await rust();
  res.laden.netwerkStilMs = rustMs < 0 ? null : Date.now() - t0 - RUST_MS;
  const m = await p.evaluate(() => window.__m);
  res.laden.lcpMs = Math.round(m.lcp); res.laden.cls = Math.round(m.cls * 1000) / 1000; res.laden.langeTaken = m.langN; res.laden.blokkeerMs = Math.round(m.lang);
  res.laden.api = apiTotaal(); res.laden.perPad = perPad();
  res.laden.paginaHoogte = await p.evaluate(() => document.documentElement.scrollHeight);
  res.laden.eersteKerncijfer = await p.evaluate(EERSTE_KERNCIJFER);
  res.laden.blokken = Object.keys(await p.evaluate(SNAPSHOT)).length;
  res.eerlijk = await p.evaluate(EERLIJK);
  const basis = await p.evaluate(SNAPSHOT);
  // De vensters op "Alle kanalen", zoals de pagina opent: hoeveel blokken er per soort zijn, welke
  // geen venster noemen, en welke conversietotalen daarin staan (het doel van fase 2: geen).
  const vensterStand = (blokken) => ({
    blokken: blokken.length,
    perSoort: blokken.reduce((t, b) => { const k = b.soort ?? "geen"; t[k] = (t[k] ?? 0) + 1; return t; }, {}),
    zonderVenster: blokken.filter((b) => b.soort === null).map((b) => b.sleutel),
    conversietotalen: blokken.flatMap((b) => b.conversietotalen.map((v) => ({ totaal: v, blok: b.sleutel, venster: b.label }))),
    conversietotalenZonderVenster: blokken.filter((b) => b.soort === null).flatMap((b) => b.conversietotalen.map((v) => ({ totaal: v, blok: b.sleutel }))),
  });
  res.vensters = vensterStand(await p.evaluate(VENSTERS));

  // ── Wissels (alleen op desktop: de tabs staan daar in beeld) ──
  if (breedte >= 1000) {
    // Terug naar alle kanalen: in de vertrouwde weergave de tab "Alle kanalen", in de nieuwe nog
    // een klik op de ingedrukte kanaalkaart (de kaart is het filter; er is geen aparte knop).
    const naarAlleKanalen = () => (WEERGAVE === "nieuw"
      ? p.locator('main button[aria-pressed="true"][aria-describedby^="kanaalkaart-"]').first().click({ timeout: 3000 })
      : p.getByRole("button", { name: /^Alle kanalen$/ }).first().click());
    const wissel = async (label, doe) => {
      log = [];
      await p.evaluate(() => { window.__m.lang = 0; window.__m.langN = 0; window.__mark(); });
      const voor = await p.evaluate(SNAPSHOT);
      const voorVensters = await p.evaluate(VENSTERS);
      const t = Date.now();
      let fout = null;
      try { await doe(); } catch (e) { fout = String(e.message).slice(0, 120); }
      const r = await rust(15000);
      await p.waitForTimeout(1600);
      const na = await p.evaluate(SNAPSHOT);
      const naVensters = await p.evaluate(VENSTERS);
      const eerste = await p.evaluate(() => window.__eerste);
      const frames = await p.evaluate(() => window.__frames.slice(2));
      const mm = await p.evaluate(() => ({ lang: window.__m.lang, langN: window.__m.langN, cls: window.__m.cls - window.__cls0 }));
      const sleutels = [...new Set([...Object.keys(voor), ...Object.keys(na)])];
      const veranderd = sleutels.filter((k) => voor[k] !== na[k]);
      // Fase 2: van de blokken die vóór de wissel "volgt periode" droegen, hoeveel hebben daarna
      // een andere tekst (het label zelf niet meegeteld)? Bij een periodewissel is het doel 90%.
      const naPerSleutel = new Map(naVensters.map((b) => [b.sleutel, b]));
      // Een dicht blok toont geen cijfer dat kan veranderen: apart genoemd, niet in de noemer.
      const volgers = voorVensters.filter((b) => b.soort === "periode" && !b.dicht);
      const dichteVolgers = voorVensters.filter((b) => b.soort === "periode" && b.dicht).map((b) => b.sleutel);
      const stil = volgers.filter((b) => naPerSleutel.get(b.sleutel)?.tekst === b.tekst).map((b) => b.sleutel);
      res.wissels.push({
        label, fout,
        api: apiTotaal(), perPad: perPad(),
        eersteVeranderingMs: eerste === null ? null : Math.round(eerste),
        netwerkStilMs: r < 0 ? null : Date.now() - t - RUST_MS - 1600,
        blokken: sleutels.length, blokkenVeranderd: veranderd.length, veranderd: veranderd.slice(0, 30),
        volgtPeriode: { blokken: volgers.length, veranderd: volgers.length - stil.length, stil, dicht: dichteVolgers },
        url: await p.evaluate(() => location.pathname + location.search),
        beeldjes: frames.length, beeldjesBoven25ms: frames.filter((x) => x > 25).length,
        langeTaken: mm.langN, blokkeerMs: Math.round(mm.lang), cls: Math.round(mm.cls * 1000) / 1000,
      });
    };
    await wissel("kanaal: Alle kanalen -> Meta", () => p.getByRole("button", { name: /^Meta$/ }).first().click());
    await wissel("kanaal: Meta -> Alle kanalen", naarAlleKanalen);
    // Het tweede bezoek aan dezelfde tab: wat een cache waard is, zie je pas hier.
    await wissel("kanaal: Alle kanalen -> Meta (tweede keer)", () => p.getByRole("button", { name: /^Meta$/ }).first().click());
    await wissel("kanaal: Meta -> Alle kanalen (tweede keer)", naarAlleKanalen);
    // De periodekiezer: de knop met aria-haspopup="dialog" (zijn naam is de gekozen periode zelf),
    // daarna de preset in het paneel. De knop is uitgeschakeld zolang de band laadt.
    const kiesPreset = async (label) => {
      const trigger = p.locator('main button[aria-haspopup="dialog"]').first();
      await trigger.waitFor({ timeout: 10000 });
      await p.waitForFunction(() => !document.querySelector('main button[aria-haspopup="dialog"]')?.disabled, null, { timeout: 15000 });
      await trigger.click();
      await p.locator('[role="dialog"] button', { hasText: new RegExp(`^${label}$`) }).first().click({ timeout: 5000 });
    };
    await wissel("periode: -> Laatste 3 maanden", () => kiesPreset("Laatste 3 maanden"));
    await wissel("periode: -> Laatste 12 maanden", () => kiesPreset("Laatste 12 maanden"));
    res.basisBlokken = Object.keys(basis);

    // ── Fase 2: de snelkoppelingen, per kanaalweergave, en de adresbalk ──
    // De knoppen 3/6/12 mnd naast de kiezer (een groep met aria-label "Periode, snelkoppelingen").
    const snel = (kort) => p.locator('[role="group"][aria-label^="Periode"] button', { hasText: new RegExp(`^${kort}$`) }).first().click({ timeout: 5000 });
    await wissel("periode (snelkoppeling): -> 6 mnd", () => snel("6 mnd"));
    // Elke kanaalweergave heeft eigen blokken; het aandeel "volgt periode" dat echt beweegt, telt
    // per weergave. Een kanaal dat deze klant niet heeft (geen tab, geen kaart) wordt overgeslagen
    // en bij naam genoemd; het is geen wissel met een fout. Dat onderscheid telt: het oordeel
    // keurt een meting met een mislukte wissel af (scripts/overzicht-normen.mjs), en een klant
    // zonder LinkedIn is geen mislukte meting.
    res.venstersPerKanaal = { "Alle kanalen": res.vensters };
    res.kanalenOvergeslagen = [];
    for (const kanaal of ["Google Ads", "Meta", "LinkedIn", "Microsoft"]) {
      // De tab heet "Microsoft", de kanaalkaart "Microsoft Ads" (KANAAL_NAAM): beide tellen.
      if ((await p.getByRole("button", { name: new RegExp(`^${kanaal}( Ads)?$`) }).count()) === 0) { res.kanalenOvergeslagen.push(kanaal); continue; }
      await wissel(`kanaal: -> ${kanaal}`, () => p.getByRole("button", { name: new RegExp(`^${kanaal}( Ads)?$`) }).first().click({ timeout: 3000 }));
      if (res.wissels.at(-1).fout) continue;
      res.venstersPerKanaal[kanaal] = vensterStand(await p.evaluate(VENSTERS));
      await wissel(`periode op ${kanaal}: -> 3 mnd`, () => snel("3 mnd"));
      await wissel(`periode op ${kanaal}: -> 12 mnd`, () => snel("12 mnd"));
    }
    // De adresbalk: Meta over de laatste drie maanden, herladen, en kijken wat er terugkomt. De
    // actieve knoppen zijn te herkennen aan aria-pressed.
    const stand = () => p.evaluate(() => ({
      url: location.pathname + location.search,
      ingedrukt: [...document.querySelectorAll('main button[aria-pressed="true"]')].map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim()),
      periode: document.querySelector('main button[aria-haspopup="dialog"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    }));
    try {
      await p.getByRole("button", { name: /^Meta$/ }).first().click({ timeout: 3000 });
      await snel("3 mnd");
      await rust(15000);
      const voorHerlaad = await stand();
      log = [];
      await p.reload({ waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => !document.querySelector('main button[aria-haspopup="dialog"]')?.disabled, null, { timeout: 30000 });
      await rust(20000);
      const naHerlaad = await stand();
      res.herlaad = {
        voor: voorHerlaad, na: naHerlaad,
        zelfdeToestand: voorHerlaad.url === naHerlaad.url && voorHerlaad.periode === naHerlaad.periode
          && JSON.stringify(voorHerlaad.ingedrukt) === JSON.stringify(naHerlaad.ingedrukt),
      };
    } catch (e) { res.herlaad = { fout: String(e.message).slice(0, 160) }; }

    // ── De dichte blokken met "volgt periode": eenmaal open, bewegen ze dan ook? ──
    // Als laatste, zodat het openen niets verandert aan wat hierboven gemeten is (de stand van een
    // paneel wordt per gebruiker onthouden). Per tabblad via de adresbalk: in de nieuwe weergave
    // is een klik op de gekozen kanaalkaart juist de weg TERUG, en na de herlaad hierboven staat
    // er al een kanaal gekozen.
    // Twee periodewissels na het openen, en de tekst na de eerste tegen die na de tweede: zo hangt
    // de uitkomst niet af van de periode die toevallig al gekozen was.
    res.dichteVolgers = {};
    const tabbladen = [["Alle kanalen", ""], ["Google Ads", "google"], ["Meta", "meta"], ["LinkedIn", "linkedin"], ["Microsoft", "microsoft"]];
    for (const [tab, kanaal] of tabbladen) {
      try {
        await p.goto(`${URL_KLANT}${kanaal ? `&kanaal=${kanaal}` : ""}`, { waitUntil: "domcontentloaded" });
        await p.waitForFunction(() => !document.querySelector('main button[aria-haspopup="dialog"]')?.disabled, null, { timeout: 30000 });
        await rust(20000);
        // Een kanaal dat deze klant niet heeft, valt terug op alle kanalen: dan is er niets te meten.
        const opKanaal = await p.evaluate(() => new URLSearchParams(location.search).get("kanaal") ?? "");
        if (opKanaal !== kanaal) { res.dichteVolgers[tab] = { fout: "tabblad niet beschikbaar" }; continue; }
        const dicht = (await p.evaluate(VENSTERS)).filter((b) => b.soort === "periode" && b.dicht).map((b) => b.sleutel);
        if (dicht.length === 0) { res.dichteVolgers[tab] = { blokken: 0, geopend: 0, veranderd: 0, stil: [], nietGeopend: [] }; continue; }
        await p.evaluate(VENSTERS, { open: dicht });
        await rust(15000);
        await snel("3 mnd"); await rust(15000); await p.waitForTimeout(1600);
        const eerst = new Map((await p.evaluate(VENSTERS)).map((b) => [b.sleutel, b]));
        await snel("12 mnd"); await rust(15000); await p.waitForTimeout(1600);
        const daarna = new Map((await p.evaluate(VENSTERS)).map((b) => [b.sleutel, b]));
        // Niet te openen (geen knop gevonden, of het blok heet open anders) is niet "veranderd":
        // het telt mee in de noemer en staat bij naam in de uitkomst.
        const nietGeopend = dicht.filter((k) => !eerst.has(k) || eerst.get(k).dicht);
        const geopend = dicht.filter((k) => !nietGeopend.includes(k));
        const stil = geopend.filter((k) => daarna.get(k)?.tekst === eerst.get(k).tekst);
        res.dichteVolgers[tab] = {
          blokken: dicht.length, geopend: geopend.length, veranderd: geopend.length - stil.length, stil, nietGeopend,
          // Het venster dat het blok open noemt: een blok dat dicht "volgt periode" heet en open een
          // ander label draagt, zegt dicht iets anders dan het is.
          openSoort: Object.fromEntries(geopend.map((k) => [k, eerst.get(k).soort])),
        };
        await p.evaluate(VENSTERS, { sluit: geopend });
        await p.waitForTimeout(300);
      } catch (e) { res.dichteVolgers[tab] = { fout: String(e.message).slice(0, 160) }; }
    }
  }
  await ctx.close();
  return res;
}

for (const throttle of THROTTLES) uit.runs.push(await run(1440, 900, throttle));
if (MOBIEL) uit.runs.push(await run(390, 844, 1));
await browser.close();

mkdirSync("scripts/metingen", { recursive: true });
const bestand = `scripts/metingen/${uit.datum.slice(0, 10)}-${FASE}.json`;
writeFileSync(bestand, JSON.stringify(uit, null, 1));

// ── Samenvatting ──
const f = (v, eenheid = "") => (v === null || v === undefined ? "—" : `${v}${eenheid}`);
for (const r of uit.runs) {
  const l = r.laden;
  console.log(`\n## ${r.naam}`);
  console.log(`laden: ${l.api.verzoeken} API-verzoeken, ${l.api.kb} kB · eerste kerncijfer ${f(l.eersteKerncijferMs, " ms")} (y=${f(l.eersteKerncijfer?.y, " px")}, ${l.eersteKerncijfer?.tekst ?? "?"}) · netwerk stil ${f(l.netwerkStilMs, " ms")} · LCP ${f(l.lcpMs, " ms")} · CLS ${l.cls} · lange taken ${l.langeTaken} (${l.blokkeerMs} ms) · hoogte ${l.paginaHoogte} px · ${l.blokken} secties`);
  for (const [k, v] of Object.entries(l.perPad).slice(0, 10)) console.log(`   ${String(v.n).padStart(2)}x ${String(v.kb).padStart(7)} kB  max ${String(v.maxMs ?? "-").padStart(5)} ms  ${k}`);
  for (const w of r.wissels) {
    console.log(`wissel ${w.label}${w.fout ? ` [FOUT ${w.fout}]` : ""}: ${w.api.verzoeken} verzoeken (${w.api.kb} kB) · eerste verandering ${f(w.eersteVeranderingMs, " ms")} · netwerk stil ${f(w.netwerkStilMs, " ms")} · blokken veranderd ${w.blokkenVeranderd}/${w.blokken} · beeldjes ${w.beeldjes} waarvan > 25 ms: ${w.beeldjesBoven25ms} · lange taken ${w.langeTaken} (${w.blokkeerMs} ms)`);
    // Alleen bij een periodewissel zegt dit iets: een kanaalwissel vervangt de blokken zelf.
    if (w.label.startsWith("periode") && w.volgtPeriode?.blokken > 0) {
      const v = w.volgtPeriode;
      console.log(`   volgt periode: ${v.veranderd}/${v.blokken} veranderd (${Math.round((v.veranderd / v.blokken) * 100)}%)${v.stil.length ? ` · stil: ${v.stil.join("; ")}` : ""}${v.dicht?.length ? ` · dicht, apart gemeten: ${v.dicht.join("; ")}` : ""} · ${w.url}`);
    }
  }
  for (const [kanaal, v] of Object.entries(r.venstersPerKanaal ?? (r.vensters ? { "Alle kanalen": r.vensters } : {}))) {
    console.log(`vensters ${kanaal}: ${v.blokken} blokken ${JSON.stringify(v.perSoort)} · zonder venster: ${v.zonderVenster.length ? v.zonderVenster.join("; ") : "geen"} · conversietotalen zonder venster: ${v.conversietotalenZonderVenster.length ? JSON.stringify(v.conversietotalenZonderVenster) : "0"}`);
  }
  for (const [tab, d] of Object.entries(r.dichteVolgers ?? {})) {
    console.log(`dichte blokken met "volgt periode" op ${tab}: ${d.fout ? `[FOUT ${d.fout}]` : d.blokken === 0 ? "geen" : `${d.veranderd}/${d.blokken} veranderd na openen${d.stil.length ? ` · stil: ${d.stil.join("; ")}` : ""}${d.nietGeopend.length ? ` · niet te openen: ${d.nietGeopend.join("; ")}` : ""}`}`);
  }
  if (r.kanalenOvergeslagen?.length) console.log(`kanalen die deze klant niet heeft, overgeslagen: ${r.kanalenOvergeslagen.join(", ")}`);
  if (r.herlaad) console.log(`herlaad: ${r.herlaad.fout ? `[FOUT ${r.herlaad.fout}]` : `${r.herlaad.zelfdeToestand ? "zelfde toestand" : "ANDERS"} · ${r.herlaad.na.url} · ${JSON.stringify(r.herlaad.na.ingedrukt)} · ${r.herlaad.na.periode}`}`);
  if (r.eerlijk) console.log(`eerlijk: conversietotalen ${JSON.stringify(r.eerlijk.conversietotalen)} · permanente animaties ${r.eerlijk.permanenteAnimaties.length} ${JSON.stringify(r.eerlijk.permanenteAnimaties.slice(0, 3))} · datastand "${r.eerlijk.datastand}"`);
}
console.log(`\nopgeslagen: ${bestand}`);

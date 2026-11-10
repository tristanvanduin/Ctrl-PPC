// Meet of het Overzicht "statisch" aanvoelt, in getallen. Hoort bij het bouwplan van 9 november
// 2026 (bouwplan-overzicht-dynamisch.md): elke fase wordt met dit script vóór en na gemeten.
//
// Gebruik (eerst bouwen, dan een server, nooit bouwen onder een draaiende server; zie AGENTS.md):
//   npx next build && npx next start -p 3190
//   FASE=0-nulmeting node scripts/meet-overzicht.mjs
//
// Omgeving: BASIS_URL (http://localhost:3190), DEMO_CLIENT (demo-greentech), FASE (label in de
// bestandsnaam), THROTTLES ("1,4": CPU-vertraging per run), CHROMIUM (pad naar de browser).
// Uitvoer: scripts/metingen/<datum>-<FASE>.json plus een leesbare samenvatting op stdout.
//
// Wat er gemeten wordt, en waarom juist dit:
//   - laden: verzoeken en bytes naar /api, tijd tot het eerste kerncijfer, LCP, CLS, lange taken,
//     paginahoogte en de positie van het eerste kerncijfer (hoe ver je moet scrollen voor een cijfer);
//   - wissel van kanaal en van periode: verzoeken, tijd tot de eerste zichtbare verandering en tot
//     het netwerk stil is, beeldjes per seconde, en het aandeel blokken (secties) dat verandert:
//     een pagina waarvan één blok op twintig beweegt, voelt statisch, hoe mooi dat ene blok ook beweegt;
//   - eerlijkheid: hoeveel verschillende conversietotalen er op de pagina staan (ieder uit een eigen
//     venster) en of er iets permanent beweegt (een pulse die nooit stopt wijst niets meer aan).
//
// Vaste meetnormen en drempels staan in het bouwplan; dit script oordeelt niet, het meet.

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASIS = process.env.BASIS_URL ?? "http://localhost:3190";
const KLANT = process.env.DEMO_CLIENT ?? "demo-greentech";
const FASE = process.env.FASE ?? "meting";
const THROTTLES = (process.env.THROTTLES ?? "1,4").split(",").map(Number);
const MOBIEL = process.env.MOBIEL !== "0";
const CHROOM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const URL_KLANT = `${BASIS}/client/${KLANT}?demo=1`;
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

  // ── Wissels (alleen op desktop: de tabs staan daar in beeld) ──
  if (breedte >= 1000) {
    const wissel = async (label, doe) => {
      log = [];
      await p.evaluate(() => { window.__m.lang = 0; window.__m.langN = 0; window.__mark(); });
      const voor = await p.evaluate(SNAPSHOT);
      const t = Date.now();
      let fout = null;
      try { await doe(); } catch (e) { fout = String(e.message).slice(0, 120); }
      const r = await rust(15000);
      await p.waitForTimeout(1600);
      const na = await p.evaluate(SNAPSHOT);
      const eerste = await p.evaluate(() => window.__eerste);
      const frames = await p.evaluate(() => window.__frames.slice(2));
      const mm = await p.evaluate(() => ({ lang: window.__m.lang, langN: window.__m.langN, cls: window.__m.cls - window.__cls0 }));
      const sleutels = [...new Set([...Object.keys(voor), ...Object.keys(na)])];
      const veranderd = sleutels.filter((k) => voor[k] !== na[k]);
      res.wissels.push({
        label, fout,
        api: apiTotaal(), perPad: perPad(),
        eersteVeranderingMs: eerste === null ? null : Math.round(eerste),
        netwerkStilMs: r < 0 ? null : Date.now() - t - RUST_MS - 1600,
        blokken: sleutels.length, blokkenVeranderd: veranderd.length, veranderd: veranderd.slice(0, 30),
        beeldjes: frames.length, beeldjesBoven25ms: frames.filter((x) => x > 25).length,
        langeTaken: mm.langN, blokkeerMs: Math.round(mm.lang), cls: Math.round(mm.cls * 1000) / 1000,
      });
    };
    await wissel("kanaal: Alle kanalen -> Meta", () => p.getByRole("button", { name: /^Meta$/ }).first().click());
    await wissel("kanaal: Meta -> Alle kanalen", () => p.getByRole("button", { name: /^Alle kanalen$/ }).first().click());
    // Het tweede bezoek aan dezelfde tab: wat een cache waard is, zie je pas hier.
    await wissel("kanaal: Alle kanalen -> Meta (tweede keer)", () => p.getByRole("button", { name: /^Meta$/ }).first().click());
    await wissel("kanaal: Meta -> Alle kanalen (tweede keer)", () => p.getByRole("button", { name: /^Alle kanalen$/ }).first().click());
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
  }
  if (r.eerlijk) console.log(`eerlijk: conversietotalen ${JSON.stringify(r.eerlijk.conversietotalen)} · permanente animaties ${r.eerlijk.permanenteAnimaties.length} ${JSON.stringify(r.eerlijk.permanenteAnimaties.slice(0, 3))} · datastand "${r.eerlijk.datastand}"`);
}
console.log(`\nopgeslagen: ${bestand}`);

// Zoekt tekst die BUITEN zijn eigen kaartrand rendert.
//
// ── WAAROM DIT ER IS ────────────────────────────────────────────────────────
//
// Op het tabblad Doelen & voortgang stonden "Doel: 1.650" en "Prognose: 1.246 (-24%)" 22 pixels
// onder de onderrand van hun kaart, op de pagina-achtergrond. Op alle vijf de kaarten. Niets
// meldde dat: tsc niet, de tests niet, de build niet, en de browser ook niet -- `overflow` staat
// op `visible`, dus het rendert gewoon en het leest als een ontwerpkeuze.
//
// De oorzaak zit een laag dieper dan de kaart. Een kind met `h-full` in een RASTERCEL is
// gevaarlijk: rastercellen rekken naar de hoogste van hun rij, dus krijgt de kaart een
// definitieve hoogte, lost `h-full` op naar die volle hoogte, en wordt alles wat ná dat kind
// komt eruit geduwd. Kerncijfer rendert zo'n `flex h-full flex-col`, met goede reden -- hij moet
// een cel kunnen vullen als hij er los in staat.
//
// Dat is geen fout die je in de code ziet staan. Je ziet hem alleen door na te meten.
//
// ── HOE JE HEM DRAAIT ───────────────────────────────────────────────────────
//
//   npx next build && npx next start -p 3190     (eerst bouwen, zonder draaiende server)
//   node scripts/check-kaartoverloop.mjs
//
// Bewust NIET in scripts/gates.sh: die moet snel zijn en heeft geen server nodig. Deze heeft een
// draaiende server en een browser nodig, dus hij is er voor na opmaakwerk aan kaarten en rasters.
//
// ── DE ZELFTEST ─────────────────────────────────────────────────────────────
//
// Een controle die niet kán falen is geen controle. Aan het eind zet dit script de bug in de
// browser terug -- de wrapper op `display: contents`, waarna `h-full` weer op de volle kaart
// oplost -- en eist dat de detector hem vindt. Vindt hij hem niet, dan is "schoon" hierboven
// betekenisloos en faalt dit script alsnog.

import { chromium } from "playwright-core";

const BASIS = process.env.BASIS_URL ?? "http://localhost:3190";
const KLANT = process.env.DEMO_CLIENT ?? "demo-greentech";
const CHROOM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const WACHT = Number(process.env.WACHT_MS ?? 8000);

/**
 * Loopt elke kaart na en geeft de tekstelementen terug die erbuiten vallen.
 *
 * Overgeslagen, met reden:
 *   - kaarten met `overflow` anders dan visible: daar is afsnijden of scrollen de bedoeling;
 *   - `position: absolute/fixed`: die horen los van de stroom te staan (tooltips, badges);
 *   - een marge van 2px, want subpixel-randen en afrondingen leveren anders ruis.
 */
const DETECTOR = () => {
  const uit = [];
  const kaarten = document.querySelectorAll(
    "div.bg-card, section.bg-card, [class*='rounded-xl'][class*='border']"
  );
  for (const kaart of kaarten) {
    const cs = getComputedStyle(kaart);
    if (cs.overflow !== "visible" || cs.position === "fixed") continue;
    const kr = kaart.getBoundingClientRect();
    if (kr.height < 20) continue;
    for (const el of kaart.querySelectorAll("*")) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || "").trim();
      if (!t) continue;
      const es = getComputedStyle(el);
      if (es.position === "absolute" || es.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) continue;
      const onder = Math.round(r.bottom - kr.bottom);
      const rechts = Math.round(r.right - kr.right);
      if (onder > 2 || rechts > 2) uit.push({ tekst: t.slice(0, 40), onder, rechts });
    }
  }
  // Ontdubbelen op tekst: dezelfde regel in twintig tabelrijen is één bevinding.
  const gezien = new Set();
  return uit.filter((u) => {
    const k = `${u.tekst}|${u.onder}|${u.rechts}`;
    if (gezien.has(k)) return false;
    gezien.add(k);
    return true;
  });
};

const KLANT_URL = `${BASIS}/client/${KLANT}?demo=1`;

/** Naam, url, en de knoppen die je moet indrukken om er te komen. */
const SCHERMEN = [
  ["klanten", `${BASIS}/clients?demo=1`, []],
  ["overzicht", KLANT_URL, []],
  ["google", KLANT_URL, [/^Google Ads$/]],
  ["meta", KLANT_URL, [/^Meta$/]],
  ["linkedin", KLANT_URL, [/^LinkedIn$/]],
  ["campagnes", KLANT_URL, [/^Campagnes$/]],
  ["prognose", KLANT_URL, [/^Prognose$/]],
  ["analyse", KLANT_URL, [/Analyse & advies/]],
  ["bevindingen", KLANT_URL, [/Analyse & advies/, /^Bevindingen$/]],
  ["sprint", KLANT_URL, [/Planning & rapportage/]],
  ["doelen", KLANT_URL, [/Planning & rapportage/, /Doelen & voortgang/]],
  ["instellingen", KLANT_URL, [/^Instellingen$/]],
  ["portfolio", `${BASIS}/portfolio?demo=1`, []],
  ["app-instellingen", `${BASIS}/settings?demo=1`, []],
  ["beheer", `${BASIS}/admin?demo=1`, []],
];

async function ga(p, url, klikken) {
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(WACHT);
  for (const k of klikken) {
    await p.getByRole("button", { name: k }).first().click().catch(() => {});
    await p.waitForTimeout(4500);
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROOM });
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let bevindingen = 0;

  for (const [naam, url, klikken] of SCHERMEN) {
    await ga(p, url, klikken);
    const r = await p.evaluate(DETECTOR);
    bevindingen += r.length;
    console.log(`  ${r.length === 0 ? "OK  " : "FOUT"}  ${naam.padEnd(18)} ${r.length === 0 ? "niets buiten de kaart" : `${r.length} buiten de kaart`}`);
    for (const x of r.slice(0, 8)) {
      const waar = [x.onder > 2 ? `${x.onder}px onder` : null, x.rechts > 2 ? `${x.rechts}px rechts` : null]
        .filter(Boolean).join(", ");
      console.log(`          "${x.tekst}"  ${waar}`);
    }
  }

  // ── De zelftest ──────────────────────────────────────────────────────────
  console.log("\nZelftest: de bug terugzetten en kijken of de detector hem vindt.");
  await ga(p, KLANT_URL, [/Planning & rapportage/, /Doelen & voortgang/]);
  const gewijzigd = await p.evaluate(() => {
    const kop = [...document.querySelectorAll("h2")].find((h) =>
      /Voortgang trajectdoelen/i.test(h.textContent || ""));
    const raster = kop?.parentElement?.querySelector("div.grid");
    let n = 0;
    for (const kaart of raster?.children ?? []) {
      const wrapper = kaart.firstElementChild;
      // `display: contents` haalt de wrapper uit de opmaak, waarna h-full weer op de volle
      // kaarthoogte oplost -- precies de stand van vóór de reparatie.
      if (wrapper) { wrapper.style.display = "contents"; n++; }
    }
    return n;
  });
  await p.waitForTimeout(500);
  const nabootsing = await p.evaluate(DETECTOR);
  await browser.close();

  if (gewijzigd === 0) {
    console.log("  FOUT  de zelftest kon de kaarten niet vinden; deze uitslag zegt niets.");
    process.exit(1);
  }
  if (nabootsing.length === 0) {
    console.log(`  FOUT  bug teruggezet op ${gewijzigd} kaarten, maar de detector meldt niets.`);
    console.log("        Dan controleert hij iets anders dan hij beweert en is 'OK' hierboven leeg.");
    process.exit(1);
  }
  console.log(`  OK    ${nabootsing.length} bevindingen bij een teruggezette bug (o.a. "${nabootsing[0].tekst}", ${nabootsing[0].onder}px onder de rand).`);

  if (bevindingen > 0) {
    console.log(`\n  ${bevindingen} stuk(ken) tekst rendert buiten zijn kaart.`);
    process.exit(1);
  }
  console.log("\n  Geen enkele kaart lekt zijn inhoud.");
}

main().catch((e) => { console.error(e); process.exit(1); });

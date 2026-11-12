// De normen van het bouwplan "een Overzicht dat niet statisch overkomt" (9 november 2026), als
// regels die een meting van scripts/meet-overzicht.mjs beoordelen. Zuiver: geen bestanden, geen
// browser. De opdrachtregel staat in scripts/oordeel-overzicht.mjs; de toetsen in
// lib/__overzicht_fase6_test.ts (het blok "Het oordeel").
//
// WAAROM DIT BESTAAT. Het meetscript oordeelt bewust niet: het legt getallen vast. De normen
// stonden in een tabel in het bouwplan, en of een meting ze haalde werd na elke fase met de hand
// naast die tabel gelegd. Dat gaat goed tot iemand een norm vergeet of een getal uit de verkeerde
// run pakt (desktop tegen mobiel, snelle tegen trage CPU). Hier staat elke norm één keer, met de
// run waar hij over gaat en de plek in de meting waar zijn getal vandaan komt.
//
// VIER UITKOMSTEN, NIET TWEE.
//   - "gehaald" en "niet gehaald";
//   - "niet gemeten": de meting bevat het getal niet (een oudere meting zonder vensters, een run
//     die ontbreekt, of een norm die dit script niet uit een pagina kan aflezen, zoals "elke
//     werkdag een nieuw logboekitem"). Niet gemeten is geen gehaald: het oordeel telt ze apart;
//   - "meting mislukt": de handeling waar de norm over gaat is in de meting FOUT gegaan (een
//     periodewissel die niet lukte, een herlaad die vastliep). Dat was eerst "niet gemeten", en
//     dan gaf een periodewissel die helemaal niet werkt een schoon oordeel. Mislukt telt voor de
//     afsluitcode als niet gehaald.
//
// EEN AFWIJKING VAN HET BOUWPLAN, HARDOP. Het bouwplan zegt bij A1: "minstens 90% van de blokken
// die 'volgt periode' dragen, verandert bij een periodewissel". Een dichtgeklapt blok toont geen
// cijfer en kan bij een wissel dus niet veranderen; het meetscript telt die sinds 12 november
// apart. A1 gaat daarom over de OPEN blokken, en A1b legt dezelfde norm op aan de dichte: de
// meting opent ze één keer en wisselt dan van periode. Alleen A1 en A1b samen zijn de norm van
// het bouwplan. Een meting zonder `dichteVolgers` (van vóór die stap) is op A1b "niet gemeten".
//
// EEN OORDEEL DAT NIET KAN AFKEUREN, ZEGT NIETS. Elke norm draagt daarom zijn eigen proef: de
// laatste waarde die nog gehaald is (`grens`), de eerste die het niet meer is (`over`, één stap
// verder), en een functie (`zet`) die zo'n waarde op de plek van DEZE norm in een goede meting
// schrijft, en nergens anders. zelftest() eist per norm: op de grens gehaald, één stap erover
// niet gehaald, en in beide gevallen blijft elke ANDERE norm gehaald. De drie runs van de goede
// meting hebben verschillende waarden, zodat een norm die uit de verkeerde run leest (desktop
// tegen mobiel, snel tegen traag) door de mand valt, en een norm met een verschoven drempel ook.
// Een eerdere zelftest gebruikte één meting die overal ruim over de grens zat: die zag niet welke
// run een norm las en niet waar de drempel lag (elf van zeventien ingebrachte fouten bleven
// onopgemerkt). De opdrachtregel draait de zelftest bij elke aanroep en faalt als hij faalt.

/** De vier uitkomsten. */
export const GEHAALD = "gehaald", NIET_GEHAALD = "niet gehaald", NIET_GEMETEN = "niet gemeten", MISLUKT = "meting mislukt";

const desktop = (m) => m.runs?.find((r) => r.breedte >= 1000 && r.throttle === 1) ?? null;
const traag = (m) => m.runs?.find((r) => r.breedte >= 1000 && r.throttle > 1) ?? null;
const mobiel = (m) => m.runs?.find((r) => r.breedte < 1000) ?? null;
const isGetal = (v) => typeof v === "number" && Number.isFinite(v);
const isPeriode = (w) => w.label.startsWith("periode");
const isKanaal = (w) => w.label.startsWith("kanaal");

/**
 * De wissels van een run waar een norm over gaat, of `{ mislukt }` als er een van FOUT ging.
 * Een kanaal dat de klant niet heeft staat niet tussen de wissels (het meetscript slaat het over en
 * noemt het in `kanalenOvergeslagen`), dus een fout hier is een handeling die niet lukte.
 */
function wissels(run, welke = () => true) {
  const lijst = (run?.wissels ?? []).filter(welke);
  const stuk = lijst.find((w) => w.fout);
  return stuk ? { mislukt: `de wissel "${stuk.label}" ging fout: ${stuk.fout}` } : lijst;
}

/** De vensters per tabblad; een oudere meting kent alleen "Alle kanalen". */
const perTabblad = (m) => desktop(m)?.venstersPerKanaal ?? (desktop(m)?.vensters ? { "Alle kanalen": desktop(m).vensters } : null);

/** Een norm met een bovengrens: de waarde uit de meting moet eronder (of erop) liggen. */
const hooguit = (grens, strikt = false) => (v) => (strikt ? v < grens : v <= grens);
const minstens = (grens) => (v) => v >= grens;

// De plekken in een meting waar de proef van een norm zijn waarde schrijft. Bewust los van `lees`:
// stond hier dezelfde hulpfunctie als in `lees`, dan las en schreef een fout in die functie op
// dezelfde verkeerde plek en zag de zelftest niets.
const run = (m, i) => m.runs[i]; // 0: desktop, snelle CPU. 1: desktop, 4x trager. 2: mobiel.
const tweedeWissel = (r, begin) => r.wissels.filter((w) => w.label.startsWith(begin))[1];
const aandeel = (v) => ({ blokken: 100, veranderd: Math.round(v * 100), stil: [], dicht: [] });

/**
 * De normen. Elke norm leest één waarde uit de meting (`lees`: een getal, null = niet gemeten, of
 * `{ mislukt }`) en toetst hem (`haalt`). `toon` maakt er een leesbaar getal van. `proef` is de
 * grens, één stap erover, en waar die waarde in een meting hoort (zie de kop van dit bestand).
 * De eigenschap (A tot E) en de tekst van de norm zijn die van de tabel in het bouwplan.
 */
export const NORMEN = [
  // ── A. Reageert ──
  {
    id: "A1", eigenschap: "A. Reageert", norm: "minstens 90% van de open blokken met 'volgt periode' verandert bij een periodewissel (de dichte: A1b)",
    lees: (m) => {
      const w = wissels(desktop(m), isPeriode);
      if (!Array.isArray(w)) return w;
      const met = w.filter((x) => x.volgtPeriode && x.volgtPeriode.blokken > 0);
      return met.length === 0 ? null : Math.min(...met.map((x) => x.volgtPeriode.veranderd / x.volgtPeriode.blokken));
    },
    haalt: minstens(0.9), toon: (v) => `${Math.round(v * 100)}% (laagste wissel)`,
    proef: { grens: 0.9, over: 0.89, zet: (m, v) => { tweedeWissel(run(m, 0), "periode").volgtPeriode = aandeel(v); } },
  },
  {
    id: "A1b", eigenschap: "A. Reageert", norm: "minstens 90% van de dichte blokken met 'volgt periode' verandert, eenmaal geopend, bij een periodewissel",
    lees: (m) => {
      const per = desktop(m)?.dichteVolgers;
      if (!per) return null;
      const stuk = Object.entries(per).find(([, d]) => d.fout && d.fout !== "tabblad niet beschikbaar");
      if (stuk) return { mislukt: `de dichte blokken op ${stuk[0]} waren niet te meten: ${stuk[1].fout}` };
      const met = Object.values(per).filter((d) => !d.fout && d.blokken > 0);
      // Geen enkel dicht blok met dit label: er valt niets te schenden.
      return met.length === 0 ? 1 : Math.min(...met.map((d) => d.veranderd / d.blokken));
    },
    haalt: minstens(0.9), toon: (v) => `${Math.round(v * 100)}% (laagste tabblad; een blok dat niet openging telt als stil)`,
    proef: { grens: 0.9, over: 0.89, zet: (m, v) => { run(m, 0).dichteVolgers.Meta = { blokken: 100, geopend: 100, veranderd: Math.round(v * 100), stil: [], nietGeopend: [] }; } },
  },
  {
    id: "A2", eigenschap: "A. Reageert", norm: "0 netwerkverzoeken bij een periodewissel",
    lees: (m) => { const w = wissels(desktop(m), isPeriode); return !Array.isArray(w) ? w : w.length === 0 ? null : Math.max(...w.map((x) => x.api.verzoeken)); },
    haalt: hooguit(0), toon: (v) => `${v} (hoogste wissel)`,
    proef: { grens: 0, over: 1, zet: (m, v) => { tweedeWissel(run(m, 0), "periode").api.verzoeken = v; } },
  },
  {
    id: "A3", eigenschap: "A. Reageert", norm: "0 netwerkverzoeken bij een kanaalwissel",
    lees: (m) => { const w = wissels(desktop(m), isKanaal); return !Array.isArray(w) ? w : w.length === 0 ? null : Math.max(...w.map((x) => x.api.verzoeken)); },
    haalt: hooguit(0), toon: (v) => `${v} (hoogste wissel; het eerste bezoek aan een kanaal telt mee)`,
    proef: { grens: 0, over: 1, zet: (m, v) => { tweedeWissel(run(m, 0), "kanaal").api.verzoeken = v; } },
  },
  {
    id: "A4", eigenschap: "A. Reageert", norm: "eerste zichtbare reactie na een klik onder 100 ms",
    lees: (m) => {
      const w = wissels(desktop(m));
      if (!Array.isArray(w)) return w;
      const met = w.filter((x) => isGetal(x.eersteVeranderingMs));
      return met.length === 0 ? null : Math.max(...met.map((x) => x.eersteVeranderingMs));
    },
    haalt: hooguit(100, true), toon: (v) => `${v} ms (traagste wissel)`,
    proef: { grens: 99, over: 100, zet: (m, v) => { tweedeWissel(run(m, 0), "periode").eersteVeranderingMs = v; } },
  },
  {
    id: "A5", eigenschap: "A. Reageert", norm: "na een herlaad dezelfde toestand (kanaal en periode uit de adresbalk)",
    lees: (m) => { const h = desktop(m)?.herlaad; return !h ? null : h.fout ? { mislukt: `de herlaad ging fout: ${h.fout}` } : h.zelfdeToestand ? 1 : 0; },
    haalt: minstens(1), toon: (v) => (v === 1 ? "zelfde toestand" : "andere toestand"),
    proef: { grens: 1, over: 0, zet: (m, v) => { run(m, 0).herlaad.zelfdeToestand = v === 1; } },
  },
  // ── C. Wijst aan ──
  {
    id: "C1", eigenschap: "C. Wijst aan", norm: "eerste kerncijfer op hooguit 350 px van de bovenrand (desktop)",
    lees: (m) => desktop(m)?.laden?.eersteKerncijfer?.y ?? null, haalt: hooguit(350), toon: (v) => `${v} px`,
    proef: { grens: 350, over: 351, zet: (m, v) => { run(m, 0).laden.eersteKerncijfer.y = v; } },
  },
  {
    id: "C2", eigenschap: "C. Wijst aan", norm: "eerste kerncijfer op hooguit 250 px van de bovenrand (mobiel)",
    lees: (m) => mobiel(m)?.laden?.eersteKerncijfer?.y ?? null, haalt: hooguit(250), toon: (v) => `${v} px`,
    proef: { grens: 250, over: 251, zet: (m, v) => { run(m, 2).laden.eersteKerncijfer.y = v; } },
  },
  // ── D. Snel en rustig ──
  {
    id: "D1", eigenschap: "D. Snel en rustig", norm: "eerste kerncijfer zichtbaar binnen 1,0 s (snelle CPU)",
    lees: (m) => desktop(m)?.laden?.eersteKerncijferMs ?? null, haalt: hooguit(1000), toon: (v) => `${v} ms`,
    proef: { grens: 1000, over: 1001, zet: (m, v) => { run(m, 0).laden.eersteKerncijferMs = v; } },
  },
  {
    id: "D2", eigenschap: "D. Snel en rustig", norm: "eerste kerncijfer zichtbaar binnen 1,5 s (4x tragere CPU)",
    lees: (m) => traag(m)?.laden?.eersteKerncijferMs ?? null, haalt: hooguit(1500), toon: (v) => `${v} ms`,
    proef: { grens: 1500, over: 1501, zet: (m, v) => { run(m, 1).laden.eersteKerncijferMs = v; } },
  },
  {
    id: "D3", eigenschap: "D. Snel en rustig", norm: "hooguit 12 verzoeken bij het laden",
    lees: (m) => desktop(m)?.laden?.api?.verzoeken ?? null, haalt: hooguit(12), toon: (v) => `${v}`,
    proef: { grens: 12, over: 13, zet: (m, v) => { run(m, 0).laden.api.verzoeken = v; } },
  },
  {
    id: "D4", eigenschap: "D. Snel en rustig", norm: "hooguit 120 kB bij het laden",
    lees: (m) => desktop(m)?.laden?.api?.kb ?? null, haalt: hooguit(120), toon: (v) => `${v} kB`,
    proef: { grens: 120, over: 121, zet: (m, v) => { run(m, 0).laden.api.kb = v; } },
  },
  {
    id: "D5", eigenschap: "D. Snel en rustig", norm: "verspringen (CLS) onder 0,10 op desktop",
    lees: (m) => desktop(m)?.laden?.cls ?? null, haalt: hooguit(0.1, true), toon: (v) => `${v}`,
    proef: { grens: 0.099, over: 0.1, zet: (m, v) => { run(m, 0).laden.cls = v; } },
  },
  {
    id: "D6", eigenschap: "D. Snel en rustig", norm: "verspringen (CLS) onder 0,10 op mobiel",
    lees: (m) => mobiel(m)?.laden?.cls ?? null, haalt: hooguit(0.1, true), toon: (v) => `${v}`,
    proef: { grens: 0.099, over: 0.1, zet: (m, v) => { run(m, 2).laden.cls = v; } },
  },
  {
    id: "D7", eigenschap: "D. Snel en rustig", norm: "geen gemist beeldje (boven 25 ms) tijdens een wissel bij 4x tragere CPU",
    lees: (m) => {
      const w = wissels(traag(m));
      if (!Array.isArray(w)) return w;
      const met = w.filter((x) => isGetal(x.beeldjesBoven25ms));
      return met.length === 0 ? null : Math.max(...met.map((x) => x.beeldjesBoven25ms));
    },
    haalt: hooguit(0), toon: (v) => `${v} (slechtste wissel)`,
    proef: { grens: 0, over: 1, zet: (m, v) => { tweedeWissel(run(m, 1), "kanaal").beeldjesBoven25ms = v; } },
  },
  {
    id: "D8", eigenschap: "D. Snel en rustig", norm: "paginahoogte hooguit 3.000 px (desktop, Alle kanalen)",
    lees: (m) => desktop(m)?.laden?.paginaHoogte ?? null, haalt: hooguit(3000), toon: (v) => `${v} px`,
    proef: { grens: 3000, over: 3001, zet: (m, v) => { run(m, 0).laden.paginaHoogte = v; } },
  },
  {
    id: "D9", eigenschap: "D. Snel en rustig", norm: "paginahoogte hooguit 4.500 px (mobiel, Alle kanalen)",
    lees: (m) => mobiel(m)?.laden?.paginaHoogte ?? null, haalt: hooguit(4500), toon: (v) => `${v} px`,
    proef: { grens: 4500, over: 4501, zet: (m, v) => { run(m, 2).laden.paginaHoogte = v; } },
  },
  // ── E. Eerlijk ──
  {
    id: "E1", eigenschap: "E. Eerlijk", norm: "geen conversietotaal in een blok dat zijn venster niet noemt",
    lees: (m) => { const per = perTabblad(m); return per ? Object.values(per).reduce((n, v) => n + (v.conversietotalenZonderVenster?.length ?? 0), 0) : null; },
    haalt: hooguit(0), toon: (v) => `${v}`,
    proef: { grens: 0, over: 1, zet: (m, v) => { run(m, 0).venstersPerKanaal.Meta.conversietotalenZonderVenster = Array.from({ length: v }, () => ({ totaal: "350", blok: "Proef #1" })); } },
  },
  {
    id: "E2", eigenschap: "E. Eerlijk", norm: "geen blok zonder venster (op elk tabblad)",
    lees: (m) => { const per = perTabblad(m); return per ? Object.values(per).reduce((n, v) => n + (v.zonderVenster?.length ?? 0), 0) : null; },
    haalt: hooguit(0), toon: (v) => `${v}`,
    proef: { grens: 0, over: 1, zet: (m, v) => { run(m, 0).venstersPerKanaal.Meta.zonderVenster = Array.from({ length: v }, () => "Proef #1"); } },
  },
  {
    id: "E3", eigenschap: "E. Eerlijk", norm: "0 permanente animaties",
    lees: (m) => { const r = desktop(m); return r?.eerlijk ? r.eerlijk.permanenteAnimaties.length : null; },
    haalt: hooguit(0), toon: (v) => `${v}`,
    proef: { grens: 0, over: 1, zet: (m, v) => { run(m, 0).eerlijk.permanenteAnimaties = Array.from({ length: v }, () => "span.animate-pulse"); } },
  },
];

/**
 * Wat het bouwplan ook als norm noemt, maar dit script niet uit een paginameting kan aflezen. Ze
 * staan in het oordeel als "niet gemeten", met waar het antwoord wel vandaan komt: zo staat er
 * geen norm stil uit de lijst.
 */
export const NIET_UIT_DE_METING = [
  { id: "B1", eigenschap: "B. Leeft", norm: "minstens 1 nieuw logboekitem per werkdag per klant", waar: "tel de regels van het logboek over een week op een live klant; de demo toont voorbeelden" },
  { id: "B2", eigenschap: "B. Leeft", norm: "80% van de bezoeken na een nacht toont iets nieuws sinds het vorige bezoek", waar: "volgt uit B1 en uit de syncs en jobs die 's nachts draaien" },
  { id: "C3", eigenschap: "C. Wijst aan", norm: "delta minstens 12 px en contrast minstens 4,5:1", waar: "de opmaak van de delta ligt vast in de tegels (lib/__overzicht_bovenkant_test.ts); het contrast meet je met een contrastchecker op de pagina" },
  { id: "E4", eigenschap: "E. Eerlijk", norm: "geen datastand ouder dan 2 dagen zonder rode melding", waar: "de regel ligt vast in lib/__overzicht_bovenkant_test.ts (kaartStand); op de demo staat de data bewust stil en is hij als demodata gemerkt" },
];

/**
 * Het oordeel over één meting: per norm de waarde en de uitkomst.
 *
 * @param meting Het JSON-bestand van scripts/meet-overzicht.mjs, ingelezen.
 * @returns De regels, in de volgorde van het bouwplan, en de telling per uitkomst.
 */
export function beoordeel(meting) {
  const regels = NORMEN.map((n) => {
    const basis = { id: n.id, eigenschap: n.eigenschap, norm: n.norm };
    let waarde = null;
    try { waarde = n.lees(meting); } catch { waarde = null; }
    if (waarde && typeof waarde === "object" && typeof waarde.mislukt === "string") return { ...basis, waarde: null, getoond: waarde.mislukt, uitkomst: MISLUKT };
    if (!isGetal(waarde)) return { ...basis, waarde: null, getoond: "—", uitkomst: NIET_GEMETEN };
    return { ...basis, waarde, getoond: n.toon(waarde), uitkomst: n.haalt(waarde) ? GEHAALD : NIET_GEHAALD };
  });
  for (const n of NIET_UIT_DE_METING) regels.push({ id: n.id, eigenschap: n.eigenschap, norm: n.norm, waarde: null, getoond: n.waar, uitkomst: NIET_GEMETEN });
  regels.sort((a, b) => a.id.localeCompare(b.id, "nl", { numeric: true }));
  const tel = (u) => regels.filter((r) => r.uitkomst === u).length;
  return { regels, gehaald: tel(GEHAALD), nietGehaald: tel(NIET_GEHAALD), nietGemeten: tel(NIET_GEMETEN), mislukt: tel(MISLUKT) };
}

/** Het oordeel als tekst, één regel per norm. */
export function oordeelTekst(oordeel) {
  const breedte = Math.max(...oordeel.regels.map((r) => r.uitkomst.length));
  const regels = oordeel.regels.map((r) => `${r.id.padEnd(3)} ${r.uitkomst.padEnd(breedte)}  ${r.norm}: ${r.getoond}`);
  regels.push(`\n${oordeel.gehaald} gehaald, ${oordeel.nietGehaald} niet gehaald, ${oordeel.mislukt} mislukt, ${oordeel.nietGemeten} niet gemeten.`);
  return regels.join("\n");
}

// ── De zelftest ─────────────────────────────────────────────────────────────────────────────────

const wissel = (label, o = {}) => ({
  label, fout: null, api: { verzoeken: 0, kb: 0 }, eersteVeranderingMs: 60, beeldjes: 80, beeldjesBoven25ms: 0,
  volgtPeriode: { blokken: 10, veranderd: 10, stil: [], dicht: [] }, ...o,
});
const vensters = () => ({ blokken: 18, perSoort: { periode: 10, jaar: 3, vast: 2, stand: 3 }, zonderVenster: [], conversietotalen: [], conversietotalenZonderVenster: [] });
const vierWissels = (o = {}) => [
  wissel("kanaal: Alle kanalen -> Meta", o), wissel("kanaal: Meta -> Alle kanalen", o),
  wissel("periode: -> Laatste 3 maanden", o), wissel("periode: -> Laatste 12 maanden", o),
];
const dichteVolgers = () => ({ blokken: 2, geopend: 2, veranderd: 2, stil: [], nietGeopend: [] });

/**
 * Een meting die elke meetbare norm haalt. Verzonnen getallen; alleen voor de zelftest.
 *
 * De drie runs zijn met opzet VERSCHILLEND, en elk zo dat hij de norm van een andere run niet zou
 * halen waar dat kan: de trage run doet 1,4 s over het eerste cijfer (te traag voor de snelle
 * norm) en reageert in 140 ms (te traag voor A4, die over de snelle run gaat); de mobiele pagina
 * is 4.200 px hoog (te hoog voor desktop); het eerste cijfer staat op desktop op 340 px (te laag
 * voor mobiel). Een norm die uit de verkeerde run leest, keurt deze meting dus al af.
 */
export function goedeMeting() {
  return {
    datum: "zelftest", fase: "goed", url: "zelftest",
    runs: [
      {
        naam: "1440 cpu x1", breedte: 1440, throttle: 1,
        laden: { eersteKerncijferMs: 800, cls: 0.02, api: { verzoeken: 10, kb: 90 }, paginaHoogte: 2900, eersteKerncijfer: { tekst: "3.384", y: 340 } },
        wissels: vierWissels(),
        eerlijk: { conversietotalen: ["350"], permanenteAnimaties: [], datastand: "t/m 25 aug 2026" },
        vensters: vensters(), venstersPerKanaal: { "Alle kanalen": vensters(), Meta: vensters() },
        dichteVolgers: { "Alle kanalen": dichteVolgers(), Meta: dichteVolgers(), LinkedIn: { fout: "tabblad niet beschikbaar" } },
        kanalenOvergeslagen: ["LinkedIn"],
        herlaad: { zelfdeToestand: true },
      },
      {
        naam: "1440 cpu x4", breedte: 1440, throttle: 4,
        laden: { eersteKerncijferMs: 1400, cls: 0.05, api: { verzoeken: 10, kb: 90 }, paginaHoogte: 2950, eersteKerncijfer: { tekst: "3.384", y: 345 } },
        wissels: vierWissels({ eersteVeranderingMs: 140 }),
        eerlijk: { conversietotalen: ["350"], permanenteAnimaties: [], datastand: "t/m 25 aug 2026" },
        vensters: vensters(), venstersPerKanaal: { "Alle kanalen": vensters(), Meta: vensters() },
        herlaad: { zelfdeToestand: true },
      },
      {
        naam: "390 cpu x1", breedte: 390, throttle: 1,
        laden: { eersteKerncijferMs: 900, cls: 0.05, api: { verzoeken: 10, kb: 90 }, paginaHoogte: 4200, eersteKerncijfer: { tekst: "3.384", y: 240 } },
        wissels: [],
        eerlijk: { conversietotalen: ["350"], permanenteAnimaties: [], datastand: "t/m 25 aug 2026" },
        vensters: vensters(),
      },
    ],
  };
}

/** Een meting die elke meetbare norm SCHENDT, elk precies één stap over zijn grens. */
export function slechteMeting() {
  const m = goedeMeting();
  for (const n of NORMEN) n.proef.zet(m, n.proef.over);
  return m;
}

/**
 * Kan het oordeel afkeuren, en keurt het af waar het hoort?
 *
 * Per norm: op de grens gehaald; één stap erover niet gehaald; en in beide gevallen is elke andere
 * norm nog gehaald (anders leest een norm de plek van een andere). Daarnaast: de goede meting
 * haalt alles, een lege meting haalt en schendt niets, en een wissel die fout ging is "mislukt"
 * op de normen die over die wissel gaan en op geen andere.
 *
 * @returns `ok` en, als het misgaat, per norm wat er niet klopte.
 */
export function zelftest() {
  const fouten = [];
  const meetbaar = new Set(NORMEN.map((n) => n.id));
  const uitkomsten = (m) => new Map(beoordeel(m).regels.filter((r) => meetbaar.has(r.id)).map((r) => [r.id, r]));

  for (const r of uitkomsten(goedeMeting()).values()) if (r.uitkomst !== GEHAALD) fouten.push(`${r.id}: de goede meting is ${r.uitkomst} (${r.getoond})`);
  for (const r of beoordeel({ runs: [] }).regels) if (r.uitkomst !== NIET_GEMETEN) fouten.push(`${r.id}: een lege meting is ${r.uitkomst}`);

  for (const n of NORMEN) {
    for (const [waarde, verwacht, naam] of [[n.proef.grens, GEHAALD, "op de grens"], [n.proef.over, NIET_GEHAALD, "één stap over de grens"]]) {
      const m = goedeMeting();
      n.proef.zet(m, waarde);
      for (const r of uitkomsten(m).values()) {
        const hoort = r.id === n.id ? verwacht : GEHAALD;
        if (r.uitkomst !== hoort) fouten.push(`${n.id} ${naam} (${waarde}): ${r.id} is ${r.uitkomst} (${r.getoond}), hoort ${hoort}`);
      }
    }
  }

  // Een wissel die fout ging: mislukt op de normen over die wissel, en alleen daar.
  const metFout = (runIndex, begin, hoortMislukt) => {
    const m = goedeMeting();
    tweedeWissel(run(m, runIndex), begin).fout = "knop niet gevonden";
    for (const r of uitkomsten(m).values()) {
      const hoort = hoortMislukt.includes(r.id) ? MISLUKT : GEHAALD;
      if (r.uitkomst !== hoort) fouten.push(`een ${begin}wissel met een fout (run ${runIndex}): ${r.id} is ${r.uitkomst}, hoort ${hoort}`);
    }
  };
  metFout(0, "periode", ["A1", "A2", "A4"]);
  metFout(0, "kanaal", ["A3", "A4"]);
  metFout(1, "periode", ["D7"]);
  {
    const m = goedeMeting();
    run(m, 0).herlaad = { fout: "time-out" };
    run(m, 0).dichteVolgers.Meta = { fout: "time-out" };
    for (const r of uitkomsten(m).values()) {
      const hoort = r.id === "A5" || r.id === "A1b" ? MISLUKT : GEHAALD;
      if (r.uitkomst !== hoort) fouten.push(`een herlaad en een tabblad die fout gingen: ${r.id} is ${r.uitkomst}, hoort ${hoort}`);
    }
  }
  for (const r of uitkomsten(slechteMeting()).values()) if (r.uitkomst !== NIET_GEHAALD) fouten.push(`${r.id}: de slechte meting is niet afgekeurd maar ${r.uitkomst} (${r.getoond})`);

  return { ok: fouten.length === 0, fouten, normen: meetbaar.size };
}

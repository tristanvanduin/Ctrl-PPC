// De brondata-toets: elk getal dat het model in een bevinding of aanbeveling schrijft wordt door
// CODE teruggezocht in de cijfers die het model zelf kreeg. Niet in wat het model eerder schreef.
//
// ── WAAROM DIT ER MOET ZIJN ─────────────────────────────────────────────────
//
// De oude "cijferpoort" (weekly-number-gate.ts) nam de toegestane getallen uit de analysetekst
// zelf: alles wat het model in stap 1 tot 3 schreef gold daarna als gegrond. Dat is model tegen
// model. Bovendien las hij "€ 1.650" als 1,65 en rondde af op hele getallen, waardoor een
// verzonnen "€ 2.400" erdoor kwam zodra er ergens een 2 in de onderbouwing stond (doorlichting
// 13 november, sectie 2 en 3). Wat de klant leest moet herleidbaar zijn tot de tabellen die de
// route uit de database haalde; dat is de enige plek waar een getal ophoudt een bewering te zijn.
//
// ── WAT ALS HERLEIDBAAR TELT ────────────────────────────────────────────────
//
// 1. Een waarde die in de brondata staat, binnen de afrondingsmarge van hoe het model hem schreef:
//    "€ 1.650" dekt 1649,5 tot 1650,5; "94,84" dekt alleen wat naar 94,84 afrondt. Een rond getal
//    ("€ 2.800") mag iets ruimer, maar nooit meer dan 2% (anders dekt "€ 500" alles tussen 450 en
//    550 en vangt de toets niets meer).
// 2. Wat code uit die brondata afleidt: per rij en per kolomtotaal de CPA, CPC, CTR, CVR, ROAS en
//    CPM. Dat zijn geen modelgetallen: de route had ze zelf kunnen uitrekenen, en het model mag ze
//    citeren. Een percentage mag ook als fractie in de bron staan (0,28 tegen "28%").
// 3. Een percentage dat de verhouding is tussen twee herleidbare getallen uit DEZELFDE bewering
//    ("CPA € 172,92 (+284,3%)" tegen het doel van € 45). Bewust niet tussen willekeurige paren
//    uit de hele brondata: bij vijfhonderd getallen is er altijd wel een paar dat toevallig klopt.
//
// Euro's, percentages en aantallen worden elk tegen hun eigen soort getoetst: "€ 17" is niet
// herleidbaar omdat er ergens 16,9% staat, "39%" niet omdat de CPA € 39,29 is, en "€ 54" niet
// omdat er 54 klikken staan. Dat was het tweede lek van de oude poort, en in de eerste versie van
// deze toets nog half open (alleen percentages hadden een eigen set).
//
// ── WAT DEZE TOETS NIET KAN ─────────────────────────────────────────────────
//
// Een heel bedrag onder de honderd euro of een rond bedrag vangt hij maar half. Op een weekly van
// gewone omvang (36 campagnemaanden, 30 zoektermen) staan honderden bedragen tussen 10 en 100
// euro: CPA's, CPM's, zoektermkosten. Een verzonnen "€ 54" ligt dan bijna altijd binnen een halve
// euro van een echt bedrag; gemeten gaat 70% van zulke verzonnen bedragen door, en 41% van de
// ronde bedragen tussen 500 en 5.000 (de 2%-marge hierboven). Bedragen met centen en bedragen
// boven de duizend vangt hij wel (onder 3% door). De metingen staan als test in
// __redeneerketen_bevindingen_test.ts; een "herleidbaar" klein of rond bedrag is dus geen bewijs.
//
// IO-vrij. Getest in lib/analysis/__redeneerketen_bevindingen_test.ts (de extractie van 1 september
// tegen geconstrueerde brondata, en de detectiekracht op een weekly van realistische omvang) en
// lib/analysis/__cijferpoort_nl_test.ts (het lezen van nl-NL-getallen en de bedragpatronen).

export type CijferSoort = "bedrag" | "percentage" | "aantal";

export interface GelezenGetal {
  waarde: number;
  /** De afrondingsstap van de schrijfwijze: 0,01 voor "94,84", 1 voor "€ 1.650". */
  stap: number;
}

export interface GetoetstCijfer {
  soort: CijferSoort;
  waarde: number;
  /** Het stuk tekst zoals het model het schreef, voor de melding en de markering. */
  tekst: string;
  start: number;
  eind: number;
  herleidbaar: boolean;
}

/** De markeringen die een niet-herleidbaar getal in de tekst vervangen. */
export const MARKERING: Record<CijferSoort, string> = {
  bedrag: "[bedrag niet uit data]",
  percentage: "[percentage niet uit data]",
  aantal: "[aantal niet uit data]",
};

// ── Getallen lezen, nl-NL eerst ──────────────────────────────────────────────

const VERMENIGVULDIGER: Array<[RegExp, number]> = [
  [/^(?:mln|miljoen|mio)$/i, 1_000_000],
  [/^(?:k|duizend)$/i, 1_000],
];

function stapVoorGeheel(cijfers: string, waarde: number): number {
  // Een rond getal ("2.800", "500") is waarschijnlijk afgerond; de stap volgt de nullen, maar
  // nooit ruimer dan 2% van de waarde. Zonder nullen: de eenheid.
  const nullen = (cijfers.match(/0+$/)?.[0].length ?? 0);
  if (nullen === 0 || waarde === 0) return 1;
  return Math.max(1, Math.min(10 ** nullen, Math.abs(waarde) * 0.02));
}

/**
 * Leest een getal zoals een Nederlandse tekst het schrijft. "1.650" is duizendzestighonderdvijftig,
 * "1.650,42" en "1 650" ook (met decimalen), "12,5" is twaalf en een half. Een Engelse decimaal
 * ("2759.82") blijft een decimaal: een punt met andere dan precies drie cijfers erachter kan geen
 * duizendtal zijn. Null als het geen getal is.
 */
export function leesGetal(ruw: string): GelezenGetal | null {
  let s = ruw.trim().replace(/[   ]/g, " ");
  const negatief = /^[-−]/.test(s);
  s = s.replace(/^[-+−]\s*/, "");
  if (/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;

  let geheel: string;
  let decimalen = "";
  const punten = (s.match(/\./g) ?? []).length;
  const kommas = (s.match(/,/g) ?? []).length;
  if (punten > 0 && kommas > 0) {
    // Beide: het laatste teken is de decimaalscheider, het andere groepeert.
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const groep = dec === "," ? "." : ",";
    const [g, d] = s.split(dec);
    geheel = g.split(groep).join("");
    decimalen = d ?? "";
  } else if (kommas > 0) {
    if (kommas === 1) [geheel, decimalen] = s.split(",");
    else geheel = s.split(",").join("");
  } else if (punten > 0) {
    if (punten > 1 || /^\d{1,3}\.\d{3}$/.test(s)) geheel = s.split(".").join("");
    else [geheel, decimalen] = s.split(".");
  } else {
    geheel = s;
  }
  if (!/^\d+$/.test(geheel) || (decimalen && !/^\d+$/.test(decimalen))) return null;
  const waarde = Number(`${geheel}${decimalen ? `.${decimalen}` : ""}`) * (negatief ? -1 : 1);
  if (!Number.isFinite(waarde)) return null;
  const stap = decimalen ? 10 ** -decimalen.length : stapVoorGeheel(geheel, waarde);
  return { waarde, stap };
}

/** Een getal uit JSON (bevinding.current_value) met de afrondingsstap van zijn eigen schrijfwijze. */
export function getalUitWaarde(waarde: number): GelezenGetal {
  const tekst = String(waarde);
  const dec = tekst.includes(".") && !tekst.includes("e") ? tekst.split(".")[1].length : 0;
  return { waarde, stap: dec > 0 ? 10 ** -dec : stapVoorGeheel(tekst.replace(/^-/, ""), waarde) };
}

// Getal met punt of komma als scheider; met spatie als duizendtal alleen in een bedrag, omdat
// "week 34 120 klikken" anders als 34.120 gelezen wordt.
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const NUM_SP = String.raw`\d{1,3}(?:[   .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const MULT = String.raw`(?:\s?(k|mln|miljoen|mio|duizend)\b)?`;
const TELWOORDEN = "klikken|kliks|clicks|conversies|conversions|impressies|impressions|vertoningen|leads|sessies|bezoekers|aankopen|transacties|aanvragen|inschrijvingen|registraties";
// Een metriek gevolgd door een kaal getal: "CPA 45" is een bedrag, "ROAS van 4,8" een aantal,
// "CTR 2,1" een percentage. Eerder waren ze alle drie "aantal" en lag "CPA 45" tegen de tellingen.
const METRIEK_BEDRAG = "CPA|CPC|CPM|CPL";
const METRIEK_AANTAL = "ROAS";
const METRIEK_PROCENT = "CTR|CVR";
const NA_METRIEK = String.raw`[^\d€%\n.;]{0,14}?(?<![\d.,\-])(${NUM})(?![\d.,]*\s?(?:%|€|euro))`;

interface Patroon { soort: CijferSoort; re: RegExp; getal: number; mult?: number }

// Volgorde telt: een bedrag gaat voor, zodat "CPA € 39,29" niet ook als metriekwaarde telt.
const PATRONEN: Patroon[] = [
  { soort: "bedrag", re: new RegExp(String.raw`(?:€|\bEUR\b)\s?([-−]?(?:${NUM_SP}))(?:,[-–])?${MULT}`, "gi"), getal: 1, mult: 2 },
  // "1650 euro", "2.400,- euro", "2.400,-": de ,- is in een Nederlandse tekst altijd geld.
  { soort: "bedrag", re: new RegExp(String.raw`(?<![\d.,])([-−]?(?:${NUM_SP}))${MULT}\s?(?:,[-–]\s?)?(?:euro\b|EUR\b|€)`, "gi"), getal: 1, mult: 2 },
  { soort: "bedrag", re: new RegExp(String.raw`(?<![\d.,])([-−]?(?:${NUM_SP})),[-–](?![\d])`, "gi"), getal: 1 },
  { soort: "percentage", re: new RegExp(String.raw`(?<![\d.,])([-+−]?(?:${NUM}))\s?(?:%|procent\b|procentpunt\b)`, "gi"), getal: 1 },
  { soort: "aantal", re: new RegExp(String.raw`(?<![\d.,\-])(${NUM})${MULT}\s+(?:${TELWOORDEN})\b`, "gi"), getal: 1, mult: 2 },
  { soort: "bedrag", re: new RegExp(String.raw`\b(?:${METRIEK_BEDRAG})\b${NA_METRIEK}`, "gi"), getal: 1 },
  { soort: "aantal", re: new RegExp(String.raw`\b(?:${METRIEK_AANTAL})\b${NA_METRIEK}`, "gi"), getal: 1 },
  { soort: "percentage", re: new RegExp(String.raw`\b(?:${METRIEK_PROCENT})\b${NA_METRIEK}`, "gi"), getal: 1 },
];

// Het andere eind van een bereik: "€ 1.650 tot 2.400", "€ 1.650-2.400" en "10 tot 15%". Zonder
// deze stap werd alleen het getal met het teken getoetst, en kon het andere alles zijn.
const BEREIK = String.raw`\s?(?:-|–|—|tot(?: en met)?|t\/m|à)\s?`;
const BEREIK_NA = new RegExp(String.raw`^${BEREIK}(?:€\s?)?(${NUM_SP})(?:,[-–])?${MULT}`, "i");
const BEREIK_VOOR = new RegExp(String.raw`(?<![\d.,])(${NUM})${BEREIK}$`, "i");

interface RuwCijfer { soort: CijferSoort; getal: GelezenGetal; tekst: string; start: number; eind: number }

/** Alle bedragen, percentages en aantallen in een tekst, elk een keer. */
export function leesCijfers(tekst: string): RuwCijfer[] {
  const uit: RuwCijfer[] = [];
  const bezet: Array<[number, number]> = [];
  const overlapt = (a: number, b: number) => bezet.some(([x, y]) => a < y && b > x);
  const factorVan = (multTekst: string | undefined) =>
    multTekst ? (VERMENIGVULDIGER.find(([re]) => re.test(multTekst))?.[1] ?? 1) : 1;
  for (const p of PATRONEN) {
    for (const m of tekst.matchAll(p.re)) {
      const start = m.index ?? 0;
      const eind = start + m[0].length;
      if (overlapt(start, eind)) continue;
      const getal = leesGetal(m[p.getal]);
      if (!getal) continue;
      const factor = factorVan(p.mult ? m[p.mult] : undefined);
      bezet.push([start, eind]);
      uit.push({ soort: p.soort, getal: { waarde: getal.waarde * factor, stap: getal.stap * factor }, tekst: m[0], start, eind });
    }
  }
  for (const c of [...uit]) {
    if (c.soort === "bedrag") {
      const m = tekst.slice(c.eind).match(BEREIK_NA);
      const getal = m ? leesGetal(m[1]) : null;
      if (!m || !getal) continue;
      // Alleen het getal zelf telt als vindplaats; het verbindingswoord blijft staan.
      const start = c.eind + m[0].indexOf(m[1]);
      const eind = c.eind + m[0].length;
      if (overlapt(start, eind)) continue;
      const factor = factorVan(m[2]);
      bezet.push([start, eind]);
      uit.push({ soort: "bedrag", getal: { waarde: getal.waarde * factor, stap: getal.stap * factor }, tekst: tekst.slice(start, eind), start, eind });
    } else if (c.soort === "percentage") {
      const voor = tekst.slice(Math.max(0, c.start - 30), c.start);
      const m = voor.match(BEREIK_VOOR);
      const getal = m ? leesGetal(m[1]) : null;
      if (!m || !getal) continue;
      const start = c.start - voor.length + (m.index ?? 0);
      const eind = start + m[1].length;
      if (overlapt(start, eind)) continue;
      bezet.push([start, eind]);
      uit.push({ soort: "percentage", getal, tekst: m[1], start, eind });
    }
  }
  return uit.sort((a, b) => a.start - b.start);
}

// ── De brondata ──────────────────────────────────────────────────────────────

export interface BronFeiten {
  /**
   * Gesorteerde absolute waarden die een AANTAL kunnen zijn: tellingen, ROAS, losse getallen in
   * door code geschreven tekst. Bedragen en percentages hebben elk hun eigen set hieronder.
   */
  aantallen: Float64Array;
  /**
   * Alleen de waarden die een bedrag ZIJN: kolommen als cost, spend, cpa, cpc, waarde en budget,
   * hun kolomtotalen, door code berekende CPA, CPC en CPM, en bedragen in door code geschreven
   * tekst. Eerder lag een bedrag tegen alle getallen samen (1681 waarden op een gewone weekly), en
   * dan was een verzonnen "€ 54" herleidbaar omdat er ergens 54 klikken stonden: 86% van de
   * verzonnen bedragen tussen 10 en 99 euro ging zo door.
   */
  bedragen: Float64Array;
  /**
   * Alleen de waarden die een percentage ZIJN: kolommen als ctr of search_budget_lost_is, door
   * code berekende CTR en CVR, en getallen met % in door code geschreven tekst. Een percentage in
   * de modeltekst wordt hiertegen gelegd, niet tegen elk getal: anders is "2,0%" herleidbaar
   * omdat er ergens 2 conversies staan.
   */
  procenten: Float64Array;
}

const KOSTEN = ["cost", "spend", "kosten", "amount_spent"];
const CONVERSIES = ["conversions", "conversies", "leads", "one_click_leads", "results"];
const KLIKKEN = ["clicks", "link_clicks", "klikken"];
const VERTONINGEN = ["impressions", "impressies", "vertoningen"];
const WAARDE = ["conversions_value", "conversion_value", "revenue", "omzet", "purchase_value"];

/** Kolom- en metrieknamen die een percentage of fractie dragen. */
export const PERCENTAGE_METRIEK = /(ctr|cvr|rate|ratio|share|aandeel|_is$|lost_is|pct|percent|benutting|utilization)/i;

/** Kolom- en metrieknamen die een bedrag dragen (en geen percentage zijn, zie isBedragKolom). */
const BEDRAG_METRIEK = /(cost|spend|kosten|amount|cpa|cpc|cpm|cpl|value|waarde|revenue|omzet|budget|bid\b|bod\b|price|prijs|euro|uitgave)/i;

export function isBedragKolom(naam: string): boolean {
  return !PERCENTAGE_METRIEK.test(naam) && BEDRAG_METRIEK.test(naam);
}

/**
 * Identificatoren tellen niet als feit: een campagne-id van tien cijfers voegt anders zijn
 * stukken als getal toe, en zegt niets over de prestaties.
 */
const ID_KOLOM = /(^id$|_id$|^id_|_ids$|uuid|resource_name)/i;

// Een regel door code geschreven tekst die over geld gaat: de getallen erin tellen ook als
// bedrag ("CPA-doel: 45" zonder euroteken in de doelensectie).
const GELDREGEL = /(€|\beuro\b|\bEUR\b|\bcpa\b|\bcpc\b|\bcpm\b|\bcpl\b|kosten|budget|omzet|spend|\bcost|waarde|\bbod\b|\bbid\b|uitgave)/i;

interface Verzameling { aantallen: number[]; bedragen: number[]; procenten: number[] }

function eerste(r: Record<string, unknown>, velden: string[]): number | null {
  for (const v of velden) {
    const n = typeof r[v] === "number" ? (r[v] as number) : typeof r[v] === "string" && r[v] !== "" ? Number(r[v]) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function afgeleid(r: Record<string, unknown>, uit: Verzameling): void {
  const kosten = eerste(r, KOSTEN);
  const conv = eerste(r, CONVERSIES);
  const klik = eerste(r, KLIKKEN);
  const vert = eerste(r, VERTONINGEN);
  const waarde = eerste(r, WAARDE);
  if (kosten != null && conv) uit.bedragen.push(kosten / conv);
  if (kosten != null && klik) uit.bedragen.push(kosten / klik);
  if (klik != null && vert) uit.procenten.push((klik / vert) * 100);
  if (conv != null && klik) uit.procenten.push((conv / klik) * 100);
  if (waarde != null && kosten) uit.aantallen.push(waarde / kosten);
  if (kosten != null && vert) uit.bedragen.push((kosten / vert) * 1000);
}

// ISO-datums en tijden eerst weg: "2026-08-18" zou anders 2026, 8 en 18 als feit toevoegen.
const DATUM_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;

/**
 * Een getal uit brondata in beide lezingen. In brondata (JSON, tabellen, code-tekst) is "1.125"
 * net zo goed de JS-decimaal 1,125 als het Nederlandse duizendtal: beide tellen, want een feit te
 * veel maakt de toets hooguit iets ruimer, een feit te weinig markeert een correct citaat als
 * verzonnen.
 */
function lezingen(ruw: string): number[] {
  const uit: number[] = [];
  const nl = leesGetal(ruw);
  if (nl) uit.push(nl.waarde);
  const en = Number(ruw.replace(/,/g, ""));
  if (Number.isFinite(en)) uit.push(en);
  return uit;
}

/**
 * Getallen uit door code geschreven tekst of uit een tekstcel. `bedragKolom`: de cel staat onder
 * een bedragkolom (Postgres numeric komt als tekst terug), dus elk getal erin is een bedrag.
 */
function getallenUitTekst(tekst: string, uit: Verzameling, bedragKolom = false): void {
  const schoon = tekst.replace(DATUM_RE, " ");
  for (const regel of schoon.split("\n")) {
    const geld = bedragKolom || GELDREGEL.test(regel);
    for (const m of regel.matchAll(/[-−]?\d[\d.,]*/g)) {
      const waarden = lezingen(m[0].replace(/[.,]+$/, ""));
      uit.aantallen.push(...waarden);
      if (geld) uit.bedragen.push(...waarden);
    }
  }
  for (const c of leesCijfers(schoon)) {
    if (c.soort === "percentage") uit.procenten.push(c.getal.waarde);
    else if (c.soort === "bedrag") uit.bedragen.push(c.getal.waarde);
  }
}

function getalVan(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
}

function verzamel(deel: unknown, uit: Verzameling, diepte = 0, sleutel = ""): void {
  if (deel == null || diepte > 6) return;
  if (sleutel && ID_KOLOM.test(sleutel)) return;
  const bedrag = sleutel !== "" && isBedragKolom(sleutel);
  if (typeof deel === "number") {
    if (!Number.isFinite(deel)) return;
    (bedrag ? uit.bedragen : uit.aantallen).push(deel);
    return;
  }
  if (typeof deel === "string") { getallenUitTekst(deel, uit, bedrag); return; }
  if (Array.isArray(deel)) {
    const rijen = deel.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
    for (const d of deel) verzamel(d, uit, diepte + 1, sleutel);
    // Kolomtotalen: "€ 2.759,82 over twee weken" is de som van twee weekrijen. Die som en de
    // ratio's erop zijn even goed brondata als de rijen zelf. Een som van percentages of id's niet.
    if (rijen.length > 1) {
      const som: Record<string, number> = {};
      for (const r of rijen) {
        for (const [k, v] of Object.entries(r)) {
          const n = getalVan(v);
          if (Number.isFinite(n) && !PERCENTAGE_METRIEK.test(k) && !ID_KOLOM.test(k)) som[k] = (som[k] ?? 0) + n;
        }
      }
      for (const [k, v] of Object.entries(som)) (isBedragKolom(k) ? uit.bedragen : uit.aantallen).push(v);
      afgeleid(som, uit);
    }
    return;
  }
  if (typeof deel === "object") {
    const r = deel as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) {
      verzamel(v, uit, diepte + 1, k);
      const n = getalVan(v);
      if (Number.isFinite(n) && PERCENTAGE_METRIEK.test(k)) {
        // Een fractie (0,28) en een percentage (28) staan allebei als percentage-feit.
        uit.procenten.push(Math.abs(n) <= 1 ? n * 100 : n);
      }
    }
    afgeleid(r, uit);
  }
}

/**
 * Bouwt de feitenset uit wat de route het model gaf: rijen uit de database (arrays van objecten),
 * losse getallen en door code geschreven tekst (doelen, maandtargets, betrouwbaarheidsblok).
 * Geef hier NOOIT modeluitvoer aan mee: dan toetst de toets het model weer aan zichzelf.
 */
export function bouwBronFeiten(delen: unknown[]): BronFeiten {
  const uit: Verzameling = { aantallen: [0], bedragen: [0], procenten: [0] };
  for (const d of delen) verzamel(d, uit);
  const sorteer = (xs: number[]) => Float64Array.from(xs.filter(Number.isFinite).map(Math.abs)).sort();
  return { aantallen: sorteer(uit.aantallen), bedragen: sorteer(uit.bedragen), procenten: sorteer(uit.procenten) };
}

function bevatBinnen(w: Float64Array, doel: number, marge: number): boolean {
  let lo = 0, hi = w.length;
  const onder = doel - marge;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (w[mid] < onder) lo = mid + 1; else hi = mid; }
  return lo < w.length && w[lo] <= doel + marge;
}

function marge(stap: number): number {
  // Een halve stap plus een fractie voor zwevendekommaruis: 94,835 rondt naar 94,84.
  return stap / 2 + stap * 1e-6;
}

/** Staat dit getal, zoals geschreven, in de brondata? Elke soort alleen tussen zijn eigen soort. */
export function inBron(getal: GelezenGetal, soort: CijferSoort, feiten: BronFeiten): boolean {
  const v = Math.abs(getal.waarde);
  const set = soort === "percentage" ? feiten.procenten : soort === "bedrag" ? feiten.bedragen : feiten.aantallen;
  return bevatBinnen(set, v, marge(getal.stap));
}

/** Is dit percentage de verhouding of het verschil tussen twee getallen uit dezelfde bewering? */
function afgeleidPercentage(getal: GelezenGetal, lokaal: number[]): boolean {
  const v = Math.abs(getal.waarde);
  const m = marge(getal.stap);
  for (let i = 0; i < lokaal.length; i += 1) {
    for (let j = 0; j < lokaal.length; j += 1) {
      if (i === j || lokaal[j] === 0) continue;
      const r = lokaal[i] / lokaal[j];
      if (Math.abs(Math.abs((r - 1) * 100) - v) <= m) return true;
      if (Math.abs(r * 100 - v) <= m) return true;
    }
  }
  return false;
}

/**
 * Toetst elk getal in een tekst. `lokaal` zijn getallen die bij dezelfde bewering horen (de
 * waarden van de bevinding, het doel); alleen daartussen mag een percentage afgeleid zijn.
 */
export function toetsTekst(tekst: string, feiten: BronFeiten, lokaal: number[] = []): GetoetstCijfer[] {
  const ruw = leesCijfers(tekst);
  // Eerst de bedragen en aantallen: wat daarvan herleidbaar is, mag een percentage dragen.
  const eerst = ruw.map((c) => ({ c, ok: c.soort !== "percentage" && inBron(c.getal, c.soort, feiten) }));
  const pool = [...lokaal.filter(Number.isFinite), ...eerst.filter((e) => e.ok).map((e) => e.c.getal.waarde)];
  return eerst.map(({ c, ok }) => ({
    soort: c.soort,
    waarde: c.getal.waarde,
    tekst: c.tekst,
    start: c.start,
    eind: c.eind,
    herleidbaar: c.soort === "percentage"
      ? inBron(c.getal, "percentage", feiten) || afgeleidPercentage(c.getal, pool)
      : ok,
  }));
}

/** Vervangt elk niet-herleidbaar getal door een markering die zegt wat er mis is. */
export function markeerTekst(tekst: string, cijfers: GetoetstCijfer[]): string {
  let uit = tekst;
  for (const c of [...cijfers].filter((x) => !x.herleidbaar).sort((a, b) => b.start - a.start)) {
    uit = uit.slice(0, c.start) + MARKERING[c.soort] + uit.slice(c.eind);
  }
  return uit;
}

export function nlGetal(n: number): string {
  return n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
}

// ── Bevindingen ──────────────────────────────────────────────────────────────


export interface BevindingToets {
  /** null als de bevinding geen kerngetal draagt (current_value leeg). */
  kerngetalHerleidbaar: boolean | null;
  /** Leesbare beschrijving van elk getal dat niet terug te vinden is. */
  nietHerleidbaar: string[];
}

export interface TeToetsenBevinding {
  metric: string;
  current_value: number | null;
  previous_value: number | null;
  target_value?: number | null;
  change_pct: number | null;
  cause: string | null;
}

export function waardeInBron(waarde: number, metric: string, feiten: BronFeiten): boolean {
  const g = getalUitWaarde(waarde);
  if (PERCENTAGE_METRIEK.test(metric)) {
    // Een percentagemetriek alleen tussen de percentages, als 28 of als fractie 0,28.
    if (inBron(g, "percentage", feiten)) return true;
    return inBron({ waarde: waarde * 100, stap: g.stap * 100 }, "percentage", feiten);
  }
  return inBron(g, isBedragKolom(metric) ? "bedrag" : "aantal", feiten);
}

/**
 * Toetst een bevinding: het kerngetal (current_value), de vergelijkingswaarde of het doel, de
 * verandering tegen die twee, en elk getal in de oorzaaktekst.
 */
export function toetsBevinding(f: TeToetsenBevinding, feiten: BronFeiten, doelen: number[] = []): BevindingToets {
  const niet: string[] = [];
  let kern: boolean | null = null;
  if (typeof f.current_value === "number") {
    kern = waardeInBron(f.current_value, f.metric, feiten);
    if (!kern) niet.push(`kerngetal ${nlGetal(f.current_value)} (${f.metric})`);
  }
  if (typeof f.previous_value === "number" && !waardeInBron(f.previous_value, f.metric, feiten)) {
    niet.push(`vorige waarde ${nlGetal(f.previous_value)}`);
  }
  if (typeof f.target_value === "number" && !waardeInBron(f.target_value, f.metric, feiten)) {
    niet.push(`doel ${nlGetal(f.target_value)}`);
  }
  const ref = typeof f.previous_value === "number" ? f.previous_value : (typeof f.target_value === "number" ? f.target_value : null);
  if (typeof f.change_pct === "number" && typeof f.current_value === "number" && ref) {
    const verwacht = ((f.current_value - ref) / Math.abs(ref)) * 100;
    // Een tiende procentpunt plus de afronding van de geschreven waarde.
    if (Math.abs(verwacht - f.change_pct) > 0.15 + getalUitWaarde(f.change_pct).stap) {
      niet.push(`verandering ${nlGetal(f.change_pct)}% klopt niet met de eigen waarden (${nlGetal(verwacht)}%)`);
    }
  }
  if (f.cause) {
    // De doelen mogen mee in de verhouding: "CPA € 172,92 (+284,3%)" is de afstand tot het doel
    // van € 45, ook als dat doel in deze zin niet als getal staat.
    const lokaal = [f.current_value, f.previous_value, f.target_value ?? null, ...doelen].filter((x): x is number => typeof x === "number");
    for (const c of toetsTekst(f.cause, feiten, lokaal)) {
      if (!c.herleidbaar) niet.push(`"${c.tekst.trim()}" in de oorzaak`);
    }
  }
  return { kerngetalHerleidbaar: kern, nietHerleidbaar: niet };
}

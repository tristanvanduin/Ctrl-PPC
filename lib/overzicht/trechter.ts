// De rekenkant van de trechter op het Overzicht in de nieuwe weergave: van "hoe gaat het" via
// "waar zit het" naar "wat nu".
//
// DE OPBOUW VAN DE PAGINA (components/dashboard/overzicht-bovenkant.tsx en overzicht-trechter.tsx)
//
//   1 HOE GAAT HET   een statusregel in één zin (statusRegel), dan de kerncijfers zoals ze waren
//   2 WAAR ZIT HET   op Alle kanalen de bijdrage per kanaal (bijdragePerKanaal), op een kanaal de
//                    trechter vertoningen > klikken > conversies (trechter)
//   3 WAAROM         de grafiek, het logboek, gezondheid en pacing: ongewijzigd
//   4 WAT NU         de drie belangrijkste open voorstellen en to-do's (watNuItems)
//
// GEEN TWEEDE REKENWEG. Conversies, omzet en kosten komen uit dezelfde reeksen als de tegels en de
// kanaalkaarten: per maand de maandreeksen van de band met gepaardeTotalen (de regel van
// comparePeriods), per dag telDagVergelijking. Wat hier bij komt, zijn alleen de vertoningen en de
// klikken, de eerste twee stappen van de trechter. Die kent de band niet; ze komen per maand uit de
// blended route (BlendedKanaalMaand.impressions/clicks, dezelfde maanden) en per dag uit dezelfde
// dag- en weekrijen als de telling (KanaalTelling.tellers). Ze tellen over PRECIES dezelfde maanden
// of dagen als de conversies ernaast, ook in de vergelijking: wat in het percentage van de
// conversies zit, zit ook in dat van de klikken. Eén kanttekening: bij Google komen de conversies
// per maand uit de Google-route (de band) en de vertoningen en klikken uit de blended route
// (fact_core). Dat zijn dezelfde maanden van dezelfde sync, maar twee lezingen.
//
// GEEN OORDEEL DAT DE DATA NIET DRAAGT. De statusregel noemt cijfers en richtingen ("steeg",
// "daalde"), nooit "goed", "zorgwekkend" of "beter dan verwacht": er is geen doel of norm in deze
// cijfers om dat aan af te meten. De bijdrage per kanaal zegt "kost meer dan het levert" alleen als
// het aandeel in de kosten minstens BIJDRAGE_VERSCHIL_VANAF punten boven dat in de conversies ligt:
// dat is een rekenkundig feit over deze periode, geen advies.
//
// Zuiver en zonder React, zodat lib/overzicht/__trechter_test.ts het zonder pagina kan toetsen.

import { bronStart, delta, gepaardeTotalen, type BronReeks, type PeriodDelta, type Totalen } from "@/lib/period/apply-period";
import { formatRange, monthIndex, monthsIn, type Month, type PeriodRange } from "@/lib/period/period-range";
import type { DagVergelijkingTelling, Tellers } from "@/lib/period/dag-telling";
import { somVergelijking, verhoudingVergelijking } from "@/lib/period/vergelijkbaar-deel";
import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import { safeDiv } from "@/lib/util/math";
import type { KaartCijfers } from "./bovenkant";
import { voorKanaal, type LogboekItem } from "./logboek";

export type { Tellers };

const AANTAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const EURO = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const aantal = (v: number) => AANTAL.format(v);
const euro = (v: number) => EURO.format(v);

// ── De stand van een kanaal, en het paar waarin hij vergeleken wordt ───────────────────────────

/** De vier getallen van de trechter over één periode: conversies, omzet en kosten, en de tellers. */
export interface KanaalStand {
  totalen: Totalen;
  /** Null als de bron de vertoningen en klikken niet kent: dan staan die stappen er "niet bekend". */
  tellers: Tellers | null;
  /**
   * De regel als het kanaal in deze periode nog niet liep (nogNietGelopen in dag-telling.ts, of
   * nietGelopenInMaanden hieronder): dan toont de trechter die regel en geen rij nullen.
   */
  nietGelopen?: string | null;
}

/** Wat van een kanaal in de vergelijking zit: de gepaarde maanden of dagen, aan beide kanten. */
export interface KanaalPaar {
  nu: KanaalStand;
  toen: KanaalStand;
  /** Gaat het paar over de hele gekozen periode? Anders zegt `over` welk deel. */
  heel: boolean;
  over: string | null;
}

export interface KanaalVergelijk {
  kanaal: Kanaal;
  /** Null zonder vergelijking, of als dit kanaal niet te paren viel (dan zegt `uitleg` waarom). */
  paar: KanaalPaar | null;
  uitleg: string | null;
}

/** De vertoningen en klikken per maand uit een maandreeks van de blended route; null als de reeks
 *  ze niet draagt (een antwoord van vóór die velden). */
export function tellersPerMaand(
  maanden: readonly { month: string; impressions?: number; clicks?: number }[] | null | undefined,
): Map<Month, Tellers> | null {
  if (!maanden || !maanden.some((m) => typeof m.impressions === "number" || typeof m.clicks === "number")) return null;
  const uit = new Map<Month, Tellers>();
  for (const m of maanden) {
    const maand = String(m.month ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(maand)) continue;
    const t = uit.get(maand) ?? { impressions: 0, clicks: 0 };
    t.impressions += Number.isFinite(m.impressions) ? (m.impressions as number) : 0;
    t.clicks += Number.isFinite(m.clicks) ? (m.clicks as number) : 0;
    uit.set(maand, t);
  }
  return uit;
}

/** De tellers over een rij maanden; een maand zonder rij telt als nul, zoals bij de conversies. */
export function tellersOver(perMaand: ReadonlyMap<Month, Tellers> | null | undefined, maanden: readonly Month[]): Tellers | null {
  if (!perMaand) return null;
  const t: Tellers = { impressions: 0, clicks: 0 };
  for (const m of maanden) {
    const x = perMaand.get(m);
    if (!x) continue;
    t.impressions += x.impressions;
    t.clicks += x.clicks;
  }
  return t;
}

/**
 * Per kanaal het paar over hele maanden: gepaardeTotalen op de bron van de band, dus precies het
 * deel dat ook in de percentages van de tegels zit. De tellers over dezelfde maanden.
 */
export function kanaalParenUitMaanden(inp: {
  perKanaal: Partial<Record<Kanaal, BronReeks>>;
  tellers: Partial<Record<Kanaal, ReadonlyMap<Month, Tellers> | null>>;
  kanalen: readonly Kanaal[];
  periode: PeriodRange;
  vergelijking: PeriodRange | null;
}): KanaalVergelijk[] {
  const uit: KanaalVergelijk[] = [];
  for (const kanaal of ALLE_KANALEN.filter((k) => inp.kanalen.includes(k))) {
    const bron = inp.perKanaal[kanaal];
    if (!bron || !inp.vergelijking) { uit.push({ kanaal, paar: null, uitleg: null }); continue; }
    const g = gepaardeTotalen([bron], inp.periode, inp.vergelijking);
    const bp = g.perBron[0];
    const naam = KANAAL_NAAM[kanaal];
    if (!bp.bereik) {
      uit.push({
        kanaal, paar: null,
        uitleg: bp.start
          ? `${naam} liep in ${formatRange(inp.vergelijking)} nog geen volle maand; voor dit kanaal is er geen vergelijking.`
          : `${naam} deed in geen enkele maand iets; er valt niets te vergelijken.`,
      });
      continue;
    }
    const t = inp.tellers[kanaal] ?? null;
    const heel = bp.bereik.huidig.start === inp.periode.start && bp.bereik.huidig.end === inp.periode.end;
    uit.push({
      kanaal,
      paar: {
        nu: { totalen: g.huidig, tellers: tellersOver(t, monthsIn(bp.bereik.huidig)) },
        toen: { totalen: g.vorig, tellers: tellersOver(t, monthsIn(bp.bereik.vorig)) },
        heel,
        over: heel ? null : `${formatRange(bp.bereik.huidig)} tegen ${formatRange(bp.bereik.vorig)}`,
      },
      uitleg: null,
    });
  }
  return uit;
}

const zelfdeTotalen = (a: Totalen, b: Totalen) =>
  a.conversions === b.conversions && a.adSpend === b.adSpend && a.revenue === b.revenue;

/**
 * Per kanaal het paar uit de telling per dag (telDagVergelijking). Gepaard per periode is het paar
 * de hele telling aan beide kanten, met de tellers erbij. Gepaard per maand kan het een deel zijn;
 * dan zijn de tellers van dat deel niet bekend en staan ze er niet.
 */
export function kanaalParenUitDagen(v: DagVergelijkingTelling, kanalen: readonly Kanaal[]): KanaalVergelijk[] {
  const uit: KanaalVergelijk[] = [];
  for (const kanaal of ALLE_KANALEN.filter((k) => kanalen.includes(k))) {
    const pk = v.perKanaal.find((x) => x.kanaal === kanaal);
    if (!pk) continue;
    if (!pk.gepaard || !pk.huidig || !pk.vorig) {
      uit.push({ kanaal, paar: null, uitleg: pk.uitleg ?? `${KANAAL_NAAM[kanaal]}: geen vergelijking mogelijk.` });
      continue;
    }
    const heel = zelfdeTotalen(pk.gepaard.huidig, pk.huidig.totalen) && zelfdeTotalen(pk.gepaard.vorig, pk.vorig.totalen);
    uit.push({
      kanaal,
      paar: {
        nu: { totalen: pk.gepaard.huidig, tellers: heel ? pk.huidig.tellers : null },
        toen: { totalen: pk.gepaard.vorig, tellers: heel ? pk.vorig.tellers : null },
        heel,
        over: heel ? null : "het deel dat in beide periodes liep",
      },
      uitleg: pk.uitleg,
    });
  }
  return uit;
}

// ── 1 HOE GAAT HET: de statusregel ──────────────────────────────────────────────────────────────

/** Een verandering in hele procenten, met teken. Onder een half procent: "vrijwel gelijk". */
export function procentTekst(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return "vrijwel gelijk";
  return `${r > 0 ? "+" : ""}${r}%`;
}

/** "steeg 4%", "daalde 4%" of "vrijwel gelijk bleef": de richting van een verhouding, zonder oordeel. */
function richting(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return "vrijwel gelijk bleef";
  return r > 0 ? `${r}% steeg` : `${-r}% daalde`;
}

/**
 * De statusregel boven de kerncijfers: één zin uit de cijfers die er al staan.
 *
 * - Zonder vergelijking: de totalen (conversies, kosten, CPA).
 * - Met vergelijking: de verandering van de conversies tegen `tegen`, en hoe de CPA bewoog. Gaat
 *   het percentage over een deel (een kanaal dat toen nog niet liep), dan zegt de zin dat.
 * - Valt er niets te paren, of was er toen niets: geen percentage, en de zin zegt waarom niet.
 *
 * Nooit een oordeel ("goed", "slecht"): of een CPA die steeg erg is, hangt af van een doel dat hier
 * niet in zit.
 */
export function statusRegel(inp: {
  totalen: Totalen;
  /** De gepaarde delta's zoals de tegels ze tonen; null zonder vergelijking. */
  deltas: { conversions: PeriodDelta; adSpend: PeriodDelta } | null;
  /** Het venster van de vergelijking in woorden ("november 2024 t/m oktober 2025"); null zonder. */
  tegen: string | null;
}): string {
  const { conversions, adSpend } = inp.totalen;
  if (conversions <= 0 && adSpend <= 0) return "Geen kosten en geen conversies in deze periode.";
  const cpa = safeDiv(adSpend, conversions);
  const totaalZin = cpa !== null
    ? `${aantal(conversions)} conversies voor ${euro(adSpend)} aan kosten, een CPA van ${euro(cpa)}`
    : `${euro(adSpend)} aan kosten en geen conversies`;
  if (!inp.deltas || !inp.tegen) return `${totaalZin}.`;

  const dc = inp.deltas.conversions;
  const dk = inp.deltas.adSpend;
  // Niets gepaard (geen kanaal liep in beide periodes): dan is er geen vergelijkbaar deel. Wel iets
  // gepaard maar toen geen conversies: er IS een deel, alleen geen basis voor een percentage.
  if (dc.huidig <= 0 && dc.vorig <= 0 && dk.huidig <= 0 && dk.vorig <= 0) {
    return `${totaalZin}; tegen ${inp.tegen} is er geen vergelijkbaar deel om een percentage op te geven.`;
  }
  const conv = somVergelijking(conversions, dc);
  if ((conv.soort !== "heel" && conv.soort !== "deel") || conv.pct === null) {
    return `${totaalZin}; in ${inp.tegen} waren er geen conversies${conv.soort === "deel" ? " in het deel dat in beide periodes liep" : ""}, dus geen percentage.`;
  }
  const cpaV = verhoudingVergelijking({
    totaalTeller: adSpend, totaalNoemer: conversions, teller: dk, noemer: dc,
  });
  // Het voorbehoud staat bij elk getal dat over een deel gaat: de conversies kunnen het hele totaal
  // dekken terwijl de kosten dat niet doen (een kanaal met kosten en zonder conversies dat toen nog
  // niet liep). Dan gaat de CPA-verandering over een ander getal dan de CPA in de tegel.
  const cpaDeel = (cpaV.soort === "heel" || cpaV.soort === "deel") && cpaV.pct !== null
    ? `, bij een CPA die${cpaV.soort === "deel" && conv.soort !== "deel" ? " over het gepaarde deel" : ""} ${richting(cpaV.pct)}`
    : cpaV.soort === "leeg" ? ", de CPA is in een van beide periodes niet te berekenen" : "";
  const deel = conv.soort === "deel" ? " (alleen over het deel dat in beide periodes liep)" : "";
  return `Conversies ${procentTekst(conv.pct)} tegen ${inp.tegen}${deel}${cpaDeel}.`;
}

// ── 2 WAAR ZIT HET, per kanaal: de trechter ─────────────────────────────────────────────────────

export type StapSleutel = "vertoningen" | "klikken" | "conversies";

export interface TrechterStap {
  sleutel: StapSleutel;
  label: string;
  /** Null als de bron dit getal niet kent. */
  waarde: number | null;
  /** De verandering tegen de vergelijkingsperiode, in procenten; null zonder paar of zonder basis. */
  pct: number | null;
  /** De kosten per eenheid van deze stap: per 1.000 vertoningen, per klik, per conversie. */
  kosten: { label: string; waarde: number | null; pct: number | null };
}

export interface TrechterOvergang {
  label: "CTR" | "Conversieratio";
  /** Als fractie (0,021 = 2,1%); null als de noemer nul of onbekend is. */
  waarde: number | null;
  /** Dezelfde verhouding over het paar in de vergelijkingsperiode; null zonder. */
  vorig: number | null;
}

export interface Trechter {
  stappen: [TrechterStap, TrechterStap, TrechterStap];
  overgangen: [TrechterOvergang, TrechterOvergang];
  /** Wat de lezer moet weten bij deze getallen (geen klikken, meer conversies dan klikken, ...). */
  opmerkingen: string[];
  /** Of en hoe er vergeleken is: niet, over de hele periode, of over een deel (`over`). */
  vergelijking: "geen" | "heel" | "deel";
  over: string | null;
  /**
   * "Meta liep in deze periode nog niet; eerste dag met data: 7 jun 2026": het kanaal was er nog
   * niet. Dan staat deze regel er in plaats van de stappen: vertoningen 0 en "kosten per 1.000
   * vertoningen niet te berekenen" lazen als een gemeten nul. Null als het kanaal liep, ook met nul.
   */
  nietGelopen: string | null;
}

const PER_DUIZEND = 1000;

/** De getallen van één stand als rij: [vertoningen, klikken, conversies] en hun kosten per stuk. */
function rij(s: KanaalStand) {
  const imp = s.tellers ? s.tellers.impressions : null;
  const klik = s.tellers ? s.tellers.clicks : null;
  const conv = s.totalen.conversions;
  const k = s.totalen.adSpend;
  const cpm = safeDiv(k, imp);
  return {
    waarden: [imp, klik, conv] as const,
    kosten: [cpm === null ? null : cpm * PER_DUIZEND, safeDiv(k, klik), safeDiv(k, conv)] as const,
    ctr: safeDiv(klik, imp),
    cr: safeDiv(conv, klik),
  };
}

const pctTussen = (nu: number | null, toen: number | null): number | null =>
  nu === null || toen === null ? null : delta(nu, toen).pct;

/**
 * De trechter van één kanaal: vertoningen > klikken > conversies, met de CTR en de conversieratio
 * ertussen en de kosten per stap. `getoond` is de hele gekozen periode (de getallen in beeld);
 * `paar` het deel dat in de vergelijking zit (kanaalParenUitMaanden of kanaalParenUitDagen).
 *
 * Elke deling gaat via safeDiv: geen klikken is "niet te berekenen", geen 0%.
 */
export function trechter(getoond: KanaalStand, paar: KanaalPaar | null): Trechter {
  const nu = rij(getoond);
  const pn = paar ? rij(paar.nu) : null;
  const pt = paar ? rij(paar.toen) : null;
  const labels: [StapSleutel, string, string][] = [
    ["vertoningen", "Vertoningen", "per 1.000 vertoningen"],
    ["klikken", "Klikken", "per klik"],
    ["conversies", "Conversies", "per conversie"],
  ];
  const stappen = labels.map(([sleutel, label, kostenLabel], i): TrechterStap => ({
    sleutel, label,
    waarde: nu.waarden[i],
    pct: pn && pt ? pctTussen(pn.waarden[i], pt.waarden[i]) : null,
    kosten: {
      label: kostenLabel,
      waarde: nu.kosten[i],
      pct: pn && pt ? pctTussen(pn.kosten[i], pt.kosten[i]) : null,
    },
  })) as Trechter["stappen"];

  const opmerkingen: string[] = [];
  const [imp, klik] = nu.waarden;
  const conv = getoond.totalen.conversions;
  const nietGelopen = getoond.nietGelopen ?? null;
  if (nietGelopen) {
    // Geen opmerkingen over nullen: er is niets gemeten, en de regel zegt waarom.
  } else if (getoond.tellers === null) {
    opmerkingen.push("Vertoningen en klikken zijn voor deze periode niet bekend; hier staan alleen de conversies en de kosten.");
  } else if (!imp && !klik && !conv) {
    opmerkingen.push("Geen vertoningen, klikken of conversies in deze periode.");
  } else {
    if (!imp && (klik || conv)) opmerkingen.push("Er zijn geen vertoningen geteld; de CTR is niet te berekenen.");
    if (imp && !klik) opmerkingen.push("Geen klikken in deze periode: de conversieratio en de kosten per klik zijn niet te berekenen.");
    if (klik && conv > klik) {
      opmerkingen.push("Er zijn meer conversies dan klikken: dit kanaal telt ook conversies zonder klik (na het zien van een advertentie), dus de conversieratio is hier geen aandeel van de klikken.");
    }
  }

  return {
    stappen,
    overgangen: [
      { label: "CTR", waarde: nu.ctr, vorig: pt?.ctr ?? null },
      { label: "Conversieratio", waarde: nu.cr, vorig: pt?.cr ?? null },
    ],
    opmerkingen,
    vergelijking: !paar || nietGelopen ? "geen" : paar.heel ? "heel" : "deel",
    over: nietGelopen ? null : paar?.over ?? null,
    nietGelopen,
  };
}

/**
 * Over hele maanden (de weg van de band): de regel als het kanaal in de hele periode nog niet liep,
 * dus als zijn eerste maand met data (bronStart van de reeks) na de periode ligt en er in de periode
 * geen enkele maandrij is. Bij een dagkanaal is een maandrij met alleen nullen een gemeten maand (de
 * reeks heeft alleen maanden met dagrijen): dan liep het kanaal, en staan de nullen er, net als bij
 * nogNietGelopen in dag-telling.ts. Google niet: zijn maandreeks wordt per jaar aangevuld met
 * nulmaanden (buildClientDataFromApi), dus daar zegt een nulmaand niets. Null anders.
 */
export function nietGelopenInMaanden(kanaal: Kanaal, bron: BronReeks, periode: PeriodRange): string | null {
  const { start } = bronStart(bron);
  if (!start || monthIndex(start) <= monthIndex(periode.end)) return null;
  if (kanaal !== "google" && monthsIn(periode).some((m) => bron.maanden.has(m))) return null;
  return `${KANAAL_NAAM[kanaal]} liep in deze periode nog niet; eerste maand met data: ${formatRange({ start, end: start })}.`;
}

/**
 * De breedte van elke balk in procenten van de breedste. Op een logaritmische schaal: vertoningen
 * zijn vaak duizend keer zo veel als conversies, en lineair zou de balk van de conversies een
 * streep van een pixel zijn. De getallen staan er altijd bij; de balk toont de volgorde en de
 * afname, niet de verhouding (dat doen de percentages ertussen). Een stap zonder getal of nul is 0.
 */
export function balkBreedtes(waarden: readonly (number | null)[]): number[] {
  const max = Math.max(0, ...waarden.map((w) => (w && w > 0 ? w : 0)));
  if (max <= 0) return waarden.map(() => 0);
  const schaal = Math.log10(1 + max);
  return waarden.map((w) => (w && w > 0 ? Math.max(6, Math.round((Math.log10(1 + w) / schaal) * 100)) : 0));
}

// ── 2 WAAR ZIT HET, op Alle kanalen: de bijdrage per kanaal ─────────────────────────────────────

/** Vanaf dit verschil (in procentpunten) tussen het aandeel in de kosten en dat in de conversies
 *  valt een kanaal op. Onder deze grens is het verschil te klein om iets over te zeggen. */
export const BIJDRAGE_VERSCHIL_VANAF = 10;

export interface BijdrageRij {
  kanaal: Kanaal;
  adSpend: number;
  conversions: number;
  aandeelKosten: number | null;
  aandeelConversies: number | null;
  cpa: number | null;
  /** "duur": het aandeel in de kosten ligt minstens BIJDRAGE_VERSCHIL_VANAF punten boven dat in de
   *  conversies; "voordelig" omgekeerd; anders null. */
  kenmerk: "duur" | "voordelig" | null;
  /** De CPA over het gepaarde deel nu en toen, en de verandering; null zonder paar. */
  cpaPaar: { nu: number | null; toen: number | null; pct: number | null } | null;
  /** Gaat de vergelijking over een deel van de periode, dan welk. */
  over: string | null;
  /** Waarom er voor dit kanaal geen vergelijking is. */
  uitleg: string | null;
}

/**
 * De bijdrage per kanaal: aandeel in de kosten tegenover aandeel in de conversies, de CPA, en de
 * verandering van de CPA tegen de vergelijkingsperiode waar dat eerlijk kan (alleen over het
 * gepaarde deel, zoals de tegels). De aandelen zijn die van de kanaalkaarten (heleProcenten, samen
 * precies 100).
 */
export function bijdragePerKanaal(cijfers: readonly KaartCijfers[], vergelijk: readonly KanaalVergelijk[] | null): BijdrageRij[] {
  return cijfers.map((c): BijdrageRij => {
    const v = vergelijk?.find((x) => x.kanaal === c.kanaal) ?? null;
    const verschil = c.aandeelKosten !== null && c.aandeelConversies !== null ? c.aandeelKosten - c.aandeelConversies : null;
    const kenmerk = cijfers.length < 2 || verschil === null ? null
      : verschil >= BIJDRAGE_VERSCHIL_VANAF ? "duur"
      : verschil <= -BIJDRAGE_VERSCHIL_VANAF ? "voordelig" : null;
    const p = v?.paar ?? null;
    const cpaNu = p ? safeDiv(p.nu.totalen.adSpend, p.nu.totalen.conversions) : null;
    const cpaToen = p ? safeDiv(p.toen.totalen.adSpend, p.toen.totalen.conversions) : null;
    return {
      kanaal: c.kanaal,
      adSpend: c.adSpend,
      conversions: c.conversions,
      aandeelKosten: c.aandeelKosten,
      aandeelConversies: c.aandeelConversies,
      cpa: c.cpa,
      kenmerk,
      cpaPaar: p ? { nu: cpaNu, toen: cpaToen, pct: pctTussen(cpaNu, cpaToen) } : null,
      over: p?.over ?? null,
      uitleg: v?.uitleg ?? null,
    };
  });
}

// ── 4 WAT NU ────────────────────────────────────────────────────────────────────────────────────

/** Hoeveel open punten het blok "Wat nu" toont. */
export const WAT_NU_MAX = 3;

/** De ICE-score uit de chip van een voorstel ("ICE 7,5"), of null. */
function iceUitChip(chip: string | null): number | null {
  const m = /ICE\s+([\d.,]+)/.exec(chip ?? "");
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

const tijd = (i: LogboekItem) => Date.parse(i.tijd);

/**
 * De open punten voor "Wat nu", uit het logboek dat de pagina al heeft (één verzoek, geen tweede):
 * open to-do's eerst (iemand heeft ze zelf gezet), dan de voorstellen die op een oordeel wachten,
 * hoogste ICE-score eerst en bij gelijke score de nieuwste. Op een kanaal dat kanaal plus wat de
 * hele klant raakt (voorKanaal, dezelfde regel als het logboek): een to-do heeft geen kanaal, een
 * voorstel alleen als zijn bron er een noemt. Hooguit WAT_NU_MAX.
 *
 * Het bereik is dat van het logboek, en het blok zegt dat erbij: de VOORSTELLEN_MAX nieuwste
 * voorstellen van de laatste LOGBOEK_DAGEN dagen (de hoogste ICE is dus de hoogste van DIE), de
 * to-do's van dezelfde dagen, en geen aanbevelingen uit sop_recommendations.
 */
export function watNuItems(items: readonly LogboekItem[], keuze: Kanaalkeuze): LogboekItem[] {
  const open = voorKanaal(items, keuze);
  const todos = open.filter((i) => i.soort === "todo" && i.chip === "open")
    .sort((a, b) => tijd(b) - tijd(a) || a.id.localeCompare(b.id));
  const voorstellen = open.filter((i) => i.soort === "voorstel")
    .sort((a, b) => (iceUitChip(b.chip) ?? -1) - (iceUitChip(a.chip) ?? -1) || tijd(b) - tijd(a) || a.id.localeCompare(b.id));
  return [...todos, ...voorstellen].slice(0, WAT_NU_MAX);
}

// De cijferpoort: toetst percentages en eurobedragen in een modeltekst tegen een toegestane set.
// Gebruikt door de cross-channel- en portfoliosynthese, de master-synthese, de Meta-briefing, de
// replay-scorekaart en (als terugval zonder brondata) de korte cadans. Waar de route de tabellen
// heeft die het model kreeg, hoort de strengere brondata-toets (brondata-toets.ts) te draaien.
//
// ── WAT ER MIS WAS (doorlichting 13 november) ───────────────────────────────
//
// 1. "€ 1.650" werd 1,65 en daarna 2: de regex kende geen duizendtalpunt. Elk bedrag boven de 999
//    kromp tot een cijfer van 1 tot 9, en zodra de onderbouwing zelf een bedrag met punt bevatte
//    stond dat cijfer in de toegestane set. "Verhoog budget naar € 2.400" kwam er zo door.
// 2. Percentages en euro's deelden een set en werden op hele getallen afgerond: "€ 17" passeerde
//    op 16,9%, "39%" op een CPA van € 39,29, "€ 38,60" op € 39,29.
// 3. "1650 euro" en "bespaar 2.400 euro" werden niet gelezen: alleen een getal direct na € telde.
//
// Nu: getallen worden in nl-NL gelezen (brondata-toets.ts, leesGetal), bedragen en percentages
// hebben elk hun eigen set, en een getal past alleen als de toegestane waarde binnen de afronding
// van de geschreven vorm valt. Een kale lijst getallen (oude aanroepers) blijft werken, maar geldt
// dan voor beide soorten.
//
// 4. "ROAS van 4,8" ging ongezien door: een ROAS is geen bedrag en geen percentage, en alle
//    "aantallen" werden overgeslagen. Een metriekwaarde (ROAS) wordt nu ook getoetst, tegen de
//    aantallen. Tellingen ("54 klikken") niet: die stonden nooit in deze poort, en de toegestane
//    sets van de aanroepers (de onderbouwing, de cluster) dragen ze niet betrouwbaar.

import { leesCijfers, MARKERING, type GelezenGetal } from "./brondata-toets";

/**
 * Een lijst toegestane getallen die ook weet welke percentages en welke bedragen waren. Blijft
 * een gewone number[] voor wie hem zo leest (includes, spread), zodat geen aanroeper hoeft te
 * veranderen; de poort gebruikt de gescheiden sets zodra ze er zijn.
 */
export type GegrondeLijst = number[] & { procenten?: number[]; bedragen?: number[]; aantallen?: number[] };

/** Maakt een GegrondeLijst uit al gescheiden sets; de lijst zelf is alles bij elkaar. */
export function gegrondeLijst(sets: { procenten: number[]; bedragen: number[]; aantallen?: number[] }): GegrondeLijst {
  const aantallen = sets.aantallen ?? [];
  const lijst = [...sets.procenten, ...sets.bedragen, ...aantallen] as GegrondeLijst;
  lijst.procenten = sets.procenten;
  lijst.bedragen = sets.bedragen;
  lijst.aantallen = aantallen;
  return lijst;
}

/** Haalt alle percentages en eurobedragen uit een gegronde tekst. */
export function extractGroundedNumbers(text: string): GegrondeLijst {
  const procenten: number[] = [];
  const bedragen: number[] = [];
  const aantallen: number[] = [];
  for (const c of leesCijfers(text)) {
    if (c.soort === "percentage") procenten.push(Math.abs(c.getal.waarde));
    else if (c.soort === "bedrag") bedragen.push(Math.abs(c.getal.waarde));
    else aantallen.push(Math.abs(c.getal.waarde));
  }
  return gegrondeLijst({ procenten, bedragen, aantallen });
}

export interface GateResult {
  text: string;
  hadUngrounded: boolean;
  ungrounded: number[];
}

function past(getal: GelezenGetal, toegestaan: readonly number[]): boolean {
  const v = Math.abs(getal.waarde);
  const marge = getal.stap / 2 + getal.stap * 1e-6;
  return toegestaan.some((t) => Math.abs(Math.abs(t) - v) <= marge);
}

/** "ROAS van 4,8": een aantal dat een metriekwaarde is, geen telling. */
function isMetriekWaarde(tekst: string): boolean {
  return /^\s*ROAS\b/i.test(tekst);
}

// Toetst een aanbeveling- of taaktekst tegen de toegestane cijfers. Een percentage of
// eurobedrag dat niet in de set zit is ongegrond: het wordt door een neutrale markering
// vervangen en gerapporteerd. Vensters als "1-2 weken" tellen niet.
export function gateUngroundedNumbers(text: string, allowedNumbers: readonly number[] | GegrondeLijst): GateResult {
  const lijst = allowedNumbers as GegrondeLijst;
  const procenten = lijst.procenten ?? allowedNumbers;
  const bedragen = lijst.bedragen ?? allowedNumbers;
  const aantallen = lijst.aantallen ?? allowedNumbers;
  const ungrounded: number[] = [];
  let out = text;
  const cijfers = leesCijfers(text)
    .filter((c) => c.soort !== "aantal" || isMetriekWaarde(c.tekst))
    .sort((a, b) => b.start - a.start);
  for (const c of cijfers) {
    const set = c.soort === "percentage" ? procenten : c.soort === "bedrag" ? bedragen : aantallen;
    if (past(c.getal, set)) continue;
    ungrounded.push(c.getal.waarde);
    out = out.slice(0, c.start) + MARKERING[c.soort] + out.slice(c.eind);
  }
  return { text: out, hadUngrounded: ungrounded.length > 0, ungrounded: ungrounded.reverse() };
}

// Past de gate toe op een set string-velden van een item (aanbeveling of taak) en geeft het
// geschoonde item terug plus of er iets gemarkeerd is. Onbekende of niet-string velden
// blijven ongemoeid.
export function gateItemFields<T extends Record<string, unknown>>(
  item: T,
  fields: string[],
  allowedNumbers: readonly number[] | GegrondeLijst
): { item: T; hadUngrounded: boolean; ungrounded: number[] } {
  const clone: Record<string, unknown> = { ...item };
  const ungrounded: number[] = [];
  for (const field of fields) {
    const value = clone[field];
    if (typeof value === "string") {
      const res = gateUngroundedNumbers(value, allowedNumbers);
      clone[field] = res.text;
      if (res.hadUngrounded) ungrounded.push(...res.ungrounded);
    }
  }
  return { item: clone as T, hadUngrounded: ungrounded.length > 0, ungrounded };
}

// Welk getal hoort bij een percentage als dat percentage niet over hetzelfde gaat als het grote getal.
//
// De kerncijfers tonen het totaal over ALLE kanalen van de gekozen periode, maar de verandering is
// gepaard: alleen de kanalen (en maanden) die in de vergelijkingsperiode ook liepen. Bij de
// demo-klant stond daardoor "CPA € 57, +14% ongunstig, was € 96": € 57 is alle vier de kanalen,
// +14% en € 96 zijn alleen Google (nu € 109). Wie getal en percentage samen las, zag de CPA met 40%
// dalen en kreeg er "ongunstig" bij. Voor ROAS hetzelfde: "2,89×, -11%, was 1,98×".
//
// De regel: gaat het percentage over precies het grote getal, dan staat de vorige waarde erbij.
// Gaat het over een deel, dan staan BEIDE waarden van dat deel erbij (nu en toen), zodat het
// percentage altijd naast de twee getallen staat waaruit het berekend is.

import { delta, type PeriodDelta } from "./apply-period";

export type DeelVergelijking =
  /** Er is geen vergelijkingsperiode. */
  | { soort: "geen" }
  /** Wel een vergelijking, maar een van beide waarden bestaat niet (geen spend, geen conversies). */
  | { soort: "leeg" }
  /** Het percentage gaat over hetzelfde als het grote getal. */
  | { soort: "heel"; pct: number | null; vorig: number }
  /** Het percentage gaat over een deel: `huidig` en `vorig` zijn de waarden van dat deel. */
  | { soort: "deel"; pct: number | null; huidig: number; vorig: number };

/** Of twee getallen hetzelfde zijn op afronding na. Relatief, want het gaat om euro's én om ROAS. */
function gelijk(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);
}

/** Een optelling (conversies, omzet, kosten): het totaal tegen de gepaarde delta. */
export function somVergelijking(totaal: number, d: PeriodDelta | null | undefined): DeelVergelijking {
  if (!d) return { soort: "geen" };
  if (gelijk(d.huidig, totaal)) return { soort: "heel", pct: d.pct, vorig: d.vorig };
  return { soort: "deel", pct: d.pct, huidig: d.huidig, vorig: d.vorig };
}

export interface VerhoudingInvoer {
  /** Teller en noemer over de hele periode, alle kanalen: wat het grote getal is. */
  totaalTeller: number;
  totaalNoemer: number;
  /** De gepaarde delta's van teller en noemer, of null zonder vergelijkingsperiode. */
  teller: PeriodDelta | null | undefined;
  noemer: PeriodDelta | null | undefined;
}

const deel = (t: number, n: number): number | null => (n > 0 ? t / n : null);

/** Een verhouding (ROAS = omzet/kosten, CPA = kosten/conversies). */
export function verhoudingVergelijking({ totaalTeller, totaalNoemer, teller, noemer }: VerhoudingInvoer): DeelVergelijking {
  if (!teller || !noemer) return { soort: "geen" };
  const huidig = deel(teller.huidig, noemer.huidig);
  const vorig = deel(teller.vorig, noemer.vorig);
  // Beide onbekend: er viel niets te paren. Dan geen regel onder de tegel; de somtegels ernaast
  // zeggen al "nieuw in deze periode" of "geen vergelijking mogelijk", en de uitleg eronder waarom.
  if (huidig === null && vorig === null) return { soort: "geen" };
  if (huidig === null || vorig === null) return { soort: "leeg" };
  const pct = delta(huidig, vorig).pct;
  // Niet de verhoudingen vergelijken maar teller en noemer: een toevallig gelijke CPA over een
  // andere set kanalen is nog steeds een ander getal.
  const heel = gelijk(teller.huidig, totaalTeller) && gelijk(noemer.huidig, totaalNoemer);
  return heel ? { soort: "heel", pct, vorig } : { soort: "deel", pct, huidig, vorig };
}

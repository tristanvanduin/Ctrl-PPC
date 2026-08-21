import type { Bedrijfsmodel } from "@/lib/benchmark/segment";
import type { Licht } from "@/lib/adoptie/account-stoplicht";

// ============================================================================
// AGENCY MACRO CHURN: DE EIGEN PORTFOLIO VAN ÉÉN BUREAU, CHURNRISICO PER SEGMENT
// ============================================================================
//
// Zelfde soort vraag als lib/macro/aggregate.ts, maar dan voor churn i.p.v. spend/conversies:
// niet "hoe presteert mijn e-com portfolio", maar "in welk segment van MIJN portfolio zit het
// churnrisico geconcentreerd". Geen k-anonimiteit nodig -- dit is de eigen data van het bureau
// over zijn eigen klanten, dezelfde grens als aggregate.ts. Licht (rood/amber/groen/onbekend) komt
// uit lib/adoptie/code-rood.ts, hetzelfde oordeel als het Today-paneel en de dashboardbanner al
// tonen -- dit is geen nieuw churnmodel, alleen een telling van een bestaand oordeel per segment.

export interface MacroChurnSleutel {
  agencyId: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
}

export interface MacroChurnTelling {
  rood: number;
  amber: number;
  groen: number;
  onbekend: number;
}

export interface MacroChurnCel {
  sleutel: MacroChurnSleutel;
  telling: MacroChurnTelling;
  /** Aantal verschillende klanten dat in deze cel meetelt. */
  accounts: number;
}

/** Eén rij per klant: het bureau, de segmentafbakening, en het actuele Code Rood/Amber-oordeel. */
export interface MacroChurnInvoerRij {
  clientId: string;
  agencyId: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
  licht: Licht;
}

function legeTelling(): MacroChurnTelling {
  return { rood: 0, amber: 0, groen: 0, onbekend: 0 };
}

function tellen(t: MacroChurnTelling, licht: Licht): void {
  if (licht === "rood") t.rood++;
  else if (licht === "amber") t.amber++;
  else if (licht === "groen") t.groen++;
  else t.onbekend++;
}

function sleutelTekst(s: MacroChurnSleutel): string {
  return `${s.agencyId}|${s.bedrijfsmodel ?? ""}|${s.niche ?? ""}`;
}

/**
 * Bouwt de churn-cellen uit een verzameling klantrijen (al beperkt tot de eigen bureaus van de
 * aanroeper door de aanroepende route, zelfde bureaugrens als bouwMacroTrends). Eén rij per
 * klant: een tweede rij met dezelfde clientId overschrijft de eerste niet stilzwijgend maar telt
 * dubbel in de telling -- dat is een programmeerfout in de aanroeper, niet iets om hier stil op
 * te vangen (zelfde aanname als bouwMacroTrends/bouwGodViewCellen).
 *
 * Elke rij telt mee op elk segmentniveau waarop de klant is afgebakend -- geen segment (het
 * agency-brede totaal), alleen bedrijfsmodel, alleen niche, en beide samen. Zelfde regel als
 * bouwMacroTrends, zodat "hoe presteert mijn e-com portfolio" en "waar zit het churnrisico"
 * dezelfde segmentgrenzen gebruiken.
 */
export function bouwMacroChurn(rijen: readonly MacroChurnInvoerRij[]): MacroChurnCel[] {
  const groepen = new Map<string, { sleutel: MacroChurnSleutel; telling: MacroChurnTelling; klanten: Set<string> }>();

  const voegToe = (sleutel: MacroChurnSleutel, rij: MacroChurnInvoerRij) => {
    const k = sleutelTekst(sleutel);
    let g = groepen.get(k);
    if (!g) { g = { sleutel, telling: legeTelling(), klanten: new Set() }; groepen.set(k, g); }
    tellen(g.telling, rij.licht);
    g.klanten.add(rij.clientId);
  };

  for (const r of rijen) {
    const basis = { agencyId: r.agencyId };
    voegToe({ ...basis, bedrijfsmodel: null, niche: null }, r);
    if (r.bedrijfsmodel) voegToe({ ...basis, bedrijfsmodel: r.bedrijfsmodel, niche: null }, r);
    if (r.niche) voegToe({ ...basis, bedrijfsmodel: null, niche: r.niche }, r);
    if (r.bedrijfsmodel && r.niche) voegToe({ ...basis, bedrijfsmodel: r.bedrijfsmodel, niche: r.niche }, r);
  }

  return [...groepen.values()]
    .map((g) => ({ sleutel: g.sleutel, telling: g.telling, accounts: g.klanten.size }))
    .sort((a, b) => (b.telling.rood + b.telling.amber) - (a.telling.rood + a.telling.amber) || b.accounts - a.accounts);
}

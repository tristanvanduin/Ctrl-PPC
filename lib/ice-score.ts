// Het ICE-totaal zoals een scherm het toont en sorteert: uit de drie delen, niet uit het getal dat
// het model zelf opgaf.
//
// Op Bevindingen stond "gesorteerd op ICE score" boven "ICE 10 · I:9 C:8 E:7", "ICE 10 · I:8 C:6
// E:6" en daarna "ICE 9.3 · I:9 C:9 E:10". Het opgeslagen totaal kwam van het model (een product
// boven 30 werd gedeeld door 3 en op 10 geklemd), en werd niet uit de delen herberekend: de
// aanbeveling met de laagste zekerheid stond bovenaan. Het opslaan zelf is van de analyselaag; hier
// leest het scherm het totaal dat bij de getoonde delen hoort.

/** (impact + confidence + ease) / 3 op één decimaal; null als een deel ontbreekt. */
export function iceUitDelen(impact: number | null | undefined, confidence: number | null | undefined, ease: number | null | undefined): number | null {
  const delen = [impact, confidence, ease];
  if (delen.some((d) => typeof d !== "number" || !Number.isFinite(d))) return null;
  return Math.round(((impact as number) + (confidence as number) + (ease as number)) / 3 * 10) / 10;
}

/** Het totaal dat een scherm toont: uit de delen, en anders het opgeslagen getal. */
export function getoondeIce(r: { ice_impact?: number | null; ice_confidence?: number | null; ice_ease?: number | null; ice_total?: number | null }): number | null {
  return iceUitDelen(r.ice_impact, r.ice_confidence, r.ice_ease) ?? (typeof r.ice_total === "number" ? r.ice_total : null);
}

/** Hoog naar laag op het getoonde totaal; zonder totaal achteraan. Stabiel bij gelijke stand. */
export function sorteerOpIce<T extends Parameters<typeof getoondeIce>[0]>(rijen: readonly T[]): T[] {
  return rijen
    .map((r, i) => ({ r, i, s: getoondeIce(r) }))
    .sort((a, b) => (b.s ?? -Infinity) - (a.s ?? -Infinity) || a.i - b.i)
    .map((x) => x.r);
}

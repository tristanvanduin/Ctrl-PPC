// Gedeelde verdeel-helper voor de demo-datasets.
//
// Waarom apart: meerdere demo-bronnen leiden fijnere rijen af uit een grover totaal (maanden uit
// een jaartotaal, ad-groepen uit een campagne, dagen uit een maand). Zodra die afleiding ergens
// afrondt zonder rest te verrekenen, klopt de som niet meer met het totaal waar hij uit kwam — en
// dan spreken twee schermen in de demo elkaar tegen. Eén helper met de rest-correctie voorkomt dat
// structureel in plaats van per geval.

/**
 * Verdeelt één geheel getal over de gewichten. De som van de delen is exact het totaal.
 *
 * Methode: grootste-rest (Hamilton). Eerst ieder deel naar beneden afgerond, daarna gaan de
 * resterende eenheden naar de delen met de grootste afgekapte rest. De voor de hand liggende
 * variant — alles afronden en het verschil bij het laatste deel dumpen — gaat stuk zodra er veel
 * delen zijn: bij 168 uur-cellen kwam alle afrondingsrest op zondag 23:00 terecht, wat dat ene
 * uur elf conversies op twintig euro gaf. Grootste-rest verdeelt de rest waar hij hoort.
 */
export function splitInt(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((v) => Math.floor(v));
  let rest = total - out.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i]++;
  return out;
}

/**
 * Verdeelt de conversiewaarde lángs een al verdeelde conversiereeks, in plaats van er los naast.
 *
 * Twee keer apart splitsen rondt twee keer anders af, en dan ontstaat het ene geval dat een lezer
 * meteen ziet: een cel met nul conversies en tóch omzet. Door de conversiedelen als gewichten te
 * gebruiken is dat onmogelijk. Zijn er helemaal geen conversies, dan valt hij terug op de
 * oorspronkelijke gewichten (relevant voor markten die wél kosten maken en niets opleveren).
 */
export function splitAlong(total: number, along: number[], fallback: number[]): number[] {
  const sum = along.reduce((s, v) => s + v, 0);
  return splitInt(total, sum > 0 ? along : fallback);
}

// Startprijzen voor de pricing-storefront. GEEN VASTGESTELDE PRIJS -- er staat nergens in de
// codebase een afgesproken bedrag, en dit bestand verzint er ook geen. De cijfers hieronder zijn
// een ronde, herkenbaar-indicatieve placeholder (expliciet gelabeld op de pagina zelf als
// "indicative"), zodat de storefront-structuur die de brief vraagt nu al staat, zonder een
// bedrag als feit te presenteren dat niemand heeft afgesproken.
//
// EEN PLEK OM TE VERVANGEN: zodra er echte prijzen zijn, hier aanpassen. app/(marketing)/
// pricing/page.tsx importeert alleen dit object, geen los bedrag in de JSX.
export const PRICING = {
  inHouse: { vanafPerMaand: 500, valuta: "EUR" },
  agency: { vanafPerMaand: 1500, valuta: "EUR" },
} as const;

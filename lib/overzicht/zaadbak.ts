// Het zaad: een antwoord dat de SERVER al ophaalde terwijl hij de pagina stuurde, en dat de browser
// gebruikt in plaats van zijn eerste eigen verzoek.
//
// WAAROM DIT BESTAAT
//
// De klantpagina stuurde alleen het skelet. Pas na het laden en hydrateren van het script vertrokken
// de verzoeken waar het eerste kerncijfer op wacht (de blended route en de client_settings-rij).
// Gemeten op de demo: eerste kerncijfer na 1754 ms, waarvan de blended route zelf 825 tot 1000 ms
// is; de rest is wachten tot het script zover is dat het verzoek kan vertrekken. De server kan die
// lezing starten op het moment dat het paginaverzoek binnenkomt en het antwoord in dezelfde
// HTML-stroom nasturen (app/(app)/client/[clientId]/page.tsx geeft de belofte als prop mee, zonder
// erop te wachten: node_modules/next/dist/docs/01-app/01-getting-started, "Streaming data").
//
// HET CONTRACT
//
// - `zaai(sleutel, belofte)`: leg het antwoord van de server klaar voor de EERSTE lezer van die
//   sleutel. Dezelfde belofte twee keer zaaien doet niets (de component rendert vaker dan eens, en
//   een pagina die uit de geschiedenis van de browser terugkomt brengt haar oude belofte mee).
// - `neem(sleutel)`: het zaad voor deze sleutel, eenmalig; daarna is het weg. Null als er geen zaad
//   ligt of als het langer dan ZAAD_VERS_MS geleden gezaaid is. De belofte geeft de waarde, of
//   `undefined` als er niets bruikbaars is: de server las niets (geen toegang, een fout) of de
//   stroom brak af. De lezer doet dan zijn gewone verzoek. Een fout van de server wordt hier dus
//   NOOIT de foutstaat van de pagina: de bestaande route houdt haar eigen foutmeldingen en
//   statuscodes.
// - `vergeet(sleutel)`: weg met het zaad (na opslaan of een sync leest de browser opnieuw).
//
// ALLEEN IN DE BROWSER. De bak staat op moduleniveau, en op de server leeft een module over
// verzoeken van verschillende gebruikers heen: daar zaaien zou het antwoord van de ene kijker aan
// de volgende geven. `zaai` doet daarom niets zonder `window`.
//
// Bewust zonder "use client": een gewone module, geen component (zie lib/data-access/bron-cache.ts).

/** Wat de server meestuurt: de waarde in een omhulsel, zodat "niets gelezen" (null) iets anders
 *  is dan een waarde die zelf null is. */
export interface Zaad<T> {
  waarde: T;
}

/**
 * Hoe lang een zaad mag blijven liggen tussen zaaien en nemen. Ruim boven de duur van een trage
 * paginalaad, ruim onder de vijf minuten van de caches.
 *
 * DE TOETS STAAT IN `neem`, tegen het moment van ZAAIEN op de klok van de browser. Hij stond eerst
 * bij het oplossen van de belofte, tegen een tijdstempel van de server. Dat ging twee keer mis:
 * een zaad dat na het oplossen bleef liggen (de hook was al gemount en haalde niet opnieuw op)
 * had geen leeftijdsgrens meer en kon minuten later door een volgende lezer als vers in de cache
 * gezet worden; en de vergelijking van twee klokken maakte bij een browser die een minuut voor- of
 * achterloopt elk zaad altijd te oud of altijd vers. Nu is er één klok, en geldt de grens op het
 * moment dat het zaad gebruikt wordt.
 */
export const ZAAD_VERS_MS = 60 * 1000;

export interface Zaadbak<T> {
  zaai(sleutel: string, belofte: Promise<Zaad<T> | null> | null | undefined): void;
  neem(sleutel: string): Promise<T | undefined> | null;
  vergeet(sleutel: string): void;
}

/** @param nu de klok, alleen voor de test. */
export function maakZaadbak<T>(nu: () => number = () => Date.now()): Zaadbak<T> {
  const gezien = new WeakSet<object>();
  const bak = new Map<string, { gezaaidOp: number; belofte: Promise<T | undefined> }>();
  return {
    zaai(sleutel, belofte) {
      if (typeof window === "undefined" || !belofte || typeof belofte.then !== "function") return;
      if (gezien.has(belofte)) return;
      gezien.add(belofte);
      bak.set(sleutel, {
        gezaaidOp: nu(),
        // Promise.resolve eromheen: wat React uit de serverstroom aanlevert is een "thenable", geen
        // echte Promise. Zijn `then` geeft niets terug, dus een ketting erop is `undefined` en de
        // eerste lezer viel om op `.then` van niets (de hele pagina, in de browser; de tests
        // zaaiden echte Promises en zagen het niet).
        belofte: Promise.resolve(belofte).then((z) => (z && typeof z === "object" && "waarde" in z ? z.waarde : undefined), () => undefined),
      });
    },
    neem(sleutel) {
      const z = bak.get(sleutel);
      bak.delete(sleutel);
      if (!z) return null;
      const leeftijd = nu() - z.gezaaidOp;
      // Ook een negatieve leeftijd (de klok is teruggezet) telt als niet vers.
      return leeftijd >= 0 && leeftijd < ZAAD_VERS_MS ? z.belofte : null;
    },
    vergeet(sleutel) {
      bak.delete(sleutel);
    },
  };
}

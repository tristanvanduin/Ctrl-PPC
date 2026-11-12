"use client";

// Een keuze die in de adresbalk woont (bouwplan fase 2: één filter over de hele pagina).
//
// WAAROM DE ADRESBALK. De kanaalkeuze was React-state en de periode stond in localStorage: een
// herlaad sprong terug naar "Alle kanalen", en een link naar "Meta over de laatste drie maanden"
// bestond niet. In de adresbalk herlaadt de pagina in dezelfde toestand, werkt Terug, en is wat je
// ziet te delen.
//
// WAAROM history.pushState EN GEEN router.push. Een wissel mag geen serverwerk en geen verzoek
// kosten: alle cijfers staan al in het geheugen (fase 1). Next koppelt de eigen pushState en
// replaceState van de browser aan zijn router: useSearchParams volgt, en er gaat niets naar de
// server (node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md,
// "Native History API"). router.push met alleen andere zoekparameters haalt de serverboom opnieuw
// op.
//
// WAAROM EEN LOKALE KOPIE ERNAAST. Next verwerkt zo'n pushState in een transition: useSearchParams
// loopt een render achter. Wie de keuze alleen daaruit afleidt, ziet de knop pas oplichten als de
// hele nieuwe weergave gerenderd is. De keuze staat daarom ook meteen in lokale state; de adresbalk
// blijft de bron (bij het laden, bij Terug en Vooruit, bij een link), de kopie is alleen de echo
// van de eigen klik.

import { useCallback, useEffect, useRef, useState } from "react";

/** De zoekparameters zoals ze NU in de adresbalk staan. Op de server leeg. */
export function leesAdresbalk(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

/**
 * Past de zoekparameters aan en laat de rest staan (?geo= van de beurskeuze, ?demo= van de demo):
 * `wijzig` krijgt de huidige parameters en verandert alleen zijn eigen sleutels.
 *
 * "push" voor een keuze waar Terug naartoe hoort te kunnen (het kanaal), "replace" voor
 * bijstellen (de periode, het rechtzetten van een ongeldige waarde): anders is Terug na vijf keer
 * een andere periode vijf keer klikken. Verandert er niets, dan gebeurt er ook niets: een klik op
 * het kanaal waar je al staat hoort geen geschiedenis te maken.
 */
export function schrijfAdresbalk(wijzig: (p: URLSearchParams) => void, hoe: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const p = leesAdresbalk();
  const voor = p.toString();
  wijzig(p);
  if (p.toString() === voor) return;
  const url = `${metZoek(window.location.pathname, p)}${window.location.hash}`;
  // null als state: Next kopieert zijn eigen routerstate naar het nieuwe item.
  if (hoe === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** De beurs-scope uit het menu (?geo=GRT). */
export const GEO_PARAM = "geo";

/** Het pad met de zoekparameters erachter; zonder parameters het kale pad, zonder vraagteken. */
function metZoek(pad: string, p: URLSearchParams): string {
  const zoek = p.toString();
  return zoek ? `${pad}?${zoek}` : pad;
}

/**
 * Het adres van een beurs (of, met `geo` null, van het hele event) binnen DEZELFDE klant: alleen
 * ?geo= verandert, de rest van de huidige zoekparameters gaat mee.
 *
 * WAAROM. De zijbalk linkte naar een vast `/client/<id>?geo=<afk>`. Zolang het kanaal React-state
 * was, maakte dat niet uit: Next houdt de pagina gemount als alleen de zoekparameters veranderen,
 * dus de keuze bleef staan. Nu de adresbalk de bron is, IS zo'n kale link een keuze: wie op Meta
 * stond en een beurs koos, viel terug op "Alle kanalen", en zijn periode en vergelijking
 * verdwenen uit het adres. Een beurs kiezen is één filter verzetten, niet alle andere wissen.
 *
 * Alles gaat mee en niet een lijstje bekende sleutels (kanaal, periode, vergelijk, demo): een
 * filter dat er later bij komt, hoeft hier dan niet ook nog eens genoemd te worden om een
 * beurswissel te overleven. Dezelfde regel als schrijfAdresbalk: je verandert je eigen sleutel.
 *
 * Alleen voor de klant die open staat. Een link naar een ANDERE klant blijft kaal: die heeft zijn
 * eigen kanalen en zijn eigen bewaarde periode, en een periode in het adres gaat voor die keuze.
 */
export function beursAdres(pad: string, huidig: { toString(): string }, geo: string | null): string {
  const p = new URLSearchParams(huidig.toString());
  if (geo) p.set(GEO_PARAM, geo);
  else p.delete(GEO_PARAM);
  return metZoek(pad, p);
}

/** De koppeling tussen één keuze en de adresbalk. `T` is een kleine, platte waarde. */
export interface UrlKoppeling<T> {
  /** De waarde zoals React hem uit de adresbalk kent (useSearchParams), al gevalideerd; null = de
   *  adresbalk zegt er niets (geldigs) over. */
  waarde: T | null;
  /** Dezelfde lezing, maar vers uit de adresbalk zelf (leesAdresbalk). */
  leesNu: () => T | null;
  /** Zet de keuze in de adresbalk; null haalt hem eruit. */
  schrijf: (v: T | null) => void;
}

/**
 * De keuze uit de adresbalk, met een directe echo van de eigen klik.
 *
 * Geeft [waarde, kies]. `kies` zet de waarde meteen (deze render) en schrijft hem naar de
 * adresbalk; een verandering van buiten (Terug, Vooruit, een link) komt via `koppeling.waarde`
 * binnen en wint.
 *
 * DE VEROUDERDE ECHO. Na twee snelle keuzes (A, dan B) kan React de adresbalk eerst nog als A
 * laten zien en dan pas als B. Die A is geen verandering van buiten maar de eigen vorige klik die
 * nog onderweg was; hem overnemen liet de knop terugspringen naar A en weer naar B. Het verschil
 * is te zien aan de adresbalk zelf, die pushState direct bijwerkt: zegt React "A" terwijl er "B"
 * staat, dan is A verouderd en gebeurt er niets.
 */
export function useUrlKeuze<T>(koppeling: UrlKoppeling<T>): [T | null, (v: T | null) => void] {
  const [lokaal, setLokaal] = useState<T | null>(koppeling.waarde);
  const sleutel = JSON.stringify(koppeling.waarde);
  // De nieuwste lees- en schrijffunctie, zonder dat een nieuwe functie per render het effect of
  // `kies` opnieuw laat lopen: de aanroeper bouwt de koppeling meestal in de render zelf.
  const nieuwste = useRef(koppeling);
  useEffect(() => { nieuwste.current = koppeling; });
  useEffect(() => {
    const nu = nieuwste.current.leesNu();
    if (JSON.stringify(nu) !== sleutel) return; // verouderde echo, zie hierboven
    setLokaal((huidig) => (JSON.stringify(huidig) === sleutel ? huidig : nu));
  }, [sleutel]);
  const kies = useCallback((v: T | null) => {
    setLokaal(v);
    nieuwste.current.schrijf(v);
  }, []);
  return [lokaal, kies];
}

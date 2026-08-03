"use client";

// De vorige inhoud vasthouden terwijl de nieuwe geladen wordt.
//
// Het patroon dat dit vervangt staat door de hele codebase: aan het begin van elk `useEffect`
// wordt de staat op `null` gezet, en `null` betekent "toon het skelet". Bij de eerste keer laden
// klopt dat — er ís nog niets. Maar bij elke VOLGENDE keer, als de gebruiker van kanaal wisselt of
// een andere uitsplitsing kiest, klapt een kaart met inhoud terug naar een skelet en daarna weer
// vol. Dat is een flits, en hij is erger dan wachten: het scherm springt van hoogte, je verliest
// je plek, en het voelt alsof er iets kapotging in plaats van dat er iets bijkwam.
//
// De richtlijn is er kort over — houd de vorige weergave vast op verlaagde dekking, zonder
// hoogtesprong. Dit hulpje doet daar het datadeel van: het onthoudt de laatste waarde die géén
// `null` was, zodat een component tijdens het verversen gewoon de oude cijfers kan blijven tonen.
//
// Wat het NIET doet, en dat is opzettelijk: het onderscheid tussen "nog nooit geladen" en "aan het
// verversen" blijft bij de aanroeper. De eerste hoort een skelet te krijgen, de tweede niet, en
// alleen de component weet welke van de twee het is.

import { useEffect, useRef } from "react";

/**
 * Geeft `waarde` terug zodra die er is, en anders de laatste waarde die er wél was.
 *
 * ```ts
 * const rijen = useVorige(data);          // blijft staan tijdens het verversen
 * const eersteKeer = rijen === null;      // nog nooit iets gehad: skelet
 * const ververst = data === null && !eersteKeer;  // oude inhoud, gedempt
 * ```
 */
export function useVorige<T>(waarde: T | null): T | null {
  const bewaard = useRef<T | null>(null);
  useEffect(() => {
    if (waarde !== null && waarde !== undefined) bewaard.current = waarde;
  }, [waarde]);
  // Tijdens dezelfde render al bijwerken, anders loopt de weergave één frame achter en zie je
  // alsnog een flits — precies wat dit hulpje moet voorkomen.
  if (waarde !== null && waarde !== undefined) bewaard.current = waarde;
  return bewaard.current;
}

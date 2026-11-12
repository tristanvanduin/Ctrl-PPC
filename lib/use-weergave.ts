"use client";

// De hook bij de schakelaar "Nieuwe weergave": leest en bewaart de keuze. De regels zelf (wat gaat
// voor, wat is de standaard, waarom een cookie ernaast) staan in lib/weergave.ts.

import { useCallback, useEffect, useState } from "react";
import { leesAdresbalk, schrijfAdresbalk } from "@/lib/adresbalk";
import { kiesWeergave, weergaveCookie, weergaveUitUrl, WEERGAVE_PARAM, WEERGAVE_SLEUTEL, type Weergave } from "@/lib/weergave";

function leesBewaard(): string | null {
  try { return window.localStorage.getItem(WEERGAVE_SLEUTEL); } catch { return null; }
}

function schrijfCookie(w: Weergave): void {
  try { document.cookie = weergaveCookie(w); } catch { /* geen cookies: dan rendert de server de vertrouwde kop */ }
}

/**
 * De gekozen weergave en de functie om hem te zetten.
 *
 * `urlWaarde` is ?weergave= zoals React hem kent (useSearchParams). `vanServer` is de keuze zoals
 * de server hem in de cookie las: daarmee rendert de eerste render dezelfde boom als de server
 * stuurde, en is dat voor wie de nieuwe weergave koos meteen de nieuwe. De bewaarde keuze uit
 * localStorage komt in een effect binnen (de server kent hem niet, en een eerste render die ervan
 * afhangt geeft een andere boom dan de server stuurde) en wint als hij er is en afwijkt.
 */
export function useWeergave(urlWaarde: string | null, vanServer: string | null = null): [Weergave, (w: Weergave) => void] {
  const [bewaard, setBewaard] = useState<string | null>(vanServer);
  // De eigen keuze van deze sessie wint van een ?weergave= die React nog een render lang laat zien
  // nadat de schakelaar hem uit het adres haalde (zie "De verouderde echo" in lib/adresbalk.ts).
  const [zelfGekozen, setZelfGekozen] = useState<Weergave | null>(null);
  useEffect(() => {
    // Alleen een geldige bewaarde keuze telt. Zonder (nooit gekozen, of opslag die niet te lezen is)
    // blijft wat de server uit de cookie las: dat is dezelfde keuze van dezelfde kijker.
    const keuze = weergaveUitUrl(leesBewaard());
    if (!keuze) return;
    setBewaard(keuze);
    // De cookie bijwerken als hij achterloopt op de opslag, zodat de volgende paginalaad klopt.
    if (keuze !== weergaveUitUrl(vanServer)) schrijfCookie(keuze);
  }, [vanServer]);

  const zet = useCallback((w: Weergave) => {
    setZelfGekozen(w);
    setBewaard(w);
    try { window.localStorage.setItem(WEERGAVE_SLEUTEL, w); } catch { /* geen opslag: de keuze geldt dan deze sessie */ }
    schrijfCookie(w);
    // De parameter weg, als vervanging: de schakelaar is nu de bron, en Terug hoort niet naar een
    // adres te leiden dat de keuze weer omdraait.
    if (leesAdresbalk().has(WEERGAVE_PARAM)) schrijfAdresbalk((p) => p.delete(WEERGAVE_PARAM), "replace");
  }, []);

  return [zelfGekozen ?? kiesWeergave({ url: urlWaarde, bewaard }), zet];
}

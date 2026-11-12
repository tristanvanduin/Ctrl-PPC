"use client";

// De hook bij de schakelaar "Nieuwe weergave": leest en bewaart de keuze. De regels zelf (wat gaat
// voor, wat is de standaard, waarom een cookie ernaast) staan in lib/weergave.ts.

import { useCallback, useEffect, useState } from "react";
import { leesAdresbalk, schrijfAdresbalk } from "@/lib/adresbalk";
import {
  CHROME_ATTRIBUUT, chromeIsNieuw, kiesWeergave, weergaveCookie, weergaveUitUrl, WEERGAVE_PARAM, WEERGAVE_SLEUTEL, type Weergave,
} from "@/lib/weergave";

function leesBewaard(): string | null {
  try { return window.localStorage.getItem(WEERGAVE_SLEUTEL); } catch { return null; }
}

/** De naam van de gebeurtenis waarmee de schakelaar zijn keuze aan de rest van het scherm meldt. */
const WEERGAVE_GEBEURTENIS = "overzicht-weergave";

function leesCookie(): string | null {
  try {
    const paar = document.cookie.split("; ").find((c) => c.startsWith(`${WEERGAVE_SLEUTEL}=`));
    return paar ? paar.slice(WEERGAVE_SLEUTEL.length + 1) : null;
  } catch { return null; }
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
    // De chrome buiten het klantdashboard (de bovenbalk, de bureaubanner) luistert mee: zie
    // useNieuweChrome hieronder.
    try { window.dispatchEvent(new CustomEvent(WEERGAVE_GEBEURTENIS, { detail: w })); } catch { /* geen venster: niets te melden */ }
    // De parameter weg, als vervanging: de schakelaar is nu de bron, en Terug hoort niet naar een
    // adres te leiden dat de keuze weer omdraait.
    if (leesAdresbalk().has(WEERGAVE_PARAM)) schrijfAdresbalk((p) => p.delete(WEERGAVE_PARAM), "replace");
  }, []);

  return [zelfGekozen ?? kiesWeergave({ url: urlWaarde, bewaard }), zet];
}

/**
 * Of de chrome rond een klantpagina (de bovenbalk, de bureaubanner) de nieuwe weergave volgt.
 *
 * WAAROM EEN TWEEDE HOOK. De schakelaar woont in het klantdashboard; de bovenbalk en de banners
 * staan in de layout erboven en kennen die toestand niet. De elementtabel van het ontwerp schrapt
 * of verplaatst daar drie dingen (de knop "Zoeken", de datum van vandaag, de SOP-dekking-banner
 * boven klantdata), en ook dat hoort achter de schakelaar te zitten. Deze hook leest dezelfde keuze
 * (adresbalk, dan localStorage, dan de cookie) en luistert naar de schakelaar, zodat de balk meteen
 * meegaat als iemand hem omzet.
 *
 * ALLEEN OP EEN KLANTPAGINA. Daar staat de schakelaar, dus daar is terug één klik. Op Vandaag,
 * Portfolio en Beheer blijft de chrome wat hij was, wat de kijker ook koos.
 *
 * Na de mount en niet in de eerste render: de server kent localStorage niet. `pad` is het pad van
 * de pagina (usePathname); bij een wissel van pagina wordt de keuze opnieuw gelezen.
 */
export function useNieuweChrome(pad: string | null): boolean {
  const [weergave, setWeergave] = useState<Weergave>("oud");
  // Is de keuze al gelezen? Tot dan is "oud" een beginwaarde en geen keuze, en blijft het kenmerk
  // op <html> wat het script in de <head> ervan maakte.
  const [gelezen, setGelezen] = useState(false);
  useEffect(() => {
    setWeergave(kiesWeergave({ url: leesAdresbalk().get(WEERGAVE_PARAM), bewaard: weergaveUitUrl(leesBewaard()) ?? leesCookie() }));
    setGelezen(true);
    const opKeuze = (e: Event) => {
      const keuze = weergaveUitUrl((e as CustomEvent<unknown>).detail as string | null);
      if (keuze) setWeergave(keuze);
    };
    window.addEventListener(WEERGAVE_GEBEURTENIS, opKeuze);
    return () => window.removeEventListener(WEERGAVE_GEBEURTENIS, opKeuze);
  }, [pad]);
  const nieuw = chromeIsNieuw({ pad, url: weergave, bewaard: null });
  // Het kenmerk op <html> dat het script in de <head> vóór de eerste verf zette (lib/weergave-init.ts)
  // bijhouden: na een wissel van de schakelaar of van pagina klopt het anders niet meer, en dan
  // verborg de CSS de knop "Zoeken" op Portfolio. Pas nadat de keuze gelezen is: de eerste render
  // staat op "oud", en het kenmerk dan weghalen liet de knop één beeld lang terugkomen.
  useEffect(() => {
    if (!gelezen) return;
    try {
      if (nieuw) document.documentElement.setAttribute(CHROME_ATTRIBUUT, "nieuw");
      else document.documentElement.removeAttribute(CHROME_ATTRIBUUT);
    } catch { /* geen document: niets bij te houden */ }
  }, [nieuw, gelezen]);
  return nieuw;
}

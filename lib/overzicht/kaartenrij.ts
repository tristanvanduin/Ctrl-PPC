// De hoogte van de rij kanaalkaarten vrijhouden tijdens het laden (bouwplan fase 3 en 6). Zuiver,
// geen React en geen opslag.
//
// WAAROM DIT BESTAAT. De rij kanaalkaarten staat er alleen bij een klant met meer dan één kanaal,
// en dat weet de pagina pas als de routes geantwoord hebben. Tot dan stond er niets; daarna
// verscheen de rij boven de tegels en duwde hij alles 86 pixels omlaag. Bij een allereerste bezoek
// aan de demo op een desktop mat dat een verspringing (CLS) van 0,22, tegen een grens van 0,10.
//
// De pagina onthield al per klant of er een kanaalbalk was (localStorage), maar alleen in de
// browser, en dus pas na de eerste verf: de server stuurde de pagina altijd zonder de rij.
//
// 1. DE SERVER WEET HET OOK, uit een cookie naast localStorage (dezelfde opzet als de keuze van de
//    weergave, lib/weergave.ts). Eén kleine cookie PER KLANT, met het pad van die klantpagina
//    (`path=/client/<id>`): de browser stuurt hem alleen mee met verzoeken onder dat pad, dus niet
//    met de API-verzoeken en niet met de pagina van een andere klant. Een eerdere opzet (één cookie
//    met een lijst van veertig klanten) ging bij elk verzoek mee en vergat de eenenveertigste.
//
// 2. BIJ EEN ONBEKENDE KLANT WORDT ER NIET GEGOKT, behalve waar het antwoord vastligt. Volgens de
//    telling in components/dashboard/kanaalkaarten.tsx hebben 62 van de 71 klanten alleen Google:
//    de rij bij elke onbekende klant vrijhouden zou bij bijna negen op de tien een vlak tonen dat
//    daarna wegvalt, en dus een sprong maken waar er geen was. Niet vrijhouden laat de rij bij de
//    overige klanten één keer per browser verschijnen; daarna weet de cookie het. De uitzondering
//    is een klant waarvan vooraf bekend is dat hij meer kanalen heeft (`meerdereVerwacht`): de
//    demo, die met vier kanalen geseed is en waar een eerste bezoek de regel is.
//
// De vertrouwde weergave houdt haar regel: alleen vrijhouden als de browser weet dat er een balk
// was. Zij leest en schrijft de cookie niet.

/** De naam van de cookie. */
export const KANAALBALK_COOKIE = "kanaalbalk";

/** Wat er over de kanaalbalk van een klant onthouden is: er was er een, er was er geen, of niets. */
export type BalkGeheugen = "1" | "0" | null;

/** Wat de cookie zegt; null als hij er niet is of iets anders bevat dan een stand. */
export function kanaalbalkUitCookie(ruw: string | null | undefined): BalkGeheugen {
  return ruw === "1" || ruw === "0" ? ruw : null;
}

/**
 * Het pad waaronder de cookie van deze klantpagina geldt: `/client/<id>`, letterlijk zoals het in
 * de adresbalk staat (de browser vergelijkt het pad van een cookie met het ruwe pad van het
 * verzoek, dus zelf opnieuw coderen kan een ander pad geven). Null buiten een klantpagina, en bij
 * een pad met een teken dat een cookie-regel zou breken.
 */
export function kanaalbalkPad(padnaam: string | null | undefined): string | null {
  const m = /^\/client\/[^/;,\s]+(?=\/|$)/.exec(padnaam ?? "");
  return m ? m[0] : null;
}

/**
 * De cookie-regel voor document.cookie: een jaar, zoals de keuze van de weergave, en alleen onder
 * het pad van deze klant. Null als de pagina geen klantpagina is: dan valt er niets te onthouden.
 */
export function kanaalbalkCookieRegel(metBalk: boolean, padnaam: string | null | undefined): string | null {
  const pad = kanaalbalkPad(padnaam);
  return pad ? `${KANAALBALK_COOKIE}=${metBalk ? "1" : "0"}; path=${pad}; max-age=31536000; samesite=lax` : null;
}

/**
 * Moet de hoogte van de kanaalrij vrijgehouden worden?
 *
 * Alleen zolang de kanalen nog niet bekend zijn. Dan: ja als er de vorige keer een balk was, nee
 * als er geen was. Is er over de klant niets bekend, dan alleen in de nieuwe weergave en alleen
 * als vooraf vaststaat dat de klant meer dan één kanaal heeft (zie de kop van dit bestand).
 */
export function reserveerKaartenrij(inp: { kanalenBekend: boolean; geheugen: BalkGeheugen; nieuw: boolean; meerdereVerwacht?: boolean }): boolean {
  if (inp.kanalenBekend) return false;
  if (inp.geheugen !== null) return inp.geheugen === "1";
  return inp.nieuw && inp.meerdereVerwacht === true;
}

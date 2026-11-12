// De schakelaar "Nieuwe weergave" van het Overzicht (bouwplan fase 3 en 6): de regels.
//
// WAAROM EEN SCHAKELAAR. De nieuwe bovenkant (kanaalkaarten, kerncijfertegels, hoofdgrafiek) staat
// twee weken NAAST de bestaande, per gebruiker te kiezen. Wie hem niet aanzet, ziet het Overzicht
// precies zoals het was; zo kan de proef in fase 6 oud en nieuw op dezelfde cijfers vergelijken, en
// is terug één klik.
//
// WAAR DE KEUZE WOONT. In localStorage, per browser: het is een voorkeur van de kijker, geen
// eigenschap van de klant en geen filter. Daarom NIET in de adresbalk zoals het kanaal en de
// periode: een gedeelde link hoort de ontvanger niet ongevraagd van weergave te laten wisselen.
//
// EN EEN KOPIE IN EEN COOKIE, alleen voor de server. De server kent localStorage niet en stuurde
// dus altijd de vertrouwde kop; wie de nieuwe weergave had gekozen, zag bij elke paginalaad eerst
// de hero van 94 pixels en daarna de compacte regel, met alles eronder dat honderd pixels
// opschoof. De cookie draagt dezelfde waarde onder dezelfde naam, zodat de server meteen de goede
// boom rendert. localStorage blijft de bron: wijken de twee af (een gewiste cookie), dan wint
// localStorage en wordt de cookie bijgewerkt (lib/use-weergave.ts).
//
// DE UITZONDERING: ?weergave=nieuw (of =oud). Die gaat voor zolang hij er staat, zonder de bewaarde
// keuze te overschrijven. Hij is er voor de meting (scripts/meet-overzicht.mjs opent een schone
// browser en moet de nieuwe weergave kunnen openen) en voor wie de eigenaar een link wil sturen
// die zeker de nieuwe weergave toont. Zet de kijker zelf de schakelaar om, dan verdwijnt de
// parameter: anders bleef het adres iets anders beweren dan de schakelaar.
//
// Dit bestand is zuiver en zonder React, zodat de serverpagina de naam van de cookie kan lezen en
// de regels te toetsen zijn zonder iets te mounten. De hook staat in lib/use-weergave.ts.

export type Weergave = "oud" | "nieuw";

/** De naam van de zoekparameter. */
export const WEERGAVE_PARAM = "weergave";
/** De sleutel in localStorage, en de naam van de cookie. Eén keuze voor alle klanten: je kiest een
 *  scherm, geen klant. */
export const WEERGAVE_SLEUTEL = "overzicht-weergave";

/**
 * De weergave voor wie niets koos. Standaard UIT: niemand krijgt de nieuwe weergave zonder hem zelf
 * aan te zetten. Dit is de ENE plek waar de standaard staat: kiesWeergave hieronder en het script
 * in de <head> (lib/weergave-init.ts) lezen hem allebei. Stonden het er twee, dan gaf de bovenbalk
 * na het omzetten van de ene weer een sprong voor iedereen zonder bewaarde keuze.
 */
export const STANDAARD_WEERGAVE: Weergave = "oud";

/** De weergave uit ?weergave= (of uit de opslag), of null als er niets of iets onbekends staat. */
export function weergaveUitUrl(ruw: string | null | undefined): Weergave | null {
  return ruw === "nieuw" || ruw === "oud" ? ruw : null;
}

/**
 * Welke weergave er getoond wordt: de adresbalk gaat voor, dan de bewaarde keuze, en zonder beide
 * de standaard (STANDAARD_WEERGAVE).
 * Een onbekende bewaarde waarde (een oudere versie, een handmatige bewerking) telt als geen keuze.
 */
export function kiesWeergave(inp: { url: string | null | undefined; bewaard: string | null | undefined }): Weergave {
  return weergaveUitUrl(inp.url) ?? weergaveUitUrl(inp.bewaard) ?? STANDAARD_WEERGAVE;
}

/** De cookie-regel die de keuze een jaar bewaart, voor document.cookie. */
export function weergaveCookie(w: Weergave): string {
  return `${WEERGAVE_SLEUTEL}=${w}; path=/; max-age=31536000; samesite=lax`;
}

// ── De chrome rond een klantpagina, vóór de eerste verf ─────────────────────────────────────────
//
// De bovenbalk staat in de layout boven het klantdashboard en kent de keuze pas na het monteren
// (lib/use-weergave.ts, useNieuweChrome): de server stuurde de knop "Zoeken" dus altijd mee, en
// voor wie de nieuwe weergave koos verdween hij daarna, waarbij alles rechts in de balk versprong.
// De cookie in de layout lezen zou dat oplossen, maar maakt ELKE pagina onder die layout dynamisch
// (Vandaag, Portfolio, Beheer), ook voor wie de schakelaar nooit aanraakt.
//
// Daarom dezelfde opzet als het thema: een regel script in de <head> (lib/weergave-init.ts) die
// vóór de eerste verf een kenmerk op <html> zet, en één regel CSS die verbergt wat in de nieuwe chrome niet hoort
// (app/globals.css, [data-chrome-oud]). React haalt de knop daarna alsnog uit de boom; dat verspringt
// niet meer, want hij stond er al niet. De hook houdt het kenmerk bij als de keuze of de pagina
// wisselt.

/** Waar een klantpagina mee begint: alleen daar volgt de chrome de schakelaar. */
export const KLANTPAD = "/client/";
/** Het kenmerk op <html> dat zegt dat de chrome de nieuwe weergave volgt. */
export const CHROME_ATTRIBUUT = "data-chrome";

/**
 * Volgt de chrome rond deze pagina de nieuwe weergave? Alleen op een klantpagina, en dan volgens
 * dezelfde voorrang als het Overzicht zelf (kiesWeergave).
 */
export function chromeIsNieuw(inp: { pad: string | null | undefined; url: string | null | undefined; bewaard: string | null | undefined }): boolean {
  return !!inp.pad && inp.pad.startsWith(KLANTPAD) && kiesWeergave(inp) === "nieuw";
}

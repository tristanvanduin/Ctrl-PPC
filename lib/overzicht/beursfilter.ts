// Wat een scherm zegt als er een beurs gekozen is (?geo=) die het niet volgt.
//
// Met "Beurs: GreenTech Amsterdam" in de kop stonden op het Overzicht 3.416 conversies en CPA € 57,
// exact de cijfers van het hele account; de kloonklant van die beurs doet 357 tegen € 229. Doelen &
// voortgang en Bevindingen toonden de voortgang en de voorstellen van het hele account, ook die
// over een andere beurs. Waar een blok niet op de beurs kan filteren, zegt het dat nu zelf.

/** De zin voor een blok dat niet op de gekozen beurs filtert; null zonder gekozen beurs. */
export function geenBeursfilterTekst(geo: string | null | undefined, onderwerp: string, meervoud = false): string | null {
  if (!geo) return null;
  return `${onderwerp} ${meervoud ? "tonen" : "toont"} het hele account, niet gefilterd op beurs ${geo}.`;
}

/**
 * Of het Overzicht de regel boven zijn cijfers toont, en over welke blokken. In beide weergaven
 * hetzelfde: de melding stond alleen onder de band van de vertrouwde weergave, en in de nieuwe
 * weergave stonden de accounttegels (3.416 conversies, CPA € 57) onder "Beurs: GreenTech Amsterdam"
 * zonder één woord. Op een los kanaal volgen de pacing en de prognose de beurs evenmin; die worden
 * genoemd, zodat de melding niet alleen over de tegels lijkt te gaan.
 */
export function overzichtBeursmelding(
  geo: string | null | undefined,
  tab: string,
  kanaal: string,
): { tekst: string } | null {
  if (!geo || tab !== "dashboard") return null;
  const onderwerp = kanaal === "blended"
    ? "De kerncijfers hierboven en het overzicht Alle kanalen"
    : "De kerncijfers hierboven, de pacing en de prognose";
  const tekst = geenBeursfilterTekst(geo, onderwerp, true);
  return tekst ? { tekst } : null;
}

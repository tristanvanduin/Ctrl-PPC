// De bewaarde periode van een klantpagina in een cookie, voor de server. Zuiver, geen React.
//
// WAAROM. De periode wordt per klant in localStorage bewaard (lib/period/period-context.tsx), en
// die kent de server niet. Zolang de kerncijfers pas in de browser een getal kregen, maakte dat
// niet uit. Nu zet de server ze al in de HTML (components/dashboard/band-uit-zaad.tsx), en dan
// moet hij hetzelfde venster kiezen als de browser straks: anders staat er eerst het getal over de
// laatste twaalf maanden en daarna, als de browser zijn bewaarde keuze leest, een ander.
//
// DEZELFDE OPZET ALS DE KANAALBALK (lib/overzicht/kaartenrij.ts): één kleine cookie per klant, met
// het pad van die klantpagina, zodat hij alleen meegaat met verzoeken onder `/client/<id>` en
// nooit bij een andere klant terechtkomt. localStorage blijft de bron; de provider schrijft de
// cookie bij elke keuze en zet hem gelijk zodra hij localStorage gelezen heeft.
//
// DE WAARDE is de keuze in de vorm van de adresbalk (lib/period/periode-url.ts): dezelfde
// schrijfwijze en dezelfde controle bij het lezen, geen tweede formaat dat uit de pas kan lopen.

import { kanaalbalkPad } from "../overzicht/kaartenrij";
import { metDagUitParams, zetMetDagParams, type PeriodeKeuzeMetDag } from "./dag-keuze";

/** De naam van de cookie. */
export const PERIODE_COOKIE = "overzicht-periode";

/** De keuze als cookiewaarde: "periode=last_3m&vergelijk=previous_period". Een keuze per dag (de
 *  nieuwe weergave, lib/period/dag-keuze.ts) in dezelfde vorm als in de adresbalk; een maandkeuze
 *  precies zoals altijd. */
export function periodeCookieWaarde(keuze: PeriodeKeuzeMetDag): string {
  const p = new URLSearchParams();
  zetMetDagParams(p, keuze);
  return p.toString();
}

/** De keuze uit de cookie, of null als hij er niet is of geen geldige periode draagt. Een maandkeuze
 *  komt terug als maandkeuze; alleen een keuze die maanden niet kunnen, draagt `dag`. */
export function periodeUitCookie(ruw: string | null | undefined): PeriodeKeuzeMetDag | null {
  if (!ruw) return null;
  try {
    return metDagUitParams(new URLSearchParams(ruw));
  } catch {
    return null;
  }
}

/**
 * De cookie-regel voor document.cookie: een jaar, alleen onder het pad van deze klant. Null buiten
 * een klantpagina: daar valt voor de server niets te onthouden.
 */
export function periodeCookieRegel(keuze: PeriodeKeuzeMetDag, padnaam: string | null | undefined): string | null {
  const pad = kanaalbalkPad(padnaam);
  return pad ? `${PERIODE_COOKIE}=${periodeCookieWaarde(keuze)}; path=${pad}; max-age=31536000; samesite=lax` : null;
}

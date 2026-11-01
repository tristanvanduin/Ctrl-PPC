import { addDays } from "@/lib/reporting-date";
import { nthMondayOfMonth } from "@/lib/fair/fair-weeks";

/**
 * De datumbereiken van de twee weekaanroepen van de client-data-route: de historie en het lopende
 * jaar, gesplitst op een MAANDAG.
 *
 * Google levert weekrijen op hun maandag (segments.week), afgekapt op het gevraagde bereik, en
 * googleAdsWeeklyByYear legt een rij bij het jaar van die maandag. Een grens op 1 januari brak de
 * week die over de jaarwisseling loopt in tweeën: 29-31 december 2025 werd een vijfde decemberweek
 * van drie dagen, en 1-4 januari kwam als een rij met maandag 29 december in de aanroep van 2026,
 * waar de route alleen 2026 houdt. Vier dagen van januari stonden zo in geen enkel weekrecord.
 *
 * Met de grens op de eerste maandag van januari is elke rij een hele week, die in precies één
 * aanroep staat en bij de maand van zijn maandag hoort -- dezelfde regel die midden in de historie
 * (december 2024) al gold. Het begin van de historie staat om dezelfde reden op een maandag: de
 * week vóór de eerste maandag zou bij een jaar horen dat de route niet meer meeneemt.
 */
/**
 * De maandag van de week waarin `dag` ("YYYY-MM-DD") valt: `dag` zelf als dat een maandag is,
 * anders de maandag ervoor. Voor de weekaanroep van de sync: die begon op de 1e van een maand, en
 * Google geeft de week waarin die valt terug onder zijn maandag, afgekapt op het bereik. De upsert
 * op (client_id, week_start) overschreef dan bij elke run een hele week met dat stuk. Vanaf de
 * maandag ervoor komt die week heel binnen. Niet de maandag erna: dan schrijft een nieuwe klant de
 * eerste dagen van zijn venster in geen enkele weekrij.
 */
export function maandagVanWeek(dag: string): string {
  const weekdag = new Date(`${dag}T00:00:00Z`).getUTCDay(); // 0 = zondag, 1 = maandag
  return addDays(dag, -((weekdag + 6) % 7));
}

export function googleWeekVensters(
  huidigJaar: number,
  eersteJaar: number,
): { historie: { van: string; tot: string }; lopend: { van: string; tot: string } } {
  // De eerste maandag van januari bestaat altijd; de terugval op 1 januari is alleen voor de typen.
  const eersteMaandag = (jaar: number) => nthMondayOfMonth(jaar, 1, 1) ?? `${jaar}-01-01`;
  const grens = eersteMaandag(huidigJaar);
  return {
    historie: { van: eersteMaandag(eersteJaar), tot: addDays(grens, -1) },
    lopend: { van: grens, tot: `${huidigJaar}-12-31` },
  };
}

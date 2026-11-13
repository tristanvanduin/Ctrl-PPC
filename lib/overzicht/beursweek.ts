// Hoe de beursstrook een week noemt: gerealiseerd, geschat of prognose.
//
// De weekreeks bevat alleen afgesloten maanden als gerealiseerd (lib/forecast.ts); een week in de
// lopende maand krijgt het doorgetrokken maandtempo. Op 13 november stond daardoor de beursweek
// van 2 november, negen dagen voorbij, als "Prognose 106" in de strook, met "Deze week" en
// "Volgende week" ook op 106. De vraag van het blok is hoe de beursweek liep; "Prognose" las als
// de uitkomst. Een week die al begonnen is maar nog geen gerealiseerd cijfer heeft, is een
// schatting uit het maandtempo, en heet nu zo.

export type WeekSoort = "gerealiseerd" | "geschat" | "prognose";

export function weekSoort(week: { realized: number | null; weekStart: string }, vandaag: string): WeekSoort {
  if (week.realized !== null) return "gerealiseerd";
  return week.weekStart.slice(0, 10) <= vandaag.slice(0, 10) ? "geschat" : "prognose";
}

// Kort, want het label staat in een weekkaart naast het getal; de toelichting gaat in de title.
// "Geschat (maandtempo, maand nog open)" was langer dan de kaart breed is.
export const WEEK_SOORT_LABEL: Record<WeekSoort, string> = {
  gerealiseerd: "Gerealiseerd",
  geschat: "Geschat",
  prognose: "Prognose",
};

export const WEEK_SOORT_UITLEG: Record<WeekSoort, string | undefined> = {
  gerealiseerd: undefined,
  geschat: "Geschat uit het maandtempo: de week is begonnen, maar de maand is nog open en dus nog niet gerealiseerd.",
  prognose: "Prognose: de week is nog niet begonnen.",
};

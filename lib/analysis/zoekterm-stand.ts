// De zoektermtabel van de weekly: alleen de nieuwste stand, met de periode erbij.
//
// ads_search_terms_wasteful draagt per rij een stand in week_start (door de sync per maand gevuld,
// getWastefulSearchTermsByMonth; bij de echte klanten twee waarden, 1 maart en 1 april). De weekly
// haalde 500 rijen over ALLE standen, gesorteerd op kosten, onder de kop "laatste 30 dagen, top
// 30". Dezelfde term stond er dan twee keer in, en het model telde de bedragen op tot een
// "verspilling" zonder vaste periode naast een week van € 2.759,82 (doorlichting 13 november).

export interface ZoektermStand {
  /** De stand (week_start) van de rijen, of null als er geen rijen zijn. */
  stand: string | null;
  rijen: Array<Record<string, unknown>>;
}

/** De duurste `max` rijen van de nieuwste stand. */
export function laatsteZoektermStand(rijen: Array<Record<string, unknown>>, max = 30): ZoektermStand {
  const standVan = (r: Record<string, unknown>): string | null =>
    typeof r.week_start === "string" && r.week_start.length >= 10 ? r.week_start.slice(0, 10) : null;
  const stand = rijen.reduce<string | null>((m, r) => {
    const w = standVan(r);
    return w && (m == null || w > m) ? w : m;
  }, null);
  const gekozen = rijen
    .filter((r) => stand == null || standVan(r) === stand)
    .sort((a, b) => Number(b.cost ?? 0) - Number(a.cost ?? 0))
    .slice(0, max);
  return { stand, rijen: gekozen };
}

/** De kop boven de tabel: zegt welke stand het is en dat die niet de weekperiode is. */
export function zoektermKop(z: ZoektermStand, weekStart: string, weekEind: string): string {
  if (!z.stand) return "## Wasteful Search Terms (geen zoektermdata beschikbaar)";
  return `## Wasteful Search Terms (stand van ${z.stand}, top ${z.rijen.length} op cost; LET OP: dit is de periode van de zoektermsync, NIET de ${weekStart} t/m ${weekEind} van de weekcijfers. Tel deze bedragen niet op bij of af tegen de weekuitgaven.)`;
}

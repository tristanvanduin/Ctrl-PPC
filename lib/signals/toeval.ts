// Is een tekort aan conversies in een segment (een weekdag, een dagdeel) meer dan toeval?
//
// De weekdag-detector noemde een dag "structureel duur" zodra zijn CPA 1,6 keer het gemiddelde
// was. Bij 20 tot 40 conversies over acht weken gebeurt dat in ongeveer 80% van de gevallen op een
// account ZONDER enig weekdageffect: met drie tot zes conversies per weekdag is een dag met de helft
// daarvan gewoon pech. De route zette zo'n verhaal als voorstel in de wachtrij, en wie het opvolgde
// haalde budget weg van een willekeurige dag.
//
// De toets hier: als elke euro dezelfde kans op een conversie heeft, verwacht een segment
// (totaal conversies x zijn aandeel in de besteding) conversies. Het aantal dat hij werkelijk
// kreeg is dan ongeveer Poisson-verdeeld rond die verwachting. Pas als de kans op zo weinig of
// minder conversies kleiner is dan de significantiegrens, gecorrigeerd voor het aantal segmenten
// dat getoetst wordt (Bonferroni: wie zeven weekdagen bekijkt, vindt anders bijna altijd wel een
// "dure"), is het tekort meer dan toeval. Daarnaast een minimumvolume: onder de tien verwachte
// conversies per segment is er geen toets die iets zegt.

/** Onder dit aantal verwachte conversies in een segment is er geen uitspraak mogelijk. */
export const MIN_VERWACHTE_CONVERSIES = 10;
/** De kans op een vals alarm over alle getoetste segmenten samen. */
export const SIGNIFICANTIE = 0.05;

/** P(X <= k) voor X ~ Poisson(lambda), in log-ruimte zodat lambda in de honderden niet onderloopt. */
export function poissonKansHoogstens(k: number, lambda: number): number {
  if (!(lambda > 0)) return 1;
  const kk = Math.floor(k);
  if (kk < 0) return 0;
  let logTerm = -lambda; // log P(X = 0)
  let som = Math.exp(logTerm);
  for (let i = 1; i <= kk; i++) {
    logTerm += Math.log(lambda) - Math.log(i);
    som += Math.exp(logTerm);
  }
  return Math.min(1, som);
}

export interface ToevalToets {
  /** Verwachte conversies als het segment converteerde zoals de rest. */
  verwacht: number;
  /** De kans op zo weinig (of minder) conversies bij toeval. */
  p: number;
  /** Genoeg volume om iets te zeggen. */
  genoegVolume: boolean;
  /** Genoeg volume en p onder de gecorrigeerde grens. */
  significant: boolean;
}

/**
 * Toetst of een segment structureel te weinig conversies kreeg voor zijn besteding.
 *
 * @param conversies     wat het segment kreeg
 * @param bestedingAandeel zijn aandeel in de totale besteding (0..1)
 * @param totaalConversies alle conversies samen
 * @param aantalToetsen  hoeveel segmenten er getoetst worden (voor de correctie)
 */
export function toetsTekort(conversies: number, bestedingAandeel: number, totaalConversies: number, aantalToetsen: number): ToevalToets {
  const verwacht = totaalConversies * bestedingAandeel;
  const genoegVolume = verwacht >= MIN_VERWACHTE_CONVERSIES;
  const p = poissonKansHoogstens(conversies, verwacht);
  const grens = SIGNIFICANTIE / Math.max(1, aantalToetsen);
  return { verwacht, p, genoegVolume, significant: genoegVolume && p < grens };
}

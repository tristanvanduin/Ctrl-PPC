/**
 * Wie mag chatten. Het licentieslot voor de spar-assistent.
 *
 * ── DE BEIDE KANTEN ─────────────────────────────────────────────────────────
 *
 * De frontend verbergt de knop, de route weigert het verzoek. Alleen dat tweede is de controle;
 * het eerste is netheid. Een component die niet rendert is geen slot -- de route erachter is
 * bereikbaar met curl, en dat is precies wat er gebeurt zodra iemand de tool interessant vindt.
 *
 * De functies hieronder zijn zuiver en worden aan BEIDE kanten gebruikt. Dat is met opzet: twee
 * kopieën van dezelfde regel lopen uit elkaar zodra er één verandert, en dat is vanmiddag nog
 * gebeurd met de bureaugrens die wel in de routes zat en niet in de middleware.
 */

/** De licentievormen zoals ze in agencies.licentie staan (migratie 060). */
export type Licentie = "basis" | "premium" | "enterprise";

export const LICENTIES: readonly Licentie[] = ["basis", "premium", "enterprise"];

/**
 * Mag dit bureau de chat gebruiken?
 *
 * Een opsomming van wat er wél mag, en niet `!== "basis"`. Dat scheelt niets vandaag en alles op
 * de dag dat er een vierde licentievorm bijkomt: een regel die "alles behalve basis" zegt geeft
 * die nieuwe vorm stilzwijgend toegang, ook als dat een proefaccount is. Dezelfde afweging als bij
 * de doorverwijslijst in lib/domein.ts.
 */
export function magChatten(licentie: string | null | undefined): boolean {
  return licentie === "premium" || licentie === "enterprise";
}

/** Nette uitleg voor wie niet mag. Wordt zowel in de UI als in het API-antwoord gebruikt. */
export const GEEN_LICENTIE_TEKST =
  "De spar-assistent hoort bij Premium. Neem contact op om je bureau te upgraden.";

/**
 * Normaliseert wat er uit de database komt naar een bekende licentievorm.
 *
 * Onbekend wordt 'basis' en niet 'premium': als de waarde niet te plaatsen is, hoort de uitkomst
 * de minst ruime te zijn. Een fout in de andere richting geeft toegang weg op grond van een
 * typefout.
 */
export function normaliseerLicentie(waarde: unknown): Licentie {
  const tekst = String(waarde ?? "").toLowerCase().trim();
  return (LICENTIES as readonly string[]).includes(tekst) ? (tekst as Licentie) : "basis";
}

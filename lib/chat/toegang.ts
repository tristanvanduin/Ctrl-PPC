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

/**
 * De licentievormen zoals ze in agencies.licentie staan (migratie 071, was drie waarden in 060).
 * Volgorde is betekenisvol: RANG hieronder gebruikt de index als rang, laag naar hoog.
 */
export type Licentie = "basis" | "core" | "growth" | "scale" | "professional" | "enterprise";

export const LICENTIES: readonly Licentie[] =
  ["basis", "core", "growth", "scale", "professional", "enterprise"];

/** Rang per licentie, voor "heeft tenminste tier X". Zie heeftTenminste hieronder. */
const RANG: Record<Licentie, number> = Object.fromEntries(
  LICENTIES.map((l, i) => [l, i])
) as Record<Licentie, number>;

/**
 * Heeft dit bureau tenminste de gegeven tier? Rang-gebaseerd in plaats van een opsomming van
 * losse namen, want dat wordt bij zes tiers onleesbaar. Dat is GEEN "alles behalve basis"-regel
 * (zie de waarschuwing bij normaliseerLicentie): een onbekende waarde normaliseert eerst naar
 * 'basis' (rang 0) en zakt dus altijd onderaan, nooit stilzwijgend naar een hogere rang.
 */
export function heeftTenminste(licentie: string | null | undefined, minimum: Licentie): boolean {
  return RANG[normaliseerLicentie(licentie)] >= RANG[minimum];
}

/**
 * Mag dit bureau de chat gebruiken?
 *
 * ── DE GRENS OP 'growth' IS AFGELEID, NIET BESLOTEN ─────────────────────────
 *
 * Voor migratie 071 lag de grens op 'premium'. Van de vijf nieuwe tiers is 'growth' de enige die
 * het gedrag van vandaag ongewijzigd laat: het is de tier waar het demo-bureau (voorheen premium)
 * naartoe is gemigreerd, juist omdat growth de eerste tier is met een features-sprong boven basis
 * (cross-account inzichten). Welke tier chat ECHT hoort te ontgrendelen volgens de blueprint staat
 * nergens vastgelegd -- die noemt chat niet als apart onderdeel van een tier. Herijk deze grens
 * zodra dat besloten is.
 */
export function magChatten(licentie: string | null | undefined): boolean {
  return heeftTenminste(licentie, "growth");
}

/** Nette uitleg voor wie niet mag. Wordt zowel in de UI als in het API-antwoord gebruikt. */
export const GEEN_LICENTIE_TEKST =
  "De spar-assistent hoort bij Growth en hoger. Neem contact op om je bureau te upgraden.";

/**
 * Normaliseert wat er uit de database komt naar een bekende licentievorm.
 *
 * Onbekend wordt 'basis' en niet een hogere tier: als de waarde niet te plaatsen is, hoort de
 * uitkomst de minst ruime te zijn. Een fout in de andere richting geeft toegang weg op grond van
 * een typefout.
 */
export function normaliseerLicentie(waarde: unknown): Licentie {
  const tekst = String(waarde ?? "").toLowerCase().trim();
  return (LICENTIES as readonly string[]).includes(tekst) ? (tekst as Licentie) : "basis";
}

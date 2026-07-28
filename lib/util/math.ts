/**
 * Rekenhulpjes die overal hetzelfde antwoord moeten geven.
 *
 * Waarom dit bestaat: `safeDiv` stond vijf keer in de codebase, in drie gedragingen. Ze waren
 * het oneens over wat "veilig" betekent, en dat verschil was zichtbaar zodra de invoer niet
 * netjes was:
 *
 *   geval               vier van de vijf     de strengste
 *   negatieve noemer    -2,5                 null
 *   NaN in de teller    NaN                  null
 *   Infinity als noemer 0                    null
 *
 * Die laatste regel is de gevaarlijkste. `10 / Infinity` is 0, en een 0 leest als een meting:
 * "de CTR was 0%". In werkelijkheid was de noemer kapot. Datzelfde geldt voor een NaN die
 * doorstroomt — JSON.stringify maakt daar stilzwijgend `null` van, en dan is niet meer te zien
 * of er niets gemeten is of dat er iets is misgegaan.
 */

/**
 * Deling die null teruggeeft zodra de uitkomst geen betekenis heeft.
 *
 * De noemer moet positief en eindig zijn. In deze codebase zijn noemers tellingen (impressies,
 * klikken) of bedragen (spend); geen daarvan kan legitiem negatief zijn, dus een negatieve
 * noemer betekent kapotte data en geen bijzonder resultaat. De teller mag wel negatief zijn —
 * een gecorrigeerde conversiewaarde bijvoorbeeld — maar niet oneindig of NaN.
 *
 * Null betekent hier "niet te berekenen", en dat is iets anders dan nul. Dat onderscheid is de
 * hele reden dat deze functie een nullable teruggeeft.
 */
export function safeDiv(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const uitkomst = numerator / denominator;
  // Eindige invoer kan alsnog overlopen: 1e308 / 1e-308 is Infinity. Zonder deze controle glipt
  // dat er langs alle bovenstaande guards heen, en JSON.stringify maakt er vervolgens `null` van
  // — dan is niet meer te zien of er niets gemeten is of dat de berekening is doorgeschoten.
  return Number.isFinite(uitkomst) ? uitkomst : null;
}

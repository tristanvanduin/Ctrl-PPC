/**
 * Statistische hulpjes die overal hetzelfde antwoord moeten geven.
 *
 * Waarom dit bestaat: `median` stond zes keer in de codebase, in drie smaken. Vier plekken
 * filterden op eindige getallen en gaven null bij een lege reeks; forecast.ts gooide ook nullen
 * en negatieven weg en gaf 0; event-forecast.ts filterde niets en gaf NaN bij een lege reeks.
 * Dezelfde naam, hetzelfde begrip, drie uitkomsten — en niemand die aanriep wist welke.
 *
 * Het verschil was niet cosmetisch. In forecast.ts werd `median` gebruikt om de MAD te bepalen
 * (de mediane absolute afwijking, de maat voor "hoeveel wisselt deze reeks normaal"). Absolute
 * afwijkingen zijn nul zodra een waarde gelijk is aan de mediaan, en juist die nullen gooide het
 * filter weg. Gemeten op [100, 100, 100, 100, 300]: de MAD werd 200 in plaats van 0, waardoor de
 * uitschieterdrempel op 700 kwam te liggen in plaats van 250 en de 300 niet meer als uitschieter
 * werd gezien. Een reeks die stabiel is met één uitschieter is precies het geval waar deze
 * reparatie voor bedoeld is.
 */

/**
 * De mediaan van eindige getallen. Null als er niets te middelen valt.
 *
 * Nullen en negatieve waarden tellen gewoon mee: die zijn metingen, geen ontbrekende data. Wie
 * ze wil uitsluiten filtert op de aanroepplek, waar zichtbaar is waarom.
 */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * De mediane absolute afwijking: hoe ver ligt een typische waarde van de mediaan af.
 *
 * Robuuster dan de standaarddeviatie omdat één uitschieter hem niet meesleept — en dat is het
 * hele punt bij uitschieterdetectie. Null als de reeks leeg is.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const med = median(values);
  if (med === null) return null;
  return median(values.filter((v) => Number.isFinite(v)).map((v) => Math.abs(v - med)));
}

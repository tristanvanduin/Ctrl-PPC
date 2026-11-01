import { addMonths, type Month } from "@/lib/period/period-range";
import { addDays } from "@/lib/reporting-date";

/**
 * Het datumvenster van de maandrapportage: dertien maanden vóór de rapportmaand (de grafieken en
 * de jaar-op-jaarmaand) t/m de laatste dag van de rapportmaand, als DATE-strings.
 *
 * Met maandrekenen en niet met tekst plakken. De route schreef "-31" achter elke eindmaand en
 * rekende het begin met een modulo uit; in zes van de twaalf maanden was dat een datum die niet
 * bestaat ("2026-11-31", "2026-00-01"), en PostgreSQL weigert die op een DATE-kolom. De laatste
 * dag is de dag vóór de eerste van de volgende maand: dat kent geen maandlengte en geen
 * schrikkeljaar.
 */
export function rapportVenster(rapportMaand: Month): { van: string; tot: string } {
  return {
    van: `${addMonths(rapportMaand, -13)}-01`,
    tot: addDays(`${addMonths(rapportMaand, 1)}-01`, -1),
  };
}

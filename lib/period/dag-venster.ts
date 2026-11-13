// "Laatste N dagen" als kalenderdagen in Amsterdam, vandaag meegeteld.
//
// De campagnetabel op een kanaaltab rekende `Date.now() − 28 × 24 uur` in UTC en filterde met
// "vanaf": dat zijn 29 kalenderdagen. Op de Microsoft-tab stond daardoor € 957 onder "laatste 28
// dagen", naast € 924 in de kerncijfers van hetzelfde venster, precies één dag van € 33 verschil.
// De kerncijfers (channel-performance.tsx) tellen dagen met een leeftijd van 0 tot en met 27.

import { addDays } from "@/lib/reporting-date";

/** De eerste dag van een venster van `n` kalenderdagen dat op `vandaag` eindigt. */
export function eersteDagVanVenster(vandaag: string, n: number): string {
  return addDays(vandaag, -(Math.max(1, Math.floor(n)) - 1));
}

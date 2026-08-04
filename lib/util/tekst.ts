/**
 * Tekst die op meerdere plekken hetzelfde moet lezen.
 *
 * ── WAAROM DIT EEN EIGEN HUIS KRIJGT ────────────────────────────────────────
 *
 * De Nederlandse opsomming -- komma's tussen alles behalve het laatste paar, daar "en" -- stond op
 * drie plekken los uitgeschreven: in lib/kanalen/beschikbaar.ts, in lib/analysis/monthly-structured.ts
 * en (net toegevoegd) in lib/pmax/assetdekking.ts. Drie keer dezelfde regel is nog geen fout, maar
 * het is precies het patroon dat bij `median` en `safeDiv` wél tot drie verschillende gedragingen
 * leidde: de vierde kopie is degene die het nét anders doet.
 *
 * Daarom staat hij hier, en staat de naam in de GEDEELD-lijst van scripts/check-hygiene.mjs zodat
 * een vijfde kopie de poort niet haalt.
 */

/**
 * "a", "a en b", "a, b en c".
 *
 * Geen Oxford-komma: die hoort niet in het Nederlands. Een lege lijst geeft een lege tekst en geen
 * null -- de aanroeper weet zelf of "niets" betekent dat er geen zin hoort te staan, en dat is een
 * andere vraag dan hoe je een lijst opschrijft.
 */
export function opsomming(delen: readonly string[]): string {
  if (delen.length <= 1) return delen[0] ?? "";
  return `${delen.slice(0, -1).join(", ")} en ${delen[delen.length - 1]}`;
}

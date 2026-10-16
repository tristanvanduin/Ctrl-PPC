// Herkent of de bron van een databasefunctie iets verandert. Gebruikt door
// scripts/check-rpc-rechten.mjs; getest in lib/security/__rpc_mutatie_test.ts.
//
// Een eigen module omdat de controle zelf niet te testen is zonder live database, en omdat juist
// deze regel stuk bleek: `update\s+\w` gevolgd door \b matchte alleen een tabelnaam van één letter.

/** Woorden die alleen in een statement voorkomen dat iets verandert. */
export const MUTATIE = /\b(insert\s+into|update\s+\w+|delete\s+from|truncate|drop\s+(table|view|function|schema|index)|alter\s+(table|view|function|schema|default)|create\s+(table|view|function|index|or\s+replace)|grant\s|revoke\s)\b/i;

/**
 * Commentaar en tekstliteralen weg, zodat alleen echte code overblijft.
 *
 * Volgorde is significant: eerst de blokken, dan de regels, dan de literalen. Andersom zou een
 * apostrof in een commentaarregel de literaal-verwijdering laten ontsporen.
 */
export function alleenCode(bron) {
  return String(bron ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Muteert deze functiebron iets? */
export function muteert(bron) {
  return MUTATIE.test(alleenCode(bron));
}

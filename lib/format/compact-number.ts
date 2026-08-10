// Compacte getalnotatie in de "Executive Terminal"-stijl (Fase 5): "4.2M", niet "4.200.000" en
// niet de Nederlandse Intl-compacte vorm ("4,2 mln."). Bewust een eigen, kleine formatter in
// plaats van Intl.NumberFormat(locale, {notation:"compact"}): deze telt-widgets zijn een apart,
// internationaal ogend register (vergelijk een beursticker), los van de nl-NL-opmaak die de rest
// van het dashboard gebruikt. Puur en los getest.

function trimTrailingZero(v: string): string {
  return v.replace(/\.0$/, "");
}

/** "4.2M", "38K", "950" -- altijd maximaal 1 decimaal, geen duizendtal-scheiding onder 1000. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return sign + trimTrailingZero((abs / 1_000_000_000).toFixed(1)) + "B";
  if (abs >= 1_000_000) return sign + trimTrailingZero((abs / 1_000_000).toFixed(1)) + "M";
  if (abs >= 1_000) return sign + trimTrailingZero((abs / 1_000).toFixed(1)) + "K";
  return sign + String(Math.round(abs));
}

/** "€ 4.2M" -- de compacte notatie met een valutaprefix. */
export function compactCurrency(value: number, currencySymbol = "€"): string {
  return `${currencySymbol} ${compactNumber(value)}`;
}

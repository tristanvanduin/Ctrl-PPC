// Grafiek-kleuren, los van de merk-chrome. Datavisualisatie volgt een eigen functioneel palet:
// CATEGORISCHE series (bv. Google/Meta/LinkedIn) krijgen een vast, gevalideerd palet dat
// maximaal onderscheidbaar is — óók kleurenblind-veilig — en dus NIET meekleurt met het merk
// (een merk met twee tinten groen zou anders onleesbare series geven). De merkkleur gebruiken we
// alleen voor één-entiteit-metrieken (bv. de spend-balk van dít account), waar kleur identiteit
// is en geen categorische vergelijking.
//
// Het categorische palet is de gevalideerde referentievolgorde uit de dataviz-richtlijn
// (validate_palette.js: alle harde checks PASS in light-mode; CVD-veilig op de aangrenzende
// paren). Volgorde is de veiligheidsmechanisme — niet cosmetisch — dus niet herschikken.

export const CHART_CATEGORICAL = [
  "#2a78d6", // blauw
  "#eb6834", // oranje
  "#1baf7a", // aqua
  "#eda100", // geel
  "#e87ba4", // magenta
  "#008300", // groen
  "#4a3aa7", // violet
  "#e34948", // rood
] as const;

// Recessieve chrome voor grafieken (raster + as-tekst), consistent over alle charts.
export const CHART_GRID = "#eef1f6";
export const CHART_AXIS = "#64748b";

// De secondaire (lijn-)kleur naast een merk-gekleurde balk: altijd oranje, dat contrasteert met
// zowel een blauw als een groen merk-primary. De vorm (lijn vs balk) draagt het onderscheid mee.
export const CHART_LINE_SECONDARY = CHART_CATEGORICAL[1];

// ── Divergerende schaal ────────────────────────────────────────────────────
// Voor grootheden met een betekenisvol middelpunt: CPA of ROAS ten opzichte van het
// accountgemiddelde. Niet hetzelfde als de sequentiële blauw-ramp van de kaarten — daar betekent
// "licht" bijna nul, hier betekent het midden "precies gemiddeld", en dat moet als niets lezen.
//
// Twee tegengestelde polen plus een neutraal grijs midden, met even veel stappen per arm. Blauw
// en rood omdat die als tegengesteld lezen; twee koele tinten zouden geen tegenstelling geven.
//
// De warme pool is bewust de status-kleur "critical": in een heatmap bestaan geen series, dus
// er is niets dat een status-kleur hier kan imiteren, en "duurder dan gemiddeld" ís een
// status-achtige lezing. De koele pool is de donkerste stap van de blauw-ramp.
const DIVERGING_COOL = [24, 79, 149] as const;   // #184f95
const DIVERGING_WARM = [208, 59, 59] as const;   // #d03b3b
const DIVERGING_MID_LIGHT = [240, 239, 236] as const; // #f0efec
const DIVERGING_MID_DARK = [56, 56, 53] as const;     // #383835

const hex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

/**
 * Kleur voor een waarde op de divergerende schaal. `t` loopt van -1 (koele pool) via 0 (neutraal)
 * naar +1 (warme pool). Doordat we vanuit het midden naar de pool interpoleren is de lichtheid
 * per arm monotoon — dat is de eis voor een divergerende schaal.
 */
export function divergingColor(t: number, dark = false): string {
  const mid = dark ? DIVERGING_MID_DARK : DIVERGING_MID_LIGHT;
  const clamped = Math.max(-1, Math.min(1, t));
  const pole = clamped < 0 ? DIVERGING_COOL : DIVERGING_WARM;
  const f = Math.abs(clamped);
  return hex(mid.map((m, i) => m + (pole[i] - m) * f));
}

/** Relatieve luminantie (WCAG), zodat tekst op een gevulde cel altijd leesbaar blijft. */
function luminance(h: string): number {
  const n = h.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Inktkleur die op deze vulling het meeste contrast geeft. Berekend door beide kandidaten te
 * vergelijken, niet via een drempelwaarde: een drempel op het oog gekozen zit er bijna altijd
 * naast, en dan valt precies in de middentinten wit op een halfdonkere vulling — het geval waar
 * je het het minst ziet aankomen en het slechtst leest.
 *
 * Het echte omslagpunt ligt op luminantie ≈ 0,179; daar geven zwart en wit allebei 4,58:1, en dat
 * is meteen het laagste contrast dat op de hele schaal voorkomt.
 */
export function inkOn(fill: string): string {
  const l = luminance(fill);
  const withBlack = (l + 0.05) / 0.05;
  const withWhite = 1.05 / (l + 0.05);
  return withBlack >= withWhite ? "#0b0b0b" : "#ffffff";
}

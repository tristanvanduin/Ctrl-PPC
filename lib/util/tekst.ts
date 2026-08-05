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

/**
 * ── DE METRIEKNAAM ZOALS EEN MENS HEM LEEST ─────────────────────────────────
 *
 * `measurement_metric` is het veld waarin een hypothese vastlegt waarop hij afgerekend wordt. Dat
 * veld wordt door twee soorten bronnen gevuld en die schrijven het anders op:
 *
 *   - de signaaldetectoren en de demo zetten er de API-veldnaam in: `conversion_rate`, `ctr`,
 *     `one_click_leads`, `conversions`, `cost`;
 *   - het model zet er een zin in: "ROAS per land", "Herbeoordeling van dit controlepunt".
 *
 * Het scherm toonde beide onbewerkt. In de sprintplanning stond dus letterlijk `one_click_leads`
 * in de kolom Metrics, naast `conversion_rate` en `ctr` -- veldnamen uit de LinkedIn- en
 * Google-API, in een tabel die een klant over de schouder meeleest.
 *
 * Deze functie vertaalt alleen wat hij kent en laat de rest ONGEWIJZIGD door. Dat is met opzet:
 * een lijst die alles zou willen vertalen, verminkt de zinnen van het model, en dat is erger dan
 * een technische naam. Onbekend erin is hetzelfde eruit.
 */
const METRIEK_LABEL: Record<string, string> = {
  conversions: "conversies",
  conversion_rate: "conversieratio",
  conversion_value: "conversiewaarde",
  cost: "kosten",
  cpa: "CPA",
  cpc: "CPC",
  cpl: "CPL",
  cpm: "CPM",
  ctr: "CTR",
  clicks: "klikken",
  frequency: "frequentie",
  impressions: "vertoningen",
  impression_share: "impressieaandeel",
  leads: "leads",
  one_click_leads: "lead-formulieren",
  quality_score: "kwaliteitsscore",
  roas: "ROAS",
  spend: "spend",
  view_rate: "view rate",
};

export function metriekLabel(metriek: string | null | undefined): string | null {
  if (!metriek) return null;
  const sleutel = metriek.trim();
  if (!sleutel) return null;
  return METRIEK_LABEL[sleutel.toLowerCase()] ?? sleutel;
}

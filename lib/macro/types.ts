import type { Bedrijfsmodel } from "@/lib/benchmark/segment";

// ============================================================================
// AGENCY MACRO TRENDS: DE EIGEN PORTFOLIO VAN ÉÉN BUREAU, GESEGMENTEERD
// ============================================================================
//
// Dit is een ANDER probleem dan lib/benchmark/cel.ts. Cel.ts beslist of een cijfer
// CROSS-AGENCY gedeeld mag worden (anoniem, met een drempel op accounts én bureaus, want anders
// is één bureau met genoeg klanten al herleidbaar). Deze module telt niets bij elkaar op tussen
// bureaus: een macro trend is een bureau dat zijn EIGEN accounts optelt per segment, om te zien
// of iets een marktbrede beweging is (bijv. "heel mijn e-com portfolio -18%") in plaats van een
// probleem van dat ene account. Geen k-anonimiteit nodig -- een bureau mag zijn eigen data altijd
// zien, hoe klein het segment ook is. Vandaar dat `agencyId` hier verplicht in de sleutel zit: een
// cel die twee bureaus zou samenvoegen is een programmeerfout, geen productbeslissing.

export type MacroKanaal = string;

export interface MacroSleutel {
  agencyId: string;
  channel: MacroKanaal;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
  /** Eerste dag van de maand, "YYYY-MM-01". */
  maand: string;
}

export interface MacroMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  leads: number;
}

export interface MacroTrendCell {
  sleutel: MacroSleutel;
  metrics: MacroMetrics;
  /** Aantal verschillende klanten dat in deze cel meetelt. */
  accounts: number;
}

/** Eén rij zoals die uit blended_account_monthly + client_settings + accounts komt. */
export interface MacroInvoerRij {
  clientId: string;
  agencyId: string;
  channel: MacroKanaal;
  maand: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  leads: number;
}

/**
 * Ondergrens voordat een cel als "trend" leest in plaats van als "toevallig dat ene account".
 *
 * Geen privacydrempel zoals in cel.ts -- puur statistisch fatsoen. Een cel onder dit aantal wordt
 * niet verborgen (het is de eigen data van het bureau), maar een consument hoort hem niet als
 * portfoliobeweging te presenteren.
 */
export const MIN_ACCOUNTS_VOOR_TREND = 3;

export function magAlsTrendGelden(accounts: number): boolean {
  return accounts >= MIN_ACCOUNTS_VOOR_TREND;
}

/** Leesbaar segmentlabel voor een cel-sleutel. Gedeeld tussen MacroTrendsPreview en de nieuwe
 *  Agency God View (Fase 5) zodat hetzelfde segment overal hetzelfde label draagt. Structureel
 *  getypeerd (niet Pick<MacroSleutel, ...>): beide consumenten hebben hun eigen, losser getypeerde
 *  API-antwoordvorm (bedrijfsmodel als kale string, niet het Bedrijfsmodel-union), en deze functie
 *  doet toch niets specifieks met de union -- alleen een truthy-check en toUpperCase(). */
export function segmentLabel(s: { bedrijfsmodel: string | null; niche: string | null }): string {
  if (s.bedrijfsmodel && s.niche) return `${s.bedrijfsmodel.toUpperCase()} + ${s.niche}`;
  if (s.niche) return s.niche;
  if (s.bedrijfsmodel) return s.bedrijfsmodel.toUpperCase();
  return "Alle segmenten";
}

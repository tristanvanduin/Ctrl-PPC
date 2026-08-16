// Search Console insight layer — gedeelde types. Spiegelt lib/ga4/types.ts qua vorm en doctrine:
// GSC is GEEN los kanaal maar een verklarende/verificatielaag (MASTERPLAN sectie 5.6.0, rol A) die
// organisch zoekgedrag naast de betaalde kanalen legt. Alle consumers werken uitsluitend op deze
// genormaliseerde shapes; alleen lib/search-console/data-access raakt de echte GSC-API aan.

// Beschikbaarheid van de GSC-data voor een klant. "absent" ⇒ de tool draait volledig door zonder
// GSC (geen valse zekerheid) — zelfde doctrine als Ga4Availability.
export type GscAvailability = "live" | "mock" | "absent";

// Per-klant Search Console-configuratie (uit client_settings.search_console_config). brandTerms is
// met opzet handmatige invoer van het bureau, nooit afgeleid uit Ads-campagnenamen — zie migratie
// 095 se opmerking over waarom dat de hele waarde van de merk-cannibalisatie-detector zou ondermijnen.
export interface GscConfig {
  siteUrl: string;
  brandTerms: string[];
}

// Eén rij uit searchAnalytics.query, met dimensies query+page+date (de fijnste combinatie die de
// detectoren nodig hebben; bredere aggregaties worden in de detectoren zelf opgebouwd).
export interface GscQueryRow {
  date: string; // YYYY-MM-DD
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1, zoals GSC 'm teruggeeft
  position: number; // gemiddelde positie, 1 = bovenaan
}

export interface GscDataset {
  availability: GscAvailability;
  config: GscConfig | null;
  rows: GscQueryRow[];
  limitations: string[]; // mensleesbare beperkingen (bv. "laatste 2-3 dagen ontbreken, dataState=final")
}

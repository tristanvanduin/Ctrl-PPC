// De maandrijen per kanaal voor "Alle kanalen": de kanaaltabel, de staven en de kanaalring.
// Zuiver, geen IO.
//
// WAAROM DIT BESTAAT
//
// Die drie blokken lazen blended_account_monthly, elk met een eigen verzoek. Die view telt de
// STANDAARDselectie van conversies (lib/analysis/channel-conversion-config.ts) en kent geen
// Microsoft, terwijl de kerncijfers, de pacing en het jaaroverzicht op hetzelfde tabblad uit
// /api/blended/client-data komen: de dagtabellen met de selectie van de klant, Microsoft erbij.
// Eén tabblad, twee tellingen. De route stuurt per kanaal-maand al de tellers mee (perKanaal),
// dus de tabel hoeft niets meer op te halen en kan niet meer van de band afwijken.
//
// De rijvorm is die van de view (maandbegin, kanaalsleutel met _ads), zodat de lezers hun
// labels, kleuren en de betrouwbaarheidsregel houden.

import type { BlendedKanaalReeks } from "@/lib/api/blended-historical";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";
import type { ChannelKey } from "./lens-facts";

/**
 * Van de kanaalnaam van het dashboard ("google") naar de kanaalsleutel van de cross-channel-laag
 * ("google_ads"). Geen tabel: de sleutel IS de naam plus "_ads", en het type dwingt af dat dat zo
 * blijft (een nieuw Kanaal zonder bijbehorende ChannelKey compileert niet).
 */
export function channelKeyVanKanaal(kanaal: Kanaal): ChannelKey {
  return `${kanaal}_ads`;
}

/** Eén maand van één kanaal, in de vorm die de view had. Onafgerond. */
export interface KanaalMaandRij {
  /** Het maandbegin, "YYYY-MM-01": zo stond de `month`-kolom er, en zo filtert de ring erop. */
  month: string;
  channel: ChannelKey;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversion_value: number;
}

/**
 * perKanaal uit de blended route als platte rijen: nieuwste maand eerst, binnen een maand de
 * kanalen in de volgorde van de route (Google, Meta, LinkedIn, Microsoft).
 */
export function kanaalMaandRijen(perKanaal: readonly BlendedKanaalReeks[]): KanaalMaandRij[] {
  const rijen: KanaalMaandRij[] = [];
  for (const reeks of perKanaal) {
    const channel = channelKeyVanKanaal(reeks.kanaal);
    for (const m of reeks.maanden) {
      rijen.push({
        month: `${m.month.slice(0, 7)}-01`,
        channel,
        impressions: m.impressions ?? 0,
        clicks: m.clicks ?? 0,
        spend: m.adSpend,
        conversions: m.conversions,
        conversion_value: m.revenue,
      });
    }
  }
  // Stabiel: bij gelijke maand blijft de volgorde van de route staan.
  return rijen.sort((a, b) => b.month.localeCompare(a.month));
}

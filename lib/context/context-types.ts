// EXECUTION_PLAN.md Stap 5: Context Intelligence, alleen interfaces en een mapping. Geen
// implementatie die iets analyseert: dat is Fase 2, en zie context-engine.ts voor waarom een
// lege functie erger is dan geen functie.
//
// AI MAG ACCOUNT-SPECIFIEKE BUSINESS EVENTS NIET VERZINNEN. businessEventsUitRaiEvents hieronder
// is een doorvertaling van wat een gebruiker zelf heeft ingevuld (client_settings.rai_events),
// nooit een gok of aanvulling. Een events-lijst die leeg is, blijft leeg.
//
// DE ENIGE HARDE BRON DIE VANDAAG BESTAAT
//
// client_settings.rai_events (JSONB, migratie 024), met cadans annual/biennial/custom en een
// lijst edities met datum en label. Gelezen door lib/fair/use-upcoming-edition.ts en de
// geo-clone-route; geschreven door components/dashboard/event-settings.tsx.
//
// sop_client_context bestaat ook, met valid_from/valid_until/impact_on_analysis, maar heeft NUL
// rijen. Leeg is niet hetzelfde als afwezig: hij is bruikbaar, alleen nooit gevuld.
//
// Een client_business_events-tabel met eventType, expectedImpact, confidence en createdBy vergt
// een eigen migratie. Niet in deze stap: dit bestand leest uitsluitend wat er al is.

import type { FairEventCfg } from "@/lib/fair/fair-weeks";
import type { BusinessEvent, ContextAnalysis } from "@/lib/decision/types";

// Herexport, geen tweede definitie: ContextAnalysis en BusinessEvent staan in
// lib/decision/types.ts, dit bestand voegt alleen de mapping toe.
export type { ContextAnalysis, BusinessEvent };

/**
 * Vertaalt de rai_events van een klant naar BusinessEvent[]. Puur: geen IO, geen database-call.
 *
 * Edge cases die expliciet afgevangen worden, niet stilzwijgend:
 * - een event zonder id of zonder naam is geen bruikbaar event (event-settings.tsx seedt een
 *   nieuw, nog niet opgeslagen event met een lege naam) en wordt overgeslagen, niet met een
 *   verzonnen waarde aangevuld;
 * - een editie zonder datum (dezelfde seed-vorm) telt niet mee.
 */
export function businessEventsUitRaiEvents(
  events: FairEventCfg[],
  agencyId: string,
  accountId: string
): BusinessEvent[] {
  return events
    .filter((e): e is FairEventCfg & { id: string; name: string } => Boolean(e.id) && Boolean(e.name?.trim()))
    .map((e) => ({
      agencyId,
      accountId,
      id: e.id,
      name: e.name.trim(),
      cadence: e.cadence ?? null,
      editions: (e.editions ?? [])
        .filter((ed) => Boolean(ed.date))
        .map((ed) => ({ date: ed.date, label: ed.label?.trim() || ed.date.slice(0, 4) })),
    }));
}

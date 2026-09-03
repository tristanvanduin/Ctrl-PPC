// De datapoort van de kanaalanalyses (weekly/biweekly voor Meta, LinkedIn, Microsoft): als het
// analysevenster leeg is, zeg dan WAAR de data ophoudt en of de sync überhaupt draait.
//
// WAAROM DIT BESTAAT
//
// De zes kanaalblokken in weekly en biweekly riepen checkDataFreshness aan, en die zegt bij
// een lege tabel letterlijk "Geen Google Ads data in Supabase" -- over een Meta-analyse. Met de
// dagstand (lib/sync/datastand.ts) wordt het "Geen bruikbare Meta-dagdata. De Meta-sync draait
// niet: data t/m 2026-04-17, 139 dagen geleden; nog nooit een geslaagde sync geregistreerd." Dat
// is een 409 (de sync staat stil of is nooit gekoppeld); een venster dat toevallig leeg is
// terwijl er wel recente data staat blijft een 404.

import type { SupabaseClient } from "@supabase/supabase-js";
import { markProgressFailed } from "@/lib/progress/server";
import { dagstandVoorKlant, dagstandBlokkade, DAGKANAAL_LABEL, type Dagkanaal, type Dagstand } from "@/lib/sync/datastand";

/** Puur: melding en HTTP-status uit de dagstand, los getest. */
export function kanaalDatapoort(stand: Dagstand): { melding: string; status: 404 | 409; action: string } {
  const label = DAGKANAAL_LABEL[stand.kanaal];
  const blokkade = dagstandBlokkade(stand);
  const action = stand.toestand === "geen"
    ? `Koppel het ${label}-account aan deze klant (Instellingen → Kanaalkoppelingen per klant) en start een backfill.`
    : `Start een sync via POST /api/sync/${stand.kanaal} of controleer de ${label}-koppeling van het bureau (Instellingen → Koppelingen).`;
  if (blokkade) return { melding: blokkade, status: 409, action };
  return { melding: `Geen ${label}-dagdata in het analysevenster. ${stand.tekst}`, status: 404, action };
}

export async function kanaalDataOntbreekt(supabase: SupabaseClient, clientId: string, jobId: string, kanaal: Dagkanaal): Promise<Response> {
  const stand = await dagstandVoorKlant(supabase, clientId, kanaal);
  const poort = kanaalDatapoort(stand);
  await markProgressFailed(supabase, { jobId, errorMessage: poort.melding });
  return Response.json({ error: poort.melding, datastand: stand, action: poort.action }, { status: poort.status });
}

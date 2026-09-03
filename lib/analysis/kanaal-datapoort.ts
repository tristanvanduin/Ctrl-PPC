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
import {
  dagstandVoorKlant, dagstandBlokkade, kanaalMaandstandVoorKlant, datastandBlokkade, DAGKANAAL_LABEL,
  type Dagkanaal, type Dagstand, type Datastand, type DatastandToestand,
} from "@/lib/sync/datastand";

/** De weg naar herstel, afhankelijk van of er ooit iets gekoppeld is. */
function kanaalActie(kanaal: Dagkanaal, toestand: DatastandToestand): string {
  const label = DAGKANAAL_LABEL[kanaal];
  return toestand === "geen"
    ? `Koppel het ${label}-account aan deze klant (Instellingen → Kanaalkoppelingen per klant) en start een backfill.`
    : `Start een sync via POST /api/sync/${kanaal} of controleer de ${label}-koppeling van het bureau (Instellingen → Koppelingen).`;
}

/** Puur: melding en HTTP-status uit de dagstand, los getest. */
export function kanaalDatapoort(stand: Dagstand): { melding: string; status: 404 | 409; action: string } {
  const label = DAGKANAAL_LABEL[stand.kanaal];
  const blokkade = dagstandBlokkade(stand);
  const action = kanaalActie(stand.kanaal, stand.toestand);
  if (blokkade) return { melding: blokkade, status: 409, action };
  return { melding: `Geen ${label}-dagdata in het analysevenster. ${stand.tekst}`, status: 404, action };
}

/** Puur: de maandpoort van de kanaalmaandanalyse. Null als er gedraaid kan worden. */
export function kanaalMaandpoort(stand: Datastand, kanaal: Dagkanaal): { melding: string; action: string } | null {
  const blokkade = datastandBlokkade(stand);
  if (!blokkade) return null;
  return { melding: blokkade, action: kanaalActie(kanaal, stand.toestand) };
}

/**
 * De maandpoort voor de kanaalmaandanalyses (monthly voor Meta, LinkedIn, Microsoft). Tot
 * 3 september 2026 hadden die geen poort: op een lege tabel maakten ze een voortgangsjob aan,
 * schreven per stap een "runtime-fallback"-rij weg en meldden de run als voltooid -- een holle
 * analyse die de cross-channel-synthese en de beslislaag vervolgens als echt lazen. Null als de
 * analysemaand data heeft; anders de 409 met de stand, en de job op failed.
 */
export async function kanaalMaandDataOntbreekt(supabase: SupabaseClient, clientId: string, jobId: string, kanaal: Dagkanaal): Promise<Response | null> {
  const stand = await kanaalMaandstandVoorKlant(supabase, clientId, kanaal);
  const poort = kanaalMaandpoort(stand, kanaal);
  if (!poort) return null;
  await markProgressFailed(supabase, { jobId, errorMessage: poort.melding });
  return Response.json({ error: poort.melding, datastand: stand, action: poort.action }, { status: 409 });
}

export async function kanaalDataOntbreekt(supabase: SupabaseClient, clientId: string, jobId: string, kanaal: Dagkanaal): Promise<Response> {
  const stand = await dagstandVoorKlant(supabase, clientId, kanaal);
  const poort = kanaalDatapoort(stand);
  await markProgressFailed(supabase, { jobId, errorMessage: poort.melding });
  return Response.json({ error: poort.melding, datastand: stand, action: poort.action }, { status: poort.status });
}

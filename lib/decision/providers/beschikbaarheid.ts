// Gedeelde isAvailable() voor de drie kanalen met een synctabel (google, meta, linkedin).
// Leunt op dezelfde KANAAL_BRON die de kanaaltabs in lib/kanalen/beschikbaar.ts gebruiken om te
// bepalen of een tabblad zin heeft: heeft een klant daar een rij, dan is er data om te tonen.
// Geen nieuwe brontabel verzinnen voor iets dat de UI al bepaalt.
//
// EXECUTION_PLAN.md Stap 3's eigen commentaar wees hier al naartoe (isAvailable() moet leunen op
// laadBeschikbareKanalen() uit lib/kanalen/beschikbaar.ts) -- die functienaam bestaat niet
// letterlijk, maar KANAAL_BRON is precies de tabel-per-kanaal-kennis die daarvoor nodig was.

import { getSupabase } from "@/lib/analysis/helpers";
import { KANAAL_BRON, type Kanaal } from "@/lib/kanalen/beschikbaar";

export async function heeftKanaalData(kanaal: Kanaal, accountId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const bron = KANAAL_BRON[kanaal];
  const { data } = await supabase.from(bron.tabel).select(bron.kolom).eq("client_id", accountId).limit(1);
  return (data?.length ?? 0) > 0;
}

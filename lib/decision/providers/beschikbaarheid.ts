// Gedeelde isAvailable() voor de kanalen met een synctabel. Leunt op dezelfde KANAAL_BRON die de
// kanaaltabs in lib/kanalen/beschikbaar.ts gebruiken om te bepalen of een tabblad zin heeft:
// heeft een klant daar een rij, dan is er data om te tonen. Geen nieuwe brontabel verzinnen voor
// iets dat de UI al bepaalt.
//
// De Supabase-client komt van de aanroeper (demo-bewust, injecteerbaar in tests). Een queryfout
// gooit DataLaagFout: "geen rij" en "de query faalde" zijn twee verschillende antwoorden, en de
// oude `const { data }` maakte van allebei "kanaal afwezig".

import type { SupabaseClient } from "@supabase/supabase-js";
import { KANAAL_BRON, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { eis } from "@/lib/analysis/db-veilig";

export async function heeftKanaalData(supabase: SupabaseClient, kanaal: Kanaal, accountId: string): Promise<boolean> {
  const bron = KANAAL_BRON[kanaal];
  const res = await supabase.from(bron.tabel).select(bron.kolom).eq("client_id", accountId).limit(1);
  return eis(res, `${bron.tabel} (beschikbaarheid ${kanaal})`).length > 0;
}

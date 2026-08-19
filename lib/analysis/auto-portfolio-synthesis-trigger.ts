// Portfolio-synthese (cross-account) automatisch laten meelopen bij elke monthly-afronding,
// dezelfde reden en hetzelfde patroon als lib/analysis/auto-cross-channel-trigger.ts: "elke maand
// analyse moet cross channel pakken als cross channel mogelijk is, cross account als er meerdere
// accounts zijn en er betaald is, en god view als er betaald is -- allemaal moeten automatisch
// zijn." Cross-channel had al zo'n koppeling; cross-account (portfolio-synthese) had er GEEN --
// de enige manier om hem te draaien was een losse, handmatige aanroep van
// /api/analysis/portfolio-synthesis, en nergens in de app staat daar een knop voor.
//
// runPortfolioSynthesis() zelf is al veilig om onvoorwaardelijk aan te roepen -- hij controleert
// intern (lib/analysis/portfolio-synthesis.ts): minder dan MIN_CLIENTS klanten, al vandaag
// gesynthetiseerd, of nog niet genoeg klanten met een vers eindverhaal. Wat hij NIET zelf checkt
// is de licentie-tier ("er betaald is") -- dat is in de bestaande handmatige route
// (app/api/analysis/portfolio-synthesis/route.ts) een aparte stap vóór de aanroep, dus die stap
// staat ook hier apart, zodat een agency zonder Growth-tier nooit een LLM-call kost.
//
// Faalt zacht: een mislukte of overgeslagen synthese mag de hoofdanalyse van dit kanaal nooit
// laten mislukken -- eigen try/catch, logt, gooit nooit door.
//
// God View: geen koppeling hier. De klantzijdige, tier-gated "God View"-module bestaat nog niet
// (lib/marketing/modules.ts markeert hem gebouwd:false; zie ook de kop van
// app/api/platform/god-view/route.ts). Wat vandaag "God View" heet (/api/platform/god-mode) is
// een intern platform-beheer-scherm zonder tier-gate, geen klantfeature -- daar is niets aan een
// monthly-run te koppelen, want het leest al live uit blended_account_monthly zonder een eigen
// trigger nodig te hebben.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenRouterKey } from "./helpers";
import { runPortfolioSynthesis } from "./portfolio-synthesis";
import { heeftTenminste } from "@/lib/chat/toegang";
import { lijstAccountsMetSops } from "@/lib/tenancy/sop-dekking";
import { lastCompleteMonth } from "@/lib/period/period-range";
import { today } from "@/lib/reporting-date";
import { logger } from "@/lib/logger";

function periodBounds(): { start: string; end: string } {
  const month = lastCompleteMonth(); // "YYYY-MM"
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10);
  return { start, end };
}

export async function triggerPortfolioSynthesisIfReady(supabase: SupabaseClient, clientId: string): Promise<void> {
  try {
    const apiKey = getOpenRouterKey();
    if (!apiKey) return; // geen sleutel geconfigureerd: stil overslaan, geen foutmelding richting de hoofdanalyse

    const { data: account } = await supabase.from("accounts").select("agency_id").eq("client_id", clientId).maybeSingle();
    const agencyId = account?.agency_id ? String(account.agency_id) : null;
    if (!agencyId) return; // geen bureau gekoppeld (bijv. nog geen accounts-rij): niets om te synthetiseren

    const { data: bureau } = await supabase.from("agencies").select("licentie").eq("id", agencyId).maybeSingle();
    if (!bureau || !heeftTenminste(bureau.licentie, "growth")) return; // "er betaald is": zelfde tier-gate als de handmatige route

    const clientIds = await lijstAccountsMetSops(supabase, agencyId);
    if (!clientIds || clientIds.length < 2) return; // "meerdere accounts": runPortfolioSynthesis() zou dit ook zelf afvangen, maar zo geen onnodige naam-lookup bij 0/1 klant

    const { data: accountRows } = await supabase.from("accounts").select("client_id, name").eq("agency_id", agencyId).in("client_id", clientIds);
    const clients = (accountRows ?? []).map((r) => ({ clientId: String(r.client_id), clientName: String(r.name ?? r.client_id) }));

    const { start, end } = periodBounds();
    const result = await runPortfolioSynthesis({
      supabase, apiKey, agencyId, clients,
      analysisDate: today(), periodStart: start, periodEnd: end,
    });

    if (!result.skipped) {
      logger.info(`[auto-portfolio-synthesis] synthese getriggerd voor bureau ${agencyId} (${result.tokensUsed} tokens, model ${result.model})`);
    }
  } catch (err) {
    logger.error(`[auto-portfolio-synthesis] mislukt voor ${clientId}, hoofdanalyse blijft ongemoeid:`, err instanceof Error ? err.message : String(err));
  }
}

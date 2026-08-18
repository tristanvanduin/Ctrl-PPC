// Kanaaloverstijgende synthese automatisch laten meelopen bij elke maandanalyse, in plaats van
// een apart, handmatig te onthouden knopje (masterplan 17.12 bouwde de synthese zelf, maar
// koppelde 'm alleen aan een losse route -- /api/analysis/cross-channel-synthesis -- die niets
// vanzelf aanriep. De eigenaar wees dit aan als de reden dat cross-channel-synthese amper werd
// getest: "elke maand analyse moet cross channel pakken als cross channel mogelijk is").
//
// runCrossChannelSynthesis() zelf is al veilig om onvoorwaardelijk aan te roepen -- hij controleert
// intern (in deze volgorde, allemaal goedkoop, vóór er ooit een LLM-call gebeurt): minder dan 2
// gekoppelde kanalen, al gesynthetiseerd vandaag, of nog niet alle kanalen deze cyclus klaar. Dit
// bestand voegt daar dus geen nieuwe voorwaarde aan toe -- het roept 'm alleen daadwerkelijk aan,
// vanaf elk van de drie plekken waar een kanaal zijn maandanalyse afrondt (Google inline in
// app/api/analysis/monthly/route.ts, en de eigen runMetaMonthlyAnalysis/runLinkedinMonthlyAnalysis
// in datzelfde bestand). Welk kanaal toevallig als laatste die dag afrondt, is degene bij wie de
// synthese echt gebeurt; de eerdere kanalen krijgen een goedkope skip.
//
// Faalt zacht: een mislukte of overgeslagen synthese mag de hoofdanalyse van dit kanaal nooit
// laten mislukken -- vandaar dat dit een losse, geïsoleerde aanroep is die zijn eigen fouten vangt
// en logt, nooit gooit.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenRouterKey } from "./helpers";
import { runCrossChannelSynthesis } from "./cross-channel-synthesis";
import { runLiteCrossChannelSynthesis, type LiteCadence } from "./cross-channel-synthesis-lite";
import { laadBeschikbareKanalen } from "@/lib/kanalen/beschikbaar";
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

export async function triggerCrossChannelSynthesisIfReady(supabase: SupabaseClient, clientId: string): Promise<void> {
  try {
    const apiKey = getOpenRouterKey();
    if (!apiKey) return; // geen sleutel geconfigureerd: stil overslaan, geen foutmelding richting de hoofdanalyse

    // "as never": zelfde workaround als de bestaande /api/analysis/cross-channel-synthesis-route
    // al gebruikt -- laadBeschikbareKanalen's structurele parametertype geeft TS bij een volle
    // SupabaseClient anders "Type instantiation is excessively deep and possibly infinite".
    const beschikbareKanalen = await laadBeschikbareKanalen(supabase as never, clientId);
    const { start, end } = periodBounds();

    const result = await runCrossChannelSynthesis({
      supabase, apiKey, clientId, beschikbareKanalen,
      analysisDate: today(), periodStart: start, periodEnd: end,
    });

    if (!result.skipped) {
      logger.info(`[auto-cross-channel] synthese getriggerd voor ${clientId} (${result.tokensUsed} tokens, model ${result.model})`);
    }
  } catch (err) {
    logger.error(`[auto-cross-channel] mislukt voor ${clientId}, hoofdanalyse blijft ongemoeid:`, err instanceof Error ? err.message : String(err));
  }
}

// 17.30: dezelfde onvoorwaardelijke, faalzachte aanroep als hierboven, maar voor de lichte
// weekly/biweekly-synthese (cross-channel-synthesis-lite.ts) -- eigen periode per cadence, want
// weekly's venster (14 dagen) en biweekly's venster (3 maanden) zijn geen van beide "de laatste
// volledige kalendermaand" die periodBounds() hierboven berekent.
export async function triggerLiteCrossChannelSynthesisIfReady(
  supabase: SupabaseClient,
  clientId: string,
  cadence: LiteCadence,
  periodStart: string,
  periodEnd: string
): Promise<void> {
  try {
    const apiKey = getOpenRouterKey();
    if (!apiKey) return;

    const beschikbareKanalen = await laadBeschikbareKanalen(supabase as never, clientId);

    const result = await runLiteCrossChannelSynthesis({
      supabase, apiKey, clientId, cadence, beschikbareKanalen,
      analysisDate: today(), periodStart, periodEnd,
    });

    if (!result.skipped) {
      logger.info(`[auto-cross-channel-lite] ${cadence}-synthese getriggerd voor ${clientId} (${result.tokensUsed} tokens, model ${result.model})`);
    }
  } catch (err) {
    logger.error(`[auto-cross-channel-lite] ${cadence}-synthese mislukt voor ${clientId}, hoofdanalyse blijft ongemoeid:`, err instanceof Error ? err.message : String(err));
  }
}

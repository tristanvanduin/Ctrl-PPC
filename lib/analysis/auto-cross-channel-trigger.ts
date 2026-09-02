// Kanaaloverstijgende synthese automatisch laten meelopen bij elke maandanalyse, in plaats van
// een apart, handmatig te onthouden knopje (masterplan 17.12 bouwde de synthese zelf, maar
// koppelde 'm alleen aan een losse route -- /api/analysis/cross-channel-synthesis -- die niets
// vanzelf aanriep. De eigenaar wees dit aan als de reden dat cross-channel-synthese amper werd
// getest: "elke maand analyse moet cross channel pakken als cross channel mogelijk is").
//
// runCrossChannelSynthesis() zelf is al veilig om onvoorwaardelijk aan te roepen -- hij controleert
// intern (in deze volgorde, allemaal goedkoop, vóór er ooit een LLM-call gebeurt): minder dan 2
// gekoppelde kanalen, minder dan 2 kanalen met een maandanalyse binnen het cyclusvenster, een
// kanaal dat te ver achterloopt op de nieuwste run, of een synthese die de nieuwste run al dekt.
// Dit bestand voegt daar dus geen nieuwe voorwaarde aan toe -- het roept 'm alleen daadwerkelijk
// aan, vanaf elk van de plekken waar een kanaal zijn maandanalyse afrondt (Google inline in
// app/api/analysis/monthly/route.ts, en de eigen runMetaMonthlyAnalysis/runLinkedinMonthlyAnalysis
// in datzelfde bestand). Welk kanaal toevallig als laatste afrondt, is degene bij wie de synthese
// echt gebeurt; de eerdere kanalen krijgen een goedkope skip.
//
// Faalt zacht: een mislukte of overgeslagen synthese mag de hoofdanalyse van dit kanaal nooit
// laten mislukken -- vandaar dat dit een losse, geïsoleerde aanroep is die zijn eigen fouten vangt
// en logt, nooit gooit. Maar "zacht" is niet "stil": een DataLaagFout (een kapotte query, geen
// ontbrekende data) krijgt zijn eigen logregel met de bron erbij, zodat een maandenlang falende
// synthese in de logs te onderscheiden is van "er was gewoon nog maar één kanaal klaar".

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenRouterKey } from "./helpers";
import { runCrossChannelSynthesis } from "./cross-channel-synthesis";
import { runLiteCrossChannelSynthesis, type LiteCadence } from "./cross-channel-synthesis-lite";
import { DataLaagFout, laatsteAfgeslotenMaandGrenzen } from "./db-veilig";
import { laadBeschikbareKanalen } from "@/lib/kanalen/beschikbaar";
import { today } from "@/lib/reporting-date";
import { logger } from "@/lib/logger";

function logFout(scope: string, clientId: string, err: unknown): void {
  if (err instanceof DataLaagFout) {
    logger.error(`${scope} databron faalde voor ${clientId} (${err.context}): ${err.oorzaak} -- hoofdanalyse blijft ongemoeid`);
    return;
  }
  logger.error(`${scope} mislukt voor ${clientId}, hoofdanalyse blijft ongemoeid:`, err instanceof Error ? err.message : String(err));
}

export async function triggerCrossChannelSynthesisIfReady(supabase: SupabaseClient, clientId: string): Promise<void> {
  try {
    const apiKey = getOpenRouterKey();
    if (!apiKey) return; // geen sleutel geconfigureerd: stil overslaan, geen foutmelding richting de hoofdanalyse

    // "as never": zelfde workaround als de bestaande /api/analysis/cross-channel-synthesis-route
    // al gebruikt -- laadBeschikbareKanalen's structurele parametertype geeft TS bij een volle
    // SupabaseClient anders "Type instantiation is excessively deep and possibly infinite".
    const beschikbareKanalen = await laadBeschikbareKanalen(supabase as never, clientId);
    // Wandklok versus afgesloten maand, bewust uit elkaar: analysis_date is vandaag (Amsterdam),
    // de periode is de laatste afgesloten kalendermaand -- dezelfde grenzen als de maandroutes.
    const { start, eind } = laatsteAfgeslotenMaandGrenzen();

    const result = await runCrossChannelSynthesis({
      supabase, apiKey, clientId, beschikbareKanalen,
      analysisDate: today(), periodStart: start, periodEnd: eind,
    });

    if (!result.skipped) {
      logger.info(`[auto-cross-channel] synthese getriggerd voor ${clientId} (${result.tokensUsed} tokens, model ${result.model}, kanalen ${result.dekking.kanalen.map((k) => `${k.channel}@${k.analysisDate}`).join(", ")})`);
    }
  } catch (err) {
    logFout("[auto-cross-channel]", clientId, err);
  }
}

// 17.30: dezelfde onvoorwaardelijke, faalzachte aanroep als hierboven, maar voor de lichte
// weekly/biweekly-synthese (cross-channel-synthesis-lite.ts) -- eigen periode per cadence, want
// weekly's venster (14 dagen) en biweekly's venster (3 maanden) zijn geen van beide "de laatste
// volledige kalendermaand" die de maandtrigger hierboven gebruikt.
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
    logFout(`[auto-cross-channel-lite] ${cadence}-synthese`, clientId, err);
  }
}

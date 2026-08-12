import type { SupabaseClient } from "@supabase/supabase-js";
import { computeAnalysisTargets } from "@/lib/analysis/compute-targets";
import { computeHealthScore } from "@/lib/health-score";
import {
  detecteerNieuweGebruiker, beoordeelAccount, FORECAST_AANHOUDEND_MAANDEN,
  type AccountSignalen,
} from "./account-stoplicht";
import { beoordeelCodeRood, type CodeRoodOordeel } from "./code-rood";

// De IO-kant van Code Rood/Amber: verzamelt de ECHTE signalen voor één klant uit bestaande
// server-side databronnen en beoordeelt ze. De pure logica (account-stoplicht.ts, code-rood.ts)
// verandert hier niet mee -- dit bestand levert alleen de input aan.
//
// METRIEKKEUZE: conversies, niet omzet of adSpend. account-stoplicht.ts laat expliciet aan de
// aanroeper over welke metric telt ("afhankelijk van het geconfigureerde primaire doel van het
// account, zie determineAccountType/buildGoalsSection in lib/prompts/sop-prompts.ts"). Die weg
// vergt een live Google Ads-credentialscall (lib/analysis/helpers.ts) puur om vast te stellen
// WELKE metric een account voert -- te zwaar voor een nachtelijke detectiejob over alle klanten.
// Conversies is de metric die health-score.ts's eigen Trend-factor ook al leunt op
// (projectionFactor). Een doelbewustere keuze per account is een latere verfijning, geen
// blokkade om dit vandaag te laten draaien.
//
// VOLLEDIGE CHANGE-HISTORY, GEEN VENSTER OP DE QUERY: detecteerNieuweGebruiker heeft "bekende"
// historie nodig van VOOR het nieuwe-gebruiker-venster (30 dagen) om vast te stellen wie al
// langer meedraait. Een query die zelf al op bijvoorbeeld 90 dagen afkapt, zou iedereen wiens
// enige eerdere wijziging langer geleden was ten onrechte als "nieuw" laten binnenkomen. Voor
// een account met jaren historie is dit dus zwaarder dan het zou kunnen zijn -- een cache van
// "bekende e-mailadressen per klant" is een reele latere optimalisatie, geen blokkade.

export async function beoordeelKlant(
  supabase: SupabaseClient,
  clientId: string,
): Promise<CodeRoodOordeel | null> {
  const targets = await computeAnalysisTargets(supabase, clientId);
  if (!targets) return null;

  const gerealiseerd = targets.forecast.conversions.points.filter((p) => p.realized !== null);
  const laatsten = gerealiseerd.slice(-FORECAST_AANHOUDEND_MAANDEN);
  const forecastSignaal = laatsten.length >= FORECAST_AANHOUDEND_MAANDEN
    ? { afwijkingenPct: laatsten.map((p) => Math.round((p.monthRatio - 1) * 100)) }
    : null;

  const { data: wijzigingen } = await supabase
    .from("ads_change_history")
    .select("change_datetime, user_email, resource_type, change_type")
    .eq("client_id", clientId);

  const nieuweGebruikerSignaal = detecteerNieuweGebruiker(
    (wijzigingen ?? []).map((w: { change_datetime: string; user_email: string | null; resource_type: string | null; change_type: string | null }) => ({
      changeDatetime: w.change_datetime,
      userEmail: w.user_email,
      resourceType: w.resource_type,
      changeType: w.change_type,
    })),
  );

  const signalen: AccountSignalen = { forecast: forecastSignaal, nieuweGebruiker: nieuweGebruikerSignaal };
  const account = beoordeelAccount(signalen);
  const health = computeHealthScore(targets.forecast);

  return beoordeelCodeRood(account, health);
}

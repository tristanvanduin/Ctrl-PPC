// De pure due-beslissing voor het automatische SOP-triggeren (nightly cron, klaargezet maar niet
// actief -- zie app/api/cron/trigger-sops/route.ts).
//
// Bewust GEEN gebruik van isDueToday/AnalysisSchedule uit ./core.ts: die is per-account
// geconfigureerd (day_of_month, enabled-vlag) en uitsluitend voor de monthly-cadans ontworpen --
// er bestaat geen day_of_month-equivalent voor weekly/biweekly, en er is geen kolom of route die
// een AnalysisSchedule ooit daadwerkelijk opslaat of leest (alleen de eigen test importeert
// isDueToday, zie docs/MASTERPLAN.md sectie 2.2's les over aannames die de code niet overleven).
// Dit bestand kiest een eenvoudiger, kanaalneutraal criterium dat voor alle drie de cadansen
// werkt zonder nieuw schema: hoe lang geleden de laatste run was, af te lezen uit
// sop_analysis_output.analysis_date -- dezelfde datum die de handmatige knoppen al tonen als
// "Laatst: {datum}" (components/insights/sop-trigger-buttons.tsx).

/** Weekly is due na 7 dagen zonder run, biweekly na 14. Monthly is geen vaste intervaltelling
 *  (zie isMonthlyDue) omdat kalendermaanden van lengte verschillen. */
export const WEEKLY_INTERVAL_DAYS = 7;
export const BIWEEKLY_INTERVAL_DAYS = 14;

function dagenSindsISO(lastRunDate: string | null, now: Date): number | null {
  if (!lastRunDate) return null;
  const laatste = new Date(`${lastRunDate}T00:00:00Z`);
  if (Number.isNaN(laatste.getTime())) return null;
  const vandaag = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((vandaag.getTime() - laatste.getTime()) / (24 * 3600 * 1000));
}

/** Nooit gedraaid -> due. Anders due zodra er minstens `intervalDays` dagen tussen zitten. */
export function isIntervalDue(lastRunDate: string | null, intervalDays: number, now: Date): boolean {
  const dagen = dagenSindsISO(lastRunDate, now);
  if (dagen === null) return true;
  return dagen >= intervalDays;
}

/** Monthly is due zodra de laatste run in een andere kalendermaand viel dan vandaag (of er nog
 *  nooit een run was) -- geen vaste dagteller, want februari en januari zijn geen gelijke maten
 *  en de monthly-route rekent zelf al met "laatst afgesloten kalendermaand". Deze functie beslist
 *  alleen OF er dit board al gedraaid is, niet WELKE periode geanalyseerd wordt -- dat blijft de
 *  eigen berekening van app/api/analysis/monthly/route.ts. */
export function isMonthlyDue(lastRunDate: string | null, now: Date): boolean {
  if (!lastRunDate) return true;
  const laatste = new Date(`${lastRunDate}T00:00:00Z`);
  if (Number.isNaN(laatste.getTime())) return true;
  return laatste.getUTCFullYear() !== now.getUTCFullYear() || laatste.getUTCMonth() !== now.getUTCMonth();
}

export type SopCadence = "weekly" | "biweekly" | "monthly";

/** De ene ingang die de drie hierboven samenvat, zodat een aanroeper niet zelf per cadans hoeft
 *  te kiezen welke functie erbij hoort. */
export function isSopDue(cadence: SopCadence, lastRunDate: string | null, now: Date): boolean {
  if (cadence === "weekly") return isIntervalDue(lastRunDate, WEEKLY_INTERVAL_DAYS, now);
  if (cadence === "biweekly") return isIntervalDue(lastRunDate, BIWEEKLY_INTERVAL_DAYS, now);
  return isMonthlyDue(lastRunDate, now);
}

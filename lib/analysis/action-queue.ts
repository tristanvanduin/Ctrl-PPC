// Fase 3 (docs/MASTERPLAN.md sectie 9): de pure beslisregel achter de action queue's
// retry-beleid, apart van app/api/cron/process-action-queue/route.ts zodat hij met vaste
// waarden te testen is zonder database of tijd — zelfde vorm als beoordeelPlafond() in
// uitgavenplafond.ts (leesX/beoordeelX puur, controleerX/route.ts doet de I/O).
//
// Beleid, letterlijk uit migratie 004's kolomcommentaar op generation_jobs.attempts: "failed met
// attempts 0 gaat na minimaal 30 minuten terug naar pending met attempts 1; een tweede
// mislukking is definitief." attempts telt dus mislukkingen, niet claim-pogingen.

export type MislukkingsUitkomst =
  | { actie: "opnieuw_inplannen"; attempts: number; scheduledFor: string; bericht: string }
  | { actie: "definitief_mislukt"; attempts: number };

export function beslisMislukkingsactie(
  huidigeAttempts: number,
  errorMessage: string,
  backoffMinuten: number,
  nu: Date = new Date()
): MislukkingsUitkomst {
  if (huidigeAttempts < 1) {
    const scheduledFor = new Date(nu.getTime() + backoffMinuten * 60 * 1000).toISOString();
    return {
      actie: "opnieuw_inplannen",
      attempts: huidigeAttempts + 1,
      scheduledFor,
      bericht: `Mislukt, wordt over ${backoffMinuten} minuten opnieuw geprobeerd: ${errorMessage}`,
    };
  }
  return { actie: "definitief_mislukt", attempts: huidigeAttempts + 1 };
}

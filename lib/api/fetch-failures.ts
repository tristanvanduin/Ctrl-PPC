// Ophaalfouten zichtbaar maken zonder de aanroepers te dwingen ze af te handelen.
//
// HET PROBLEEM
//
// De 24 getters in google-ads.ts eindigen op `catch { return []; }` — zonder logregel, zonder
// signaal. Een netwerkfout, een quota-limiet en een verlopen token zijn daardoor niet te
// onderscheiden van "deze klant heeft geen zoekwoorden". Dat is de duurste soort stilte: de
// analyse meldt "geen data beschikbaar", de mens gaat zoeken waarom de klant geen zoekwoorden
// heeft, en niemand kijkt naar de sync.
//
// WAAROM NIET GEWOON GOOIEN
//
// De getters worden vanuit tien plekken aangeroepen, waaronder UI-routes waar een leeg paneel de
// juiste degradatie is. En in de orchestrator zitten dertig getters in één Promise.all: één throw
// legt daar alle dertig om. Het teruggeven van [] blijft dus het juiste gedrag; alleen mag het
// niet langer geruisloos.
//
// HOE
//
// AsyncLocalStorage draagt een verzamelaar mee door de aanroepketen. De sync opent er één per run,
// de getters schrijven erin, en de orchestrator leest hem uit om datasets als mislukt te markeren.
// Zo hoeft geen enkele functiesignatuur een extra parameter te krijgen, en twee klanten die
// tegelijk synchroniseren zitten elkaar niet in de weg — iets wat een module-globale array wél
// zou doen.
//
// Buiten een run is er geen verzamelaar en gebeurt er niets extra's; alleen de logregel blijft.

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@/lib/logger";

export interface FetchFailure {
  /** De getter die faalde, bv. "getKeywordPerformanceByMonth". */
  source: string;
  message: string;
  at: string;
}

const store = new AsyncLocalStorage<FetchFailure[]>();

/**
 * Draait `fn` met een eigen verzamelaar. Geeft het resultaat terug plus de fouten die tijdens de
 * uitvoering zijn opgetreden — ook die welke onderweg zijn opgeslikt.
 */
export async function withFetchFailures<T>(fn: () => Promise<T>): Promise<{ result: T; failures: FetchFailure[] }> {
  const failures: FetchFailure[] = [];
  const result = await store.run(failures, fn);
  return { result, failures };
}

/**
 * Noteert een opgeslikte ophaalfout. Logt altijd — ook zonder actieve verzamelaar, want een
 * stille catch is precies wat we hier wegnemen.
 *
 * `channel` is puur voor de logregel (welk kanaal faalde) -- oorspronkelijk alleen voor
 * google-ads.ts gebouwd, vandaar de default. Meta/LinkedIn geven hun eigen kanaal mee zodat een
 * mislukte Meta-call niet als "[google-ads] ... faalde" in de logs staat.
 */
export function recordFetchFailure(source: string, err: unknown, channel: string = "google-ads"): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`[${channel}] ${source} faalde: ${message}`);
  store.getStore()?.push({ source, message, at: new Date().toISOString() });
}

/** De fouten die tot nu toe binnen de lopende run zijn opgetreden. */
export function currentFetchFailures(): FetchFailure[] {
  return [...(store.getStore() ?? [])];
}

/** Is deze specifieke getter gefaald binnen de lopende run? */
export function hasFetchFailure(source: string): boolean {
  return (store.getStore() ?? []).some((f) => f.source === source);
}

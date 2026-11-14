// Het tijdbudget van een invocatie van app/api/cron/trigger-sops: wat er nog past voordat het
// platform de functie afbreekt.
//
// ── HET PROBLEEM ─────────────────────────────────────────────────────────────
//
// De cronroute roept /api/analysis/{weekly,biweekly,monthly} aan op de eigen origin en WACHT op het
// antwoord: hij heeft de uitvoer nodig voor de upload naar Bestanden. Die analyse-routes hebben
// maxDuration 600; de cronroute had 300. Gemeten in generation_jobs (afgeronde runs vanaf
// 1 augustus 2026, completed_at - started_at): biweekly 4 van 14 boven 300 s (max 508), monthly 2
// van 21 (max 390), weekly 1 van 16 (max 303). Dat zijn knop- en testruns: de cron is nooit gepland
// geweest en triggered_by was overal leeg. Het is dus een VERWACHTING, geen waarneming: bij 7 van die
// 51 runs zou de cron hebben afgebroken terwijl de analyse zelf doorliep, zonder upload,
// cross-channel, PDF-check of JSON-overzicht.
//
// Twee grenzen, niet een. De eerste is de maxDuration van de cronroute zelf (deze module). De
// tweede zit in fetch: undici, waar de globale fetch van Node op draait, breekt een verzoek af als
// er na 300 s nog geen headers zijn (UND_ERR_HEADERS_TIMEOUT), en de analyse-routes sturen pas aan
// het eind headers (Response.json). Een hogere maxDuration of een ruimere AbortSignal.timeout
// verandert daar niets aan. Daarom wacht de cron niet met fetch maar met interneAanroep
// (lib/scheduler/interne-aanroep.ts, node:http zonder headers-timeout); de regels hieronder gaan
// ervan uit dat dat zo is.
//
// ── DE REGEL ────────────────────────────────────────────────────────────────
//
// Een wachtende aanroeper moet minstens zo lang mogen leven als wat hij aanroept. Dus:
//
//   1. Een analyse start alleen als het RESTANT van deze invocatie de volle maxDuration van de
//      analyse-route (ANALYSE_MAX_DUUR_S) plus de upload erna (UPLOAD_MARGE_S) dekt. Niet de gemeten
//      duur: die is een verdeling, de maxDuration is een harde grens -- langer kan de analyse niet
//      lopen, het platform breekt hem dan zelf af. Zo past een gestarte analyse binnen deze
//      invocatie, ook de traagste (mits er gewacht wordt zonder headers-timeout, zie hierboven).
//   2. Een vervolgstap (cross-channel, synthese, PDF) krijgt als timeout wat er nog over is, en
//      start niet meer onder VERVOLG_MIN_S. Hij wordt dan uitgesteld, niet overgeslagen: de
//      PDF-check leest de stand in de database en pakt het bij de volgende invocatie op, en de
//      synthese start de maandroute ook zelf in zijn after().
//   3. Er blijft altijd EINDMARGE_S over om het JSON-overzicht terug te geven.
//
// Met maxDuration 300 dekt het restant nooit 600 + 30: onder deze regel kon de oude instelling geen
// enkele analyse gegarandeerd afmaken (de test zegt dat letterlijk). Vandaar maxDuration 800 op de
// route: het maximum van Vercel Pro met Fluid Compute. Zie de kop van de route voor de onderbouwing
// van het plan.
//
// Zuiver: geen klok, geen fetch. De route geeft Date.now() mee.

/** maxDuration van /api/analysis/{weekly,biweekly,monthly}. Langer kan een analyse niet duren. */
export const ANALYSE_MAX_DUUR_S = 600;
/** De markdown naar Storage en twee client_files-queries: in de praktijk een paar seconden. */
export const UPLOAD_MARGE_S = 30;
/** Om het JSON-overzicht te schrijven voordat het platform afbreekt. */
export const EINDMARGE_S = 15;
/** Onder dit restant start er geen vervolgstap of nieuwe klant meer. De PDF-route deed er gemeten
 *  hooguit 9 s over (pdf_generation in generation_jobs), cross-channel is deterministisch. */
export const VERVOLG_MIN_S = 30;

export interface Tijdbudget {
  /** Wanneer de invocatie begon (ms sinds epoch). */
  startMs: number;
  /** De maxDuration van de route, in seconden. */
  maxDuurS: number;
}

export function maakTijdbudget(maxDuurS: number, startMs: number): Tijdbudget {
  return { startMs, maxDuurS };
}

/** Wat er nog over is tot de eindmarge, in ms. Kan negatief zijn. */
export function resterendMs(budget: Tijdbudget, nuMs: number): number {
  return budget.startMs + (budget.maxDuurS - EINDMARGE_S) * 1000 - nuMs;
}

/** Past een volledige analyse plus upload nog, ook als de analyse zijn hele maxDuration nodig heeft? */
export function magAnalyseStarten(budget: Tijdbudget, nuMs: number): boolean {
  return resterendMs(budget, nuMs) >= (ANALYSE_MAX_DUUR_S + UPLOAD_MARGE_S) * 1000;
}

/** De timeout voor het wachten op een analyse: het restant min de upload. Null als hij niet past. */
export function analyseTimeoutMs(budget: Tijdbudget, nuMs: number): number | null {
  return magAnalyseStarten(budget, nuMs) ? resterendMs(budget, nuMs) - UPLOAD_MARGE_S * 1000 : null;
}

/** De timeout voor een vervolgstap, of null als er te weinig over is om hem te beginnen. */
export function vervolgTimeoutMs(budget: Tijdbudget, nuMs: number): number | null {
  const rest = resterendMs(budget, nuMs);
  return rest >= VERVOLG_MIN_S * 1000 ? rest : null;
}

export type DueBeslissing =
  | { soort: "starten"; timeoutMs: number }
  | { soort: "uitgesteld"; reden: "limiet" | "tijd" };

/**
 * Wat er met een due item gebeurt: starten (met de timeout voor het wachten erop), of uitstellen
 * omdat de batch vol is (`limit`) of omdat de tijd hem niet meer dekt. Beide uitgestelde items komen
 * terug als "due_deferred"; de volgende invocatie pakt ze op. Beslissing en timeout komen uit
 * hetzelfde `nuMs`: twee klokken konden op de grens "starten" geven met een timeout van nul.
 */
export function beslisDueItem(inp: { getriggerd: number; limit: number; budget: Tijdbudget; nuMs: number }): DueBeslissing {
  if (inp.getriggerd >= inp.limit) return { soort: "uitgesteld", reden: "limiet" };
  const timeoutMs = analyseTimeoutMs(inp.budget, inp.nuMs);
  if (timeoutMs === null) return { soort: "uitgesteld", reden: "tijd" };
  return { soort: "starten", timeoutMs };
}

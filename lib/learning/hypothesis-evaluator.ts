// =====================================================================
// STATUS: gewired sinds commit 1a557ff (16 juli): app/api/cron/evaluate-hypotheses/route.ts
// roept deze evaluator aan op de weekdata van het kanaal van de hypothese. Die route staat NIET in
// vercel.json (zie de kop daar): hij draait alleen als iemand hem aanroept. Deze regel zei
// eerder "nog niet gewired" -- dat klopte niet meer sinds die route bestaat en was daarmee
// zelf een van de redenen dat de kolomfout hieronder zo lang onopgemerkt bleef: wie deze
// kop las nam aan dat er niets aan te controleren viel.
// =====================================================================
// ============================================================
// H1: hypothese-evaluator, de deterministische kern
// ------------------------------------------------------------
// Velt na het meetvenster een verdict over een hypothese door elk success- en
// guardrail-predicaat tegen de baseline te toetsen, en bepaalt of de actie
// aantoonbaar is uitgevoerd. Volledig deterministisch, geen LLM.
//
// No-go's uit de spec, hier afgedwongen:
// - Geen causaliteitsclaims: we meten of de metrics binnen het venster conform
//   de verwachting bewogen, niet of de actie dat veroorzaakte.
// - Geen evaluatie zonder baseline.
// - Het verdict wordt altijd SAMEN met de uitvoeringsstatus gerapporteerd, want
//   "verworpen maar niet uitgevoerd" is een andere les dan "uitgevoerd en verworpen".
// ============================================================

const MIN_WINDOW_IMPRESSIONS = 100; // onder dit volume is een oordeel niet betrouwbaar
const EXPIRY_DAYS = 45; // open en onmeetbaar ouder dan dit verloopt
const STABLE_BAND = 0.05; // standaard band voor richting "stable" (5 procent van baseline)

// no_drop is een guardrail: de metric mag niet meer dan `threshold` dalen. Bedoeld voor volume,
// zodat een CPA die daalt omdat de helft van de conversies wegvalt niet als geslaagd telt.
export type PredicateDirection = "increase" | "decrease" | "above" | "below" | "stable" | "no_drop";

export interface Predicate {
  metric: string;
  direction: PredicateDirection;
  threshold?: number; // above/below: absolute grens; increase/decrease: minimale magnitude (optioneel); stable: band-fractie; no_drop: toegestane daling
  /**
   * De ruisband bij increase/decrease ZONDER drempel: de beweging moet groter zijn dan dit om te
   * tellen. Zonder ruisband gold m < b, en dan was een CPA van 25,00 naar 24,99 "gehaald" -- een
   * oordeel dat ook door toeval elke tweede keer uitkomt. De aanroeper leidt hem af uit de
   * week-op-week-spreiding van de baseline (evaluate-hypothesis-row.ts).
   */
  noiseBand?: number;
}

export type Verdict = "accepted" | "rejected" | "unmeasurable" | "expired";
export type ExecutionStatus = "detected" | "not_executed" | "unknown";

export interface MetricJudgment {
  metric: string;
  kind: "success" | "guardrail";
  baseline: number | null;
  measured: number | null;
  delta: number | null;
  predicate: string; // leesbare omschrijving
  met: boolean | null; // null = niet te evalueren (metric of grens ontbreekt)
}

export interface HypothesisOutcome {
  verdict: Verdict;
  reason?: string;
  metrics: MetricJudgment[];
}

export interface EvaluateInput {
  successPredicates: Predicate[];
  guardrailPredicates: Predicate[];
  baseline: Record<string, number>;
  measured: Record<string, number>;
  windowImpressions: number;
  entityActive: boolean;
  ageInDays: number;
}

function describe(p: Predicate): string {
  const t = p.threshold;
  switch (p.direction) {
    case "increase": return t != null ? `${p.metric} stijgt met minimaal ${t}` : p.noiseBand != null ? `${p.metric} stijgt meer dan de ruisband (${p.noiseBand.toFixed(2)})` : `${p.metric} stijgt`;
    case "decrease": return t != null ? `${p.metric} daalt met minimaal ${t}` : p.noiseBand != null ? `${p.metric} daalt meer dan de ruisband (${p.noiseBand.toFixed(2)})` : `${p.metric} daalt`;
    case "above": return `${p.metric} boven ${t}`;
    case "below": return `${p.metric} onder ${t}`;
    case "stable": return `${p.metric} stabiel`;
    case "no_drop": return `${p.metric} daalt niet meer dan ${t ?? 0}`;
  }
}

// Evalueert een predicaat. met=null als de metric of een vereiste grens ontbreekt.
function judge(p: Predicate, kind: "success" | "guardrail", baseline: Record<string, number>, measured: Record<string, number>): MetricJudgment {
  const b = baseline[p.metric];
  const m = measured[p.metric];
  const haveB = typeof b === "number" && Number.isFinite(b);
  const haveM = typeof m === "number" && Number.isFinite(m);
  const delta = haveB && haveM ? m - b : null;
  const base: MetricJudgment = {
    metric: p.metric, kind,
    baseline: haveB ? b : null,
    measured: haveM ? m : null,
    delta,
    predicate: describe(p),
    met: null,
  };

  if (p.direction === "above" || p.direction === "below") {
    if (!haveM || p.threshold == null) return base; // absolute grens vereist een gemeten waarde en een drempel
    base.met = p.direction === "above" ? m >= p.threshold : m <= p.threshold;
    return base;
  }

  // increase/decrease/stable zijn relatief aan de baseline
  if (!haveB || !haveM) return base;
  if (p.direction === "increase") {
    base.met = p.threshold != null ? (m - b) >= p.threshold : p.noiseBand != null ? (m - b) > p.noiseBand : m > b;
  } else if (p.direction === "decrease") {
    base.met = p.threshold != null ? (b - m) >= p.threshold : p.noiseBand != null ? (b - m) > p.noiseBand : m < b;
  } else if (p.direction === "no_drop") {
    base.met = (b - m) <= (p.threshold ?? 0);
  } else { // stable
    const band = p.threshold != null ? p.threshold : Math.abs(b) * STABLE_BAND;
    base.met = Math.abs(m - b) <= band;
  }
  return base;
}

/**
 * Velt het verdict over een hypothese. Volgorde van poorten:
 * 1. Entiteit inactief of volume te laag, geen baseline: onmeetbaar (of verlopen bij ouderdom).
 * 2. Een success-metric niet te evalueren: onmeetbaar.
 * 3. Alle success-predicaten gehaald en geen guardrail aantoonbaar geschonden: geaccepteerd.
 * 4. Anders: verworpen.
 */
export function evaluateHypothesisOutcome(input: EvaluateInput): HypothesisOutcome {
  const successJ = input.successPredicates.map((p) => judge(p, "success", input.baseline, input.measured));
  const guardrailJ = input.guardrailPredicates.map((p) => judge(p, "guardrail", input.baseline, input.measured));
  const metrics = [...successJ, ...guardrailJ];

  const expiredIfStuck = (reason: string): HypothesisOutcome =>
    input.ageInDays > EXPIRY_DAYS ? { verdict: "expired", reason: `${reason}, en ouder dan ${EXPIRY_DAYS} dagen`, metrics }
      : { verdict: "unmeasurable", reason, metrics };

  if (!input.entityActive) return expiredIfStuck("entiteit gepauzeerd of niet actief");
  if (input.windowImpressions < MIN_WINDOW_IMPRESSIONS) {
    return expiredIfStuck(`onvoldoende volume (${input.windowImpressions} vertoningen, minimaal ${MIN_WINDOW_IMPRESSIONS})`);
  }

  const unevaluableSuccess = successJ.find((j) => j.met === null);
  if (unevaluableSuccess) {
    return expiredIfStuck(`success-metric niet te meten (${unevaluableSuccess.metric})`);
  }

  const allSuccessMet = successJ.every((j) => j.met === true);
  const guardrailViolated = guardrailJ.some((j) => j.met === false); // alleen aantoonbare schending telt
  const verdict: Verdict = allSuccessMet && !guardrailViolated ? "accepted" : "rejected";
  return { verdict, metrics };
}

// ── Uitvoeringsdetectie ─────────────────────────────────────────────────────

export interface ChangeEvent {
  type: string; // budget, status_paused, bid, keyword_added, keyword_excluded, ...
  entity: string;
  date: string;
  detail?: string;
}

// Interventie-trefwoorden naar change-event-types. Deterministisch.
const INTENT_MAP: { keywords: RegExp; types: string[] }[] = [
  { keywords: /budget|dagbudget/i, types: ["budget"] },
  { keywords: /pauzeer|pauzeren|zet uit|uitzetten|stopzetten|pause/i, types: ["status_paused"] },
  { keywords: /\bbod\b|bieding|bidstrategie|\bbid\b|doel-?cpa|tcpa|troas/i, types: ["bid"] },
  { keywords: /zoekwoord toevoegen|toevoegen als zoekwoord|keyword.*toevoeg/i, types: ["keyword_added"] },
  { keywords: /uitsluiten|uitsluiting|negatief|negative/i, types: ["keyword_excluded"] },
];

export function intendedTypes(intervention: string): string[] {
  const out = new Set<string>();
  for (const rule of INTENT_MAP) {
    if (rule.keywords.test(intervention)) rule.types.forEach((t) => out.add(t));
  }
  return [...out];
}

/**
 * Bepaalt of de interventie aantoonbaar is uitgevoerd, door de bedoelde
 * wijziging te matchen tegen change-history-events op dezelfde entiteit.
 * Zonder dekking (bijvoorbeeld LinkedIn) altijd unknown; nooit ten onrechte
 * not_executed als er geen change-history is.
 */
export function detectExecution(
  intervention: string,
  entityName: string,
  changeEvents: ChangeEvent[],
  hasCoverage: boolean
): { status: ExecutionStatus; evidence: string | null } {
  if (!hasCoverage) return { status: "unknown", evidence: null };

  const types = intendedTypes(intervention);
  const sameEntity = changeEvents.filter((e) => e.entity && entityName && e.entity.toLowerCase() === entityName.toLowerCase());

  // Als de interventie geen herkenbaar type heeft, val terug op elke wijziging op de entiteit.
  const match = types.length > 0
    ? sameEntity.find((e) => types.includes(e.type))
    : sameEntity[0];

  if (match) {
    return { status: "detected", evidence: `${match.type} op ${match.entity} (${match.date})` };
  }
  return { status: "not_executed", evidence: null };
}

/**
 * Accountbrede variant van detectExecution. sprint_hypotheses draagt geen entiteit-referentie
 * (zie de kop van app/api/cron/evaluate-hypotheses/route.ts), dus een exacte entity-match zoals
 * detectExecution die vraagt is voor de meeste hypotheses niet mogelijk. Deze functie vraagt niet
 * WELKE campagne is aangepast, alleen OF er ergens in het account een wijziging van het bedoelde
 * type is doorgevoerd, ongeacht wie: specialist, tool of script.
 *
 * Zonder herkenbaar type in de interventietekst is er niets specifieks om aan te toetsen, en
 * zonder entity is er niets om op te filteren -- "er gebeurde iets op het account" is geen
 * signaal. Dat geeft unknown, geen gok.
 */
export function detectExecutionAccountWide(
  intervention: string,
  changeEvents: ChangeEvent[],
  hasCoverage: boolean
): { status: ExecutionStatus; evidence: string | null } {
  if (!hasCoverage) return { status: "unknown", evidence: null };

  const types = intendedTypes(intervention);
  if (types.length === 0) return { status: "unknown", evidence: null };

  const match = changeEvents.find((e) => types.includes(e.type));
  if (match) {
    return { status: "detected", evidence: `${match.type} op ${match.entity} (${match.date})` };
  }
  return { status: "not_executed", evidence: null };
}

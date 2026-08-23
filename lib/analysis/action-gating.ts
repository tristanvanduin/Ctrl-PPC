/**
 * Post-processing action gating.
 *
 * Deterministically downgrades recommendations that violate gating rules:
 * - direct_action requires evidence_level=deterministic + confidence=high
 * - small waste amounts (<€50) should not be direct_action
 * - conflicting actions on the same entity get downgraded
 * - low confidence findings cannot generate direct_action recommendations
 */

import type { Finding, Recommendation } from "../schema/analysis-schema";

/** Leest de huidige readiness. Elke regel leest opnieuw; zie de opmerking in applyActionGating. */
function readinessOf(rec: Recommendation): string | undefined {
  return (rec as Record<string, unknown>).action_readiness as string | undefined;
}

function setReadiness(rec: Recommendation, waarde: string): void {
  (rec as Record<string, unknown>).action_readiness = waarde;
}

/**
 * Metrieken waarvan de waarde een bedrag in euro's is.
 *
 * De kleine-signalen-drempel hieronder is bedoeld als "er staat te weinig geld op het spel om
 * dit automatisch te doen". Die vraag heeft alleen betekenis bij een bedrag. Zonder deze
 * controle werd `current_value` van elke metriek als euro's gelezen, en dan is een ROAS van 4,2
 * of een CTR van 0,05 altijd "minder dan 50 euro".
 */
const BEDRAG_METRIEKEN = /^(cost|spend|kosten|budget|uitgaven|revenue|omzet|conversions?_value|conversiewaarde|waarde)$/i;

/**
 * Ontbreekt de metriek, dan is niet vast te stellen of het om een bedrag gaat en grijpt de
 * drempel niet in. Het schema vereist het veld wel, maar deze objecten komen uit LLM-uitvoer via
 * een herstelpad, dus hier niet op vertrouwen.
 */
function isBedrag(metric: string | null | undefined): boolean {
  return typeof metric === "string" && BEDRAG_METRIEKEN.test(metric.trim());
}

/** Onder dit bedrag is de inzet te klein om zonder mens op te handelen. */
const KLEIN_BEDRAG_EUR = 50;

/**
 * Metrieken die een kliktelling zijn (geen ratio zoals CTR/CPC, die "click" ook in de naam
 * kunnen dragen maar geen telling zijn). Whole-string match zoals BEDRAG_METRIEKEN hierboven.
 */
const KLIKTELLING_METRIEKEN = /^(clicks?|link_clicks?|unique_clicks?|klikken?)$/i;

function isKliktelling(metric: string | null | undefined): boolean {
  return typeof metric === "string" && KLIKTELLING_METRIEKEN.test(metric.trim());
}

/**
 * F5 fase2.5: LinkedIn heeft doorgaans een klein klikvolume (vaak een fractie van Meta/Google).
 * Onder dit aantal klikken is een direct_action-conclusie statistisch te wankel — ruis in een
 * paar klikken verschuift een ratio-metriek al met tientallen procenten.
 */
const LINKEDIN_MIN_CLICKS_VOOR_DIRECT_ACTION = 30;

/**
 * Apply action gating rules to recommendations based on their linked findings.
 * Mutates the recommendations in-place and returns them.
 *
 * Let op: elke regel leest `action_readiness` opnieuw. Eerder werd hij één keer bovenaan
 * uitgelezen, waarna de regels daaronder hun beslissing namen op een waarde die inmiddels
 * achterhaald was — regel 1 waardeerde af naar investigate_first en regel 2 en 3 dachten nog
 * steeds met een direct_action te maken te hebben.
 */
export function applyActionGating(
  findings: Finding[],
  recommendations: Recommendation[],
  opts?: { channel?: string }
): Recommendation[] {
  const isLinkedin = opts?.channel === "linkedin_ads";
  for (const rec of recommendations) {
    const evidenceLevel = (rec as Record<string, unknown>).evidence_level as string | undefined;
    const confidence = (rec as Record<string, unknown>).confidence as string | undefined;

    // Rule 1: direct_action requires deterministic + high confidence
    if (readinessOf(rec) === "direct_action") {
      if (evidenceLevel !== "deterministic" || confidence !== "high") {
        setReadiness(rec, "investigate_first");
      }
    }

    // Rule 2: Check linked finding for small signals
    const index = rec.finding_index;
    if (index !== null && index !== undefined) {
      const finding = findings[index];
      if (!finding) {
        // De aanbeveling wijst naar een bevinding die niet bestaat. Dat is geen reden om de
        // controles hieronder over te slaan — juist andersom: het bewijs waar deze aanbeveling
        // op zegt te rusten is niet te vinden, dus hij mag niet zonder mens uitgevoerd worden.
        // Eerder viel zo'n aanbeveling stil buiten regel 2 en behield hij direct_action.
        if (readinessOf(rec) === "direct_action") setReadiness(rec, "investigate_first");
      } else {
        // Small waste: te weinig geld op het spel om automatisch op te handelen.
        const bedrag = Math.abs(finding.current_value ?? 0);
        if (
          isBedrag(finding.metric) && bedrag < KLEIN_BEDRAG_EUR &&
          readinessOf(rec) === "direct_action" && finding.insight_type !== "anomaly"
        ) {
          setReadiness(rec, "monitor");
        }

        // Low confidence finding → max investigate_first
        const findingConfidence = (finding as Record<string, unknown>).confidence as string | undefined;
        if (findingConfidence === "low" && readinessOf(rec) === "direct_action") {
          setReadiness(rec, "investigate_first");
        }

        // F5 fase2.5: LinkedIn <30-klik guardrail. Alleen voor bevindingen die zelf een
        // kliktelling zijn (niet CTR/CPC, die "click" ook in de naam dragen maar geen telling).
        if (
          isLinkedin && isKliktelling(finding.metric) &&
          (finding.current_value ?? 0) < LINKEDIN_MIN_CLICKS_VOOR_DIRECT_ACTION &&
          readinessOf(rec) === "direct_action"
        ) {
          setReadiness(rec, "investigate_first");
        }
      }
    }

    // Rule 3: hypothesis source → always strategic_hypothesis.
    //
    // Onvoorwaardelijk, en dat is een wijziging. Eerder stond hier een controle op
    // direct_action, die per ongeluk werkte omdat de readiness bovenaan was uitgelezen en dus
    // nog de oorspronkelijke waarde had — ook nadat regel 1 al had afgewaardeerd. Zodra de
    // regels de actuele stand lezen, viel een hypothese met zwak bewijs op investigate_first
    // in plaats van in de hypothesebak.
    //
    // strategic_hypothesis is een categorie, geen sterktegraad: een aanbeveling uit een
    // hypothese hoort in het sprint- en experimentenspoor, ongeacht hoe stevig het bewijs is.
    // Zwak bewijs is juist de normale toestand van een hypothese.
    if (rec.source === "hypothesis") {
      setReadiness(rec, "strategic_hypothesis");
    }
  }

  // Rule 4: Detect contradictions on same entity
  const entityActions = new Map<string, Array<{ rec: Recommendation; index: number }>>();
  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    // Group by affected entity (from hypothesis text or finding entity)
    // Zonder bevinding is de hele hypothesetekst de sleutel, niet de eerste 30 tekens.
    // "Verhoog het budget van campagne Brand NL" en "Verhoog het budget van campagne Generic BE"
    // kappen allebei af op "Verhoog het budget van campagn" en werden zo als dezelfde entiteit
    // behandeld. Twee losse campagnes konden elkaars aanbeveling dan afwaarderen op een
    // tegenstrijdigheid die er niet was.
    const entityKey = rec.finding_index !== null && rec.finding_index !== undefined && findings[rec.finding_index]
      ? findings[rec.finding_index].entity_name
      : rec.hypothesis;

    if (!entityActions.has(entityKey)) entityActions.set(entityKey, []);
    entityActions.get(entityKey)!.push({ rec, index: i });
  }

  for (const [, group] of entityActions) {
    if (group.length <= 1) continue;

    // Check for budget up + budget down on same entity. Alleen de twee aanbevelingen die de
    // tegenstrijdigheid zelf vormen gaan omlaag -- niet de hele groep. Een derde, ongerelateerde
    // direct_action-aanbeveling op dezelfde entiteit (bv. "pauzeer deze advertentie") werd hier
    // eerder collateraal meegedowngraded omdat de loop over `group` liep i.p.v. over de
    // aanbevelingen die zelf "verhoog"/"verlaag budget" bevatten.
    const isBudgetUp = (g: { rec: Recommendation }) => g.rec.hypothesis.toLowerCase().includes("verhoog") && g.rec.hypothesis.toLowerCase().includes("budget");
    const isBudgetDown = (g: { rec: Recommendation }) => g.rec.hypothesis.toLowerCase().includes("verlaag") && g.rec.hypothesis.toLowerCase().includes("budget");
    if (group.some(isBudgetUp) && group.some(isBudgetDown)) {
      for (const g of group) {
        if (!isBudgetUp(g) && !isBudgetDown(g)) continue;
        if ((g.rec as Record<string, unknown>).action_readiness === "direct_action") {
          (g.rec as Record<string, unknown>).action_readiness = "investigate_first";
        }
      }
    }

    // Check for tROAS up + tROAS down. Zelfde precisie als hierboven.
    const isRoasUp = (g: { rec: Recommendation }) => g.rec.hypothesis.toLowerCase().includes("verhoog") && g.rec.hypothesis.toLowerCase().includes("roas");
    const isRoasDown = (g: { rec: Recommendation }) => g.rec.hypothesis.toLowerCase().includes("verlaag") && g.rec.hypothesis.toLowerCase().includes("roas");
    if (group.some(isRoasUp) && group.some(isRoasDown)) {
      for (const g of group) {
        if (!isRoasUp(g) && !isRoasDown(g)) continue;
        if ((g.rec as Record<string, unknown>).action_readiness === "direct_action") {
          (g.rec as Record<string, unknown>).action_readiness = "investigate_first";
        }
      }
    }
  }

  return recommendations;
}

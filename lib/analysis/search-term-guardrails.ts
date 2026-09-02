/**
 * Deterministic guardrails for search term analysis.
 *
 * Runs AFTER LLM classification to catch and correct unsafe recommendations.
 * Policy layers:
 *   1. Core protection (converting terms, brand terms, low spend)
 *   2. Intent-specific policy (competitor, commercial, informational)
 *   3. Negative keyword safety (phrase vs exact, risk flagging)
 *   4. Cluster consistency (same theme = same action)
 *   5. Review readiness (derive actionReadiness, evidenceLevel, safer alternatives)
 *
 * Let op de betekenis van `saferAlternativeAction`. Op de meeste plekken hieronder bewaart dat
 * veld juist de AGRESSIEVERE actie die is overschreven (met de toelichting "Origineel: ..."),
 * niet een veiliger alternatief. Alleen regel 7 zet er werkelijk een zachter alternatief in. Het
 * veld wordt nergens weggeschreven of getoond — het is nu puur spoor — maar wie het ooit als
 * "dit mag je in plaats daarvan toepassen" gaat lezen, zet een phrase-uitsluiting op een term
 * die converteert. Lees de bijbehorende `saferAlternativeReason` voordat je erop bouwt.
 */

import type { SearchTermVerdict } from "../schema/search-term-schema";

interface TermWithData extends SearchTermVerdict {
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  campaignName: string;
  adGroupName: string;
  /**
   * search_term_view.status uit Google Ads (ADDED, EXCLUDED, NONE). Optioneel omdat oudere
   * aanroepers hem niet meegeven; alleen EXCLUDED heeft hier betekenis (regel 14).
   */
  status?: string;
}

// ── Intent normalization ───────────────────────────────────────────────────

const INTENT_NORMALIZE: Record<string, string> = {
  "transactional": "generic_commercial",
  "informational": "generic_informational",
  "competitor": "branded_competitor",
  "brand": "branded_own",
};

function normalizeIntent(v: TermWithData): void {
  if (v.intentType && INTENT_NORMALIZE[v.intentType]) {
    v.intentType = INTENT_NORMALIZE[v.intentType] as typeof v.intentType;
  }
}

// ── Branded campagnes herkennen ────────────────────────────────────────────

/**
 * Op hele woorden, niet op deelstrings. "brand" zat als deelstring in Brandbeveiliging,
 * Brandstof en Brandweer — allemaal gewone Nederlandse woorden en stuk voor stuk onderwerpen
 * waar een beursklant over kan gaan. Elke zoekterm in zo'n campagne werd daardoor op "keep" gezet en
 * kon nooit meer worden uitgesloten. Andersom miste de oude controle "merk" zelf: alleen
 * "merknaam" telde mee.
 */
const BRAND_TOKENS = ["brand", "branded", "brandname", "merk", "merknaam"];
const BRAND_PATROON = new RegExp(`(^|[^a-z0-9])(${BRAND_TOKENS.join("|")})([^a-z0-9]|$)`, "i");

function isBrandCampaign(campaignName: string): boolean {
  return BRAND_PATROON.test(campaignName.toLowerCase());
}

// ── Core guardrails ────────────────────────────────────────────────────────

export function applySearchTermGuardrails(verdicts: TermWithData[]): TermWithData[] {
  // Phase 1: Per-term guardrails
  for (const v of verdicts) {
    normalizeIntent(v);

    // ── Rule 1: Converting terms are ALWAYS keep ──
    if (v.conversions > 0) {
      if (v.recommendedAction !== "keep") {
        v.saferAlternativeAction = v.recommendedAction;
        v.saferAlternativeReason = `Origineel aanbevolen: ${v.recommendedAction}. Overschreven omdat term ${v.conversions} conversie(s) heeft.`;
        v.recommendedAction = "keep";
        v.verdict = "relevant";
        v.relevanceScore = Math.max(v.relevanceScore, 4);
        v.confidence = "high";
        v.reason = `Term heeft ${v.conversions} conversie(s) — altijd behouden.`;
      }
      v.evidenceLevel = "deterministic";
    }

    // ── Rule 2: Brand campaign terms ──
    if (isBrandCampaign(v.campaignName) && v.recommendedAction !== "keep") {
      v.saferAlternativeAction = v.recommendedAction;
      v.saferAlternativeReason = `Origineel: ${v.recommendedAction}. Overschreven: term zit in branded campagne.`;
      v.recommendedAction = "keep";
      v.verdict = "relevant";
      v.relevanceScore = Math.max(v.relevanceScore, 4);
      v.confidence = "high";
      v.intentType = "branded_own";
      v.reason = `Term in branded campagne — altijd behouden.`;
    }

    // ── Rule 3: Low spend → downgrade aggressive actions ──
    if (v.cost < 5 && v.conversions === 0 && (v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase")) {
      v.saferAlternativeAction = v.recommendedAction;
      v.saferAlternativeReason = `Origineel: ${v.recommendedAction}. Te weinig spend (${v.cost.toFixed(2)} euro) voor betrouwbare uitsluiting.`;
      v.recommendedAction = "monitor";
      v.confidence = "low";
      v.commercialityLevel = v.commercialityLevel ?? "low";
    }

    // ── Rule 4: Competitor terms — never phrase negative, prefer investigate ──
    if (v.intentType === "branded_competitor") {
      if (v.recommendedAction === "negative_phrase") {
        v.saferAlternativeAction = "negative_phrase";
        v.saferAlternativeReason = "Phrase-uitsluiting op concurrent is te risicovol — kan bredere queries blokkeren.";
        v.recommendedAction = v.cost > 50 && v.conversions === 0 ? "negative_exact" : "investigate";
        v.riskFlag = true;
      }
      if (v.recommendedAction === "negative_exact" && v.cost < 50) {
        v.saferAlternativeAction = "negative_exact";
        v.saferAlternativeReason = `Concurrent met slechts ${v.cost.toFixed(2)} euro spend — investigate is veiliger.`;
        v.recommendedAction = "investigate";
      }
      v.requiresHumanReview = true;
    }

    // ── Rule 5: Core commercial terms — protect from reckless exclusion ──
    if ((v.intentType === "generic_commercial" || v.intentType === "product_specific" || v.intentType === "category_broad") && v.conversions === 0) {
      if (v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase") {
        if (v.relevanceScore >= 3) {
          // Relevant commercial term with 0 conversions = probably execution problem, not bad traffic
          v.saferAlternativeAction = v.recommendedAction;
          v.saferAlternativeReason = `Relevante commerciele term (score ${v.relevanceScore}) met 0 conversies. Probleem kan liggen bij landingspagina, prijs, of campagnestructuur — niet bij de zoekterm zelf.`;
          v.recommendedAction = "investigate";
          v.requiresHumanReview = true;
        }
      }
    }

    // ── Rule 6: Informational terms — never phrase negative ──
    if (v.intentType === "generic_informational" && v.recommendedAction === "negative_phrase") {
      v.saferAlternativeAction = "negative_phrase";
      v.saferAlternativeReason = "Phrase-uitsluiting op informatieve termen is te breed — kan waardevolle varianten blokkeren.";
      v.recommendedAction = "negative_exact";
      v.riskFlag = true;
    }

    // ── Rule 7: Short term phrase negative = always risky ──
    if (v.recommendedAction === "negative_phrase") {
      const wordCount = v.searchTerm.trim().split(/\s+/).length;
      if (wordCount <= 2) {
        v.riskFlag = true;
        v.requiresHumanReview = true;
        v.exclusionRisk = "high";
        v.saferAlternativeAction = "negative_exact";
        v.saferAlternativeReason = `Phrase-uitsluiting op kort zoekwoord (${wordCount} woorden) blokkeert potentieel veel traffic.`;
      }
    }

    // ── Rule 8: Very few clicks → lower confidence ──
    if (v.clicks <= 2 && v.confidence === "high") {
      v.confidence = "medium";
    }

    // ── Rule 9: Set defaults for missing fields ──
    if (!v.confidence) v.confidence = "medium";
    if (!v.intentType) v.intentType = "unknown";
    if (v.riskFlag === undefined) v.riskFlag = false;
    if (v.requiresHumanReview === undefined) v.requiresHumanReview = false;

    // ── Rule 10: Derive commercialityLevel ──
    if (!v.commercialityLevel) {
      if (v.intentType === "generic_commercial" || v.intentType === "product_specific" || v.intentType === "branded_own") {
        v.commercialityLevel = "high";
      } else if (v.intentType === "category_broad" || v.intentType === "problem_solution" || v.intentType === "local_intent") {
        v.commercialityLevel = "medium";
      } else if (v.intentType === "generic_informational" || v.intentType === "navigational") {
        v.commercialityLevel = "low";
      } else {
        v.commercialityLevel = "none";
      }
    }

    // ── Rule 11: Derive exclusionRisk ──
    if (!v.exclusionRisk) {
      if (v.recommendedAction === "negative_phrase") v.exclusionRisk = "high";
      else if (v.recommendedAction === "negative_exact" && v.commercialityLevel !== "none") v.exclusionRisk = "medium";
      else if (v.recommendedAction === "negative_exact") v.exclusionRisk = "low";
      else v.exclusionRisk = "low";
    }

    // ── Rule 13: Derive evidenceLevel ──
    if (!v.evidenceLevel) {
      if (v.conversions > 0) v.evidenceLevel = "deterministic";
      else if (v.confidence === "high") v.evidenceLevel = "inferred";
      else v.evidenceLevel = "weak_signal";
    }

    // ── Rule 14: Al uitgesloten termen niet opnieuw als uitsluiting adviseren ──
    //
    // search_term_view.status EXCLUDED betekent dat er al een negative op deze term staat; die
    // nog eens als negative adviseren zet een dubbel voorstel in de wachtrij en laat de lijst
    // "openstaande uitsluitingen" nooit leeglopen (sloop-audit 1 sep 2026, de status werd
    // volledig genegeerd). Bewust als LAATSTE regel in de lus, zodat hij ook uitsluitingen
    // vangt die eerdere regels lieten staan; keep/monitor/investigate blijven onaangeroerd.
    if (v.status === "EXCLUDED" && isNegative(v)) {
      v.saferAlternativeAction = v.recommendedAction;
      v.saferAlternativeReason = `Origineel: ${v.recommendedAction}. Term is al uitgesloten in Google Ads (search_term_view.status EXCLUDED).`;
      v.recommendedAction = "monitor";
      v.reason = `Al uitgesloten in Google Ads (status EXCLUDED); geen nieuwe uitsluiting nodig. ${v.reason}`;
    }
  }

  // Phase 2: Cluster consistency — same n-gram pattern = consistent action
  applyClusterConsistency(verdicts);

  // Phase 3: Rule 12 — actionReadiness afleiden.
  //
  // Dit hoort NA fase 2. Toen het nog in de lus hierboven stond, werd de readiness bepaald op de
  // aanbeveling zoals die er op dat moment lag, waarna de clustercontrole de actie alsnog
  // terugzette naar investigate. Er kwamen dan rijen uit met recommendedAction "investigate" en
  // requiresHumanReview true, maar actionReadiness "direct_action" — en dat laatste veld is nu
  // juist het veld dat in action-gating.ts bepaalt of iets zonder mens toegepast mag worden.
  for (const v of verdicts) deriveActionReadiness(v);

  return verdicts;
}

function deriveActionReadiness(v: TermWithData): void {
  if (v.recommendedAction === "keep" || v.recommendedAction === "monitor") {
    v.actionReadiness = "monitor";
  } else if (v.confidence === "high" && v.recommendedAction === "negative_exact" && v.intentType === "out_of_scope" && !v.requiresHumanReview && !v.riskFlag) {
    v.actionReadiness = "direct_action";
  } else if (v.recommendedAction === "investigate" || v.requiresHumanReview) {
    v.actionReadiness = "investigate_first";
  } else if (v.confidence === "high" && !v.riskFlag) {
    v.actionReadiness = "direct_action";
  } else {
    v.actionReadiness = "investigate_first";
  }
}

// ── Cluster consistency ────────────────────────────────────────────────────

function isNegative(v: TermWithData): boolean {
  return v.recommendedAction === "negative_exact" || v.recommendedAction === "negative_phrase";
}

function applyClusterConsistency(verdicts: TermWithData[]): void {
  // Group by 2-gram overlap for simple clustering.
  // Een Set en geen array: een zoekterm waarin hetzelfde 2-gram twee keer voorkomt
  // ("zonnepaneel installatie zonnepaneel installatie") werd anders twee keer in dezelfde groep
  // gezet. Twee van zulke termen haalden samen de drempel van drie, terwijl het er twee waren.
  const clusters = new Map<string, Set<TermWithData>>();
  const voegToe = (key: string, v: TermWithData) => {
    if (!clusters.has(key)) clusters.set(key, new Set());
    clusters.get(key)!.add(v);
  };

  for (const v of verdicts) {
    const words = v.searchTerm.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    // Generate 2-grams as cluster keys
    for (let i = 0; i < words.length - 1; i++) {
      voegToe(`${words[i]} ${words[i + 1]}`, v);
    }
    // Also use single significant words for short terms
    if (words.length === 1 && words[0].length > 4) {
      voegToe(words[0], v);
    }
  }

  // Dezelfde zoekterm kan in meerdere advertentiegroepen voorkomen en daar een ander oordeel
  // hebben gekregen. Dat is een tegenspraak op zichzelf en hoort niet af te hangen van de vraag
  // of er toevallig 2-grammen overlappen. Eerst dus die controle, los van de clusters.
  const perTerm = new Map<string, TermWithData[]>();
  for (const v of verdicts) {
    const sleutel = v.searchTerm.trim().toLowerCase();
    if (!perTerm.has(sleutel)) perTerm.set(sleutel, []);
    perTerm.get(sleutel)!.push(v);
  }
  for (const [term, rijen] of perTerm) {
    if (rijen.length < 2) continue;
    const houden = rijen.some((v) => v.recommendedAction === "keep");
    const uitsluiten = rijen.some((v) => isNegative(v));
    if (!houden || !uitsluiten) continue;
    for (const v of rijen) {
      if (!isNegative(v)) continue;
      v.saferAlternativeAction = v.recommendedAction;
      v.saferAlternativeReason = `Zoekterm "${term}" wordt in een andere advertentiegroep juist behouden — uitsluiting is inconsistent.`;
      v.recommendedAction = "investigate";
      v.requiresHumanReview = true;
      v.riskFlag = true;
    }
  }

  // For clusters with 3+ terms: ensure consistency.
  // Drie verschillende zoektermen, niet drie rijen: dezelfde term in drie advertentiegroepen is
  // geen thema.
  for (const [key, groepSet] of clusters) {
    const group = [...groepSet];
    const losseTermen = new Set(group.map((v) => v.searchTerm.trim().toLowerCase()));
    if (losseTermen.size < 3) continue;

    // Check for mixed actions on same cluster
    const actions = new Set(group.map((v) => v.recommendedAction));
    if (actions.size <= 1) {
      // Consistent — assign cluster key
      for (const v of group) v.clusterKey = v.clusterKey ?? key;
      continue;
    }

    // Mixed actions — check if some are aggressive while others are not
    const hasKeep = group.some((v) => v.recommendedAction === "keep");
    const hasNegative = group.some((v) => isNegative(v));

    if (hasKeep && hasNegative) {
      // Contradiction: same theme has both keep and negative — downgrade negatives to investigate
      for (const v of group) {
        if (isNegative(v)) {
          v.saferAlternativeAction = v.recommendedAction;
          v.saferAlternativeReason = `Cluster "${key}" bevat ook relevante termen — uitsluiting is inconsistent.`;
          v.recommendedAction = "investigate";
          v.requiresHumanReview = true;
          v.riskFlag = true;
        }
        v.clusterKey = key;
      }
    } else {
      // Assign cluster key for review grouping
      for (const v of group) v.clusterKey = v.clusterKey ?? key;
    }
  }
}

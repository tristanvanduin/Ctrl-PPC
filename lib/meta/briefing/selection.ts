// M4 selectie-laag (spec 5, selection.ts): volledig deterministisch. Kiest wat de briefing
// mag beweren (alleen deterministic-bewijs), bepaalt de gaten in de matrix voor het bewuste
// experiment, en bewaakt het eerlijke insufficient-data-pad: minder dan drie
// deterministic-patronen betekent GEEN concepten, wel een heldere lijst van wat er nodig is.
// IO-vrij en los getest; de builder (LLM, formuleert alleen) en de render zijn build-kant.

import type { PatternAggregate, ReplacementCandidate } from "../vision/patterns";

export const MAX_POSITIVE_PATTERNS = 6;
export const MAX_DONTS = 3;
export const MIN_DETERMINISTIC_FOR_CONCEPTS = 3;
export const GAP_MAX_ADS = 1; // een attribuut-waarde met 0 of 1 ads is een gat in de matrix

export interface SelectedPattern {
  pattern: PatternAggregate;
  weight: number; // |lift_pct| maal log10(impressions), de spec-sortering
}

export interface GapCandidate {
  attribute: string;
  value: string;
  nAds: number;
  reasoning: string; // waarom dit gat kansrijk is (de tegenhanger-lift)
}

export type BriefingSelection =
  | {
      status: "voldoende_bewijs";
      positives: SelectedPattern[];
      donts: SelectedPattern[];
      gaps: GapCandidate[];
      experiment: GapCandidate | null; // precies een bewust experiment (spec sectie 5 van de briefing)
      replacements: ReplacementCandidate[];
    }
  | {
      status: "onvoldoende_bewijs";
      deterministicCount: number;
      needed: string; // wat er nodig is voordat een briefing zinvol is
      replacements: ReplacementCandidate[];
    };

function weightOf(p: PatternAggregate): number {
  return Math.abs(p.liftPct) * Math.log10(Math.max(p.impressions, 10));
}

// De kern-selectie. Alleen deterministic telt als bewijs; inferred-patronen komen de
// briefing niet in (de no-go: geen concepten zonder referentie naar bewijs).
export function selectBriefingPatterns(input: {
  patterns: PatternAggregate[];
  replacements: ReplacementCandidate[];
}): BriefingSelection {
  const deterministic = input.patterns.filter((p) => p.evidenceLevel === "deterministic");

  if (deterministic.length < MIN_DETERMINISTIC_FOR_CONCEPTS) {
    return {
      status: "onvoldoende_bewijs",
      deterministicCount: deterministic.length,
      needed: `Er zijn ${deterministic.length} deterministic-patronen; voor een briefing zijn er minstens ${MIN_DETERMINISTIC_FOR_CONCEPTS} nodig. Dat vraagt per patroon minstens 3 ads met elk 5.000 impressies, en voor conversie-claims 30 conversies per patroon. Laat de huidige ads doorlopen of verbreed de creative-variatie, en draai de analyse daarna opnieuw.`,
      replacements: input.replacements,
    };
  }

  const ranked = deterministic
    .map((pattern) => ({ pattern, weight: Math.round(weightOf(pattern) * 100) / 100 }))
    .sort((a, b) => b.weight - a.weight);

  const positives = ranked.filter((s) => s.pattern.liftPct > 0).slice(0, MAX_POSITIVE_PATTERNS);
  const donts = ranked.filter((s) => s.pattern.liftPct < 0).slice(0, MAX_DONTS);

  const gaps = buildGapMatrix(input.patterns);
  const experiment = pickExperiment(gaps);

  return { status: "voldoende_bewijs", positives, donts, gaps, experiment, replacements: input.replacements };
}

// De gap-matrix: attribuut-waarde-combinaties die nog niet echt beproefd zijn. De redenatie
// leunt op de tegenhanger: als een andere waarde van hetzelfde attribuut een bewezen lift
// heeft, is het gat het testen waard.
//
// Herbouwd 1 september 2026 (sloop-audit): de oude versie zocht uitsluitend rijen met 0 of
// 1 ads, maar de patroontabel BEVAT die per constructie niet — aggregatePattern slaat onder
// MIN_PATTERN_ADS=3 niets op. De matrix was dus altijd leeg, terwijl het schema precies één
// experiment mét gap-redenatie afdwingt: het model moest er een verzinnen of de validatie
// faalde. Nu: eerst echte gaten (mochten die er ooit komen), anders de DUNST bewezen
// combinatie per attribuut — de minste ads, wél opgeslagen — als eerlijk "hier weten we het
// minst van"-experiment.
export function buildGapMatrix(patterns: PatternAggregate[]): GapCandidate[] {
  const kandidaat = (p: PatternAggregate, dun: boolean): GapCandidate => {
    const counterpart = patterns
      .filter((other) => other.attribute === p.attribute && other.value !== p.value && other.evidenceLevel === "deterministic" && Math.abs(other.liftPct) > 0)
      .sort((a, b) => Math.abs(b.liftPct) - Math.abs(a.liftPct))[0];
    const basis = dun
      ? `de waarde ${p.value} is met ${p.nAds} ad(s) het dunst bewezen deel van de matrix`
      : `de waarde ${p.value} is met ${p.nAds} ad(s) nog vrijwel onbeproefd`;
    return {
      attribute: p.attribute,
      value: p.value,
      nAds: p.nAds,
      reasoning: counterpart
        ? `${p.attribute} is bewezen relevant (${counterpart.value}: ${counterpart.liftPct > 0 ? "plus" : "min"} ${Math.round(Math.abs(counterpart.liftPct) * 1000) / 10}% op ${counterpart.metric}); ${basis}`
        : `${p.attribute} = ${p.value}: ${basis}; onbekend terrein`,
    };
  };

  const echteGaten = patterns.filter((p) => p.nAds <= GAP_MAX_ADS).map((p) => kandidaat(p, false));
  if (echteGaten.length > 0) {
    return echteGaten.sort((a, b) => (b.reasoning.includes("bewezen relevant") ? 1 : 0) - (a.reasoning.includes("bewezen relevant") ? 1 : 0));
  }

  // Geen echte gaten in de opslag: per attribuut de dunst bewezen waarde, mits het
  // attribuut meerdere waarden kent (anders valt er niets te kiezen).
  const perAttribuut = new Map<string, PatternAggregate[]>();
  for (const p of patterns) {
    const lijst = perAttribuut.get(p.attribute) ?? [];
    lijst.push(p);
    perAttribuut.set(p.attribute, lijst);
  }
  const dunste: GapCandidate[] = [];
  for (const lijst of perAttribuut.values()) {
    if (lijst.length < 2) continue;
    const dun = [...lijst].sort((a, b) => a.nAds - b.nAds)[0];
    dunste.push(kandidaat(dun, true));
  }
  return dunste.sort((a, b) => (b.reasoning.includes("bewezen relevant") ? 1 : 0) - (a.reasoning.includes("bewezen relevant") ? 1 : 0) || a.nAds - b.nAds);
}

// Precies een bewust experiment: het gat met de sterkste tegenhanger-redenatie wint.
export function pickExperiment(gaps: GapCandidate[]): GapCandidate | null {
  return gaps.find((g) => g.reasoning.includes("bewezen relevant")) ?? gaps[0] ?? null;
}

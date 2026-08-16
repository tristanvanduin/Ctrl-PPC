import { toPromptTable } from "@/lib/analysis/prompt-table";
// M2 route-wiring: bouwt de per-stap data-prompt (de userMessage voor runNarrativeStep) uit de
// voorgerekende Meta-facts. Dezelfde rol als de inline Google-messages, maar gevoed door
// buildMetaStepFacts. Het model krijgt de exacte getallen aangeleverd en hoeft niet zelf te rekenen.
// Pure functie, op fixtures te testen.

// F5 fase3: 6 pijlers (was 11 stappen). Zie lib/analysis/adapters/meta-ads.ts voor de mapping
// van oude stappen naar deze pijlers.
const META_STEP_NAMES: Record<number, string> = {
  1: "Account Performance",
  2: "Structuur & Budget",
  3: "Creative & Visual",
  4: "Placement & Doelgroep-segmenten",
  5: "Funnel, Verzadiging & Schedule",
  6: "Hypotheses en Sprintplanning",
};

export function metaStepName(stepNumber: number): string {
  return META_STEP_NAMES[stepNumber] ?? `Stap ${stepNumber}`;
}

export function buildMetaStepMessage(stepNumber: number, facts: unknown, clientId: string): string {
  const name = metaStepName(stepNumber);
  const factsBlock = toPromptTable(facts ?? {});
  return [
    `Analyseer ${name} (stap ${stepNumber}) voor client "${clientId}".`,
    "",
    "## Voorgerekende feiten",
    "Reken uitsluitend met deze exacte, deterministisch voorgerekende getallen. Verzin geen nieuwe cijfers en herbereken niets zelf.",
    "",
    factsBlock,
  ].join("\n");
}

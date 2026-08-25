import { toPromptTable } from "@/lib/analysis/prompt-table";
// Microsoft route-wiring: bouwt de per-stap data-prompt (de userMessage voor de stap-runner) uit
// de voorgerekende Microsoft-facts. Dezelfde rol als de Meta- en LinkedIn-versies: het model
// krijgt de exacte getallen aangeleverd en rekent niet zelf. Pure functie, op fixtures te testen.

// 6 pijlers, dezelfde titels als de stap-instructies in lib/analysis/adapters/microsoft-ads.ts.
const MICROSOFT_STEP_NAMES: Record<number, string> = {
  1: "Account Performance",
  2: "Structuur, Budget & Import",
  3: "Keywords & Zoektermen",
  4: "Profiel & Doelgroep",
  5: "Netwerk, Impressieaandeel & Schedule",
  6: "Hypotheses en Sprintplanning",
};

export function microsoftStepName(stepNumber: number): string {
  return MICROSOFT_STEP_NAMES[stepNumber] ?? `Stap ${stepNumber}`;
}

export function buildMicrosoftStepMessage(stepNumber: number, facts: unknown, clientId: string): string {
  const name = microsoftStepName(stepNumber);
  const factsBlock = toPromptTable(facts ?? {});
  return [
    `Analyseer ${name} (stap ${stepNumber}) voor client "${clientId}".`,
    "",
    "## Voorgerekende feiten",
    "Reken uitsluitend met deze exacte, deterministisch voorgerekende getallen. Verzin geen nieuwe cijfers en herbereken niets zelf. Dit kanaal draait op een fractie van Google-volumes: noem bij elk percentage het absolute aantal, en behandel segmenten onder de aangeleverde volumegrens als indicatief.",
    "",
    factsBlock,
  ].join("\n");
}

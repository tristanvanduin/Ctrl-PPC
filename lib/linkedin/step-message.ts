import { toPromptTable } from "@/lib/analysis/prompt-table";
// L2 route-wiring: bouwt de per-stap data-prompt (de userMessage voor de stap-runner) uit de
// voorgerekende LinkedIn-facts. Dezelfde rol als de Meta-versie: het model krijgt de exacte
// getallen aangeleverd en rekent niet zelf. Pure functie, op fixtures te testen.

// F5 fase3: 6 pijlers (was 9 stappen). Zie lib/analysis/adapters/linkedin-ads.ts voor de mapping
// van oude stappen naar deze pijlers.
const LINKEDIN_STEP_NAMES: Record<number, string> = {
  1: "Account Performance",
  2: "Structuur, Budget & Bidding",
  3: "Creative Performance",
  4: "Doelgroep: ICP-fit & Verzadiging",
  5: "Lead Gen Funnel",
  6: "Hypotheses en Sprintplanning",
};

export function linkedinStepName(stepNumber: number): string {
  return LINKEDIN_STEP_NAMES[stepNumber] ?? `Stap ${stepNumber}`;
}

export function buildLinkedinStepMessage(stepNumber: number, facts: unknown, clientId: string): string {
  const name = linkedinStepName(stepNumber);
  const factsBlock = toPromptTable(facts ?? {});
  return [
    `Analyseer ${name} (stap ${stepNumber}) voor client "${clientId}".`,
    "",
    "## Voorgerekende feiten",
    "Reken uitsluitend met deze exacte, deterministisch voorgerekende getallen. Verzin geen nieuwe cijfers en herbereken niets zelf. Bij LinkedIn leidt CPL, niet ROAS.",
    "",
    factsBlock,
  ].join("\n");
}

// Verificatie van F2 4f: deduplicatie in summaries, alternative_route en de
// containment-afhankelijkheid. Getoetst op de echte functies uit monthly-structured.ts; hier
// stonden eerst kopieen van de drie transforms.
// Draaien: npx tsx lib/analysis/__summary_dedup_test.ts

import {
  samenvattingZonderDubbeling,
  buildFinalRecommendationFromStrategy,
  applyExecutiveRecommendationDependencies,
} from "./monthly-structured";

type Rec = Parameters<typeof buildFinalRecommendationFromStrategy>[0];
type Strat = Parameters<typeof buildFinalRecommendationFromStrategy>[1];
type FinalRec = Parameters<typeof applyExecutiveRecommendationDependencies>[0][number];

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const summary = samenvattingZonderDubbeling;

// alternative_route komt uit de echte bouwer van de finale aanbeveling.
const strategie = (action: string, mode = "containment"): Strat => ({
  mode, action, expected_result: "x", timeframe: "1-2 weken", evidence_level: "inferred", confidence: "medium",
  validation_metric: "CPA", validation_condition: "Valideer binnen 1-2 weken of CPA verbetert.", risk_note: "x",
} as unknown as Strat);
const aanbeveling = { measurement_metric: "CPA", canonical_metric: "CPA", canonical_entity_name: "Campagne Noord", expected_result: "x" } as unknown as Rec;
const altRoute = (alts: { action: string }[], stratAction: string) =>
  buildFinalRecommendationFromStrategy(aanbeveling, strategie(stratAction), "containment", alts.map((a) => strategie(a.action, "recovery"))).alternative_route;

// De containment-afhankelijkheid komt uit de echte nabewerking van de executive-aanbevelingen.
const finaal = (route: string, handeling: string, voorwaarde: string): FinalRec => ({
  route, handeling, object: "Landset", doel: "x", meet_via: "CPA", voorwaarde, beslisregel: "x", risico: "x",
} as unknown as FinalRec);
function depVoorwaarde(recHandeling: string, contHandeling: string | null, voorwaarde: string): string {
  const items = [finaal("recovery", recHandeling, voorwaarde)];
  if (contHandeling) items.push(finaal("containment", contHandeling, "x"));
  return applyExecutiveRecommendationDependencies(items)[0].voorwaarde;
}

console.log("\n1. Summary: object alleen toevoegen als de handeling het nog niet bevat");
check("handeling bevat object al -> geen dubbeling", summary("Pauzeer campagne Noord", "campagne Noord") === "Pauzeer campagne Noord");
check("handeling bevat object niet -> object toegevoegd", summary("Verlaag budget", "Zoekcampagne Noord") === "Verlaag budget Zoekcampagne Noord");
check("overlap ondanks hoofdletters/diacritiek", summary("Sluit zoekterm 'café' uit", "Café") === "Sluit zoekterm 'café' uit");

console.log("\n2. alternative_route alleen bij een verschillende actie");
check("zelfde actie -> undefined (geen echo)", altRoute([{ action: "Verlaag budget met 30%" }], "Verlaag budget met 30%") === undefined);
check("zelfde actie modulo opmaak -> undefined", altRoute([{ action: "Verlaag  budget,  30%" }], "Verlaag budget 30%") === undefined);
const anders = altRoute([{ action: "Pauzeer landset" }], "Verlaag budget");
check("verschillende actie -> wel gezet, met de actie erin", typeof anders === "string" && anders.includes("Pauzeer landset"), String(anders));
check("geen alternatieven -> undefined", altRoute([], "Verlaag budget") === undefined);

console.log("\n3. Containment-afhankelijkheid alleen als de recovery-handeling verschilt");
check("zelfde handeling -> geen circulaire afhankelijkheid", depVoorwaarde("Pauzeer landset", "Pauzeer landset", "Meet herstel via ROAS.") === "Meet herstel via ROAS.");
check("verschillende handeling -> afhankelijkheid toegevoegd", depVoorwaarde("Herstart in aparte set", "Pauzeer landset", "Meet herstel via ROAS.").startsWith("Start pas nadat containment"));
check("voorwaarde noemt containment al -> niet overschrijven", depVoorwaarde("Herstart in aparte set", "Pauzeer landset", "Na containment stabiliseert ROAS.") === "Na containment stabiliseert ROAS.");
check("geen containment-route -> voorwaarde blijft", depVoorwaarde("Herstart in aparte set", null, "Meet herstel via ROAS.") === "Meet herstel via ROAS.");

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);

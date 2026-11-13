export {};
// Verificatie van F3 4a (generieke repair-loop), pure logica. Getoetst op de echte helpers uit
// app/api/analysis/monthly/route.ts; hier stond eerst een kopie, inclusief een eigen kopie van de
// lijst zware waarschuwingen. Een matcher erbij of eraf in de route zag deze test dan niet.
// Draaien: npx tsx lib/analysis/__step_repair_test.ts

import {
  countHeavyWarnings,
  shouldRepairStep,
  buildStepRepairUserMessage,
  pickBetterStepAttempt as echtePick,
} from "../../app/api/analysis/monthly/route";
import type { StepValidationResult } from "./step-validator";

type Validation = StepValidationResult;
type StepAttempt = { id: string; validation: Validation };
type EchtePoging = Parameters<typeof echtePick>[0];
// De echte functie kijkt alleen naar .validation en geeft een van de twee pogingen terug.
const pickBetterStepAttempt = (a: StepAttempt, b: StepAttempt): StepAttempt =>
  echtePick(a as unknown as EchtePoging, b as unknown as EchtePoging) as unknown as StepAttempt;

const V = (errors: string[], warnings: string[]): Validation => ({ stepNumber: 1, valid: errors.length === 0, errors, warnings });

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1. shouldRepairStep: drempels");
check("een error -> repair", shouldRepairStep(V(["Geen JSON-object gevonden in step output"], []), false));
check("twee zware warnings -> repair", shouldRepairStep(V([], ["Verwacht 3 findings, kreeg 2", "Narratief bevat geen concrete cijfers"]), false));
check("een zware warning alleen -> geen repair", !shouldRepairStep(V([], ["Verwacht 3 findings, kreeg 2"]), false));
check("een lichte warning -> geen repair", !shouldRepairStep(V([], ["Cross-reference context ontbreekt vanuit vorige stapconclusie"]), false));
check("OUD gedrag (alleen stap 12) ving deze 2 zware warnings NIET, NIEUW wel", shouldRepairStep(V([], ["Wiskundige inconsistentie: X", "Verwacht 3 findings, kreeg 1"]), false));
check(
  "de echte, herhaalde Meta/LinkedIn-combo (nested JSON + te weinig findings) triggert nu repair",
  shouldRepairStep(V([], ["Step-output was gedegradeerd of nested JSON; parse salvage toegepast.", "Verwacht 3 findings, kreeg 1"]), false)
);
check(
  "OUD gat: 'gedegradeerd of nested JSON' alleen (zonder findings-tekort) blijft onder de drempel",
  !shouldRepairStep(V([], ["Step-output was gedegradeerd of nested JSON; parse salvage toegepast."]), false)
);

console.log("\n2. Kostenrem (errorsOnly na 5 repairs)");
check("errorsOnly: drie zware warnings -> geen repair meer", !shouldRepairStep(V([], ["Wiskundige inconsistentie: X", "Verwacht 3 findings, kreeg 1", "Narratief bevat geen concrete cijfers"]), true));
check("errorsOnly: een error -> nog steeds repair", shouldRepairStep(V(["Geen JSON-object gevonden in step output"], []), true));

console.log("\n3. F4-koppeling: claim-warning telt als zwaar");
check("een claim-warning + een andere zware -> repair", shouldRepairStep(V([], ["Claim-consistentie: waarde 1.4 voor X wijkt af van 5.43", "Narratief bevat geen concrete cijfers"]), false));
check("claim-warning telt mee in countHeavyWarnings", countHeavyWarnings(V([], ["Claim-consistentie: waarde 1.4 voor X wijkt af van 5.43"])) === 1);

console.log("\n4. buildStepRepairUserMessage");
{
  const msg = buildStepRepairUserMessage("Analyseer stap 2.", V(["Geen JSON-object gevonden"], ["Verwacht 3 findings, kreeg 1"]), "ctx", "note");
  check("bevat het REPAIR FEEDBACK blok", /## REPAIR FEEDBACK/.test(msg));
  check("bevat de letterlijke errorregel", /- Geen JSON-object gevonden/.test(msg));
  check("bevat de letterlijke warningregel", /- Verwacht 3 findings, kreeg 1/.test(msg));
  const many = buildStepRepairUserMessage("x", V(Array.from({ length: 20 }, (_, i) => `err${i}`), []), "ctx");
  const feedbackCount = (many.match(/- err\d+/g) || []).length;
  check("maximaal 12 feedbackregels", feedbackCount === 12, "kreeg " + feedbackCount);
}

console.log("\n5. pickBetterStepAttempt: geen verslechtering (convergentie-garantie)");
{
  const orig2err = { id: "orig", validation: V(["e1", "e2"], []) };
  const repaired0err = { id: "repaired", validation: V([], []) };
  check("repair met minder errors wint", pickBetterStepAttempt(orig2err, repaired0err).id === "repaired");
  const orig0err = { id: "orig", validation: V([], []) };
  const repaired2err = { id: "repaired", validation: V(["e1", "e2"], []) };
  check("repair die SLECHTER is (meer errors) wordt verworpen, origineel blijft", pickBetterStepAttempt(orig0err, repaired2err).id === "orig");
  const origHeavy2 = { id: "orig", validation: V([], ["Wiskundige inconsistentie: X", "Verwacht 3 findings, kreeg 1"]) };
  const repairedHeavy0 = { id: "repaired", validation: V([], ["Cross-reference context ontbreekt"]) };
  check("gelijke errors, repair met minder zware warnings wint", pickBetterStepAttempt(origHeavy2, repairedHeavy0).id === "repaired");
  const a = { id: "orig", validation: V([], ["Cross-reference context ontbreekt"]) };
  const b = { id: "repaired", validation: V([], ["Cross-reference context ontbreekt"]) };
  check("gelijke kwaliteit -> origineel behouden (geen churn)", pickBetterStepAttempt(a, b).id === "orig");
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
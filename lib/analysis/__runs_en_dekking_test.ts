// Een halve run telt niet als gedraaid, een vastgelopen run gaat op failed, de maandpoort keurt
// geen analyse goed die over ontbrekende stappen zwijgt, en de zoektermtabel heeft een periode.
// Draaien: node_modules/.bin/tsx lib/analysis/__runs_en_dekking_test.ts

import { dekkingsRegel, validateMonthlyAcceptance, GEEN_DATA_MODEL } from "./monthly-acceptance";
import { laatsteZoektermStand, zoektermKop } from "./zoekterm-stand";
import { vastgelopenRuns, vastgelopenReden } from "@/lib/scheduler/vastgelopen-runs";
import { isStaleRunning, VASTGELOPEN_RUN_MINUTEN } from "@/lib/scheduler/core";
import type { StepResult } from "./helpers";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("Vastgelopen runs");
{
  const nu = new Date("2026-11-13T12:00:00Z");
  const rijen = [
    { job_id: "a", status: "running", updated_at: "2026-09-01T15:02:00Z", current_phase: "run_step_6", current_phase_label: "Stap 6" },
    { job_id: "b", status: "running", updated_at: "2026-11-13T11:30:00Z", current_phase: "run_step_2" },
    { job_id: "c", status: "completed", updated_at: "2026-09-01T15:02:00Z", current_phase: "done" },
  ];
  const weg = vastgelopenRuns(rijen, nu);
  check("alleen de run zonder update na een uur", weg.length === 1 && weg[0].job_id === "a", JSON.stringify(weg));
  check("een run met voortgang een half uur geleden loopt nog", !weg.some((r) => r.job_id === "b"));
  check("de reden noemt de fase en dat hij niet als gedraaid telt", vastgelopenReden(rijen[0]).includes("Stap 6") && vastgelopenReden(rijen[0]).includes("telt niet als gedraaid"));
  check("de pump-drempel van 15 minuten blijft de standaard", isStaleRunning("running", new Date(nu.getTime() - 20 * 60_000), nu) && !isStaleRunning("running", new Date(nu.getTime() - 20 * 60_000), nu, VASTGELOPEN_RUN_MINUTEN));
}

console.log("\nDe maandpoort en stappen zonder data");
function stap(n: number, naam: string, model = "model-x"): StepResult {
  return { stepNumber: n, stepName: naam, output: "tekst", model, tokensUsed: 0, saved: true, latencyMs: 0, retries: 0 };
}
{
  // Tegenvoorbeeld: demo-grt, demo-gra en demo-grn op 19 augustus, elk 5 van 12 stappen zonder
  // data, kwaliteitspoort passed, why-score 9,2, en nergens een woord over de lege stappen.
  const stappen = [
    stap(1, "Account"), stap(2, "Campagnes"), stap(3, "Product Performance", GEEN_DATA_MODEL),
    stap(4, "Demand & Search Intelligence", GEEN_DATA_MODEL), stap(5, "Budget"),
  ];
  const regel = dekkingsRegel(stappen);
  check("de dekkingsregel telt de stappen", !!regel && regel.includes("3 van de 5 stappen met data"), String(regel));
  check("en noemt de lege bij naam", !!regel && regel.includes("Product Performance") && regel.includes("Demand & Search Intelligence"));
  const basis = {
    narrativeSteps: stappen, recommendations: [], tasks: [], coverage: [{} as never], findings: [],
    checkpointsRun: 0, expectedCheckpointCount: 0, stepCount: 5,
  };
  const zwijgt = validateMonthlyAcceptance({ ...basis, deliverableMarkdown: "# Analyse\nHoofdoorzaak: budget." });
  const ac19 = zwijgt.criteria.find((c) => c.id === "AC-19");
  check("zwijgen over lege stappen: AC-19 faalt", ac19?.passed === false, JSON.stringify(ac19));
  check("en de poort keurt niet goed", zwijgt.passed === false);
  const zegtHet = validateMonthlyAcceptance({ ...basis, deliverableMarkdown: `${regel}\n\n# Analyse` });
  check("met de dekkingsregel erboven: AC-19 slaagt", zegtHet.criteria.find((c) => c.id === "AC-19")?.passed === true);
  const vol = validateMonthlyAcceptance({ ...basis, narrativeSteps: [stap(1, "Account")], stepCount: 1 });
  check("alle stappen met data: geen regel nodig", dekkingsRegel([stap(1, "Account")]) === null && vol.criteria.find((c) => c.id === "AC-19")?.passed === true);
}

console.log("\nDe zoektermtabel krijgt de periode die de kop belooft");
{
  // Bij de echte klanten twee maandstanden; dezelfde term stond dan twee keer in de tabel.
  const rijen = [
    { week_start: "2026-03-01", search_term: "gratis kas bouwen", cost: 300 },
    { week_start: "2026-04-01", search_term: "gratis kas bouwen", cost: 135 },
    { week_start: "2026-04-01", search_term: "hydroponics diy home", cost: 160 },
    ...Array.from({ length: 40 }, (_, i) => ({ week_start: "2026-04-01", search_term: `term ${i}`, cost: i })),
  ];
  const z = laatsteZoektermStand(rijen, 30);
  check("alleen de nieuwste stand", z.stand === "2026-04-01" && z.rijen.every((r) => r.week_start === "2026-04-01"));
  check("dezelfde term niet twee keer", z.rijen.filter((r) => r.search_term === "gratis kas bouwen").length === 1);
  check("de top 30 op kosten", z.rijen.length === 30 && z.rijen[0].search_term === "hydroponics diy home");
  const kop = zoektermKop(z, "2026-08-18", "2026-09-01");
  check("de kop noemt de stand en zegt dat het niet de weekperiode is", kop.includes("stand van 2026-04-01") && kop.includes("NIET de 2026-08-18 t/m 2026-09-01"), kop);
  check("zonder rijen een eerlijke kop", zoektermKop(laatsteZoektermStand([]), "a", "b").includes("geen zoektermdata"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

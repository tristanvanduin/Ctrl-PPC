// Regressietest: over hoeveel maanden de budgetscenario-kaart (components/dashboard/budget-scenario.tsx)
// een budgetwijziging laat doorwerken. Draaien: tsx lib/__budget_scenario_test.ts
//
// Waarom: het scenario nam 12 - realizedThroughMonth. Loopt de data achter op de kalender (de
// geseede demo stopt op 26 augustus: gerealiseerd t/m juli), dan zijn dat op 1 november vijf
// maanden. Maar augustus, september en oktober liggen achter ons; een budgetwijziging van vandaag
// raakt alleen november en december. +50% budget gaf zo 125 extra conversies waar 50 klopt.

import * as scenario from "../components/dashboard/budget-scenario";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("scenarioMaanden (budget-scenario.tsx)");
{
  const f = (scenario as { scenarioMaanden?: unknown }).scenarioMaanden as undefined
    | ((naGrens: number, currentYear: number, vandaag: string) => number);
  // naGrens = 12 - realizedThroughMonth, zoals de kaart hem meegeeft.
  check("budget-scenario.tsx exporteert scenarioMaanden", typeof f === "function");
  if (typeof f === "function") {
    check("demo (t/m juli) op 1 november: november en december, niet vijf maanden", f(12 - 7, 2026, "2026-11-01") === 2, String(f(12 - 7, 2026, "2026-11-01")));
    check("bij (t/m oktober) op 15 november: ook twee", f(12 - 10, 2026, "2026-11-15") === 2, String(f(12 - 10, 2026, "2026-11-15")));
    check("in januari, nog niets gerealiseerd: het hele jaar", f(12 - 0, 2027, "2027-01-15") === 12, String(f(12 - 0, 2027, "2027-01-15")));
    check("in december: minstens één maand", f(12 - 11, 2026, "2026-12-10") === 1, String(f(12 - 11, 2026, "2026-12-10")));
    check("alles gerealiseerd: minstens één maand", f(12 - 12, 2026, "2026-12-31") === 1);
    // Een ander jaar dan de kalender (data van vorig jaar bekeken): alleen de gerealiseerde grens telt.
    check("ander jaar dan vandaag: 12 - gerealiseerd", f(12 - 9, 2025, "2026-11-01") === 3, String(f(12 - 9, 2025, "2026-11-01")));
  }
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

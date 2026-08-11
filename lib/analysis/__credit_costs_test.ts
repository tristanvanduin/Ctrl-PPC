// Het creditgrootboek, puur getest. Geen database: leesSaldo/recordCredit zijn IO-wrappers om
// saldoUit/buildLedgerRij heen en worden hier niet aangeroepen.

import { creditKostenVoor, saldoUit, buildLedgerRij, CREDIT_COSTS, type LedgerRij } from "./credit-costs";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("creditKostenVoor");
check(
  "onbekend label geeft null, geen geraden getal",
  creditKostenVoor("nooit-bestaand-label", {}) === null
);
check(
  "bekend label geeft zijn vaste kosten",
  creditKostenVoor("monthly", { monthly: 10 }) === 10
);
check(
  "CREDIT_COSTS staat leeg totdat de prijsbeslissing genomen is",
  Object.keys(CREDIT_COSTS).length === 0
);

console.log("\nsaldoUit");
check("leeg grootboek is saldo nul", saldoUit([]) === 0);

const alleenGrant: LedgerRij[] = [{ event: "grant", amount: 100 }];
check("een toekenning telt op", saldoUit(alleenGrant) === 100);

const grantEnConsume: LedgerRij[] = [
  { event: "grant", amount: 100 },
  { event: "consume", amount: 30 },
];
check("verbruik telt af van de toekenning", saldoUit(grantEnConsume) === 70);

const meerdereGebeurtenissen: LedgerRij[] = [
  { event: "grant", amount: 50 },
  { event: "consume", amount: 10 },
  { event: "grant", amount: 20 },
  { event: "consume", amount: 5 },
];
check(
  "meerdere gebeurtenissen sommeren in volgorde-onafhankelijke saldo",
  saldoUit(meerdereGebeurtenissen) === 55
);

const overVerbruikt: LedgerRij[] = [{ event: "consume", amount: 10 }];
check(
  "verbruik zonder toekenning geeft een negatief saldo, geen clamp op nul -- dat verbergt een reeel tekort",
  saldoUit(overVerbruikt) === -10
);

console.log("\nbuildLedgerRij");
const rij = buildLedgerRij({ agencyId: "bureau-1", event: "consume", amount: 10, reason: "sop:monthly", runKey: "run-1" });
check("agency_id komt door", rij.agency_id === "bureau-1");
check("event komt door", rij.event === "consume");
check("amount komt door", rij.amount === 10);
check("reason komt door", rij.reason === "sop:monthly");
check("run_key komt door", rij.run_key === "run-1");

const rijZonderExtras = buildLedgerRij({ agencyId: "bureau-1", event: "grant", amount: 100 });
check("ontbrekende reason wordt null, niet undefined", rijZonderExtras.reason === null);
check("ontbrekende run_key wordt null, niet undefined", rijZonderExtras.run_key === null);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

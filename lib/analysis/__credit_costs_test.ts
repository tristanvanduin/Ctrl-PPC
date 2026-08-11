// Het creditgrootboek, puur getest. Geen database: leesSaldo/recordCredit/controleerSaldo zijn
// IO-wrappers om saldoUit/buildLedgerRij/beoordeelSaldo heen en worden hier niet aangeroepen.

import { creditKostenVoor, saldoUit, buildLedgerRij, beoordeelSaldo, CREDIT_COSTS, type LedgerRij } from "./credit-costs";

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

console.log("\nbeoordeelSaldo");

// De blueprint-regel: nooit onbeperkt, blokkeer bij saldo < kosten, met een koop/upgrade-tekst.
const genoegSaldo = beoordeelSaldo(100, 30);
check("genoeg saldo blokkeert niet", genoegSaldo.toestand === "genoeg" && !genoegSaldo.blokkeert);
check(
  "genoeg saldo geeft het juiste restant",
  genoegSaldo.toestand === "genoeg" && genoegSaldo.resterend === 70,
  genoegSaldo.toestand === "genoeg" ? String(genoegSaldo.resterend) : ""
);

const preciesGenoeg = beoordeelSaldo(30, 30);
check("precies genoeg blokkeert niet (>=, niet >)", preciesGenoeg.toestand === "genoeg" && !preciesGenoeg.blokkeert);

const ontoereikend = beoordeelSaldo(10, 30);
check("te weinig saldo blokkeert", ontoereikend.toestand === "ontoereikend" && ontoereikend.blokkeert);
check(
  "het tekort is het verschil",
  ontoereikend.toestand === "ontoereikend" && ontoereikend.tekort === 20,
  ontoereikend.toestand === "ontoereikend" ? String(ontoereikend.tekort) : ""
);
check(
  "de tekst wijst naar Credit Pack of upgrade, zoals de blueprint zegt",
  ontoereikend.toestand === "ontoereikend" && /Credit Pack/.test(ontoereikend.tekst) && /upgrade/.test(ontoereikend.tekst)
);

// KEUZE: onbekende kosten blokkeren NOOIT. Een lege CREDIT_COSTS-tabel is "nog geen prijs
// afgesproken", niet "nul credits toegestaan" -- die twee mogen nooit hetzelfde gedrag geven.
const onbekendeKosten = beoordeelSaldo(0, null);
check("onbekende kosten blokkeren nooit, ook bij saldo 0", onbekendeKosten.toestand === "onbekende_kosten" && !onbekendeKosten.blokkeert);

// KEUZE: een onleesbaar saldo (leesSaldo gaf null, DB-storing) blokkeert NOOIT. Zou dit als 0
// behandeld worden, dan blokkeert een tijdelijke storing een analyse die dat normaal niet zou doen.
const onbekendSaldo = beoordeelSaldo(null, 30);
check(
  "een onleesbaar saldo blokkeert nooit, ook al is de prijs wel bekend",
  onbekendSaldo.toestand === "onbekend_saldo" && !onbekendSaldo.blokkeert
);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

// De Second Opinion-trialpoort, puur getest. Geen database: leesSecondOpinionTrialSaldo/
// verbruikSecondOpinionTrial/controleerSecondOpinionTrial zijn IO-wrappers en worden hier niet
// aangeroepen -- alleen beoordeelSecondOpinionTrial, dezelfde vorm als __credit_costs_test.ts.

import { beoordeelSecondOpinionTrial, SECOND_OPINION_TRIAL_REDEN } from "./second-opinion-trial";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("beoordeelSecondOpinionTrial");

check("de ledger-reden is stabiel", SECOND_OPINION_TRIAL_REDEN === "second-opinion-trial");

const foundation = beoordeelSecondOpinionTrial("basis", 100);
check(
  "Foundation (basis) blokkeert altijd, ongeacht saldo",
  foundation.toestand === "foundation" && !foundation.toegestaan
);

const foundationOnbekendeLicentie = beoordeelSecondOpinionTrial(null, 100);
check(
  "onbekende licentie normaliseert naar basis en blokkeert dus ook",
  foundationOnbekendeLicentie.toestand === "foundation" && !foundationOnbekendeLicentie.toegestaan
);

const beschikbaar = beoordeelSecondOpinionTrial("growth", 3);
check(
  "betaalde tier met saldo > 0 mag draaien",
  beschikbaar.toestand === "beschikbaar" && beschikbaar.toegestaan
);
check(
  "het resterende aantal komt door",
  beschikbaar.toestand === "beschikbaar" && beschikbaar.resterend === 3,
  beschikbaar.toestand === "beschikbaar" ? String(beschikbaar.resterend) : ""
);

const uitgeputNul = beoordeelSecondOpinionTrial("growth", 0);
check("saldo 0 is uitgeput, blokkeert", uitgeputNul.toestand === "uitgeput" && !uitgeputNul.toegestaan);

const uitgeputNegatief = beoordeelSecondOpinionTrial("growth", -2);
check(
  "een negatief saldo (dubbel verbruikt) is ook uitgeput, niet 'beschikbaar met -2 over'",
  uitgeputNegatief.toestand === "uitgeput" && !uitgeputNegatief.toegestaan
);

// KEUZE: een onbekend saldo (leesfout, of de trigger uit migratie 074 heeft nog niet gevuurd)
// blokkeert NOOIT voor betaalde tiers -- zelfde principe als beoordeelSaldo in credit-costs.ts.
// Second Opinion had hiervoor helemaal geen poort; "we weten het niet" mag hier nooit strenger
// zijn dan het gedrag van gisteren.
const onbekendSaldo = beoordeelSecondOpinionTrial("scale", null);
check(
  "onbekend saldo blokkeert niet voor een betaalde tier",
  onbekendSaldo.toestand === "onbekend_saldo" && onbekendSaldo.toegestaan
);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

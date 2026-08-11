// De SOP-dekking, puur getest. Geen database: telAccountsMetSops/controleerDekking zijn
// IO-wrappers om beoordeelDekking heen en worden hier niet aangeroepen.

import { beoordeelDekking, SOP_DEKKING } from "./sop-dekking";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("beoordeelDekking");

const ruim = beoordeelDekking(10, 20);
check("binnen dekking blokkeert niet als toestand", ruim.toestand === "binnen_dekking");
check(
  "de ruimte is het verschil",
  ruim.toestand === "binnen_dekking" && ruim.ruimte === 10,
  ruim.toestand === "binnen_dekking" ? String(ruim.ruimte) : ""
);

const preciesOp = beoordeelDekking(20, 20);
check("precies op de limiet is nog binnen dekking (<=, niet <)", preciesOp.toestand === "binnen_dekking");

const over = beoordeelDekking(25, 20);
check("meer accounts dan dekking is overschreden", over.toestand === "overschreden");
check(
  "het overtal is het verschil",
  over.toestand === "overschreden" && over.overtal === 5,
  over.toestand === "overschreden" ? String(over.overtal) : ""
);
check(
  "de tekst noemt alle drie de keuzes",
  over.toestand === "overschreden" &&
    /upgrade/.test(over.tekst) && /bij/.test(over.tekst) && /uit/.test(over.tekst)
);

console.log("\nSOP_DEKKING");
check("basis (gratis) heeft geen automatische-SOP-dekking", SOP_DEKKING.basis === 0);
check(
  "de tiers zijn oplopend, core tot professional",
  SOP_DEKKING.core < SOP_DEKKING.growth &&
    SOP_DEKKING.growth < SOP_DEKKING.scale &&
    SOP_DEKKING.scale < SOP_DEKKING.professional
);
check("enterprise kent (nog) geen accountplafond", !Number.isFinite(SOP_DEKKING.enterprise));

// Basis heeft dekking 0: elk account met sops_enabled=true op een basis-bureau is per definitie
// overschreden. Dat is de bedoelde uitkomst (SOP's zijn een betaalde tier), geen edge case.
const basisMetEenAccount = beoordeelDekking(1, SOP_DEKKING.basis);
check(
  "een basis-bureau met 1 account op automatisch is al overschreden",
  basisMetEenAccount.toestand === "overschreden"
);
const basisZonderAccounts = beoordeelDekking(0, SOP_DEKKING.basis);
check(
  "een basis-bureau zonder accounts op automatisch zit binnen zijn (nul) dekking",
  basisZonderAccounts.toestand === "binnen_dekking"
);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

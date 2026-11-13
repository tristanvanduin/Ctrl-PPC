// De kopregel van het Portfolio zegt over welk kanaal hij gaat en zegt alleen "alles op schema" als
// er een doel getoetst is (lib/portfolio-kop.ts).
// Draaien: tsx lib/__portfolio_kop_test.ts
//
// Tegenvoorbeeld uit de doorlichting van 13 november: "1 actieve klanten · 0 groeiend · alles op
// schema" bij een klant op -7% tegen vorig jaar, met op Doelen & voortgang "ACTIE VEREIST", en
// nergens op de pagina het woord Google.

import { STIP_LEGENDA, gezondheidStip, portfolioKopregel } from "./portfolio-kop";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const greentech = portfolioKopregel({ actief: 1, groeiend: 0, aandacht: 0, doelGetoetst: false });
check("geen doel getoetst: niet 'alles op schema'", !greentech.includes("alles op schema"), greentech);
check("zegt wat er gemeten is", greentech.includes("geen klant meer dan 10% onder vorig jaar"), greentech);
check("zegt dat het alleen Google Ads is", greentech.includes("alleen Google Ads"), greentech);
check("enkelvoud bij één klant", greentech.startsWith("1 actieve klant ·"), greentech);
check("met een getoetst doel mag het", portfolioKopregel({ actief: 3, groeiend: 1, aandacht: 0, doelGetoetst: true }).includes("alles op schema"));
check("aandacht gaat voor", portfolioKopregel({ actief: 3, groeiend: 1, aandacht: 2, doelGetoetst: true }).includes("2 vragen aandacht"));

// De stip: de legenda zei "Oranje: tussen -10% en +10%", de code kleurde ook +30% bij ROAS 1,4 oranje.
check("+30% met ROAS onder 2: oranje", gezondheidStip(true, 30, 1.4) === "oranje");
check("leadgen zonder omzet (ROAS 0) wordt nooit groen", gezondheidStip(true, 80, 0) !== "groen");
check("+30% met ROAS 3: groen", gezondheidStip(true, 30, 3) === "groen");
check("-12%: rood", gezondheidStip(true, -12, 5) === "rood");
check("-10% precies: rood (niet boven de grens)", gezondheidStip(true, -10, 5) === "rood");
check("zonder data: grijs", gezondheidStip(false, 50, 5) === "grijs");
check("de legenda zegt niet meer 'tussen -10% en +10%'", !STIP_LEGENDA.includes("tussen -10% en +10%"), STIP_LEGENDA);
check("de legenda noemt groei met lage ROAS als oranje", STIP_LEGENDA.includes("ROAS onder 2"), STIP_LEGENDA);

console.log(`portfolio kop: ${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

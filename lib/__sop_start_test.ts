// Een klik die een betaalde analyse start, vraagt eerst om bevestiging en start niets in de demo
// zonder sessie (lib/sop-start.ts).
// Draaien: tsx lib/__sop_start_test.ts
//
// Het tegenvoorbeeld uit de doorlichting van 13 november: in een ?demo=1-sessie zonder login ging
// bij één klik op Weekly, Bi-weekly of Monthly direct een POST naar de analyseroute, zonder
// bevestiging; de demo-blokkade stond standaard uit.

import { sopBevestigVraag, sopStartBeleid, rapportBevestigVraag } from "./sop-start";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const basis = { demoKlant: true, ingelogd: false, laden: false, blokkadeVlag: false };
const zonder = sopStartBeleid(basis);
check("demo zonder sessie: geen run, ook zonder blokkadevlag", !zonder.mag, JSON.stringify(zonder));
check("en zegt waarom", !zonder.mag && zonder.reden.includes("sessie"));
check("demo terwijl de sessie nog geladen wordt: nog geen run", !sopStartBeleid({ ...basis, laden: true }).mag);
check("demo met sessie: mag", sopStartBeleid({ ...basis, ingelogd: true }).mag);
check("demo met sessie en blokkadevlag: niet", !sopStartBeleid({ ...basis, ingelogd: true, blokkadeVlag: true }).mag);
check("echte klant: mag (de bevestiging volgt)", sopStartBeleid({ ...basis, demoKlant: false }).mag);

const vraag = sopBevestigVraag("Monthly", "Google Ads", true);
check("de bevestiging noemt de analyse en het kanaal", vraag.includes("Monthly") && vraag.includes("Google Ads"), vraag);
check("de bevestiging zegt dat het kost en wat het overschrijft", vraag.includes("kost") && vraag.includes("vervangt"), vraag);
check("het rapport vraagt ook", rapportBevestigVraag().includes("kost"));

console.log(`sop-start: ${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);

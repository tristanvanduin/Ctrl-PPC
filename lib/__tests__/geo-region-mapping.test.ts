export {};
// Verificatie van de VS-regio-join (regionNameToUsps): Google Ads levert regio's als Engelse
// staatsnaam ("California"), terwijl de staten-kaart op USPS-codes ("CA") tekent. Als deze
// mapping stilletjes faalt, blijft de staten-drilldown leeg zonder foutmelding — vandaar een test
// die zowel de treffers als de bewuste missers vastlegt.
// Draaien: npx tsx lib/__tests__/geo-region-mapping.test.ts

import { regionNameToUsps, stateLabel, FIPS_TO_USPS } from "../geo/us-fips";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. Engelse staatsnaam → USPS");
check('"California" → CA', regionNameToUsps("California") === "CA");
check('"New York" → NY (meerwoordig)', regionNameToUsps("New York") === "NY");
check('"District of Columbia" → DC', regionNameToUsps("District of Columbia") === "DC");
check('"Puerto Rico" → PR', regionNameToUsps("Puerto Rico") === "PR");

console.log("\n2. Ongevoelig voor casing en witruimte (sync-data is niet altijd netjes)");
check('"california" → CA', regionNameToUsps("california") === "CA");
check('"  Texas  " → TX', regionNameToUsps("  Texas  ") === "TX");
check('"NEW JERSEY" → NJ', regionNameToUsps("NEW JERSEY") === "NJ");

console.log("\n3. Een al-correcte USPS-code komt ongewijzigd terug");
check('"CA" → CA', regionNameToUsps("CA") === "CA");
check('"tx" → TX', regionNameToUsps("tx") === "TX");

console.log("\n4. Geen valse treffers: onbekend blijft null (liever leeg dan verkeerd ingekleurd)");
check("null → null", regionNameToUsps(null) === null);
check('"" → null', regionNameToUsps("") === null);
check('"Noord-Holland" → null (geen VS-staat)', regionNameToUsps("Noord-Holland") === null);
check('"Ontario" → null (Canadese provincie)', regionNameToUsps("Ontario") === null);
check('"ZZ" → null (bestaat niet)', regionNameToUsps("ZZ") === null);

console.log("\n5. Elke staat uit de kaart-geometrie is ook labelbaar (geen gat op de kaart)");
const uspsCodes = Object.values(FIPS_TO_USPS);
const unlabeled = uspsCodes.filter((c) => stateLabel(c) === c);
check(`alle ${uspsCodes.length} staten hebben een label`, unlabeled.length === 0, unlabeled.join(","));

console.log("\n6. Rondreis: label → terug naar dezelfde code (voor de staten die Engels heten)");
check("California ↔ CA", regionNameToUsps("California") === "CA" && stateLabel("CA") === "Californië");
check("Texas ↔ TX", regionNameToUsps("Texas") === "TX" && stateLabel("TX") === "Texas");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

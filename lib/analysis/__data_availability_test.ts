// Test voor checkStepDataAvailability (masterplan 17.14). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__data_availability_test.ts

import { checkStepDataAvailability } from "./data-availability";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const LEGE_INPUT = {
  audienceData: [], deviceData: [], checkoutData: [], creativeData: [], keywordData: [],
  productData: [], countryData: [], networkData: [], scheduleData: [], searchTermData: [],
};

console.log("checkStepDataAvailability: stap 7 kent zijn derde bron (search term waste)");
{
  // Live testrun 17 augustus 2026 (demo-greentech): ads_keyword_performance_monthly en
  // ads_search_terms_wasteful zijn TWEE aparte tabellen. Een klant kan de ene leeg hebben en de
  // andere gevuld -- vóór deze fix kende stap 7 alleen de eerste twee dimensies (keyword+product),
  // dus zo'n klant kreeg `alle dimensies unavailable` terwijl er wel degelijk bruikbare
  // zoektermdata was.
  const availability = checkStepDataAvailability({
    ...LEGE_INPUT,
    keywordData: [], // leeg: geen ads_keyword_performance_monthly
    productData: [], // leeg: geen product feed
    searchTermData: [{ search_term: "hydroponics diy home", cost: 160, conversions: 0 }], // wél gevuld
  });
  const step7 = availability.find((a) => a.step === 7)!;
  const searchTermDim = step7.dimensions.find((d) => d.name === "Search term waste data");
  check("stap 7 heeft nu drie dimensies", step7.dimensions.length === 3, String(step7.dimensions.length));
  check("de zoektermdimensie is gevonden en beschikbaar", searchTermDim?.available === true, JSON.stringify(searchTermDim));
  check("niet elke dimensie is unavailable (dus geen allUnavailable meer)", !step7.dimensions.every((d) => !d.available));
}

console.log("checkStepDataAvailability: stap 7 zonder enige bron blijft terecht 'alles ontbreekt'");
{
  const availability = checkStepDataAvailability(LEGE_INPUT);
  const step7 = availability.find((a) => a.step === 7)!;
  check("alle drie dimensies ontbreken", step7.dimensions.every((d) => !d.available));
  check("promptNote meldt de zoektermdata er nu ook expliciet bij", step7.promptNote.toLowerCase().includes("search term waste"), step7.promptNote);
}

console.log("checkStepDataAvailability: stap 9 kent zijn tweede bron (geo) na de fase4-samenvoeging");
{
  // Live testrun 18 augustus 2026 (4 echte klanten van hetzelfde bureau): stap 9 heet "Doelgroep- &
  // Geosegmenten" sinds oud-stap-9 (Audience) en oud-stap-11 (Geo) zijn samengevoegd in
  // lib/prompts/monthly-v2.ts ("F4 fase4"), maar deze lijst kende alleen de audience-bron. Bij
  // alle 4 klanten ontbrak audience-data (heel gewoon) maar was geo-data er wel -- vóór deze fix
  // viel `allUnavailable` dan alsnog op true uit voor de HELE stap, en de validator keurde
  // daardoor de wel-echte, wel-deterministische geo-findings (GB/NL/DE/BE) af. 100% reproductie,
  // blokkeerde elke maandanalyse in die test.
  const availability = checkStepDataAvailability({
    ...LEGE_INPUT,
    audienceData: [], // leeg: heel gewoon, geen audience-koppeling
    countryData: [{ country: "NL", cost: 5549.12, conversions: 257.1 }], // wél gevuld
  });
  const step9 = availability.find((a) => a.step === 9)!;
  const geoDim = step9.dimensions.find((d) => d.name === "Geo data");
  check("stap 9 heeft nu twee dimensies", step9.dimensions.length === 2, String(step9.dimensions.length));
  check("de geo-dimensie is gevonden en beschikbaar", geoDim?.available === true, JSON.stringify(geoDim));
  check("niet elke dimensie is unavailable (dus geen allUnavailable meer)", !step9.dimensions.every((d) => !d.available));
}

console.log("checkStepDataAvailability: stap 9 zonder audience én geo blijft terecht 'alles ontbreekt'");
{
  const availability = checkStepDataAvailability(LEGE_INPUT);
  const step9 = availability.find((a) => a.step === 9)!;
  check("beide dimensies ontbreken", step9.dimensions.every((d) => !d.available));
}

console.log("checkStepDataAvailability: andere stappen blijven ongewijzigd door de nieuwe dimensie");
{
  const metAlles = checkStepDataAvailability({ ...LEGE_INPUT, keywordData: [{ x: 1 }], searchTermData: [{ x: 1 }] });
  const step5 = metAlles.find((a) => a.step === 5)!;
  check("stap 5 heeft nog steeds maar 1 dimensie (search term waste hoort daar niet bij)", step5.dimensions.length === 1, String(step5.dimensions.length));
  const step6 = metAlles.find((a) => a.step === 6)!;
  check("stap 6 (Product data) blijft ongemoeid", step6.dimensions.length === 1 && step6.dimensions[0].name === "Product data");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

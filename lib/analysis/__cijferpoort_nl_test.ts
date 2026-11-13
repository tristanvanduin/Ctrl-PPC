// De cijferpoort leest Nederlandse getallen en houdt euro's en percentages uit elkaar.
// Draaien: node_modules/.bin/tsx lib/analysis/__cijferpoort_nl_test.ts
//
// Elk geval hieronder is een tegenvoorbeeld uit de doorlichting van 13 november (sectie 3): met
// de grounding "Kosten: € 1.650,42 (was € 1.412,10); CPA € 39,29; +16,9%" las de oude poort de
// toegestane set als [17, 2, 1, 39] en liet hij al deze verzonnen getallen door.

import { extractGroundedNumbers, gateUngroundedNumbers } from "./weekly-number-gate";
import { leesGetal, leesCijfers } from "./brondata-toets";
import { groundedNumbersFromCluster } from "./monthly-structured";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("Getallen in nl-NL");
check("€ 1.650 is 1650", leesGetal("1.650")?.waarde === 1650);
check("1.650,42 is 1650,42", leesGetal("1.650,42")?.waarde === 1650.42);
check("12.480,50 is 12480,5", leesGetal("12.480,50")?.waarde === 12480.5);
check("1 650 (spatie) is 1650", leesGetal("1 650")?.waarde === 1650);
check("12,5 is twaalf en een half", leesGetal("12,5")?.waarde === 12.5);
check("2759.82 blijft een Engelse decimaal", leesGetal("2759.82")?.waarde === 2759.82);
check("de afrondingsstap volgt de schrijfwijze", leesGetal("94,84")?.stap === 0.01 && leesGetal("1.651")?.stap === 1);
check("een rond getal mag iets ruimer, nooit meer dan 2%", leesGetal("1.650")?.stap === 10 && leesGetal("500")?.stap === 10, String(leesGetal("500")?.stap));
check("€ 3 miljoen is drie miljoen", leesCijfers("budget van € 3 miljoen")[0]?.getal.waarde === 3_000_000);
check("1650 euro zonder €-teken is een bedrag", leesCijfers("1650 euro extra")[0]?.soort === "bedrag");
check("bedrag met spatie als duizendtal", leesCijfers("€ 12 480,50")[0]?.getal.waarde === 12480.5);

console.log("\nDe toegestane set");
const grond = extractGroundedNumbers("Kosten: € 1.650,42 (was € 1.412,10); CPA € 39,29; +16,9%");
check("bedragen als hele bedragen", JSON.stringify(grond.bedragen) === JSON.stringify([1650.42, 1412.1, 39.29]), JSON.stringify(grond.bedragen));
check("percentages apart", JSON.stringify(grond.procenten) === JSON.stringify([16.9]), JSON.stringify(grond.procenten));
check("blijft een gewone lijst voor oude aanroepers", Array.isArray(grond) && grond.includes(1650.42));

console.log("\nDe tegenvoorbeelden worden nu gevangen");
const vangt = (tekst: string) => gateUngroundedNumbers(tekst, grond).hadUngrounded;
check("'Verhoog budget naar € 2.400 of € 1.900'", vangt("Verhoog budget naar € 2.400 of € 1.900"));
check("'bespaar 2.400 euro'", vangt("bespaar 2.400 euro"));
check("'Verlaag de CPA naar € 17' (17 kwam uit 16,9%)", vangt("Verlaag de CPA naar € 17"));
check("'CTR stijgt 39%' (39 kwam uit € 39,29)", vangt("CTR stijgt 39%"));
check("'CPA wordt € 38,60' (rondde af naar 39)", vangt("CPA wordt € 38,60"));
check("'bespaar 2%' (2 kwam uit € 1.650)", vangt("bespaar 2%"));
check("'€ 5.000' (las als 5)", vangt("Investeer € 5.000"));
check("'€ 3 miljoen'", vangt("Dat levert € 3 miljoen op"));

console.log("\nWat wel klopt, blijft staan");
check("'€ 1.650' (afgerond citaat van € 1.650,42)", !vangt("De kosten waren € 1.650"));
check("'1650 euro'", !vangt("De kosten waren 1650 euro"));
check("'€ 39,29'", !vangt("De CPA is € 39,29"));
check("'16,9%'", !vangt("Een stijging van 16,9%"));
check("een venster als 1-2 weken telt niet", !vangt("Evalueer over 1-2 weken"));
const g = gateUngroundedNumbers("Verhoog budget naar € 2.400 en houd € 1.650 aan", grond);
check("alleen het verzonnen bedrag wordt vervangen", g.text === "Verhoog budget naar [bedrag niet uit data] en houd € 1.650 aan", g.text);
check("en gerapporteerd", JSON.stringify(g.ungrounded) === JSON.stringify([2400]), JSON.stringify(g.ungrounded));

console.log("\nDe gaten uit de herstelronde: ,-, bereiken, ROAS en de maandcluster");
{
  const bedragen = (t: string) => leesCijfers(t).filter((c) => c.soort === "bedrag").map((c) => c.getal.waarde);
  check("'2.400,- euro' is een bedrag van 2400", JSON.stringify(bedragen("verhoog naar 2.400,- euro")) === "[2400]", JSON.stringify(leesCijfers("verhoog naar 2.400,- euro")));
  check("'2.400,-' zonder euro ook", JSON.stringify(bedragen("verhoog naar 2.400,- per maand")) === "[2400]");
  check("'€ 2.400,-' een keer", JSON.stringify(bedragen("verhoog naar € 2.400,-")) === "[2400]");
  check("'€ 1.650 tot 2.400': beide eindes", JSON.stringify(bedragen("tussen € 1.650 tot 2.400")) === "[1650,2400]", JSON.stringify(bedragen("tussen € 1.650 tot 2.400")));
  check("'€ 1.650-2.400': beide eindes", JSON.stringify(bedragen("budget € 1.650-2.400")) === "[1650,2400]", JSON.stringify(bedragen("budget € 1.650-2.400")));
  const pct = leesCijfers("groei van 10-15%").filter((c) => c.soort === "percentage").map((c) => c.getal.waarde);
  check("'10-15%': ook de 10 is een percentage", JSON.stringify(pct) === "[10,15]", JSON.stringify(pct));
  check("'CPA 45' is een bedrag, geen telling", leesCijfers("houd de CPA 45 aan")[0]?.soort === "bedrag");
  check("'CTR 2,1' is een percentage", leesCijfers("CTR 2,1 deze week")[0]?.soort === "percentage");

  check("verzonnen '2.400,- euro' wordt gevangen", vangt("Verhoog het budget naar 2.400,- euro"));
  check("het tweede eind van '€ 1.650 tot 2.400' wordt getoetst", vangt("Houd het budget tussen € 1.650 tot 2.400"));
  check("'€ 1.650-2.400' ook", vangt("Houd het budget op € 1.650-2.400"));
  check("een bereik binnen de data blijft staan", !vangt("Kosten tussen € 1.412 tot 1.650"));
  // Het rapport: in de oude poort passeerde 'ROAS van 4,8' omdat aantallen werden overgeslagen.
  const metRoas = extractGroundedNumbers("ROAS 3,2 bij € 1.650 kosten");
  check("'ROAS van 4,8' zonder 4,8 in de grond wordt gevangen", gateUngroundedNumbers("Mik op een ROAS van 4,8", metRoas).hadUngrounded);
  check("'ROAS van 3,2' uit de grond blijft staan", !gateUngroundedNumbers("Houd een ROAS van 3,2 aan", metRoas).hadUngrounded);
  check("de markering zegt aantal", gateUngroundedNumbers("Mik op een ROAS van 4,8", metRoas).text.includes("[aantal niet uit data]"));
  check("tellingen blijven buiten de poort", !gateUngroundedNumbers("Dat zijn 54 klikken", metRoas).hadUngrounded);
}
{
  // monthly-structured gaf een kale number[] door: € 17 was gegrond omdat change_pct 16,9 was.
  const cluster = { findings: [
    { metric: "cpa", current_value: 39.29, previous_value: 33.61, change_pct: 16.9 },
    { metric: "search_budget_lost_is", current_value: 0.28, previous_value: null, change_pct: null },
    { metric: "conversions", current_value: 42, previous_value: null, change_pct: null },
  ] } as unknown as Parameters<typeof groundedNumbersFromCluster>[0];
  const g = groundedNumbersFromCluster(cluster);
  check("maandcluster: CPA is een bedrag", JSON.stringify(g.bedragen) === "[39.29,33.61]", JSON.stringify(g.bedragen));
  check("maandcluster: change_pct en het impressieaandeel (als 28) zijn percentages", (g.procenten ?? []).length === 2 && (g.procenten ?? []).some((p) => Math.abs(p - 28) < 1e-9) && (g.procenten ?? []).includes(16.9), JSON.stringify(g.procenten));
  check("maandcluster: '€ 17' is niet gegrond op 16,9%", gateUngroundedNumbers("Verlaag de CPA naar € 17", g).hadUngrounded);
  check("maandcluster: '€ 42' is niet gegrond op 42 conversies", gateUngroundedNumbers("Bespaar € 42", g).hadUngrounded);
  check("maandcluster: '28%' wel", !gateUngroundedNumbers("budget lost IS van 28%", g).hadUngrounded);
  check("maandcluster: '€ 39,29' wel", !gateUngroundedNumbers("De CPA is € 39,29", g).hadUngrounded);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

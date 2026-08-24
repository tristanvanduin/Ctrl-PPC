// De voorberekende maandpacing voor de bi-weekly.
// Draaien: npx tsx lib/analysis/__pacing_facts_test.ts
//
// Waarom deze test er is: dit getal verving een rekenregel die het MODEL uitvoerde
// ("Prognose maandeinde = (huidige waarde / verstreken dagen) x totaal dagen in maand"), en die
// regel werd twee regels later in dezelfde preambule tegengesproken. Zodra de route het voorrekent,
// is het een bewering van de code en niet meer van het model -- en dan hoort hij getest te zijn.
//
// De randgevallen hieronder zijn de gevallen waar een prognose stilzwijgend onzin oplevert: dag 1
// van de maand (deling door bijna niets), februari en de schrikkeldag (verkeerde noemer), en een
// target van nul (deling door nul die als "0%" zou lezen).

import { computePacingFacts, formatPacingFacts, daysInMonthOf } from "./comparison-facts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("daysInMonthOf kent de kalender");
check("januari 31", daysInMonthOf("2026-01-15") === 31);
check("april 30", daysInMonthOf("2026-04-15") === 30);
check("februari 28 in 2026", daysInMonthOf("2026-02-15") === 28);
check("februari 29 in een schrikkeljaar", daysInMonthOf("2028-02-15") === 29);
check("december 31", daysInMonthOf("2026-12-31") === 31);
check("onleesbare datum valt terug op 30", daysInMonthOf("kapot") === 30);

console.log("\nDe projectie is een rechte lijn en zegt dat ook");
{
  // Halverwege een maand van 30 dagen: de projectie is exact het dubbele van de stand.
  const f = computePacingFacts({ mtd: { spend: 1500, conversies: 30 }, today: "2026-04-15", targets: null });
  check("dag en maandlengte kloppen", f.daysElapsed === 15 && f.daysInMonth === 30, `${f.daysElapsed}/${f.daysInMonth}`);
  const spend = f.metrics.find((m) => m.metric === "spend")!;
  check("spend verdubbelt", spend.projected === 3000, String(spend.projected));
  check("de stand blijft de stand", spend.mtd === 1500);
  check("zonder target geen percentage", spend.deltaPct === null);
}

console.log("\nTargets leveren een percentage, en nul levert er geen");
{
  const f = computePacingFacts({
    mtd: { conversies: 30 },
    today: "2026-04-15",
    targets: { conversies: 100 },
  });
  const c = f.metrics[0];
  // 30 in 15 dagen -> 60 over 30 dagen -> 40% onder een target van 100.
  check("prognose 60", c.projected === 60, String(c.projected));
  check("delta -40%", c.deltaPct === -40, String(c.deltaPct));
}
{
  const f = computePacingFacts({ mtd: { conversies: 30 }, today: "2026-04-15", targets: { conversies: 0 } });
  // Een target van nul mag GEEN percentage opleveren: -Infinity of "0%" leest allebei als een
  // gemeten uitspraak, en dat is precies het verzonnen getal waar de cijferdiscipline over gaat.
  check("een target van nul geeft null, geen Infinity", f.metrics[0].deltaPct === null, String(f.metrics[0].deltaPct));
}

console.log("\nDag 1 van de maand blaast niet op");
{
  const f = computePacingFacts({ mtd: { spend: 50 }, today: "2026-04-01", targets: null });
  check("dag 1 telt als 1", f.daysElapsed === 1);
  check("projectie is 30x de eerste dag", f.metrics[0].projected === 1500, String(f.metrics[0].projected));
  check("geen deling door nul", Number.isFinite(f.metrics[0].projected));
}

console.log("\nDe tekst noemt de aanname hardop");
{
  const t = formatPacingFacts(computePacingFacts({ mtd: { spend: 1500 }, today: "2026-04-15", targets: null }));
  check("noemt de stand in dagen", t.includes("dag 15 van 30"));
  check("noemt dat het een rechte lijn is", t.toUpperCase().includes("RECHTE LIJN"));
  // Zonder deze zin leest de prognose als een verwachting, en dat is hij niet: het maandeinde-effect
  // zit er niet in. De preambule van de bi-weekly verwijst hier expliciet naar.
  check("waarschuwt voor het maandeinde-effect", t.includes("maandeinde-effect"));
  check("zegt dat het een ondergrens is", t.includes("ondergrens"));
}

console.log("\nGeen metrieken, geen blok");
check("leeg blijft leeg", formatPacingFacts(computePacingFacts({ mtd: {}, today: "2026-04-15", targets: null })) === "");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

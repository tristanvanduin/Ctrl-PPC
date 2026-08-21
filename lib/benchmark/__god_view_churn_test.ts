// Test voor de God View-churnlaag. Deterministisch, geen IO.
// Draaien: npx tsx lib/benchmark/__god_view_churn_test.ts

import { bouwGodViewChurnCellen, CHURN_CHANNEL, type GodViewChurnInvoerRij } from "./god-view-churn";
import { MIN_ACCOUNTS, MIN_BUREAUS, MIN_ACCOUNTS_COMBINATIE, MIN_BUREAUS_COMBINATIE } from "./cel";
import type { Licht } from "@/lib/adoptie/account-stoplicht";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rij(o: Partial<GodViewChurnInvoerRij> & { clientId: string; agencyId: string }): GodViewChurnInvoerRij {
  return { bedrijfsmodel: "b2b", niche: null, licht: "groen", ...o };
}

function accounts(n: number, bureaus: number, licht: Licht, o: Partial<GodViewChurnInvoerRij> = {}): GodViewChurnInvoerRij[] {
  return Array.from({ length: n }, (_, i) =>
    rij({ clientId: `c${i}`, agencyId: `a${i % bureaus}`, licht, ...o }));
}

console.log("Onder de drempel: geen telling");
{
  const cellen = bouwGodViewChurnCellen(accounts(MIN_ACCOUNTS - 1, MIN_BUREAUS, "rood"));
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("cel bestaat", !!cel);
  check("churn is null onder de drempel", cel.churn === null, JSON.stringify(cel));
}

console.log("Op de drempel: telling verschijnt en klopt");
{
  const rood = accounts(6, MIN_BUREAUS, "rood");
  const amber = accounts(2, MIN_BUREAUS, "amber").map((r, i) => ({ ...r, clientId: `amber${i}` }));
  const groen = accounts(2, MIN_BUREAUS, "groen").map((r, i) => ({ ...r, clientId: `groen${i}` }));
  const cellen = bouwGodViewChurnCellen([...rood, ...amber, ...groen]);
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("churn bestaat op de drempel (10 accounts, 4 bureaus)", cel.churn !== null, JSON.stringify(cel));
  check("6 rood geteld", cel.churn?.rood === 6, `${cel.churn?.rood}`);
  check("2 amber geteld", cel.churn?.amber === 2, `${cel.churn?.amber}`);
  check("2 groen geteld", cel.churn?.groen === 2, `${cel.churn?.groen}`);
}

console.log("Channel is altijd 'account', nooit een los kanaal");
{
  const cellen = bouwGodViewChurnCellen(accounts(MIN_ACCOUNTS, MIN_BUREAUS, "rood"));
  check("elke cel heeft channel=account", cellen.every((c) => c.sleutel.channel === CHURN_CHANNEL));
}

console.log("Combinatie-diepte: hogere drempel dan los model of los niche");
{
  const acc = accounts(MIN_ACCOUNTS_COMBINATIE - 1, MIN_BUREAUS_COMBINATIE, "rood", { niche: "saas" });
  const cellen = bouwGodViewChurnCellen(acc);
  const modelCel = cellen.find((c) => c.sleutel.model === "b2b" && c.sleutel.niche === null)!;
  const combiCel = cellen.find((c) => c.sleutel.model === "b2b" && c.sleutel.niche === "saas")!;
  check("los model haalt zijn (lagere) drempel", modelCel.churn !== null, JSON.stringify(modelCel));
  check("combinatie haalt de eigen (hogere) drempel nog niet", combiCel.churn === null, JSON.stringify(combiCel));
}

console.log("Sortering: cellen met meer rood+amber eerst");
{
  const veelChurn = accounts(MIN_ACCOUNTS, MIN_BUREAUS, "rood", { niche: "saas" });
  const weinigChurn = accounts(MIN_ACCOUNTS, MIN_BUREAUS, "groen", { bedrijfsmodel: "b2c", niche: "mode" })
    .map((r, i) => ({ ...r, clientId: `b2c${i}` }));
  const cellen = bouwGodViewChurnCellen([...veelChurn, ...weinigChurn]);
  const eerste = cellen.find((c) => c.churn !== null)!;
  check("cel met het meeste rood+amber staat vooraan", (eerste.churn?.rood ?? 0) > 0, JSON.stringify(eerste));
}

console.log("Testmodus-drempels: optioneel argument, nooit de standaard");
{
  const acc = accounts(2, 1, "rood");
  const standaard = bouwGodViewChurnCellen(acc);
  const standaardCel = standaard.find((c) => c.sleutel.model === "b2b")!;
  check("zonder argument blijft de echte drempel gelden", standaardCel.churn === null, JSON.stringify(standaardCel));

  const testmodus = bouwGodViewChurnCellen(acc, { minAccounts: 1, minBureaus: 1, minAccountsCombinatie: 2, minBureausCombinatie: 1 });
  const testmodusCel = testmodus.find((c) => c.sleutel.model === "b2b")!;
  check("met expliciet verlaagde drempel wordt dezelfde cel wel deelbaar", testmodusCel.churn !== null, JSON.stringify(testmodusCel));
  check("telling blijft correct in testmodus", testmodusCel.churn?.rood === 2, `${testmodusCel.churn?.rood}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

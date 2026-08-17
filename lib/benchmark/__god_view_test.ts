// Test voor de God View-kernlaag (masterplan 16.7). Deterministisch, geen IO.
// Draaien: npx tsx lib/benchmark/__god_view_test.ts

import { bouwGodViewCellen, type GodViewInvoerRij } from "./god-view";
import { MIN_ACCOUNTS, MIN_BUREAUS, MIN_ACCOUNTS_COMBINATIE, MIN_BUREAUS_COMBINATIE } from "./cel";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rij(o: Partial<GodViewInvoerRij> & { clientId: string; agencyId: string }): GodViewInvoerRij {
  return { channel: "google", bedrijfsmodel: "b2b", niche: null, spend: 1000, conversions: 10, conversionValue: 4000, ...o };
}

// Genereert n accounts verspreid over minstens `bureaus` verschillende bureaus.
function accounts(n: number, bureaus: number, o: Partial<GodViewInvoerRij> = {}): GodViewInvoerRij[] {
  return Array.from({ length: n }, (_, i) =>
    rij({ clientId: `c${i}`, agencyId: `a${i % bureaus}`, ...o }));
}

// ── Onder de drempel: geen enkele metric, ook geen deelmetric ──────────────

console.log("Onder de drempel");
{
  const cellen = bouwGodViewCellen(accounts(MIN_ACCOUNTS - 1, MIN_BUREAUS));
  check("cel bestaat (model b2b)", cellen.some((c) => c.sleutel.model === "b2b"));
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("metrics is null onder de accountdrempel", cel.metrics === null, JSON.stringify(cel));
}
{
  // Genoeg accounts, te weinig bureaus (drie bureaus met elk vier klanten = 12 accounts, 3 bureaus).
  const cellen = bouwGodViewCellen(accounts(12, 3));
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("metrics is null onder de bureaudrempel ondanks genoeg accounts", cel.metrics === null, JSON.stringify(cel));
}

// ── Op en boven de drempel: metrics verschijnen ─────────────────────────────

console.log("Op de drempel");
{
  const cellen = bouwGodViewCellen(accounts(MIN_ACCOUNTS, MIN_BUREAUS));
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("metrics bestaat op de drempel", cel.metrics !== null, JSON.stringify(cel));
  check("medianCpa is 100 (1000/10 voor elk account)", cel.metrics?.medianCpa === 100, `${cel.metrics?.medianCpa}`);
  check("medianRoas is 4 (4000/1000 voor elk account)", cel.metrics?.medianRoas === 4, `${cel.metrics?.medianRoas}`);
}

// ── Mediaan, geen som/som: één dominant account mag de uitkomst niet trekken ─

console.log("Uitschieter-robuustheid");
{
  const normaal = accounts(MIN_ACCOUNTS - 1, MIN_BUREAUS, { spend: 1000, conversions: 10 }); // CPA 100 elk
  const uitschieter = rij({ clientId: "whale", agencyId: "a0", spend: 1_000_000, conversions: 10 }); // CPA 100.000
  const cellen = bouwGodViewCellen([...normaal, uitschieter]);
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("mediaan blijft bij de normale CPA, niet de uitschieter", cel.metrics?.medianCpa === 100, `${cel.metrics?.medianCpa}`);
  const somOverSom = (normaal.reduce((s, r) => s + r.spend, 0) + uitschieter.spend) / (normaal.reduce((s, r) => s + r.conversions, 0) + uitschieter.conversions);
  check("som/som ZOU wel gedomineerd zijn (bewijst dat mediaan hier het verschil maakt)", somOverSom > 1000, `${somOverSom}`);
}

// ── Combinatie-diepte: hogere drempel dan los model of los niche ────────────

console.log("Combinatie model + niche");
{
  const acc = accounts(MIN_ACCOUNTS_COMBINATIE - 1, MIN_BUREAUS_COMBINATIE, { niche: "saas" });
  const cellen = bouwGodViewCellen(acc);
  const modelCel = cellen.find((c) => c.sleutel.model === "b2b" && c.sleutel.niche === null)!;
  const combiCel = cellen.find((c) => c.sleutel.model === "b2b" && c.sleutel.niche === "saas")!;
  check("los model haalt zijn (lagere) drempel", modelCel.metrics !== null, JSON.stringify(modelCel));
  check("combinatie haalt de eigen (hogere) drempel nog niet", combiCel.metrics === null, JSON.stringify(combiCel));
}

// ── Deelmetric-drempel: cel als geheel deelbaar, maar de CPA-subset niet ────

console.log("Metric-eigen drempel onder de celdrempel");
{
  // Tien accounts, vier bureaus (cel zelf deelbaar) -- maar maar twee van de tien hadden ooit een
  // conversie. De CPA-mediaan zou op die twee rusten en moet dus zelf null blijven, terwijl ROAS
  // (alle tien hebben spend>0) wel gewoon verschijnt.
  const acc = accounts(MIN_ACCOUNTS, MIN_BUREAUS).map((r, i) => ({ ...r, conversions: i < 2 ? 10 : 0 }));
  const cellen = bouwGodViewCellen(acc);
  const cel = cellen.find((c) => c.sleutel.model === "b2b")!;
  check("cel als geheel is deelbaar", cel.metrics !== null, JSON.stringify(cel));
  check("medianCpa is null: de subset met conversies haalt de drempel niet", cel.metrics?.medianCpa === null, `${cel.metrics?.medianCpa}`);
  check("accountsMetCpa is 0 (geen deelbare subset, geen los getal)", cel.metrics?.accountsMetCpa === 0, `${cel.metrics?.accountsMetCpa}`);
  check("medianRoas bestaat gewoon (alle tien hebben spend)", cel.metrics?.medianRoas !== null, `${cel.metrics?.medianRoas}`);
}

// ── Elke rij telt mee op elk niveau waarop hij is afgebakend ────────────────

console.log("Meertelling per niveau");
{
  const acc = accounts(MIN_ACCOUNTS_COMBINATIE, MIN_BUREAUS_COMBINATIE, { niche: "saas" });
  const cellen = bouwGodViewCellen(acc);
  const namen = cellen.map((c) => `${c.sleutel.model ?? "-"}/${c.sleutel.niche ?? "-"}`);
  check("model-cel bestaat", namen.includes("b2b/-"));
  check("niche-cel bestaat", namen.includes("-/saas"));
  check("combinatiecel bestaat", namen.includes("b2b/saas"));
}

// ── Testmodus-drempels (masterplan 16.8): optioneel argument, nooit de standaard ────────────

console.log("Overschreven drempels: expliciet argument nodig, standaard blijft ongewijzigd");
{
  // Twee accounts, één bureau -- ver onder de echte drempel (10 accounts, 4 bureaus).
  const acc = accounts(2, 1);
  const standaard = bouwGodViewCellen(acc);
  const standaardCel = standaard.find((c) => c.sleutel.model === "b2b")!;
  check("zonder argument blijft de echte drempel gelden", standaardCel.metrics === null, JSON.stringify(standaardCel));

  const testmodus = bouwGodViewCellen(acc, { minAccounts: 1, minBureaus: 1, minAccountsCombinatie: 2, minBureausCombinatie: 1 });
  const testmodusCel = testmodus.find((c) => c.sleutel.model === "b2b")!;
  check("met expliciet verlaagde drempel wordt dezelfde cel wel deelbaar", testmodusCel.metrics !== null, JSON.stringify(testmodusCel));
  check("de mediaan zelf blijft correct berekend in testmodus", testmodusCel.metrics?.medianCpa === 100, `${testmodusCel.metrics?.medianCpa}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

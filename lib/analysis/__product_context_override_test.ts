// Wat product-context doet met de uitkomst van de vangrails. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__product_context_override_test.ts
//
// applyProductContextDecisioning draait NA applySearchTermGuardrails, over dezelfde objecten.
// Het is dus de laatste die schrijft, en daarmee degene die wint. Dat ging twee keer mis:
//
//   1. De tak "safe_to_exclude" zette een zoekterm van "keep" naar "negative_exact" met
//      actionReadiness "direct_action", zonder ergens naar conversies te kijken. De beoordeling
//      erboven krijgt het aantal conversies wel mee maar leest het nergens. Een zoekterm met zes
//      conversies en 1200 euro conversiewaarde kwam er zo uit als direct uitvoerbare uitsluiting,
//      met verdict "irrelevant" — terwijl de vangrails hem net onvoorwaardelijk op keep hadden
//      gezet, hun meest fundamentele regel.
//   2. Diezelfde tak leidde actionReadiness alleen af uit de aanbevolen actie, en negeerde
//      requiresHumanReview en riskFlag. Een concurrentterm die de vangrails expliciet hadden
//      gemarkeerd kwam eruit als direct_action met requiresHumanReview true ernaast.

import { applySearchTermGuardrails } from "./search-term-guardrails";
import { applyProductContextDecisioning, buildProductContext } from "./product-context";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type T = Parameters<typeof applySearchTermGuardrails>[0][number];
const t = (searchTerm: string, o: Partial<T> = {}): T => ({
  searchTerm, verdict: "relevant", relevanceScore: 3, reason: "r", confidence: "medium",
  recommendedAction: "keep", intentType: "generic_commercial",
  clicks: 20, cost: 100, conversions: 0, conversionsValue: 0,
  campaignName: "Search Generic", adGroupName: "AG", ...o,
} as T);

// Een catalogus voor duurzame energie. Alles wat daar niets mee te maken heeft, wordt door de
// beoordeling als veilig uit te sluiten aangemerkt.
const context = buildProductContext({
  productTitles: ["Zonnepaneel 400W", "Warmtepomp lucht-water"],
  productTypes: ["Zonnepanelen", "Warmtepompen"], productBrands: ["SolarMax"],
  customLabels: [], customAttributes: [], merchantProducts: [],
  keywords: ["zonnepaneel kopen"], adCopyPhrases: ["Zonnepanelen van SolarMax"],
  strategicContextText: "Duurzame energie voor particulieren.", targetedCountries: ["NL"],
});

/** De volledige keten zoals de route hem draait. */
function keten(verdicts: T[]): T[] {
  applySearchTermGuardrails(verdicts);
  applyProductContextDecisioning(verdicts, context);
  return verdicts;
}

const BUITEN_CATALOGUS = ["gratis spelletjes downloaden", "vacature monteur solliciteren", "tweedehands fiets marktplaats"];

// ── Conversies winnen van het catalogusoordeel ────────────────────────────

console.log("Een zoekterm die converteert");
for (const term of BUITEN_CATALOGUS) {
  const v = keten([t(term, { conversions: 6, conversionsValue: 1200 })]);
  const x = v[0];
  check(`"${term}" wordt niet uitgesloten`, x.recommendedAction !== "negative_exact" && x.recommendedAction !== "negative_phrase",
    `${x.recommendedAction} — deze term leverde 6 conversies op`);
  check(`  en is niet direct uitvoerbaar`, x.actionReadiness !== "direct_action", String(x.actionReadiness));
  check(`  en vraagt om een mens`, x.requiresHumanReview === true, String(x.requiresHumanReview));
  check(`  en heet niet irrelevant`, x.verdict !== "irrelevant", String(x.verdict));
  check(`  de reden noemt de conversies`, /conversie/i.test(x.reason), x.reason);
}
{
  // Eén conversie is al genoeg; de grens ligt bij nul.
  const v = keten([t("gratis spelletjes downloaden", { conversions: 1, conversionsValue: 40 })]);
  check("ook bij één conversie", v[0].recommendedAction !== "negative_exact", String(v[0].recommendedAction));
}

// ── Zonder conversies mag het gewoon ──────────────────────────────────────

console.log("\nEen zoekterm zonder conversies");
{
  const v = keten([t("gratis spelletjes downloaden", { conversions: 0, relevanceScore: 1, verdict: "irrelevant" })]);
  const x = v[0];
  // De poort mag niet zo dicht komen te staan dat er niets meer doorheen kan.
  check("wordt wel uitgesloten", x.recommendedAction === "negative_exact", String(x.recommendedAction));
  check("en mag direct uitgevoerd worden", x.actionReadiness === "direct_action", String(x.actionReadiness));
  check("en heet irrelevant", x.verdict === "irrelevant", String(x.verdict));
}

// ── Een gemarkeerde term wordt niet direct uitvoerbaar ────────────────────

console.log("\nEen term die de vangrails hebben gemarkeerd");
{
  const v = [t("gratis spelletjes outlet", { intentType: "competitor", recommendedAction: "negative_phrase", cost: 80 })];
  applySearchTermGuardrails(v);
  check("de vangrails vragen om beoordeling", v[0].requiresHumanReview === true);
  applyProductContextDecisioning(v, context);
  check("product-context maakt daar geen directe actie van",
    v[0].actionReadiness !== "direct_action", `${v[0].actionReadiness} naast requiresHumanReview=${v[0].requiresHumanReview}`);
}
{
  // Geen enkele uitkomst mag tegelijk om een mens vragen en als direct uitvoerbaar gelden.
  const alle = keten([
    t("gratis spelletjes downloaden", { conversions: 6 }),
    t("gratis spelletjes outlet", { intentType: "competitor", recommendedAction: "negative_phrase", cost: 80 }),
    t("vacature monteur solliciteren", { relevanceScore: 1, verdict: "irrelevant" }),
    t("zonnepaneel kopen", { relevanceScore: 5 }),
    t("warmtepomp offerte", { conversions: 2 }),
  ]);
  const tegenstrijdig = alle.filter((x) => x.actionReadiness === "direct_action" && (x.requiresHumanReview || x.riskFlag));
  check("geen enkele rij spreekt zichzelf tegen", tegenstrijdig.length === 0,
    tegenstrijdig.map((x) => `${x.searchTerm}: ${x.actionReadiness}/review=${x.requiresHumanReview}/risk=${x.riskFlag}`).join(" | "));

  // En geen enkele converterende term komt eruit als uitsluiting.
  const uitgesloten = alle.filter((x) => x.conversions > 0 && (x.recommendedAction === "negative_exact" || x.recommendedAction === "negative_phrase"));
  check("geen converterende term wordt uitgesloten", uitgesloten.length === 0,
    uitgesloten.map((x) => `${x.searchTerm} (${x.conversions} conv)`).join(", "));
}

// ── De keten blijft stabiel ───────────────────────────────────────────────

console.log("\nStabiliteit van de hele keten");
{
  const maak = (): T[] => [
    t("gratis spelletjes downloaden", { conversions: 6 }),
    t("zonnepaneel kopen", { relevanceScore: 5 }),
    t("vacature monteur solliciteren", { relevanceScore: 1, verdict: "irrelevant" }),
  ];
  const sleutel = (v: T[]) => v.map((x) => `${x.searchTerm}=${x.recommendedAction}/${x.actionReadiness}/${x.verdict}`).sort().join(" ; ");

  const een = keten(maak());
  const twee = maak(); keten(twee); keten(twee);
  check("twee keer door de keten verandert niets", sleutel(een) === sleutel(twee),
    `${sleutel(een)}\n        vs ${sleutel(twee)}`);

  const omgekeerd = maak().reverse(); keten(omgekeerd);
  check("de volgorde van de invoer maakt niet uit", sleutel(een) === sleutel(omgekeerd),
    `${sleutel(een)}\n        vs ${sleutel(omgekeerd)}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

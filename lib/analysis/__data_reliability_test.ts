// Test voor de betrouwbaarheidsbeoordeling. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__data_reliability_test.ts
//
// Deze module bepaalt of de tool zijn eigen cijfers vertrouwt, en het antwoord gaat via
// promptContext rechtstreeks de LLM in. Hij was ongetest, en de maatstaf stond aan de
// onderkant op zijn kop: elke controle heeft minstens twee maanden nodig, dus met een maand
// data vuurde er niets en kwam er "hoog vertrouwen — alle metrics kunnen met vertrouwen
// worden geanalyseerd" uit. MINDER data gaf MEER vertrouwen.
//
// Derde keer deze klasse in dezelfde codebase: de CPA viel terug op de totale besteding bij
// nul conversies, de gezondheidsscore gaf 20 van de 20 voor "geen doel ingesteld", en hier
// werd het ontbreken van tegenspraak gelezen als bevestiging.

import { computeDataReliability } from "./data-reliability";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = Parameters<typeof computeDataReliability>[0]["accountMonthly"][number];

function maand(m: string, o: Partial<Rij> = {}): Rij {
  return { month: m, impressions: 10000, clicks: 500, cost: 1000, conversions: 20, conversions_value: 4000, ...o };
}
function maanden(n: number, o: Partial<Rij> = {}): Rij[] {
  return Array.from({ length: n }, (_, i) => maand(`2025-${String(i + 1).padStart(2, "0")}`, o));
}
function beoordeel(rijen: Rij[], extra: Partial<Parameters<typeof computeDataReliability>[0]> = {}) {
  return computeDataReliability({
    accountMonthly: rijen, campaignMonthly: [], conversionLagDays: 3,
    hasKpiTargets: true, lastCompleteMonth: 6, ...extra,
  });
}

const RANG = { critical: 0, low: 1, medium: 2, high: 3 } as const;

// ── Vertrouwen mag nooit dalen als er data bij komt ────────────────────────

console.log("Meer data geeft nooit minder vertrouwen");
{
  const reeks = [1, 2, 3, 4, 5, 6, 9, 13].map((n) => ({ n, r: beoordeel(maanden(n)) }));
  for (const { n, r } of reeks) {
    check(`${n} maanden levert een oordeel`, typeof r.overallConfidence === "string");
  }
  // Dit is de kern: op stabiele data hoort de curve monotoon te stijgen.
  for (let i = 1; i < reeks.length; i++) {
    const vorige = RANG[reeks[i - 1].r.overallConfidence];
    const huidige = RANG[reeks[i].r.overallConfidence];
    check(`${reeks[i - 1].n} -> ${reeks[i].n} maanden gaat niet omlaag`, huidige >= vorige,
      `${reeks[i - 1].r.overallConfidence} -> ${reeks[i].r.overallConfidence}`);
  }
}

console.log("\nTe weinig data is geen hoog vertrouwen");
{
  const een = beoordeel(maanden(1));
  check("een maand geeft geen hoog vertrouwen", een.overallConfidence !== "high", een.overallConfidence);
  check("en geen volledige analysemodus", een.analysisMode !== "full", een.analysisMode);
  // De tekst mag niets beweren over consistentie die niet te zien is.
  check("de uitleg belooft geen betrouwbaarheid",
    !/consistent en betrouwbaar|met vertrouwen worden geanalyseerd/i.test(een.overallExplanation),
    een.overallExplanation);
  check("en noemt de reden", /maand/i.test(een.overallExplanation), een.overallExplanation);
  check("er staat een vlag bij", een.flags.some((f) => f.type === "data_gap"));
}
{
  const drie = beoordeel(maanden(3));
  check("drie maanden geeft geen hoog vertrouwen", drie.overallConfidence !== "high", drie.overallConfidence);
  const zes = beoordeel(maanden(6));
  check("zes maanden stabiele data mag wel hoog zijn", zes.overallConfidence === "high", zes.overallConfidence);
}

console.log("\nHelemaal geen data");
{
  const leeg = beoordeel([]);
  check("levert kritiek", leeg.overallConfidence === "critical");
  check("en diagnostische modus", leeg.analysisMode === "diagnostic");
  check("met een vlag", leeg.flags.length > 0);
}

// ── De inhoudelijke controles blijven werken ──────────────────────────────

console.log("\nDe controles zelf");
{
  // Een tracking-breuk: veel clicks, ineens nul conversies.
  const rijen = maanden(6);
  rijen[5] = maand("2025-06", { conversions: 0, clicks: 500 });
  const r = beoordeel(rijen);
  check("nul conversies na een stabiele periode wordt gezien",
    r.flags.some((f) => f.type === "tracking" && f.severity === "critical"),
    r.flags.map((f) => f.type).join(","));
  check("en dat drukt het vertrouwen", r.overallConfidence === "critical");
}
{
  // Onmogelijke waarden.
  const rijen = maanden(6);
  rijen[2] = maand("2025-03", { cost: -500 });
  const r = beoordeel(rijen);
  check("negatieve spend wordt gezien", r.flags.some((f) => f.type === "impossible_value"));
}
{
  // Account en campagnes lopen uiteen.
  const r = beoordeel(maanden(6), {
    campaignMonthly: maanden(6).map((m) => ({
      campaign_name: "X", month: m.month, cost: m.cost * 0.5,
      conversions: m.conversions, conversions_value: m.conversions_value,
    })),
  });
  check("een afwijking tussen account en campagnes wordt gezien",
    r.flags.some((f) => f.type === "reconciliation"));
}

// ── Geen enkel veld mag ontbreken of onzin bevatten ───────────────────────

console.log("\nDe vorm van het antwoord");
for (const [naam, rijen] of Object.entries({ leeg: [], een: maanden(1), zes: maanden(6), dertien: maanden(13) })) {
  const r = beoordeel(rijen as Rij[]);
  check(`${naam}: er is een uitleg`, r.overallExplanation.length > 0);
  check(`${naam}: er is een modus-uitleg`, r.modeExplanation.length > 0);
  check(`${naam}: promptContext is gevuld`, r.promptContext.length > 0);
  check(`${naam}: elke vlag heeft een omschrijving`, r.flags.every((f) => f.description.length > 0));
  check(`${naam}: geen NaN of undefined in de tekst`,
    !/NaN|undefined|Infinity/.test(r.overallExplanation + r.promptContext));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

// Test voor de ingest-invarianten: de pure beoordelingskern. Deterministisch, geen IO.
// Draaien: npx tsx lib/sync/__invarianten_test.ts

import { beoordeelRijen, metaIngestChecks, linkedinIngestChecks, microsoftIngestChecks } from "./invarianten";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Schone rijen: alles in orde.
const schoon = beoordeelRijen(
  [{ level: "account", impressions: 100, spend: 12.5, impression_share: 0.46 }],
  { tabel: "t", toegestaneWaarden: { kolom: "level", waarden: ["account"] }, nietNegatief: ["impressions", "spend"], fractie: ["impression_share"] }
);
assert(schoon.ok && schoon.gecontroleerd === 1, "schone rij passeert");

// Level buiten de whitelist: de klasse fout die de lezers stilzwijgend niets laat lezen.
const level = beoordeelRijen(
  [{ level: "campaign" }],
  { tabel: "meta_breakdown_daily", toegestaneWaarden: { kolom: "level", waarden: ["account"] } }
);
assert(!level.ok && level.schendingen[0].includes('"campaign"'), "afwijkend level gemeld met waarde");

// Negatieve metric: altijd een parse-/mappingfout.
const negatief = beoordeelRijen([{ spend: -3 }], { tabel: "t", nietNegatief: ["spend"] });
assert(!negatief.ok && negatief.schendingen[0].includes("negatief"), "negatieve spend gemeld");

// Procent-in-plaats-van-fractie: op demo-data onzichtbaar, op echte data de klassieker.
const procent = beoordeelRijen([{ impression_share: 46 }], { tabel: "t", fractie: ["impression_share"] });
assert(!procent.ok && procent.schendingen[0].includes("procent"), "46 als IS gemeld als procent-verdenking");

// Null is toegestaan: null is eerlijk, geen schending.
const nulls = beoordeelRijen([{ spend: null, impression_share: null }], { tabel: "t", nietNegatief: ["spend"], fractie: ["impression_share"] });
assert(nulls.ok, "null-waarden zijn geen schending");

// Meldingen dedupliceren en aftoppen: duizend kopieën verstoppen het verslag.
const veel = beoordeelRijen(
  Array.from({ length: 500 }, () => ({ level: "x" })),
  { tabel: "t", toegestaneWaarden: { kolom: "level", waarden: ["account"] } }
);
assert(!veel.ok && veel.schendingen.length === 1, "identieke schendingen één keer gemeld");

// De per-kanaal specs dragen exact de lezer-aannames.
const meta = metaIngestChecks("2026-08-01");
assert(meta.some((c) => c.regel.tabel === "meta_breakdown_daily" && c.regel.toegestaneWaarden?.waarden.join() === "account"), "meta: level-pin account");
const li = linkedinIngestChecks("2026-08-01");
assert(li.some((c) => c.regel.tabel === "linkedin_demographic_daily" && c.regel.toegestaneWaarden?.waarden.join() === "CAMPAIGN"), "linkedin: level-pin CAMPAIGN");
const ms = microsoftIngestChecks("2026-08-01", "2026-08-01");
const isCheck = ms.find((c) => c.regel.tabel === "microsoft_campaign_impression_share");
assert(!!isCheck && (isCheck.regel.fractie ?? []).includes("impression_share") && !(isCheck.regel.fractie ?? []).includes("budget_utilization"), "microsoft: IS-fracties zonder budget_utilization");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

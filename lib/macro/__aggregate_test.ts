// De aggregator: rijen naar cellen, op elk segmentniveau waarop een klant is afgebakend, en
// nooit twee bureaus samengevoegd in één cel.

import { bouwMacroTrends } from "./aggregate";
import type { MacroInvoerRij } from "./types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function rij(deel: Partial<MacroInvoerRij> & { clientId: string }): MacroInvoerRij {
  return {
    agencyId: "bureau-a", channel: "google", maand: "2026-06-01",
    bedrijfsmodel: null, niche: null,
    impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0, leads: 0,
    ...deel,
  };
}

console.log("geen segment: alleen de agency-brede cel");
const kaal = bouwMacroTrends([rij({ clientId: "k1", spend: 100 })]);
check("precies één cel", kaal.length === 1, JSON.stringify(kaal));
check("zonder model en niche", kaal[0].sleutel.bedrijfsmodel === null && kaal[0].sleutel.niche === null);
check("het bedrag klopt", kaal[0].metrics.spend === 100);

console.log("\nmodel én niche: vier cellen uit één rij");
const compleet = bouwMacroTrends([
  rij({ clientId: "k1", bedrijfsmodel: "b2b", niche: "software", spend: 50 }),
]);
check("vier dieptes (alles, model, niche, model+niche)", compleet.length === 4, JSON.stringify(compleet.map((c) => c.sleutel)));
check("elke cel draagt hetzelfde bedrag", compleet.every((c) => c.metrics.spend === 50));

console.log("\noptellen binnen hetzelfde segment, apart per bureau");
const tweeBureaus = bouwMacroTrends([
  rij({ clientId: "a1", agencyId: "bureau-a", bedrijfsmodel: "b2c", spend: 100 }),
  rij({ clientId: "a2", agencyId: "bureau-a", bedrijfsmodel: "b2c", spend: 200 }),
  rij({ clientId: "b1", agencyId: "bureau-b", bedrijfsmodel: "b2c", spend: 900 }),
]);
const modelCellen = tweeBureaus.filter((c) => c.sleutel.bedrijfsmodel === "b2c" && c.sleutel.niche === null);
check("twee bureaus geven twee cellen, geen samengevoegde", modelCellen.length === 2, JSON.stringify(modelCellen));
const bureauA = modelCellen.find((c) => c.sleutel.agencyId === "bureau-a")!;
check("bureau A telt zijn eigen twee klanten op", bureauA.metrics.spend === 300 && bureauA.accounts === 2);
const bureauB = modelCellen.find((c) => c.sleutel.agencyId === "bureau-b")!;
check("bureau B ziet niets van bureau A's 300", bureauB.metrics.spend === 900);

console.log("\ndistincte klanten, niet rijen");
const meerdereMaanden = bouwMacroTrends([
  rij({ clientId: "k1", maand: "2026-05-01", spend: 10 }),
  rij({ clientId: "k1", maand: "2026-05-01", spend: 5, channel: "meta" }),
]);
// Twee verschillende kanalen voor dezelfde klant zijn twee cellen (kanaal zit in de sleutel),
// dus dit telt niet als hetzelfde account tweemaal in ÉÉN cel -- die test staat hieronder apart.
const eenKlantEenCel = bouwMacroTrends([
  rij({ clientId: "k1", maand: "2026-05-01", spend: 10 }),
  rij({ clientId: "k1", maand: "2026-06-01", spend: 20 }),
]);
const juniCellen = eenKlantEenCel.filter((c) => c.sleutel.maand === "2026-05-01" || c.sleutel.maand === "2026-06-01");
check("twee maanden voor dezelfde klant blijven twee cellen (maand zit in de sleutel)",
  juniCellen.length === 2 && juniCellen.every((c) => c.accounts === 1),
  JSON.stringify(juniCellen));
check("twee kanalen voor dezelfde klant/maand zijn twee cellen", meerdereMaanden.length === 2);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

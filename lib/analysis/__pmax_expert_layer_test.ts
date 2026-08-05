// De PMax-expertlaag tegen de demo-dataset, via de mock-Supabase.
// Draaien: npx tsx lib/analysis/__pmax_expert_layer_test.ts
//
// Aanleiding: de signalen filterden rechtstreeks over maandrijen. Bij vier maanden data meldde de
// laag "16 zoekcategorieën zonder conversies" waar het er vier zijn. Die telling was het
// zichtbare deel; eronder zat dat een categorie die in één maand niets opleverde maar in de
// andere drie wél, als verspilling werd aangemerkt.
//
// Deze test draait de echte functie tegen de echte demo-data. Een test op losse verzonnen rijen
// had de fout niet gevonden — die ontstaat pas zodra dezelfde entiteit meerdere maanden heeft.

import { createDemoSupabase } from "../demo/mock-supabase";
import { demoRows } from "../demo/demo-rows";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { computePmaxInsights, aggregateByEntity } from "./pmax-expert-layer";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

async function main() {
  console.log("aggregateByEntity");
  const rows = [
    { category_label: "a", cost: 10, clicks: 3, conversions: 0, impressions: 100 },
    { category_label: "a", cost: 15, clicks: 4, conversions: 2, impressions: 200 },
    { category_label: "b", cost: 5, clicks: 1, conversions: 0, impressions: 50 },
    { category_label: "", cost: 99, clicks: 9, conversions: 0, impressions: 1 },
  ];
  const agg = aggregateByEntity(rows, "category_label");
  check("één rij per entiteit", agg.length === 2, String(agg.length));
  check("maanden worden opgeteld", agg[0].label === "a" && agg[0].cost === 25 && agg[0].impressions === 300);
  check("een converterende maand redt de categorie", agg[0].conversions === 2);
  check("naamloze rijen vallen weg", !agg.some((a) => a.label === ""));
  check("op kosten aflopend", agg[0].cost >= agg[1].cost);
  check("klikken worden opgeteld", agg[0].clicks === 7, String(agg[0].clicks));

  // Zoekcategorieën komen zonder kosten binnen (campaign_search_term_insight kent geen
  // cost_micros). Zonder tweede sorteersleutel gaf de vergelijking overal 0 terug en was de
  // volgorde de binnenkomstvolgorde -- terwijl de meldingen `slice(0, 3)` "de grootste" noemen.
  const zonderKosten = aggregateByEntity(
    [
      { category_label: "klein", cost: 0, impressions: 100 },
      { category_label: "groot", cost: 0, impressions: 9000 },
      { category_label: "midden", cost: 0, impressions: 500 },
    ],
    "category_label"
  );
  check(
    "zonder kosten op impressies aflopend",
    zonderKosten.map((c) => c.label).join(",") === "groot,midden,klein",
    zonderKosten.map((c) => c.label).join(",")
  );

  console.log("\nDe expertlaag tegen de demo");
  const sb = createDemoSupabase(null, demoRows()) as never;
  const insights = await computePmaxInsights(sb, DEMO_GREENTECH_ID);

  check("vindt de PMax-campagne", insights.hasPmaxCampaigns && insights.campaignCount === 1);
  check("levert een netwerkmix", insights.networkMix.length > 0);
  check("Maps zit in de mix", insights.networkMix.some((n) => n.network === "MAPS"), JSON.stringify(insights.networkMix));

  const dilution = insights.signals.find((s) => s.type === "search_dilution");
  check("meldt zoekverdunning", !!dilution, insights.signals.map((s) => s.type).join(","));

  if (dilution) {
    // De demo heeft vier consumententhema's zonder conversies, over vier maanden = 16 rijen.
    // Voor de fix stond hier 16; het getal moet het aantal categorieën zijn, niet het aantal rijen.
    const genoemd = Number(dilution.description.match(/^(\d+)/)?.[1] ?? 0);
    const maanden = new Set((demoRows()["ads_pmax_search_categories"] as Record<string, unknown>[]).map((r) => r.month)).size;
    const categorieen = new Set(
      (demoRows()["ads_pmax_search_categories"] as Record<string, unknown>[])
        .filter((r) => Number(r.conversions) === 0).map((r) => r.category_label)
    ).size;
    check("telt categorieën, geen maandrijen", genoemd === categorieen, `meldde ${genoemd}, verwacht ${categorieen} (over ${maanden} maanden)`);
    check("het getal is niet het rij-aantal", genoemd !== categorieen * maanden, `${genoemd}`);
  }

  // Elke categorie in de melding moet écht nul conversies hebben over het hele venster.
  const cats = demoRows()["ads_pmax_search_categories"] as Record<string, unknown>[];
  const totalPerCat = new Map<string, number>();
  for (const r of cats) {
    const k = String(r.category_label);
    totalPerCat.set(k, (totalPerCat.get(k) ?? 0) + Number(r.conversions ?? 0));
  }
  const echtNul = [...totalPerCat.entries()].filter(([, v]) => v === 0).length;
  check("aantal klopt met de venstertotalen", echtNul > 0 && echtNul <= totalPerCat.size);

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

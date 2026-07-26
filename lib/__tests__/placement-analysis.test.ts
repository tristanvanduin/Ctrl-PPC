export {};
// Verificatie van de YouTube-placement-beoordeling. Het risico dat deze code moet vermijden is
// niet "een slechte placement missen" maar het omgekeerde: een uitsluiting adviseren op basis van
// toeval. De meeste placements zijn klein, en "0 conversies" op 40 vertoningen is ruis. Wie daarop
// uitsluit gooit bereik weg dat prima werkte, en dat komt niet vanzelf terug.
// Draaien: npx tsx lib/__tests__/placement-analysis.test.ts

import {
  aggregatePlacements, judgePlacements, medianCpa, wastedSpend, isAppPlacement,
  MIN_SPEND_TO_JUDGE, MIN_VIEWS_TO_JUDGE, CPA_MULTIPLE_FOR_REVIEW,
  type PlacementInput,
} from "../video/placement-analysis";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

function p(over: Partial<PlacementInput> = {}): PlacementInput {
  return {
    placement: "ch-1", displayName: "Kanaal 1", placementType: "YOUTUBE_CHANNEL", targetUrl: "",
    campaignName: "GRT | YouTube | Awareness NL",
    impressions: 0, clicks: 0, cost: 0, conversions: 0, videoViews: 0,
    ...over,
  };
}
const verdictOf = (rows: PlacementInput[], key: string) =>
  judgePlacements(aggregatePlacements(rows)).find((j) => j.agg.placement === key)?.verdict;

console.log("\n1. Materieel budget zonder één conversie → uitsluiten");
{
  const rows = [p({ placement: "ch-bad", cost: 180, videoViews: 4_200, clicks: 60, conversions: 0, impressions: 20_000 })];
  const j = judgePlacements(aggregatePlacements(rows))[0];
  check("verdict uitsluiten", j.verdict === "uitsluiten", j.verdict);
  check("reden noemt de kosten", /180/.test(j.reason), j.reason);
}

console.log("\n2. Klein en zonder conversies → géén oordeel (dit is de valkuil)");
{
  const rows = [p({ placement: "ch-tiny", cost: MIN_SPEND_TO_JUDGE - 1, videoViews: 40, clicks: 2, conversions: 0, impressions: 300 })];
  const j = judgePlacements(aggregatePlacements(rows))[0];
  check("verdict te_weinig_data, niet uitsluiten", j.verdict === "te_weinig_data", j.verdict);
  check("reden legt uit dat het volume ontbreekt", /volume/i.test(j.reason), j.reason);
}

console.log("\n3. Genoeg spend maar te dunne basis → nog steeds geen oordeel");
{
  // Spend haalt de drempel, maar er is nauwelijks iets gebeurd: dan zegt 0 conversies niets.
  const rows = [p({ placement: "ch-thin", cost: 200, videoViews: MIN_VIEWS_TO_JUDGE - 1, clicks: 3, conversions: 0, impressions: 900 })];
  check("te_weinig_data", verdictOf(rows, "ch-thin") === "te_weinig_data", String(verdictOf(rows, "ch-thin")));
}

console.log("\n4. App-plaatsingen krijgen een eigen, scherpere uitleg");
{
  const rows = [p({ placement: "app-1", displayName: "Puzzelspel", placementType: "MOBILE_APPLICATION", cost: 150, clicks: 400, videoViews: 2_000, conversions: 0, impressions: 30_000 })];
  const j = judgePlacements(aggregatePlacements(rows))[0];
  check("uitsluiten", j.verdict === "uitsluiten");
  check("noemt onbedoelde klikken", /onbedoeld/i.test(j.reason), j.reason);
  check("isAppPlacement herkent de types", isAppPlacement("MOBILE_APPLICATION") && isAppPlacement("MOBILE_APP_CATEGORY") && !isAppPlacement("YOUTUBE_CHANNEL"));
}

console.log("\n5. Converteert duur → bekijken, niet blind uitsluiten");
{
  const rows = [
    p({ placement: "ch-a", cost: 100, conversions: 10, videoViews: 3_000, clicks: 50, impressions: 20_000 }), // CPA 10
    p({ placement: "ch-b", cost: 100, conversions: 10, videoViews: 3_000, clicks: 50, impressions: 20_000 }), // CPA 10
    p({ placement: "ch-dear", cost: 300, conversions: 2, videoViews: 3_000, clicks: 50, impressions: 20_000 }), // CPA 150
  ];
  const js = judgePlacements(aggregatePlacements(rows));
  check("mediaan-CPA uit de eigen data", medianCpa(aggregatePlacements(rows)) === 10, String(medianCpa(aggregatePlacements(rows))));
  check("dure converteerder → bekijken", js.find((j) => j.agg.placement === "ch-dear")?.verdict === "bekijken");
  check("normale converteerders → houden", js.filter((j) => j.verdict === "houden").length === 2, js.map((j) => `${j.agg.placement}=${j.verdict}`).join(","));
  check("reden vergelijkt met de mediaan", /mediaan/i.test(js.find((j) => j.agg.placement === "ch-dear")?.reason ?? ""));
}

console.log("\n6. Net binnen de CPA-bandbreedte → houden (geen ruis-aanbeveling)");
{
  const rows = [
    p({ placement: "ch-a", cost: 100, conversions: 10, videoViews: 3_000, clicks: 50, impressions: 20_000 }),
    p({ placement: "ch-b", cost: 100, conversions: 10, videoViews: 3_000, clicks: 50, impressions: 20_000 }),
    p({ placement: "ch-ok", cost: 100, conversions: 10 / (CPA_MULTIPLE_FOR_REVIEW - 0.5), videoViews: 3_000, clicks: 50, impressions: 20_000 }),
  ];
  check("houden", verdictOf(rows, "ch-ok") === "houden", String(verdictOf(rows, "ch-ok")));
}

console.log("\n7. Rijen van dezelfde placement over campagnes/maanden worden opgeteld");
{
  const rows = [
    p({ placement: "ch-x", cost: 60, videoViews: 1_500, clicks: 20, conversions: 0, impressions: 10_000, campaignName: "A" }),
    p({ placement: "ch-x", cost: 60, videoViews: 1_500, clicks: 20, conversions: 0, impressions: 10_000, campaignName: "B" }),
  ];
  const a = aggregatePlacements(rows)[0];
  check("kosten opgeteld", a.cost === 120);
  check("views opgeteld", a.videoViews === 3_000);
  check("beide campagnes vermeld", a.campaigns.join(",") === "A,B", a.campaigns.join(","));
  check("CPM uit de totalen", Math.abs((a.cpm ?? 0) - (120 / 20_000) * 1000) < 1e-9);
}

console.log("\n8. Losse rijen blijven onder de drempel, samengeteld dragen ze wél een oordeel");
{
  // Elk los te klein (€15, 300 views), samen erboven (€30, 600 views). Het oordeel hoort op het
  // totaal te gaan, anders ontsnapt een lek dat over meerdere campagnes verspreid zit.
  const rows = [
    p({ placement: "ch-split", cost: 15, videoViews: 300, clicks: 10, conversions: 0, impressions: 5_000, campaignName: "A" }),
    p({ placement: "ch-split", cost: 15, videoViews: 300, clicks: 10, conversions: 0, impressions: 5_000, campaignName: "B" }),
  ];
  check("losse rij alleen zou zwijgen", judgePlacements(aggregatePlacements([rows[0]]))[0].verdict === "te_weinig_data");
  check("samengeteld → uitsluiten", verdictOf(rows, "ch-split") === "uitsluiten", String(verdictOf(rows, "ch-split")));
}

console.log("\n9. Verspilling optellen over de uitsluit-kandidaten");
{
  const rows = [
    p({ placement: "ch-bad1", cost: 180, videoViews: 4_000, clicks: 60, conversions: 0, impressions: 20_000 }),
    p({ placement: "ch-bad2", cost: 120, videoViews: 3_000, clicks: 40, conversions: 0, impressions: 15_000 }),
    p({ placement: "ch-good", cost: 100, conversions: 10, videoViews: 3_000, clicks: 50, impressions: 20_000 }),
    p({ placement: "ch-tiny", cost: 5, videoViews: 20, clicks: 1, conversions: 0, impressions: 200 }),
  ];
  const js = judgePlacements(aggregatePlacements(rows));
  check("verspilling telt alleen uitsluit-kandidaten", wastedSpend(js) === 300, String(wastedSpend(js)));
  check("de te kleine telt niet mee", !js.some((j) => j.agg.placement === "ch-tiny" && j.verdict === "uitsluiten"));
}

console.log("\n10. Geen enkele converterende placement → geen mediaan, geen valse 'bekijken'");
{
  const rows = [
    p({ placement: "ch-1", cost: 100, videoViews: 3_000, clicks: 40, conversions: 0, impressions: 20_000 }),
    p({ placement: "ch-2", cost: 90, videoViews: 2_500, clicks: 35, conversions: 0, impressions: 18_000 }),
  ];
  const aggs = aggregatePlacements(rows);
  check("mediaan is null", medianCpa(aggs) === null);
  check("beide uitsluiten, geen crash", judgePlacements(aggs).every((j) => j.verdict === "uitsluiten"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

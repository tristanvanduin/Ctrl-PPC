export {};
// Verificatie van de doorgifte naar het signaalframe. Wat hier fout kan gaan is niet de rekenkunde
// (die is elders getest) maar de vertaling: dat er voorstellen ontstaan waar geen actie in zit, dat
// twintig placements twintig losse voorstellen worden, of dat een PMax-bevinding als "bewezen"
// de wachtrij in gaat terwijl de kosten onbekend zijn.
// Draaien: npx tsx lib/__tests__/google-video-signals.test.ts

import {
  buildVideoDepthSignals, buildPlacementWasteSignals, buildPmaxNetworkSignals,
  PLACEMENT_WASTE_MIN_TOTAL,
} from "../signals/google-video";
import { aggregateVideoCampaigns, type VideoCampaignRow } from "../video/video-performance";
import { aggregatePlacements, judgePlacements, type PlacementInput } from "../video/placement-analysis";
import { buildNetworkSplit, type NetworkRow } from "../pmax/network-split";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

function vrow(over: Partial<VideoCampaignRow> = {}): VideoCampaignRow {
  return {
    campaignId: "c1", campaignName: "GRT | YouTube | Awareness NL", campaignType: "VIDEO", month: "2026-06-01",
    impressions: 50_000, cost: 400, videoViews: 12_000, avgCpm: 8, avgCpv: 0.03, videoViewRate: 0.24,
    videoQuartileP25: 0.4, videoQuartileP50: 0.2, videoQuartileP75: 0.1, videoQuartileP100: 0.05,
    ...over,
  };
}
function prow(over: Partial<PlacementInput> = {}): PlacementInput {
  return {
    placement: "ch-1", displayName: "Kanaal 1", placementType: "YOUTUBE_CHANNEL", targetUrl: "",
    campaignName: "GRT | YouTube | Awareness NL",
    impressions: 20_000, clicks: 60, cost: 120, conversions: 0, videoViews: 4_000,
    metricsComplete: true, source: "video", ...over,
  };
}
const nrow = (networkType: string, cost: number, conversions: number): NetworkRow =>
  ({ networkType, cost, conversions, conversionsValue: conversions * 100, impressions: 100_000, clicks: 2_000 });

console.log("\n1. Zwakke opening wordt een voorstel met een creatieve richting");
{
  const r = buildVideoDepthSignals(aggregateVideoCampaigns([vrow()]));
  check("één verhaal", r.triggered.length === 1, String(r.triggered.length));
  const t = r.triggered[0];
  check("categorie creative", t.category === "creative");
  check("actie wijst naar de opening", /opening|eerste 5 seconden/i.test(t.actionDirection), t.actionDirection);
  check("zegt expliciet dat budget dit niet oplost", /budget/i.test(t.actionDirection));
  check("bewijs bevat de kijkdiepte", t.evidence.some((e) => /kijkdiepte 25/.test(e.metric)));
}

console.log("\n2. Een video die goed presteert levert geen actiepunt op");
{
  const good = vrow({ videoQuartileP25: 0.9, videoQuartileP50: 0.75, videoQuartileP75: 0.55, videoQuartileP100: 0.45 });
  check("geen verhaal bij een landende boodschap", buildVideoDepthSignals(aggregateVideoCampaigns([good])).triggered.length === 0);
  const thin = vrow({ impressions: 200, videoViews: 50 });
  check("geen verhaal bij te weinig data", buildVideoDepthSignals(aggregateVideoCampaigns([thin])).triggered.length === 0);
  check("wel gerapporteerd wat onderzocht is", buildVideoDepthSignals([]).checked.length === 1);
}

console.log("\n3. Placements bundelen tot één voorstel per bron, niet één per placement");
{
  const rows = [
    prow({ placement: "a", displayName: "A", cost: 200 }),
    prow({ placement: "b", displayName: "B", cost: 150 }),
    prow({ placement: "c", displayName: "C", cost: 120 }),
    prow({ placement: "d", displayName: "D", cost: 100 }),
  ];
  const r = buildPlacementWasteSignals(judgePlacements(aggregatePlacements(rows)));
  check("vier placements → één voorstel", r.triggered.length === 1, String(r.triggered.length));
  const t = r.triggered[0];
  check("noemt het totaal", /570/.test(t.story), t.story);
  check("noemt het aantal", /4 placement/.test(t.story), t.story);
  check("actie is één handeling", /uitsluitingslijst/i.test(t.actionDirection));
}

console.log("\n4. Video en PMax blijven gescheiden: andere bewijskracht, andere handeling");
{
  const rows = [
    prow({ placement: "vid", cost: 300 }),
    prow({ placement: "pmax-app", displayName: "Spel", placementType: "MOBILE_APPLICATION", impressions: 60_000, clicks: 0, cost: 0, conversions: 0, videoViews: 0, metricsComplete: false, source: "pmax" }),
  ];
  const r = buildPlacementWasteSignals(judgePlacements(aggregatePlacements(rows)));
  check("twee verhalen", r.triggered.length === 2, String(r.triggered.length));
  const video = r.triggered.find((t) => t.id.endsWith("_video"))!;
  const pmax = r.triggered.find((t) => t.id.endsWith("_pmax"))!;
  check("video-verhaal is bewezen", video.certainty === "bewezen_binnen_platform");
  check("PMax-verhaal is slechts indicatie", pmax.certainty === "indicatie", pmax.certainty);
  check("PMax zegt dat kosten onbekend zijn", /niet vast te stellen|onbekend/i.test(pmax.story + JSON.stringify(pmax.evidence)));
  check("PMax-actie noemt accountniveau", /accountniveau/i.test(pmax.actionDirection));
  check("video-actie noemt de campagnes", /videocampagnes/i.test(video.actionDirection));
}

console.log("\n5. Verwaarloosbare verspilling haalt de wachtrij niet");
{
  const rows = [prow({ placement: "klein", cost: PLACEMENT_WASTE_MIN_TOTAL - 1, videoViews: 4_000, clicks: 60 })];
  check("onder de drempel → stil", buildPlacementWasteSignals(judgePlacements(aggregatePlacements(rows))).triggered.length === 0);
}

console.log("\n6. PMax-netwerk: alleen het dure netwerk wordt een actiepunt");
{
  const slices = buildNetworkSplit([nrow("SEARCH", 600, 30), nrow("CONTENT", 300, 5), nrow("YOUTUBE_WATCH", 100, 5)]);
  const r = buildPmaxNetworkSignals(slices);
  check("alleen Display gemeld", r.triggered.length === 1 && r.triggered[0].id.includes("CONTENT"), JSON.stringify(r.triggered.map((t) => t.id)));
  const t = r.triggered[0];
  check("noemt beide aandelen", /budget/.test(t.story) && /conversies/.test(t.story));
  check("actie erkent dat de verdeling niet stuurbaar is", /niet rechtstreeks te sturen/i.test(t.actionDirection));
  check("actie geeft wél handvatten", /assetmix|doelgroepsignalen|uitsluiting/i.test(t.actionDirection));
}

console.log("\n7. Een efficiënt netwerk is geen actiepunt");
{
  // Zoeken is hier de efficiënte kant; die hoort niet als taak in de sprint te belanden.
  const slices = buildNetworkSplit([nrow("SEARCH", 600, 30), nrow("CONTENT", 300, 5), nrow("YOUTUBE_WATCH", 100, 5)]);
  const r = buildPmaxNetworkSignals(slices);
  check("geen verhaal voor het efficiënte netwerk", !r.triggered.some((t) => t.id.includes("SEARCH")), JSON.stringify(r.triggered.map((t) => t.id)));
}

console.log("\n8. Zonder conversies geen PMax-oordeel");
{
  const slices = buildNetworkSplit([nrow("SEARCH", 600, 0), nrow("CONTENT", 400, 0)]);
  check("stil", buildPmaxNetworkSignals(slices).triggered.length === 0);
}

console.log("\n9. Elk verhaal heeft alles wat de wachtrij nodig heeft");
{
  const all = [
    ...buildVideoDepthSignals(aggregateVideoCampaigns([vrow()])).triggered,
    ...buildPlacementWasteSignals(judgePlacements(aggregatePlacements([prow({ cost: 300 })]))).triggered,
    ...buildPmaxNetworkSignals(buildNetworkSplit([nrow("SEARCH", 600, 30), nrow("CONTENT", 300, 5)])).triggered,
  ];
  check("drie verhalen", all.length === 3, String(all.length));
  check("allemaal een id", all.every((t) => t.id.length > 0));
  check("allemaal een scope", all.every((t) => t.scope.length > 0));
  check("allemaal een actierichting", all.every((t) => t.actionDirection.length > 10));
  check("allemaal bewijs", all.every((t) => t.evidence.length > 0));
  check("geen dubbele ids", new Set(all.map((t) => t.id)).size === all.length);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

export {};
// Verificatie van de video-prestatielaag (YouTube/Demand Gen). Twee dingen die stil fout kunnen
// gaan: (1) ratio's die uit een gemiddelde van maandwaarden komen in plaats van uit de totalen —
// dan weegt een kleine maand even zwaar als een grote; (2) een kijkdiepte-oordeel op te weinig
// data, wat een gok is die als advies wordt gepresenteerd.
// Draaien: npx tsx lib/__tests__/video-performance.test.ts

import {
  aggregateVideoCampaigns, diagnoseVideo, type VideoCampaignRow,
  HOOK_WEAK_P25, COMPLETION_STRONG_P75,
} from "../video/video-performance";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};
const near = (a: number | null, b: number, eps = 1e-6) => a != null && Math.abs(a - b) < eps;

function row(over: Partial<VideoCampaignRow> = {}): VideoCampaignRow {
  return {
    campaignId: "c1", campaignName: "GRT | YouTube | NL", campaignType: "VIDEO", month: "2026-05-01",
    impressions: 0, cost: 0, videoViews: 0, avgCpm: 0, avgCpv: 0, videoViewRate: 0,
    videoQuartileP25: 0, videoQuartileP50: 0, videoQuartileP75: 0, videoQuartileP100: 0,
    ...over,
  };
}

console.log("\n1. Ratio's komen uit de venstertotalen, niet uit een maandgemiddelde");
{
  // Maand A: veel volume, goedkoop. Maand B: weinig volume, duur. Het totaal moet naar A neigen.
  const agg = aggregateVideoCampaigns([
    row({ month: "2026-05-01", impressions: 100_000, cost: 500, videoViews: 30_000 }),
    row({ month: "2026-06-01", impressions: 1_000, cost: 50, videoViews: 100 }),
  ])[0];
  check("CPM = totale kosten / totale vertoningen × 1000", near(agg.cpm, (550 / 101_000) * 1000));
  check("CPV = totale kosten / totale views", near(agg.cpv, 550 / 30_100));
  check("view rate = totale views / totale vertoningen", near(agg.viewRate, 30_100 / 101_000));
  // Het naïeve maandgemiddelde van CPM zou (5 + 50)/2 = 27,5 zijn — ruim 5× de echte waarde.
  check("wijkt af van het naïeve maandgemiddelde (27,5)", agg.cpm != null && agg.cpm < 10, String(agg.cpm));
}

console.log("\n2. Kijkdiepte weegt naar vertoningen (een kleine maand kapert het beeld niet)");
{
  const agg = aggregateVideoCampaigns([
    row({ impressions: 99_000, videoQuartileP25: 0.80, videoQuartileP75: 0.50 }),
    row({ month: "2026-06-01", impressions: 1_000, videoQuartileP25: 0.10, videoQuartileP75: 0.05 }),
  ])[0];
  check("p25 blijft dicht bij de grote maand (~0,793)", near(agg.p25!, (0.8 * 99_000 + 0.1 * 1_000) / 100_000, 1e-9));
  check("ongewogen zou 0,45 zijn geweest", agg.p25! > 0.7, String(agg.p25));
}

console.log("\n3. Meerdere campagnes blijven gescheiden");
{
  const aggs = aggregateVideoCampaigns([
    row({ campaignId: "c1", impressions: 10_000, cost: 100 }),
    row({ campaignId: "c2", campaignName: "GRA | YouTube | US", impressions: 20_000, cost: 400 }),
  ]);
  check("twee campagnes", aggs.length === 2);
  const c1 = aggs.find((a) => a.campaignId === "c1")!;
  const c2 = aggs.find((a) => a.campaignId === "c2")!;
  check("c1 CPM = 10", near(c1.cpm, 10));
  check("c2 CPM = 20", near(c2.cpm, 20));
}

console.log("\n4. Diagnose: zwakke hook vs landende boodschap");
{
  const weak = aggregateVideoCampaigns([row({ impressions: 50_000, videoQuartileP25: HOOK_WEAK_P25 - 0.1, videoQuartileP75: 0.2 })])[0];
  check("p25 onder de drempel → hook_zwak", diagnoseVideo(weak) === "hook_zwak");

  const strong = aggregateVideoCampaigns([row({ impressions: 50_000, videoQuartileP25: 0.9, videoQuartileP75: COMPLETION_STRONG_P75 + 0.1 })])[0];
  check("hoge p75 → boodschap_landt", diagnoseVideo(strong) === "boodschap_landt");

  const mid = aggregateVideoCampaigns([row({ impressions: 50_000, videoQuartileP25: 0.7, videoQuartileP75: 0.25 })])[0];
  check("ertussenin → middenmoot", diagnoseVideo(mid) === "middenmoot");
}

console.log("\n5. Geen oordeel op een dunne basis (liever zwijgen dan gokken)");
{
  const thin = aggregateVideoCampaigns([row({ impressions: 300, videoQuartileP25: 0.1, videoQuartileP75: 0.05 })])[0];
  check("onder de drempel → te_weinig_data, ondanks dramatische cijfers", diagnoseVideo(thin) === "te_weinig_data");

  const none = aggregateVideoCampaigns([row({ impressions: 0, cost: 0 })])[0];
  check("nul vertoningen → geen ratio's (null, niet 0)", none.cpm === null && none.viewRate === null);
  check("nul vertoningen → te_weinig_data", diagnoseVideo(none) === "te_weinig_data");
}

console.log("\n6. Nul views geeft geen CPV van 0 (dat zou 'gratis' suggereren)");
{
  const noViews = aggregateVideoCampaigns([row({ impressions: 20_000, cost: 300, videoViews: 0 })])[0];
  check("CPV is null bij 0 views", noViews.cpv === null);
  check("CPM wordt wel gewoon berekend", near(noViews.cpm, 15));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

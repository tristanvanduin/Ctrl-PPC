// Land × kanaal: de eigenschappen die de matrix betrouwbaar maken.
// Draaien: npx tsx lib/geo/__channel_matrix_test.ts

import {
  buildChannelMatrix, matrixTotals, cellIndex, findMixDeviations, channelFromCampaignType,
  isUnsplit, cpa, roas, CHANNEL_ORDER, MIN_COUNTRY_COST, strongestPerCountry,
  type GeoCampaignRow,
} from "./channel-matrix";
import { demoRows } from "../demo/demo-rows";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const row = (country: string | null, campaignId: string | null, cost: number, conversions: number, value = 0): GeoCampaignRow =>
  ({ countryCode: country, campaignId, impressions: cost * 10, clicks: cost, cost, conversions, conversionsValue: value });

console.log("Campagnetype naar kanaal");
check("SEARCH", channelFromCampaignType("SEARCH") === "search");
check("PERFORMANCE_MAX is onverdeeld", channelFromCampaignType("PERFORMANCE_MAX") === "pmax_onverdeeld");
check("DEMAND_GEN valt onder display", channelFromCampaignType("DEMAND_GEN") === "display");
check("onbekend type wordt overig", channelFromCampaignType("IETS_NIEUWS") === "overig");
check("leeg type wordt overig", channelFromCampaignType(null) === "overig");

console.log("\nAggregatie");
const types = new Map([["c1", "SEARCH"], ["c2", "DISPLAY"], ["c3", "PERFORMANCE_MAX"]]);
const cells = buildChannelMatrix([
  row("nl", "c1", 100, 10, 1300), row("NL", "c1", 100, 10, 1300),
  row("NL", "c2", 50, 1, 130), row("NL", "c3", 200, 8, 1440),
  row("US", "c1", 300, 12, 1560),
], types);

check("landcodes worden genormaliseerd", cells.filter((c) => c.country === "NL" && c.channel === "search")[0]?.cost === 200);
check("rijen zonder land vallen weg", buildChannelMatrix([row(null, "c1", 99, 1)], types).length === 0);
check("rijen zonder campagne vallen weg", buildChannelMatrix([row("NL", null, 99, 1)], types).length === 0);
check("onbekende campagne valt weg", buildChannelMatrix([row("NL", "onbekend", 99, 1)], types).length === 0);

console.log("\nRandtotalen");
const t = matrixTotals(cells);
check("landen op kosten aflopend", t.countries[0] === "NL", t.countries.join(","));
check("kanalen in vaste volgorde", t.channels.join(",") === CHANNEL_ORDER.filter((c) => t.channels.includes(c)).join(","));
check("geen lege kolommen", !t.channels.includes("video"));
check("totaal = som van de cellen", t.grand.cost === cells.reduce((s, c) => s + c.cost, 0));
check("landtotaal klopt", t.byCountry.get("NL")!.cost === 450, String(t.byCountry.get("NL")!.cost));

console.log("\nAfgeleide waarden komen uit de totalen");
const nlSearch = cellIndex(cells).get("NL|search")!;
check("CPA uit celtotalen", cpa(nlSearch) === 200 / 20);
check("ROAS uit celtotalen", roas(nlSearch) === 2600 / 200);
check("CPA zonder conversies is null, niet 0", cpa({ ...nlSearch, conversions: 0 }) === null);
check("ROAS zonder kosten is null", roas({ ...nlSearch, cost: 0 }) === null);

console.log("\nPMax blijft onverdeeld");
check("pmax_onverdeeld is als onverdeeld gemarkeerd", isUnsplit("pmax_onverdeeld"));
check("search is dat niet", !isUnsplit("search"));
check("PMax-kosten tellen wél mee in het landtotaal", t.byCountry.get("NL")!.cost === 450);
check("PMax verschijnt niet als afwijking", !findMixDeviations(cells).some((d) => isUnsplit(d.channel)));

console.log("\nAfwijkingsdetectie");
// VS draait 100% zoeken, het account leunt breder — dat is een materieel verschil.
const dev = findMixDeviations(cells);
check("VS wijkt af op zoeken", dev.some((d) => d.country === "US" && d.channel === "search"), JSON.stringify(dev));
check("gesorteerd op grootte van de afwijking", dev.every((d, i) => i === 0 || Math.abs(dev[i - 1].gap) >= Math.abs(d.gap)));
check("kleine markten tellen niet mee", (() => {
  const small = buildChannelMatrix([row("NL", "c1", 5000, 100), row("BE", "c2", MIN_COUNTRY_COST - 1, 1)], types);
  return !findMixDeviations(small).some((d) => d.country === "BE");
})());
check("leeg account geeft geen afwijkingen", findMixDeviations([]).length === 0);

console.log("\nDe demo voedt de matrix");
const demo = demoRows();
const geo = (demo["ads_geo_performance_monthly"] ?? []) as Record<string, unknown>[];
const meta = (demo["ads_campaign_metadata"] ?? []) as Record<string, unknown>[];
const demoTypes = new Map(meta.map((m) => [String(m.campaign_id), String(m.campaign_type)]));
const demoCells = buildChannelMatrix(
  geo.map((r) => ({
    countryCode: String(r.country_code ?? ""), campaignId: String(r.campaign_id ?? ""),
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0), conversionsValue: Number(r.conversions_value ?? 0),
  })),
  demoTypes
);
const dt = matrixTotals(demoCells);
check("demo levert cellen", demoCells.length > 0);
check("demo heeft meerdere markten", dt.countries.length >= 3, dt.countries.join(","));
check("demo heeft een PMax-kolom", dt.channels.some(isUnsplit));
check("demo heeft een zoekkolom", dt.channels.includes("search"));

// De landtotalen moeten exact terugkomen op ads_country_monthly: één geo-waarheid.
const countryMonthly = (demo["ads_country_monthly"] ?? []) as Record<string, unknown>[];
const costByCountry = new Map<string, number>();
for (const r of countryMonthly) {
  const c = String(r.country_code);
  costByCountry.set(c, (costByCountry.get(c) ?? 0) + Number(r.cost ?? 0));
}
const mismatches = dt.countries.filter((c) => Math.round(dt.byCountry.get(c)!.cost) !== Math.round(costByCountry.get(c) ?? -1));
check("landtotalen == ads_country_monthly", mismatches.length === 0, mismatches.join(","));

check("Frankrijk draait geen zoekcampagne", !cellIndex(demoCells).has("FR|search"));
check("Frankrijk converteert niet", (dt.byCountry.get("FR")?.conversions ?? -1) === 0);


console.log("\nSterkste afwijking per markt");
{
  const many = [
    { country: "FR", channel: "search" as const, countryShare: 0, accountShare: 0.5, gap: -0.5 },
    { country: "FR", channel: "video" as const, countryShare: 0.62, accountShare: 0.17, gap: 0.45 },
    { country: "FR", channel: "display" as const, countryShare: 0.38, accountShare: 0.07, gap: 0.31 },
    { country: "CA", channel: "display" as const, countryShare: 0.34, accountShare: 0.07, gap: 0.27 },
  ];
  const top = strongestPerCountry(many);
  check("één regel per markt", top.length === 2, String(top.length));
  check("de sterkste wint", top[0].country === "FR" && top[0].channel === "search");
  check("tweede markt komt in beeld", top[1].country === "CA");
  check("nog steeds op grootte gesorteerd", Math.abs(top[0].gap) >= Math.abs(top[1].gap));
  check("leeg blijft leeg", strongestPerCountry([]).length === 0);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

// Test voor de multi-kanaal client-reports-blending (channel-report-blend.ts).
// Draaien: npx tsx lib/analysis/__channel_report_blend_test.ts

import { monthlyFromDaily, blendMonthly } from "./channel-report-blend";
import { resolveChannelConversionConfig } from "./channel-conversion-config";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const convConfig = resolveChannelConversionConfig(null);

// ── monthlyFromDaily: Meta dagrijen naar één maandrij ──
const metaDaily = [
  { date: "2026-07-05", impressions: 1000, link_clicks: 20, spend: 100, conversions: 2, leads: 0, conversion_value: 300 },
  { date: "2026-07-20", impressions: 2000, link_clicks: 30, spend: 150, conversions: 3, leads: 0, conversion_value: 450 },
  { date: "2026-08-01", impressions: 500, link_clicks: 10, spend: 50, conversions: 1, leads: 0, conversion_value: 150 },
];
const metaMonthly = monthlyFromDaily(metaDaily, {
  dateField: "date", clicksField: "link_clicks",
  convFields: (r) => ({ conversions: Number(r.conversions ?? 0), leads: Number(r.leads ?? 0) }),
  channelKey: "meta_ads", convConfig,
});
assert(metaMonthly.length === 2, `twee maanden in de output (kreeg ${metaMonthly.length})`);
const juli = metaMonthly.find((m) => m.month === "2026-07-01");
assert(juli?.impressions === 3000, `juli's vertoningen tellen op (kreeg ${juli?.impressions})`);
assert(juli?.cost === 250, `juli's kosten tellen op (kreeg ${juli?.cost})`);
assert(juli?.conversions === 5, `juli's conversies tellen op (kreeg ${juli?.conversions})`);
assert(Math.abs((juli?.ctr as number) - 50 / 3000) < 1e-9, `ctr is klikken/vertoningen, niet het gemiddelde van twee dag-ctr's`);
assert(Math.abs((juli?.avg_cpc as number) - 250 / 50) < 1e-9, `avg_cpc is kosten/klikken uit de opgetelde tellers`);

// ── LinkedIn: andere conversievelden, zelfde vorm terug ──
const liDaily = [
  { date: "2026-07-10", impressions: 500, clicks: 15, spend: 200, one_click_leads: 4, external_website_conversions: 1, post_click_conversions: 0, conversion_value: 500 },
];
const liMonthly = monthlyFromDaily(liDaily, {
  dateField: "date", clicksField: "clicks",
  convFields: (r) => ({
    one_click_leads: Number(r.one_click_leads ?? 0),
    external_website_conversions: Number(r.external_website_conversions ?? 0),
    post_click_conversions: Number(r.post_click_conversions ?? 0),
  }),
  channelKey: "linkedin_ads", convConfig,
});
assert(liMonthly[0]?.conversions === 5, `LinkedIn: one_click_leads + external_website_conversions telt mee (kreeg ${liMonthly[0]?.conversions})`);

// ── blendMonthly: drie bronnen samen, geen dubbele/gemiste maanden ──
const google = [{ month: "2026-07-01", impressions: 10000, clicks: 200, cost: 1000, conversions: 20, conversions_value: 4000 }];
const blended = blendMonthly([google, metaMonthly, liMonthly]);
const julBlend = blended.find((m) => m.month === "2026-07-01");
assert(julBlend?.impressions === 10000 + 3000 + 500, `blend: vertoningen van alle drie bronnen tellen op (kreeg ${julBlend?.impressions})`);
assert(julBlend?.cost === 1000 + 250 + 200, `blend: kosten van alle drie bronnen tellen op (kreeg ${julBlend?.cost})`);
assert(julBlend?.conversions === 20 + 5 + 5, `blend: conversies van alle drie bronnen tellen op (kreeg ${julBlend?.conversions})`);

// ── Eén bron blenden is een pure doorgave (geen gedragswijziging voor een Google-only klant) ──
const soloBlend = blendMonthly([google]);
assert(soloBlend[0]?.impressions === google[0].impressions, "blend van één bron levert dezelfde tellers op");
assert(soloBlend[0]?.cost === google[0].cost, "blend van één bron levert dezelfde kosten op");

// ── Lege input geeft lege output, geen crash ──
assert(monthlyFromDaily([], { dateField: "date", clicksField: "clicks", convFields: () => ({}), channelKey: "meta_ads", convConfig }).length === 0, "lege dagrijen geven lege maandrijen");
assert(blendMonthly([]).length === 0, "lege bronnen geven lege blend");
assert(blendMonthly([[], []]).length === 0, "twee lege bronnen geven lege blend");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

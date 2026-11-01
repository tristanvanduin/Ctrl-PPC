// Test voor de multi-kanaal client-reports-blending (channel-report-blend.ts).
// Draaien: npx tsx lib/analysis/__channel_report_blend_test.ts

import { readFileSync } from "node:fs";
import * as blend from "./channel-report-blend";
import { monthlyFromDaily, blendMonthly } from "./channel-report-blend";
import { resolveChannelConversionConfig, conversionSourcesFor, type ChannelConversionChannel, type ChannelConversionConfig } from "./channel-conversion-config";

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

// ── Eén dag->maand voor Meta/LinkedIn/Microsoft, met de selectie van de klant ──
//
// Stap 0, item F: de KPI-band, het Jaaroverzicht en de rapportage hadden elk een eigen lus, met
// een eigen select-lijst. Het Jaaroverzicht las fact_core, waar de standaardselectie in de SQL
// zit; zodra een klant iets anders koos, telden de band en het Jaaroverzicht verschillend.
// Namespace-import: op de oude code bestaan deze exports niet, en dan moet dat hier per geval
// falen in plaats van de hele test op de import te laten struikelen.
const { kanaalMaandenUitDagen, dagbronSelect, KANAAL_DAGBRON } = blend as unknown as {
  kanaalMaandenUitDagen?: (rows: Array<Record<string, unknown>>, channel: ChannelConversionChannel, convConfig: ChannelConversionConfig) => Array<Record<string, unknown>>;
  dagbronSelect?: (channel: ChannelConversionChannel) => string;
  KANAAL_DAGBRON?: Record<ChannelConversionChannel, { table: string; clicksField: string; entityField?: string }>;
};
const KANALEN: ChannelConversionChannel[] = ["meta_ads", "linkedin_ads", "microsoft_ads"];

assert(typeof kanaalMaandenUitDagen === "function", "kanaalMaandenUitDagen bestaat");
assert(typeof dagbronSelect === "function", "dagbronSelect bestaat");
assert(KANAAL_DAGBRON !== undefined, "KANAAL_DAGBRON bestaat");

if (typeof kanaalMaandenUitDagen === "function") {
  // Meta: een opgeslagen keuze voor alleen leads telt alleen leads.
  const metaDag = [
    { date: "2026-07-05", impressions: 1000, link_clicks: 20, clicks_all: 99, spend: 100, conversions: 2, leads: 7, conversion_value: 300 },
    { date: "2026-07-20", impressions: 2000, link_clicks: 30, clicks_all: 99, spend: 150, conversions: 3, leads: 1, conversion_value: 450 },
  ];
  const alleenLeads = resolveChannelConversionConfig({ meta_ads: ["leads"] });
  const mLeads = kanaalMaandenUitDagen(metaDag, "meta_ads", alleenLeads);
  assert(mLeads.length === 1 && mLeads[0].month === "2026-07-01", `Meta: één maandrij voor juli (kreeg ${JSON.stringify(mLeads.map((m) => m.month))})`);
  assert(mLeads[0]?.conversions === 8, `Meta met opgeslagen selectie [leads]: alleen leads tellen, 7+1 = 8 (kreeg ${mLeads[0]?.conversions})`);
  assert(mLeads[0]?.clicks === 50, `Meta: klikken zijn link_clicks, niet clicks_all (kreeg ${mLeads[0]?.clicks})`);
  assert(mLeads[0]?.cost === 250 && mLeads[0]?.conversions_value === 750 && mLeads[0]?.impressions === 3000,
    "Meta: kosten, omzet en vertoningen tellen op, los van de selectie");
  const mStandaard = kanaalMaandenUitDagen(metaDag, "meta_ads", resolveChannelConversionConfig(null));
  assert(mStandaard[0]?.conversions === 13, `Meta zonder opgeslagen selectie: de standaard (aankopen + leads) = 13 (kreeg ${mStandaard[0]?.conversions})`);

  // LinkedIn: post-click-conversies zitten NIET in de standaard, maar zijn wel te kiezen. Een
  // lus die alleen de standaardvelden las, telde een opgeslagen keuze daarvoor stil als nul.
  const liDag = [
    { date: "2026-08-03", impressions: 500, clicks: 15, spend: 200, one_click_leads: 4, external_website_conversions: 1, post_click_conversions: 6, conversion_value: 500 },
    { date: "2026-09-01", impressions: 100, clicks: 5, spend: 50, one_click_leads: 1, external_website_conversions: 0, post_click_conversions: 2, conversion_value: 0 },
  ];
  const postClick = kanaalMaandenUitDagen(liDag, "linkedin_ads", resolveChannelConversionConfig({ linkedin_ads: ["post_click_conversions"] }));
  const liAug = postClick.find((m) => m.month === "2026-08-01");
  assert(liAug?.conversions === 6, `LinkedIn met opgeslagen selectie [post_click]: alleen post-click = 6 (kreeg ${liAug?.conversions})`);
  assert(postClick.find((m) => m.month === "2026-09-01")?.conversions === 2, "LinkedIn: elke maand apart, met dezelfde selectie");
  assert(liAug?.clicks === 15, `LinkedIn: klikken uit clicks (kreeg ${liAug?.clicks})`);
  const liStandaard = kanaalMaandenUitDagen(liDag, "linkedin_ads", resolveChannelConversionConfig(null));
  assert(liStandaard.find((m) => m.month === "2026-08-01")?.conversions === 5, "LinkedIn zonder selectie: de standaard (lead-forms + website) = 5");

  // Microsoft: één veld, dezelfde route.
  const msDag = [{ date: "2026-08-10", impressions: 300, clicks: 12, spend: 80, conversions: 3.5, conversion_value: 120 }];
  const ms = kanaalMaandenUitDagen(msDag, "microsoft_ads", resolveChannelConversionConfig(null));
  assert(ms[0]?.conversions === 3.5 && ms[0]?.clicks === 12 && ms[0]?.cost === 80, `Microsoft: conversies, klikken en kosten (kreeg ${JSON.stringify(ms[0])})`);

  // Dezelfde uitkomst als de bestaande handgeschreven aanroep in de rapportage (geen gedragswijziging daar).
  const oudeWeg = monthlyFromDaily(metaDag, {
    dateField: "date", clicksField: "link_clicks",
    convFields: (r) => ({ conversions: Number(r.conversions ?? 0), leads: Number(r.leads ?? 0) }),
    channelKey: "meta_ads", convConfig: alleenLeads,
  });
  assert(JSON.stringify(oudeWeg) === JSON.stringify(mLeads), "Meta: identiek aan de inline monthlyFromDaily-aanroep uit client-reports");

  assert(kanaalMaandenUitDagen([], "meta_ads", convConfig).length === 0, "lege dagrijen geven lege maandrijen");
}

if (typeof dagbronSelect === "function" && KANAAL_DAGBRON) {
  // De datagrond-poort (scripts/check-datagrond.mjs) kan een select uit een functie niet lezen:
  // daarom hier, tegen dezelfde schemafoto. Een kolom die niet bestaat is in productie een 400
  // die als "geen data" leest.
  const schema = JSON.parse(readFileSync(new URL("../../scripts/schema-snapshot.json", import.meta.url), "utf8")) as Record<string, string[]>;
  for (const ch of KANALEN) {
    const kolommen = dagbronSelect(ch).split(",").map((k) => k.trim());
    for (const s of conversionSourcesFor(ch)) {
      assert(kolommen.includes(s.field), `${ch}: dagbronSelect bevat het selecteerbare veld ${s.field}`);
    }
    for (const vast of ["date", "impressions", "spend", "conversion_value", KANAAL_DAGBRON[ch].clicksField]) {
      assert(kolommen.includes(vast), `${ch}: dagbronSelect bevat ${vast}`);
    }
    assert(new Set(kolommen).size === kolommen.length, `${ch}: geen dubbele kolommen in de select`);
    const tabel = KANAAL_DAGBRON[ch].table;
    assert(Array.isArray(schema[tabel]), `${ch}: tabel ${tabel} staat in de schemafoto`);
    for (const k of kolommen) {
      assert((schema[tabel] ?? []).includes(k), `${ch}: kolom ${k} bestaat in ${tabel}`);
    }
    // De tweede sorteersleutel bij gepagineerd lezen (blended-historical). Een orderkolom die niet
    // bestaat is net zo goed een 400.
    const entiteit = KANAAL_DAGBRON[ch].entityField;
    assert(typeof entiteit === "string" && (schema[tabel] ?? []).includes(entiteit),
      `${ch}: entiteitkolom ${entiteit} bestaat in ${tabel}`);
  }
  assert(KANAAL_DAGBRON.meta_ads.clicksField === "link_clicks", "Meta: klikkolom is link_clicks");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

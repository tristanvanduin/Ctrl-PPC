// Test voor de conversie-selectie per kanaal (Meta/LinkedIn). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__channel_conversion_config_test.ts

import {
  resolveChannelConversionConfig,
  sumSelectedConversions,
  selectedConversionLabels,
  conversionSourcesFor,
  DEFAULT_CHANNEL_CONVERSION_CONFIG,
} from "./channel-conversion-config";
import * as config from "./channel-conversion-config";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Bronnen per kanaal ──
assert(conversionSourcesFor("meta_ads").map((s) => s.field).join(",") === "conversions,leads", "Meta-bronnen: aankopen + leads");
assert(conversionSourcesFor("linkedin_ads").map((s) => s.field).join(",") === "one_click_leads,external_website_conversions,post_click_conversions", "LinkedIn-bronnen: leads, website, post-click");

// ── Resolve: geldige selectie blijft, ongeldige velden eruit ──
const cfg = resolveChannelConversionConfig({ meta_ads: ["leads", "onzin"], linkedin_ads: ["post_click_conversions"] });
assert(cfg.meta_ads.join(",") === "leads", "ongeldige velden worden gefilterd, geldige blijven");
assert(cfg.linkedin_ads.join(",") === "post_click_conversions", "LinkedIn-selectie blijft behouden");

// ── Resolve: lege/ontbrekende selectie valt terug op default (nooit 0 conversies) ──
const cfgEmpty = resolveChannelConversionConfig({ meta_ads: [], linkedin_ads: undefined });
assert(cfgEmpty.meta_ads.join(",") === DEFAULT_CHANNEL_CONVERSION_CONFIG.meta_ads.join(","), "lege Meta-selectie valt terug op default");
assert(cfgEmpty.linkedin_ads.join(",") === DEFAULT_CHANNEL_CONVERSION_CONFIG.linkedin_ads.join(","), "ontbrekende LinkedIn-selectie valt terug op default");
const cfgNull = resolveChannelConversionConfig(null);
assert(cfgNull.meta_ads.length === 2 && cfgNull.linkedin_ads.length === 2, "null geeft de volledige default-config");

// ── Sommeren: alleen de geselecteerde velden tellen mee ──
const metaRow = { conversions: 7, leads: 12, spend: 300 };
assert(sumSelectedConversions(metaRow, "meta_ads", resolveChannelConversionConfig({ meta_ads: ["conversions"] })) === 7, "alleen aankopen geselecteerd → 7");
assert(sumSelectedConversions(metaRow, "meta_ads", resolveChannelConversionConfig({ meta_ads: ["leads"] })) === 12, "alleen leads geselecteerd → 12");
assert(sumSelectedConversions(metaRow, "meta_ads", resolveChannelConversionConfig({ meta_ads: ["conversions", "leads"] })) === 19, "beide geselecteerd → 19");

const liRow = { one_click_leads: 5, external_website_conversions: 3, post_click_conversions: 2 };
assert(sumSelectedConversions(liRow, "linkedin_ads", resolveChannelConversionConfig({ linkedin_ads: ["one_click_leads"] })) === 5, "LinkedIn: alleen lead-forms → 5");
assert(sumSelectedConversions(liRow, "linkedin_ads", resolveChannelConversionConfig({ linkedin_ads: ["one_click_leads", "external_website_conversions", "post_click_conversions"] })) === 10, "LinkedIn: alle drie → 10");

// ── Strings uit de DB (numeric-kolommen) tellen ook ──
assert(sumSelectedConversions({ conversions: "4", leads: "6" }, "meta_ads", resolveChannelConversionConfig({ meta_ads: ["conversions", "leads"] })) === 10, "numerieke strings tellen mee");

// ── Labels van de selectie ──
assert(selectedConversionLabels("meta_ads", resolveChannelConversionConfig({ meta_ads: ["leads"] })).join(",") === "Leads", "labels van de geselecteerde velden");

// ── Google: de opgeslagen conversieacties -> het filter voor de Google-query ──
//
// De sync en de browser lazen deze lijst elk op hun eigen manier (de browser uit een
// localStorage-kopie). Eén lezing; de regels zijn die van de sync: alleen aangevinkte acties, en
// niets aangevinkt of geen lijst = niet filteren (nooit nul conversies).
const { dashboardConversionActionIds } = config as unknown as { dashboardConversionActionIds?: (actions: unknown) => string[] | undefined };
assert(typeof dashboardConversionActionIds === "function", "dashboardConversionActionIds bestaat");
if (typeof dashboardConversionActionIds === "function") {
  const acties = [
    { id: "111", name: "Aanvraag", includedInDashboard: true },
    { id: "222", name: "Telefoon", includedInDashboard: false },
    { id: "333", name: "Brochure", includedInDashboard: true },
    { id: "444", name: "Zonder vlag" },
  ];
  assert(dashboardConversionActionIds(acties)?.join(",") === "111,333", "alleen de aangevinkte acties, in volgorde");
  assert(dashboardConversionActionIds([{ id: "1", includedInDashboard: false }]) === undefined, "niets aangevinkt: niet filteren (undefined), geen leeg filter");
  assert(dashboardConversionActionIds([]) === undefined, "lege lijst: niet filteren");
  assert(dashboardConversionActionIds(null) === undefined, "geen lijst (null): niet filteren");
  assert(dashboardConversionActionIds({ id: "1", includedInDashboard: true }) === undefined, "geen array: niet filteren");
  assert(dashboardConversionActionIds([{ id: 987654321, includedInDashboard: true }])?.[0] === "987654321", "numeriek id wordt tekst");
  assert(dashboardConversionActionIds([{ includedInDashboard: true }, { id: "", includedInDashboard: true }, null, "x"]) === undefined,
    "acties zonder bruikbaar id tellen niet: 'undefined' als id zou de query leegmaken");
  assert(dashboardConversionActionIds([{ id: "5", includedInDashboard: true }, { id: "5", includedInDashboard: true }])?.length === 1, "dubbele ids één keer");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

// Bewaakt de eigenschappen waar de aangevulde demo-data op staat of valt.
// Draaien: npx tsx lib/demo/__demo_sop_inputs_test.ts
//
// De inhoud van een demo mag best schuiven, maar deze drie dingen niet: de dimensies moeten
// optellen tot het account waar ze uit gesplitst zijn, er mag nergens omzet zonder conversie
// staan, en de tabellen die de maand-SOP leest moeten gevuld zijn. Elk van die drie is hier al
// een keer misgegaan; een test is goedkoper dan het opnieuw ontdekken in een demo.

import { demoRows } from "./demo-rows";
import { splitInt, splitAlong } from "./split";
import { demoGeoCountries, demoGeoStates, geoMonthlyRows } from "./geo-demo";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const rows = demoRows();
const get = (t: string) => (rows[t] ?? []) as Record<string, unknown>[];
const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
const sum = (rs: Record<string, unknown>[], k: string) => rs.reduce((s, r) => s + num(r, k), 0);

console.log("splitInt verdeelt exact en zonder rest-dump");
check("som blijft het totaal", splitInt(242, Array.from({ length: 168 }, (_, i) => 1 + (i % 5))).reduce((a, b) => a + b, 0) === 242);
check("laatste deel is geen restbak", (() => {
  // Bij grootste-rest ligt geen enkel deel meer dan één eenheid boven zijn evenredige aandeel.
  const w = Array.from({ length: 100 }, () => 1);
  const out = splitInt(242, w);
  return Math.max(...out) - Math.min(...out) <= 1;
})());
check("waarde volgt de conversies", splitAlong(1000, [0, 0, 5], [1, 1, 1]).slice(0, 2).every((v) => v === 0));
check("zonder conversies valt hij terug op de gewichten", splitAlong(900, [0, 0, 0], [1, 1, 1]).reduce((a, b) => a + b, 0) === 900);

console.log("\nDimensies tellen op tot het account");
const account = get("ads_account_monthly");
const month = String(account.at(-2)?.month ?? ""); // laatste volledige maand
const accCost = sum(account.filter((r) => r.month === month), "cost");
const inMonth = (t: string) => get(t).filter((r) => r.month === month);
check("apparaten = account", sum(inMonth("ads_device_performance_monthly"), "cost") === accCost, `${sum(inMonth("ads_device_performance_monthly"), "cost")} vs ${accCost}`);
check("netwerken = account", sum(inMonth("ads_network_performance_monthly"), "cost") === accCost);
check("ad-groepen = campagnes", sum(inMonth("ads_adgroup_monthly"), "cost") === sum(inMonth("ads_campaign_monthly"), "cost"));
check("zoekwoorden = hun ad-groepen (alleen zoekcampagnes)", (() => {
  const kwGroups = new Set(inMonth("ads_keyword_performance_monthly").map((r) => r.ad_group_name));
  const kw = sum(inMonth("ads_keyword_performance_monthly"), "cost");
  const ag = sum(inMonth("ads_adgroup_monthly").filter((r) => kwGroups.has(r.ad_group_name)), "cost");
  return kw === ag;
})());

console.log("\nGeo blijft één bron (maandsommen == kaarttotalen)");
for (const [label, aggs] of [["landen", demoGeoCountries("google")], ["staten", demoGeoStates("google")]] as const) {
  const monthly = geoMonthlyRows(aggs, ["2026-05-01", "2026-06-01", "2026-07-01"]);
  const off = aggs.flatMap((a) =>
    (["impressions", "clicks", "cost", "conversions", "conversionsValue"] as const)
      .filter((k) => monthly.filter((r) => r.code === a.code).reduce((s, r) => s + r[k], 0) !== Math.round(a[k]))
      .map((k) => `${a.code}.${k}`)
  );
  check(label, off.length === 0, off.join(", "));
}

console.log("\nGeen omzet zonder conversie");
for (const table of [
  "ads_adgroup_monthly", "ads_device_performance_monthly", "ads_network_performance_monthly",
  "ads_ad_schedule_performance", "ads_keyword_performance_monthly", "ads_audience_performance_monthly",
  "ads_account_weekly", "ads_country_monthly", "ads_region_monthly",
]) {
  const bad = get(table).filter((r) => num(r, "conversions") === 0 && num(r, "conversions_value") > 0);
  check(table, bad.length === 0, bad.length ? JSON.stringify(bad[0]) : "");
}

console.log("\nDe maand-SOP vindt zijn tabellen");
for (const table of [
  "ads_account_weekly", "ads_adgroup_monthly", "ads_search_terms_wasteful", "ads_account_yoy",
  "ads_campaign_yoy", "ads_campaign_metadata", "ads_audience_performance_monthly",
  "ads_device_performance_monthly", "ads_country_yoy", "ads_network_performance_monthly",
  "ads_ad_schedule_performance", "ads_keyword_performance_monthly",
]) check(table, get(table).length > 0);

console.log("\nDe patronen die de demo moet laten zien");
const nights = get("ads_ad_schedule_performance").filter((r) => num(r, "hour_of_day") < 6);
const schedAll = get("ads_ad_schedule_performance");
check("nacht kost onevenredig veel per conversie",
  sum(nights, "cost") / sum(schedAll, "cost") > 3 * (sum(nights, "conversions") / Math.max(1, sum(schedAll, "conversions"))));
const partners = get("ads_network_performance_monthly").filter((r) => r.network_type === "SEARCH_PARTNERS");
const nets = get("ads_network_performance_monthly");
check("zoekpartners kosten meer dan ze opleveren",
  sum(partners, "cost") / sum(nets, "cost") > 2 * (sum(partners, "conversions") / sum(nets, "conversions")));
check("desktop converteert beter dan mobiel", (() => {
  const d = get("ads_device_performance_monthly");
  const cpa = (dev: string) => sum(d.filter((r) => r.device === dev), "cost") / sum(d.filter((r) => r.device === dev), "conversions");
  return cpa("DESKTOP") < cpa("MOBILE");
})());
check("weekreeks is niet twee keer dezelfde week", (() => {
  const w = get("ads_account_weekly");
  return new Set(w.map((r) => `${r.cost}|${r.clicks}`)).size > w.length * 0.9;
})());
check("landen-YoY verschilt per maand", (() => {
  const nl = get("ads_country_yoy").filter((r) => r.country_code === "NL");
  return new Set(nl.map((r) => r.cost_yoy_pct)).size > 1;
})());
check("Frankrijk heeft geen vorig jaar", get("ads_country_yoy").every((r) => r.country_code !== "FR"));
check("zoektermen dragen klikken zonder conversie", (() => {
  const st = get("ads_search_terms_wasteful");
  return st.length > 0 && st.every((r) => num(r, "clicks") > 0 && !("conversions" in r));
})());

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

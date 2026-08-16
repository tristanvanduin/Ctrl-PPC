export {};
// Verificatie van de live-koppelingslaag die niet aan netwerk/credentials hangt: de
// source/medium-classificatie (channel-map.ts) en het samenvoegen van de twee ruwe GA4-rapporten
// tot Ga4DailyRow[] (map-rows.ts) — met name dat sessies NIET dubbel geteld worden over meerdere
// key-events in dezelfde sessie.
// Draaien: npx tsx lib/ga4/__ga4_live_mapping_test.ts

import { classifyGa4Channel } from "./channel-map";
import { buildGa4DailyRows } from "./map-rows";
import type { Ga4ReportRow } from "./api-client";
import type { Ga4Config } from "./types";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. classifyGa4Channel");
check("google/cpc → google", classifyGa4Channel("google", "cpc") === "google");
check("googleads/cpc → google (variant)", classifyGa4Channel("google", "ppc") === "google");
check("facebook/paidsocial → meta", classifyGa4Channel("facebook", "paidsocial") === "meta");
check("instagram/cpc → meta", classifyGa4Channel("instagram", "cpc") === "meta");
check("linkedin/cpc → linkedin", classifyGa4Channel("linkedin", "cpc") === "linkedin");
check("google/organic → other (niet betaald)", classifyGa4Channel("google", "organic") === "other");
check("direct/none → other", classifyGa4Channel("(direct)", "(none)") === "other");
check("leeg/onbekend → other, geen crash", classifyGa4Channel(null, undefined) === "other");

console.log("\n2. buildGa4DailyRows — geen dubbeltelling van sessies over meerdere key events");
{
  const config: Ga4Config = { propertyId: "properties/1", keyEvents: ["form_submit", "generate_lead"], funnelSteps: ["session_start", "form_submit"] };
  // Eén sessierij: 100 sessies, 60 engaged, voor google/cpc/desktop/"/lp".
  const sessionRows: Ga4ReportRow[] = [
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/lp"], metricValues: [100, 60] },
  ];
  // Twee key-events in dezelfde combinatie — zouden bij een naïeve sessies-sommatie de sessies
  // verdubbelen; eventCount kent dat probleem niet en moet gewoon optellen.
  const eventRows: Ga4ReportRow[] = [
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/lp", "form_submit"], metricValues: [12] },
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/lp", "generate_lead"], metricValues: [8] },
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/lp", "session_start"], metricValues: [100] },
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/lp", "page_view"], metricValues: [140] }, // niet geconfigureerd — moet genegeerd worden
  ];
  const out = buildGa4DailyRows(sessionRows, eventRows, config);
  check("precies één samengevoegde rij", out.length === 1, `lengte=${out.length}`);
  const r = out[0];
  check("sessies blijven 100 (niet verdubbeld)", r?.sessions === 100, `sessions=${r?.sessions}`);
  check("engagedSessions overgenomen", r?.engagedSessions === 60);
  check("keyEvents = som van geconfigureerde events (12+8=20)", r?.keyEvents === 20, `keyEvents=${r?.keyEvents}`);
  check("funnel bevat alleen geconfigureerde stappen", r?.funnel.session_start === 100 && r?.funnel.form_submit === 12 && !("page_view" in (r?.funnel ?? {})));
  check("kanaal correct geclassificeerd", r?.channel === "google");
  check("device correct", r?.device === "desktop");
}

console.log("\n3. buildGa4DailyRows — gebeurtenis zonder sessierij wordt niet verzonnen");
{
  const config: Ga4Config = { propertyId: "properties/1", keyEvents: ["form_submit"], funnelSteps: [] };
  const out = buildGa4DailyRows([], [
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/lp", "form_submit"], metricValues: [5] },
  ], config);
  check("geen rij zonder sessiecontext", out.length === 0, `lengte=${out.length}`);
}

console.log("\n4. buildGa4DailyRows — meerdere kanalen/devices blijven apart");
{
  const config: Ga4Config = { propertyId: "properties/1", keyEvents: ["form_submit"], funnelSteps: [] };
  const sessionRows: Ga4ReportRow[] = [
    { dimensionValues: ["2026-08-01", "google", "cpc", "desktop", "/a"], metricValues: [50, 30] },
    { dimensionValues: ["2026-08-01", "facebook", "cpc", "mobile", "/b"], metricValues: [40, 20] },
  ];
  const out = buildGa4DailyRows(sessionRows, [], config);
  check("twee losse rijen", out.length === 2, `lengte=${out.length}`);
  check("kanalen niet vermengd", new Set(out.map((r) => r.channel)).size === 2);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);

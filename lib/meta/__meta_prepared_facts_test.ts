// Fixture-test voor de per-stap fact-assemblage (M2 data-laag). Deterministisch, geen IO.
// F5 fase3: 6 pijlers (was 11 losse stappen). Zie lib/analysis/adapters/meta-ads.ts voor de mapping.
// Draaien: npx tsx lib/meta/__meta_prepared_facts_test.ts

import { buildMetaStepFacts, type MetaBreakdownComputeRow, type MetaCreativePatternRow, type MetaPreparedInputs } from "./prepared-facts";
import type { MetaComputeRow } from "./prepared-compute";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function eq(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

// Helper: daily-rijen over opeenvolgende dagen in 2026-03.
function days(entity_id: string, name: string, startDay: number, count: number, impr: number, link_clicks: number, frequency: number, conversions = 0, conversion_value = 0): MetaComputeRow[] {
  const rows: MetaComputeRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ date: `2026-03-${String(startDay + i).padStart(2, "0")}`, entity_id, entity_name: name, impressions: impr, spend: impr * 0.01, link_clicks, conversions, conversion_value, frequency });
  }
  return rows;
}

// Account: februari en maart, met funnelvelden in beide maanden.
const account: MetaComputeRow[] = [
  { date: "2026-02-15", entity_id: "acc", impressions: 10000, spend: 1000, link_clicks: 200, conversions: 20, conversion_value: 4000, frequency: 1.8, landing_page_views: 900, add_to_cart: 180, initiate_checkout: 100 },
  { date: "2026-03-15", entity_id: "acc", impressions: 12000, spend: 1000, link_clicks: 180, conversions: 15, conversion_value: 3000, frequency: 2.4, landing_page_views: 1000, add_to_cart: 200, initiate_checkout: 100 },
];

// Campagnes in de laatste maand: camp_a boven, camp_b onder het accountgemiddelde (link CTR 1,5%).
const campaigns: MetaComputeRow[] = [
  { date: "2026-03-15", entity_id: "camp_a", entity_name: "Campagne A", impressions: 6000, spend: 500, link_clicks: 120, conversions: 10, conversion_value: 2000, frequency: 2.2 },
  { date: "2026-03-15", entity_id: "camp_b", entity_name: "Campagne B", impressions: 6000, spend: 500, link_clicks: 60, conversions: 5, conversion_value: 1000, frequency: 2.6 },
];

const adsets: MetaComputeRow[] = [
  { date: "2026-03-15", entity_id: "as_1", entity_name: "Ad set 1", impressions: 8000, spend: 600, link_clicks: 140, conversions: 12, conversion_value: 2400, frequency: 2.3 },
];

// Ads: een vermoeide ad (fatigue), een winnaar (hoge ROAS), en een vóór de analysemaand
// gepauzeerde ad met 12 conversies verspreid over februari -- boven de grens als je het volle
// venster telt, maar nul in de analysemaand: precies het geval waarin de stelligheidsvlag uit
// moet blijven.
const adFatigued = [...days("ad_fatigue", "Vermoeide ad", 1, 7, 1000, 20, 1.5), ...days("ad_fatigue", "Vermoeide ad", 8, 7, 1000, 10, 3.0)];
const adWinner = days("ad_winner", "Winnaar ad", 1, 14, 1000, 20, 1.5, 5, 1000);
const adPaused: MetaComputeRow[] = [1, 2, 3, 4].map((d) => (
  { date: `2026-02-0${d}`, entity_id: "ad_paused", entity_name: "Gepauzeerde ad", impressions: 1000, spend: 50, link_clicks: 15, conversions: 3, conversion_value: 600, frequency: 1.9 }
));
const ads: MetaComputeRow[] = [...adFatigued, ...adWinner, ...adPaused];

// Breakdowns: placement met waste, en demografie met en zonder volume. De februari-rij is de
// maand-anker-wacht: met het anker verandert hij NIETS aan de segmentcijfers hieronder (AN blijft
// 28,57% van de placement-spend); zonder anker zou AN's aandeel naar (200+900)/(700+900) = 68,75%
// springen en zouden de asserts hieronder omvallen.
const breakdowns: MetaBreakdownComputeRow[] = [
  { date: "2026-02-10", breakdown_type: "publisher_platform", breakdown_value: "audience_network", impressions: 4000, spend: 900, link_clicks: 20, conversions: 0, conversion_value: 0 },
  { date: "2026-03-15", breakdown_type: "publisher_platform", breakdown_value: "facebook_feed", impressions: 5000, spend: 500, link_clicks: 100, conversions: 10, conversion_value: 2000 },
  { date: "2026-03-15", breakdown_type: "publisher_platform", breakdown_value: "audience_network", impressions: 2000, spend: 200, link_clicks: 10, conversions: 0, conversion_value: 0 },
  { date: "2026-03-15", breakdown_type: "age_gender", breakdown_value: "25-34|female", impressions: 4000, spend: 400, link_clicks: 90, conversions: 15, conversion_value: 3000 },
  { date: "2026-03-15", breakdown_type: "age_gender", breakdown_value: "18-24|male", impressions: 1000, spend: 100, link_clicks: 15, conversions: 3, conversion_value: 300 },
];

const inputs: MetaPreparedInputs = { account, campaigns, adsets, ads, breakdowns, targets: { roasTarget: 3 } };
const facts = buildMetaStepFacts(inputs) as Record<number, any>;

// 1. Alle 6 pijlers aanwezig.
eq(Object.keys(facts).length, 6, "facts heeft 6 pijlers");
for (let s = 1; s <= 6; s++) assert(facts[s] !== undefined, `pijler ${s} aanwezig`);

// 2. Pijler 1: laatste maand, MoM-keten en target-status.
eq(facts[1].latest_month, "2026-03", "pijler 1 laatste maand maart");
eq(facts[1].previous_month, "2026-02", "pijler 1 vorige maand februari");
const convFact = facts[1].mom_chain.find((c: any) => c.metric === "Conversies");
eq(convFact.delta_pct, -25, "pijler 1: Conversies MoM -25%");
eq(facts[1].target.type, "ROAS", "pijler 1: ROAS-target gebruikt");
eq(facts[1].target.status, "OP SCHEMA", "pijler 1: ROAS 3,0 haalt target 3 (OP SCHEMA)");

// 3. Pijler 2 (Structuur & Budget): camp_a boven, camp_b onder het accountgemiddelde op Link CTR.
const campA = facts[2].campagnes.entities.find((e: any) => e.entity_id === "camp_a");
const campB = facts[2].campagnes.entities.find((e: any) => e.entity_id === "camp_b");
eq(campA.vs_average.find((v: any) => v.metric === "Link CTR").position, "boven", "pijler 2: camp_a boven gemiddelde Link CTR");
eq(campB.vs_average.find((v: any) => v.metric === "Link CTR").position, "onder", "pijler 2: camp_b onder gemiddelde Link CTR");
eq(facts[2].ad_sets.entities[0].entity_id, "as_1", "pijler 2: ad sets zitten in hetzelfde blok");

// 4. Pijler 3 (Creative & Visual): vermoeide ad is bleeder met fatigue-flag, winnaar is winnaar.
const adF = facts[3].creative_performance.ads.find((a: any) => a.entity_id === "ad_fatigue");
const adW = facts[3].creative_performance.ads.find((a: any) => a.entity_id === "ad_winner");
eq(adF.fatigue.flag, true, "pijler 3: vermoeide ad fatigue true");
eq(adF.classification, "bleeder", "pijler 3: vermoeide ad geclassificeerd als bleeder");
eq(adW.classification, "winnaar", "pijler 3: hoge-ROAS ad geclassificeerd als winnaar");
eq(facts[3].visual_patterns.available, false, "pijler 3: visual_patterns markeert geen vision-data zonder creativePatterns");
// Volumediscipline (pariteitsronde): de winnaar draait in de analysemaand ruim boven de grens;
// de gepauzeerde ad heeft 12 conversies over het volle venster maar nul in de maand -- zijn
// vlag moet uit staan, hoe zijn vol-venster-cijfers ook ogen.
const adP = facts[3].creative_performance.ads.find((a: any) => a.entity_id === "ad_paused");
eq(adW.boven_volumegrens, true, "pijler 3: winnaar boven de volumegrens in de analysemaand");
eq(adP.actief_in_maand, false, "pijler 3: gepauzeerde ad is niet actief in de analysemaand");
eq(adP.boven_volumegrens, false, "pijler 3: gepauzeerde ad nooit boven de grens, ondanks 12 vol-venster-conversies");

// 5. Pijler 4 (Placement & Doelgroep-segmenten): audience_network heeft waste (spend zonder conversies).
const an = facts[4].placement.segments.find((s: any) => s.breakdown_value === "audience_network");
eq(facts[4].placement.available, true, "pijler 4: placement beschikbaar");
eq(an.waste, true, "pijler 4: audience_network is waste");
// Maand-anker: de februari-AN-rij (900 spend) telt niet mee -- AN's spend is de maart-200, en het
// blok draagt de analysemaand expliciet. Placement heeft sinds de pariteitsronde dezelfde
// volumegrens als demografie: AN met 0 conversies is onder de grens.
eq(facts[4].placement.latest_month, "2026-03", "pijler 4: placement is op de laatste maand geankerd");
eq(an.spend, 200, "pijler 4: de oudere-maand-rij telt niet mee in het AN-segment");
eq(an.volume_ok, false, "pijler 4: AN-placement (0 conversies) onder de volumegrens");

// 5b. F5 fase2.3 placement-waste-detector. AN heeft 200 van de 700 publisher_platform-spend
// (28,57%, > 15%) en 0 van de 10 conversies (0% < 28,57%) -- dus disproportioneel en flagged.
eq(facts[4].placement.audience_network_waste.spend_share_pct, 28.57, "pijler 4: AN spend-aandeel 28,57%");
eq(facts[4].placement.audience_network_waste.conversion_share_pct, 0, "pijler 4: AN conversie-aandeel 0%");
eq(facts[4].placement.audience_network_waste.flagged, true, "pijler 4: AN placement-waste geflagd (>15% spend, geen evenredige conversies)");

// 6. Pijler 4: 25-34 haalt volume, 18-24 niet (gate op 10 conversies).
const seg2534 = facts[4].demografie_geo.segments.find((s: any) => s.breakdown_value === "25-34|female");
const seg1824 = facts[4].demografie_geo.segments.find((s: any) => s.breakdown_value === "18-24|male");
eq(seg2534.volume_ok, true, "pijler 4: 25-34 haalt minimumvolume");
eq(seg1824.volume_ok, false, "pijler 4: 18-24 onder minimumvolume");

// 7. Pijler 5 (Funnel, Verzadiging & Schedule): funnel beschikbaar, eerste fase is een hoge drop-off.
eq(facts[5].funnel.available, true, "pijler 5: funnel beschikbaar");
const firstStage = facts[5].funnel.stages[0];
eq(firstStage.flag_high, true, "pijler 5: Impressions naar LPV is hoge drop-off (>50%)");

// 8. Pijler 6 is een expliciete synthese-marker.
assert(typeof facts[6].note === "string", "pijler 6 is een synthese-marker");

// 9. Pijler 5: weekdagen aanwezig.
assert(Array.isArray(facts[5].schedule.days) && facts[5].schedule.days.length >= 1, "pijler 5: schedule heeft weekdagen");

// 10. Pijler 5: FTIR-verzadiging. Account-fixture heeft geen reach (delta reach = 0) bij groeiende
// impressies (10000 -> 12000) en stijgende CPA (50 -> 66,67), dus FTIR = 0 (< 0,25) plus
// stijgende CPA classificeert als audience-verzadiging.
eq(facts[5].frequency_verzadiging.ftir, 0, "pijler 5: FTIR is 0 (geen reach-groei terwijl impressies groeien)");
eq(facts[5].frequency_verzadiging.ftir_signal, "audience_verzadiging", "pijler 5: FTIR-signaal is audience_verzadiging");
eq(facts[5].frequency_verzadiging.saturation_signal, true, "pijler 5: saturation_signal volgt uit FTIR-signaal");
eq(facts[5].frequency_verzadiging.ftir_inputs.cpa_rising, true, "pijler 5: CPA stijgt (50 -> 66,67)");

// 11. Bij voldoende nieuw bereik (FTIR > 0,40) en dalende CTR is het signaal creative fatigue,
// niet verzadiging -- ook al staat frequency en CPA in dezelfde richting.
const freshAccount: MetaComputeRow[] = [
  { date: "2026-02-15", entity_id: "acc", impressions: 10000, spend: 1000, link_clicks: 250, conversions: 20, conversion_value: 4000, frequency: 1.8, reach: 6000 },
  { date: "2026-03-15", entity_id: "acc", impressions: 12000, spend: 1000, link_clicks: 180, conversions: 20, conversion_value: 4000, frequency: 1.8, reach: 7200 },
];
const freshFacts = buildMetaStepFacts({ account: freshAccount, campaigns: [], adsets: [], ads: [], breakdowns: [] }) as Record<number, any>;
eq(freshFacts[5].frequency_verzadiging.ftir, 0.6, "pijler 5: FTIR 0,6 bij evenredige reach-groei (1200/2000)");
eq(freshFacts[5].frequency_verzadiging.ftir_signal, "creative_fatigue", "pijler 5: hoog FTIR + dalende CTR is creative_fatigue");
eq(freshFacts[5].frequency_verzadiging.saturation_signal, false, "pijler 5: creative_fatigue is geen saturation_signal");

// 12. Pijler 4: AN blijft ongeflagd als het spend-aandeel onder de 15%-drempel blijft, ook al
// zijn er geen conversies.
const lowShareBreakdowns: MetaBreakdownComputeRow[] = [
  { date: "2026-03-15", breakdown_type: "publisher_platform", breakdown_value: "facebook_feed", impressions: 9000, spend: 900, link_clicks: 180, conversions: 18, conversion_value: 3600 },
  { date: "2026-03-15", breakdown_type: "publisher_platform", breakdown_value: "audience_network", impressions: 1000, spend: 100, link_clicks: 5, conversions: 0, conversion_value: 0 },
];
const lowShareFacts = buildMetaStepFacts({ account, campaigns: [], adsets: [], ads: [], breakdowns: lowShareBreakdowns }) as Record<number, any>;
eq(lowShareFacts[4].placement.audience_network_waste.spend_share_pct, 10, "pijler 4: AN spend-aandeel 10% (onder de drempel)");
eq(lowShareFacts[4].placement.audience_network_waste.flagged, false, "pijler 4: AN niet geflagd onder de 15%-drempel");

// 12b. Maand-anker-degradatie: rijen die ALLEEN buiten de analysemaand vallen zijn geen data
// voor die maand -- placement degradeert naar available:false en de AN-waste naar null, in
// plaats van stilletjes op verouderde maanden te rekenen.
const oudeBreakdowns: MetaBreakdownComputeRow[] = [
  { date: "2026-02-10", breakdown_type: "publisher_platform", breakdown_value: "facebook_feed", impressions: 9000, spend: 900, link_clicks: 180, conversions: 18, conversion_value: 3600 },
];
const oudeFacts = buildMetaStepFacts({ account, campaigns: [], adsets: [], ads: [], breakdowns: oudeBreakdowns }) as Record<number, any>;
eq(oudeFacts[4].placement.available, false, "pijler 4: alleen oudere-maand-rijen degradeert placement naar available:false");
eq(oudeFacts[4].placement.audience_network_waste, null, "pijler 4: AN-waste is null zonder rijen in de analysemaand");

// 13. F5 fase2.4: pijler 3 koppelt meta_creative_patterns i.p.v. altijd te degraderen.
// Deterministic gaat voor inferred; gesorteerd op |lift_pct|; alleen top 10.
const creativePatterns: MetaCreativePatternRow[] = [
  { period_start: "2026-03-01", period_end: "2026-03-31", attribute: "style", value: "ugc", metric: "hook_rate", n_ads: 12, impressions: 500000, conversions: 80, pattern_value: 0.42, account_avg: 0.31, lift_pct: 35.48, evidence_level: "deterministic" },
  { period_start: "2026-03-01", period_end: "2026-03-31", attribute: "human_present", value: "true", metric: "link_ctr", n_ads: 9, impressions: 300000, conversions: 40, pattern_value: 0.01, account_avg: 0.015, lift_pct: -33.33, evidence_level: "deterministic" },
  { period_start: "2026-03-01", period_end: "2026-03-31", attribute: "emotion", value: "urgentie", metric: "cvr", n_ads: 2, impressions: 5000, conversions: 3, pattern_value: 0.06, account_avg: 0.04, lift_pct: 50, evidence_level: "inferred" },
];
const withPatterns = buildMetaStepFacts({ ...inputs, creativePatterns }) as Record<number, any>;
eq(withPatterns[3].visual_patterns.available, true, "pijler 3: visual_patterns beschikbaar zodra er patronen zijn");
eq(withPatterns[3].visual_patterns.deterministic_count, 2, "pijler 3: 2 deterministic patronen");
eq(withPatterns[3].visual_patterns.top_patterns.length, 2, "pijler 3: alleen deterministic patronen als die er zijn (inferred genegeerd)");
eq(withPatterns[3].visual_patterns.top_patterns[0].attribute, "style", "pijler 3: hoogste |lift| eerst (35,48 > 33,33)");
eq(withPatterns[3].visual_patterns.top_patterns[0].direction, "boven", "pijler 3: positieve lift is boven");
eq(withPatterns[3].visual_patterns.top_patterns[1].direction, "onder", "pijler 3: negatieve lift is onder");

// 14. Pijler 3 valt terug op inferred als er geen deterministic patronen zijn.
const onlyInferred: MetaCreativePatternRow[] = [creativePatterns[2]];
const withInferredOnly = buildMetaStepFacts({ ...inputs, creativePatterns: onlyInferred }) as Record<number, any>;
eq(withInferredOnly[3].visual_patterns.available, true, "pijler 3: ook beschikbaar met alleen inferred patronen");
eq(withInferredOnly[3].visual_patterns.deterministic_count, 0, "pijler 3: 0 deterministic patronen");
eq(withInferredOnly[3].visual_patterns.top_patterns.length, 1, "pijler 3: valt terug op inferred");

// 15. F5 fase3: pijler 4 hard-skipt (top-level available:false) alleen als ECHT beide subdomeinen
// niets hebben -- niet zodra er ergens breakdown-data is.
const noBreakdownFacts = buildMetaStepFacts({ account, campaigns: [], adsets: [], ads: [], breakdowns: [] }) as Record<number, any>;
eq(noBreakdownFacts[4].available, false, "pijler 4: hard-skip markering zonder enige breakdown-data");
eq(noBreakdownFacts[4].placement.available, false, "pijler 4: placement blijft ook zichtbaar als losse degradatie");
eq(facts[4].available, undefined, "pijler 4: geen hard-skip markering zodra er wel breakdown-data is");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

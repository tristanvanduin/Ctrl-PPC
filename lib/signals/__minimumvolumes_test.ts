// Gedragstest voor de minimumvolumes en ontbrekende toetsen uit de doorlichting van 13 november
// 2026 (rapportsectie 1). Elk tegenvoorbeeld komt uit het rapport.
// Draaien: tsx lib/signals/__minimumvolumes_test.ts

import { detectMetaCreativeFatigue, detectMetaFrequencySaturation, type MetaAdSignalInput } from "./meta-creative";
import { detectLinkedInCplPressure, detectLinkedInEngagementWeakness, type LinkedInEntitySignalInput } from "./linkedin-signals";
import { renderSignalSection } from "./render-section";
import { mergeDetections } from "./types";
import { shapeMetaAdInputs, shapeLinkedInInputs, type MetaDailyRow, type LinkedInDailyRow } from "../analysis/channel-signal-data";
import { analyzeCampaignImpressionShare } from "../analysis/impression-share-facts";
import { buildMicrosoftStepFacts } from "../microsoft/prepared-facts";
import { detectAdFatigue } from "../meta/prepared-compute";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}  ${detail}`); }
}

const ad = (o: Partial<MetaAdSignalInput>): MetaAdSignalInput => ({
  entityId: "a", adName: "Ad A", campaignName: "Camp", impressions: 30000, frequency: 3.2,
  hookRate: null, holdRate: null, linkCtr: 0.01, prevLinkCtr: 0.01, cpa: null, prevCpa: null,
  qualityRanking: null, engagementRanking: null, conversionRanking: null, ...o,
} as MetaAdSignalInput);

console.log("Meta: frequentie zonder ontdubbeld bereik");
{
  // Rapport: dagfrequentie 1,3 met CTR -40% gaf 0 verhalen en "gecontroleerd, niets gevonden".
  const r = detectMetaCreativeFatigue([ad({ frequency: null, dailyFrequency: 1.3, linkCtr: 0.006 })]);
  check("geen verhaal op een dagfrequentie", r.triggered.length === 0);
  check("maar ook niet 'gecontroleerd'", !r.checked.includes("meta_creative_fatigue"), JSON.stringify(r.checked));
  check("wel: frequentie niet te beoordelen, met de reden", (r.notAssessable ?? []).some((n) => /niet te beoordelen/.test(n.reason) && /1,3|1\.3/.test(n.reason)), JSON.stringify(r.notAssessable));
  const s = detectMetaFrequencySaturation([{ scope: "Awareness", frequency: null, dailyFrequency: 1.5, impressions: 50000 }]);
  check("saturatie idem", s.triggered.length === 0 && (s.notAssessable ?? []).length === 1);
  const sectie = renderSignalSection(mergeDetections([r, s]), "Meta").section;
  check("de sectie zwijgt niet maar zegt het", /Niet te beoordelen/.test(sectie) && /Lees dit niet als "in orde"/.test(sectie), sectie);

  // Met een periodelezing (4,2 over 28 dagen) gaat hij wel af.
  const metPeriode = detectMetaCreativeFatigue([ad({ frequency: 4.2, linkCtr: 0.006 })]);
  check("met een periodefrequentie van 4,2 en CTR -40% wel fatigue", metPeriode.triggered.length === 1);
}

console.log("\nMeta: periodefrequentie komt uit de periode-rij, niet uit de dagen");
{
  const rows: MetaDailyRow[] = [];
  for (let d = 0; d < 56; d++) {
    const date = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
    rows.push({ entity_id: "a", date, impressions: 1000, link_clicks: 10, spend: 30, conversions: 1, frequency: 1.3 } as MetaDailyRow);
  }
  const laatste = rows.at(-1)!.date;
  const begin = new Date(Date.parse(laatste) - 27 * 86_400_000).toISOString().slice(0, 10);
  const zonder = shapeMetaAdInputs(rows, new Map());
  check("zonder periode-rij is frequency null en de dagwaarde staat apart", zonder[0].frequency === null && Math.abs((zonder[0].dailyFrequency ?? 0) - 1.3) < 1e-9);
  const met = shapeMetaAdInputs(rows, new Map(), [{ entity_id: "a", period_start: begin, period_end: laatste, impressions: 28000, reach: 7000 }]);
  check("met periode-rij is frequency 4,0 (28.000 / 7.000)", met[0].frequency === 4);
  const oud = shapeMetaAdInputs(rows, new Map(), [{ entity_id: "a", period_start: "2026-01-01", period_end: "2026-01-28", impressions: 28000, reach: 7000 }]);
  check("een periode-rij van een ander venster telt niet", oud[0].frequency === null);
}

console.log("\nMeta-fatigue en LinkedIn CPL-druk: een conversie verschil is geen patroon");
{
  // Rapport: 2 conversies vorig venster, 1 recent, CTR gelijk: "de CPA steeg 100%".
  const meta = detectMetaCreativeFatigue([ad({ cpa: 600, prevCpa: 300, conversions: 1, prevConversions: 2 })]);
  check("Meta: 2 tegen 1 conversie geeft geen fatigue", meta.triggered.length === 0);
  const metaVol = detectMetaCreativeFatigue([ad({ cpa: 60, prevCpa: 40, conversions: 30, prevConversions: 45 })]);
  check("Meta: met volume wel, maar als indicatie (alleen CPA-pad)", metaVol.triggered.length === 1 && metaVol.triggered[0].certainty === "indicatie");

  const li = (o: Partial<LinkedInEntitySignalInput>): LinkedInEntitySignalInput => ({
    name: "ABM", impressions: 20000, clicks: 300, ctr: 0.015, cpl: 560, prevCpl: 280, results: 1, prevResults: 2,
    formOpens: 0, formCompletionRate: null, videoCompletionRate: null, prevCtr: null, ...o,
  } as LinkedInEntitySignalInput);
  const dun = detectLinkedInCplPressure([li({})]);
  check("LinkedIn: 2 leads tegen 1 geeft geen CPL-druk", dun.triggered.length === 0);
  check("maar wel 'te weinig volume'", (dun.notAssessable ?? []).some((n) => /te weinig volume/.test(n.reason)));
  const vol = detectLinkedInCplPressure([li({ cpl: 125, prevCpl: 100, results: 15, prevResults: 15 })]);
  check("LinkedIn: +25% bij 15 resultaten per venster wel", vol.triggered.length === 1);
}

console.log("\nLinkedIn: CTR alleen binnen hetzelfde doel");
{
  // Rapport: "GreenTech Productvideo" (VIDEO_VIEWS, 0,40%) tegen de mediaan van leadgen (1,36%).
  const e = (name: string, ctr: number, objective: string): LinkedInEntitySignalInput => ({
    name, impressions: 90000, clicks: Math.round(90000 * ctr), ctr, objective, cpl: null, prevCpl: null,
    formOpens: 0, formCompletionRate: null, videoCompletionRate: null, prevCtr: null,
  } as LinkedInEntitySignalInput);
  const r = detectLinkedInEngagementWeakness([
    e("Lead A", 0.014, "LEAD_GENERATION"), e("Lead B", 0.0136, "LEAD_GENERATION"), e("Lead C", 0.013, "LEAD_GENERATION"),
    e("Lead D", 0.0135, "LEAD_GENERATION"), e("Verkeer", 0.012, "WEBSITE_VISITS"), e("Productvideo", 0.004, "VIDEO_VIEWS"),
  ]);
  check("de videocampagne krijgt geen 'boodschap resoneert niet'", !r.triggered.some((s) => s.scope === "Productvideo"));
  const r2 = detectLinkedInEngagementWeakness([
    e("Lead A", 0.014, "LEAD_GENERATION"), e("Lead B", 0.0136, "LEAD_GENERATION"), e("Lead C", 0.013, "LEAD_GENERATION"), e("Lead zwak", 0.004, "LEAD_GENERATION"),
  ]);
  check("een zwakke leadgen-campagne tussen leadgen-campagnes wel", r2.triggered.some((s) => s.scope === "Lead zwak"));
}

console.log("\nLinkedIn: CPL-druk telt met de ingestelde conversieselectie");
{
  const rows: LinkedInDailyRow[] = [];
  for (let d = 0; d < 56; d++) {
    const date = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
    const recent = d >= 28;
    rows.push({ entity_urn: "u", date, impressions: 2000, clicks: 30, spend: recent ? 140 : 95, one_click_leads: 0, one_click_lead_form_opens: 0, external_website_conversions: recent ? 0.5 : 0.6 } as LinkedInDailyRow);
  }
  const zonder = shapeLinkedInInputs(rows, new Map([["u", "Gids Downloads"]]));
  check("alleen lead-formulieren: geen CPL (de oude situatie)", zonder[0].cpl === null);
  const met = shapeLinkedInInputs(rows, new Map([["u", "Gids Downloads"]]), {
    results: (r) => Number(r.one_click_leads ?? 0) + Number((r as { external_website_conversions?: number }).external_website_conversions ?? 0),
    resultLabel: "resultaat",
  });
  check("met websiteconversies: een CPL", met[0].cpl != null && met[0].prevCpl != null);
  check("en de stijging gaat af", detectLinkedInCplPressure(met).triggered.length === 1);
}

console.log("\nImpressieaandeel: geen budgetverhoging zonder CPA-toets");
{
  const rij = (id: string, conv: number, cost: number, budgetLost: number) => ({
    campaign_id: id, campaign_name: id, month: "2026-10", conversions: conv, cost,
    search_impression_share: 0.5, search_budget_lost_is: budgetLost, search_rank_lost_is: 0.05,
  });
  // Rapport: 1 conversie op € 5.000 met 40% budgetverlies werd raise_budget.
  const een = analyzeCampaignImpressionShare([rij("X", 1, 5000, 0.4), rij("Y", 100, 3000, 0.01)]);
  const x = een.campaigns.find((c) => c.campaignId === "X")!;
  check("1 conversie op € 5.000 is geen budgetkandidaat", x.action !== "raise_budget" && een.summary.raiseBudgetCandidates === 0, x.action);
  check("en de reden staat erbij", /te weinig|boven/.test(x.budgetTegengehouden ?? ""), String(x.budgetTegengehouden));
  // De seed: GRT CPA 161 tegen een account-CPA van 76 (S13 naast S10 'effectiviteitsvraag').
  const seed = analyzeCampaignImpressionShare([rij("GRT", 26, 4200, 0.28), rij("GRA", 30, 3000, 0.04), rij("Brand", 45, 500, 0.01)]);
  const grt = seed.campaigns.find((c) => c.campaignId === "GRT")!;
  check("GRT blijft budget-gedreven", grt.driver === "budget");
  check("maar krijgt 'eerst efficiëntie' en geen budgetverhoging", grt.action === "improve_bid_or_quality" && /eerst efficiëntie/.test(grt.budgetTegengehouden ?? ""), String(grt.budgetTegengehouden));
  const goed = analyzeCampaignImpressionShare([rij("GRT", 26, 4200, 0.28)], { cpaTarget: 200 });
  check("onder het CPA-doel en met volume wel", goed.campaigns[0].action === "raise_budget");
}

console.log("\nMicrosoft: nul conversies is het slechtste lek, geen 'geen lek'");
{
  const datum = "2026-10-15";
  const account = [{ date: datum, impressions: 10000, clicks: 500, spend: 1000, conversions: 40 }];
  const segment = (waarde: string, spend: number, conversions: number) => ({ breakdown_type: "network", breakdown_value: waarde, date: datum, impressions: 1000, clicks: 50, spend, conversions });
  const facts = (an: number) => buildMicrosoftStepFacts({
    account, campaigns: [], adgroups: [],
    breakdowns: [segment("Search", 800, 40), segment("Audience", 200, an)],
  } as never) as unknown as Record<number, { netwerk: { segments: { segment: string; lek: boolean; lek_reden?: string }[] } }>;
  const met1 = facts(1)[5].netwerk.segments.find((s) => s.segment === "Audience")!;
  check("1 conversie bij 20% spend: lek", met1.lek === true);
  const met0 = facts(0)[5].netwerk.segments.find((s) => s.segment === "Audience")!;
  check("0 conversies bij 20% spend: ook lek, met reden", met0.lek === true && met0.lek_reden === "geen conversies", JSON.stringify(met0));
}

console.log("\nMeta prepared-compute: CTR-daling met alleen dagfrequenties");
{
  // Dagfrequentie 1,2 haalt de poort van 2,5 nooit; de CTR-daling mag dan niet stil verdwijnen.
  const rows = Array.from({ length: 21 }, (_, i) => ({
    entity_id: "ad1", date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
    impressions: 1000, link_clicks: i < 7 ? 20 : i >= 14 ? 10 : 15, spend: 30, conversions: 1, frequency: 1.2,
  }));
  const f = detectAdFatigue(rows as never)[0];
  check("geen fatigue-vlag op een dagfrequentie", f.fatigue === false);
  check("maar wel: CTR-daling, frequentie op periodeschaal onbekend", f.ctr_daling_frequentie_onbekend === true);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

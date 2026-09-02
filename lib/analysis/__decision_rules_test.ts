// Zelf-draaiende test voor de deterministische beslisregels (de keystone: hier komt de
// actierichting per campagne/geo/device vandaan). Herbouwd 2 september 2026: de regels kennen nu
// een "geen data"-toestand (drempels, null-groei, niet-meetbare ratio's, één resultaatmetriek
// voor geo) en een dekkingsblok. Dit bestand vervangt ook lib/__tests__/decision-rules.test.ts,
// dat dezelfde module met oude aannames (spend van €5, +100% groei zonder vorige maand) testte.
// Draaien: npx tsx lib/analysis/__decision_rules_test.ts

import {
  computeDecisionRules, MIN_CAMPAGNE_SPEND, MIN_GEO_SPEND, MIN_DEVICE_CLICKS, standaardResultMetric,
  type DecisionRulesInput,
} from "./decision-rules";

let failed = 0;
function assert(cond: boolean, msg: string, detail = "") {
  if (!cond) { failed++; console.error("  ✗ " + msg + (detail ? "  " + detail : "")); } else { console.log("  ✓ " + msg); }
}

const base = (over: Partial<DecisionRulesInput>): DecisionRulesInput => ({
  accountType: "ecommerce_roas",
  currentAccount: {},
  campaignRows: [],
  geoRows: [],
  deviceRows: [],
  targets: {},
  ...over,
});

console.log("accountstatus:");
{
  const op = computeDecisionRules(base({ currentAccount: { conversions: 100 }, targets: { conversionsTarget: 100 } }));
  assert(op.accountStatus === "OP SCHEMA", "conversies op target zonder roas/cpa-target => OP SCHEMA");
  const niet = computeDecisionRules(base({ currentAccount: { conversions: 85 }, targets: { conversionsTarget: 100 } }));
  assert(niet.accountStatus === "NIET OP SCHEMA", "85% van target => NIET OP SCHEMA");
  const kritiek = computeDecisionRules(base({ currentAccount: { conversions: 50 }, targets: { conversionsTarget: 100 } }));
  assert(kritiek.accountStatus === "KRITIEK", "onder 80% van target => KRITIEK");
  // ROAS-target zonder gemeten conversiewaarde: de target telt niet als gefaald, en dat staat erbij.
  const zonderWaarde = computeDecisionRules(base({ currentAccount: { conversions: 100, cost: 1000 }, targets: { conversionsTarget: 100, roasTarget: 3 } }));
  assert(zonderWaarde.accountStatus === "OP SCHEMA", "roasTarget zonder conversiewaarde faalt niet op ontbrekende data");
  assert(zonderWaarde.dekking.opmerkingen.some((o) => o.includes("ROAS-target")), "de dekking meldt de niet-toetsbare ROAS-target", JSON.stringify(zonderWaarde.dekking.opmerkingen));
  const leegAccount = computeDecisionRules(base({ currentAccount: {}, targets: { conversionsTarget: 100 } }));
  assert(leegAccount.dekking.opmerkingen.some((o) => o.includes("Geen accountrij")), "lege accountrij wordt benoemd");
}

console.log("volumedrempel:");
{
  const klein = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Restje", roas: 0.5, cost: 5, conversions: 1, conversions_value: 2.5 }],
    previousCampaignRows: [{ campaign_name: "Restje", cost: 1 }],
    targets: { roasTarget: 3 },
  }));
  const d = klein.campaignDecisions[0];
  assert(d.direction === "monitor" && d.confidence === "low", `spend < €${MIN_CAMPAGNE_SPEND} => monitor/low, nooit reduce`);
  assert(klein.dekking.campagnesOnderDrempel.includes("Restje"), "campagne staat in dekking.campagnesOnderDrempel");
  assert(/Onder de volumedrempel.*Restje/.test(klein.bindingFacts), "bindende feiten noemen de drempel apart, niet als oordeel");
}

console.log("campagne-richting (ROAS-account):");
{
  const reduce = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Slecht", roas: 1.0, cost: 200, conversions: 4, conversions_value: 200 }],
    previousCampaignRows: [{ campaign_name: "Slecht", cost: 100 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(reduce.direction === "reduce" && reduce.confidence === "high", "ROAS ver onder target + spend explodeert => reduce/high");

  const investigate = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Slecht", roas: 1.0, cost: 200, conversions: 4, conversions_value: 200 }],
    previousCampaignRows: [{ campaign_name: "Slecht", cost: 195 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(investigate.direction === "investigate", "ROAS onder target maar vlakke spend => investigate");

  // Geen vorige maand: groei is onbekend, niet +100%. Nieuw of hernoemd => investigate, geen reduce.
  const nieuw = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Nieuw", roas: 1.0, cost: 200, conversions: 4, conversions_value: 200 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(nieuw.direction === "investigate", "zonder vorige maand: investigate i.p.v. reduce (groei onbekend)", nieuw.direction);
  assert(nieuw.evidence.includes("onbekend"), "evidence zegt dat spend MoM onbekend is", nieuw.evidence);

  const expand = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Winner", roas: 4.0, cost: 100, conversions: 10, conversions_value: 400, search_budget_lost_is: 15 }],
    targets: { roasTarget: 3 },
  })).campaignDecisions[0];
  assert(expand.direction === "expand", "ROAS ruim boven target + budgetverlies => expand");

  // Materiële spend zonder conversies: ROAS/CPA niet meetbaar => investigate, nooit expand/reduce.
  const zonderConversies = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    campaignRows: [{ campaign_name: "Stil", cost: 400, conversions: 0, search_budget_lost_is: 30 }],
    targets: { cpaTarget: 30 },
  })).campaignDecisions[0];
  assert(zonderConversies.direction === "investigate", "0 conversies bij €400 spend => investigate (CPA 0 is geen 'onder target')", zonderConversies.direction);
}

console.log("campagne-richting (CPA-leadgen):");
{
  const reduce = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    campaignRows: [{ campaign_name: "Duur", cost_per_conversion: 50, cost: 200, conversions: 4 }],
    previousCampaignRows: [{ campaign_name: "Duur", cost: 100 }],
    targets: { cpaTarget: 30 },
  })).campaignDecisions[0];
  assert(reduce.direction === "reduce", "CPA ver boven target + spend stijgt => reduce");

  const expand = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    campaignRows: [{ campaign_name: "Efficient", cost_per_conversion: 20, cost: 100, conversions: 5, search_budget_lost_is: 20 }],
    targets: { cpaTarget: 30 },
  })).campaignDecisions[0];
  assert(expand.direction === "expand", "CPA onder target + budgetverlies => expand");

  const monitor = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    currentAccount: { conversions: 100, cost_per_conversion: 48 },
    campaignRows: [{ campaign_name: "Lead Search", cost: 1000, conversions: 20, cost_per_conversion: 48, search_budget_lost_is: 0.1 }],
    previousCampaignRows: [{ campaign_name: "Lead Search", cost: 900, conversions: 19, cost_per_conversion: 47 }],
    targets: { cpaTarget: 50, conversionsTarget: 100 },
  })).campaignDecisions[0];
  assert(monitor.direction === "monitor", "CPA rond target => monitor");
}

console.log("dedupe: dezelfde campagne krijgt nooit expand én reduce:");
{
  const output = computeDecisionRules(base({
    currentAccount: { conversions: 150, roas: 3.1, conversion_rate: 0.05 },
    campaignRows: [
      { campaign_name: "Brand", roas: 3.1, cost: 1500, conversions: 120, conversions_value: 4650, search_budget_lost_is: 0.25 },
      { campaign_name: "Brand", roas: 1.1, cost: 2500, conversions: 20, conversions_value: 2750, search_budget_lost_is: 0.25 },
    ],
    previousCampaignRows: [{ campaign_name: "Brand", roas: 2.9, cost: 1400, conversions: 110 }],
    targets: { roasTarget: 2.2, cpaTarget: 20, conversionsTarget: 100 },
  }));
  assert(output.campaignDecisions.filter((d) => d.campaignName === "Brand").length === 1, "één oordeel per campagnenaam");
}

console.log("geo: één resultaatmetriek voor alle landen, drempel, geen-data-toestand:");
{
  const geo = computeDecisionRules(base({
    geoRows: [
      { country: "NL", cost: 100, conversions_value: 50 },
      { country: "DE", cost: 100, conversions_value: 150 },
    ],
  })).geoDecisions;
  assert(geo.find((g) => g.country === "NL")?.direction === "geo_reduce", "land dat meer spend absorbeert dan het teruggeeft => geo_reduce");
  assert(geo.find((g) => g.country === "DE")?.direction === "geo_expand", "land met disproportionele conversiewaarde => geo_expand");

  // Gemengde velden: bij resultMetric conversion_value telt een land ZONDER waarde als 0, niet
  // als zijn aantal conversies. Dat land is dus geo_reduce, niet geo_expand.
  const gemengd = computeDecisionRules(base({
    geoRows: [
      { country: "NL", cost: 100, conversions_value: 300, conversions: 3 },
      { country: "BE", cost: 100, conversions: 40 },
    ],
  })).geoDecisions;
  assert(gemengd.find((g) => g.country === "BE")?.direction === "geo_reduce", "land zonder conversiewaarde telt bij conversion_value als 0 (geen eenhedenmix)", JSON.stringify(gemengd));

  const leadgen = computeDecisionRules(base({
    accountType: "leadgen_cpa",
    geoRows: [{ country: "NL", cost: 100, conversions: 3 }, { country: "BE", cost: 100, conversions: 40 }],
  })).geoDecisions;
  assert(leadgen.find((g) => g.country === "BE")?.direction === "geo_expand", "bij leadgen telt het aantal conversies als teller");
  assert(standaardResultMetric("leadgen_cpa") === "conversions" && standaardResultMetric("ecommerce_roas") === "conversion_value", "standaardResultMetric volgt het accounttype");

  const drempel = computeDecisionRules(base({
    geoRows: [{ country: "NL", cost: 100, conversions_value: 300 }, { country: "LU", cost: 3, conversions_value: 0 }],
  }));
  assert(drempel.geoDecisions.every((g) => g.country !== "LU") && drempel.dekking.landenOnderDrempel === 1, `land onder €${MIN_GEO_SPEND} wordt overgeslagen en geteld`);

  const geenData = computeDecisionRules(base({ geoRows: [] }));
  assert(geenData.dekking.geoData === false, "lege geoRows => dekking.geoData false");
  assert(/Geen geo-data voor de analysemaand/.test(geenData.bindingFacts), "bindende feiten zeggen 'geen geo-data', niet 'geen richtingen'");
}

console.log("device: klikdrempel en spend-aandeel:");
{
  const dev = computeDecisionRules(base({
    currentAccount: { conversion_rate: 0.05 },
    deviceRows: [
      { device: "mobile", cost: 100, clicks: 1000, conversions: 10 },
      { device: "desktop", cost: 100, clicks: 1000, conversions: 100 },
      { device: "tablet", cost: 20, clicks: 3, conversions: 1 },
    ],
  })).deviceDecisions;
  assert(dev.find((d) => d.device === "mobile")?.direction === "device_reduce", "device ver onder account-CVR met materieel spend => device_reduce");
  assert(dev.find((d) => d.device === "desktop")?.direction === "device_expand", "device ruim boven account-CVR met spend-aandeel => device_expand");
  assert(dev.find((d) => d.device === "tablet")?.direction === "monitor", `tablet met 3 klikken (< ${MIN_DEVICE_CLICKS}) => monitor, geen device_expand`);
  const geenData = computeDecisionRules(base({ deviceRows: [] }));
  assert(/Geen device-data voor de analysemaand/.test(geenData.bindingFacts) && geenData.dekking.deviceData === false, "lege deviceRows => 'geen device-data'");
}

console.log("bindende feiten:");
{
  const out = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Slecht", roas: 1.0, cost: 200, conversions: 4, conversions_value: 200 }],
    previousCampaignRows: [{ campaign_name: "Slecht", cost: 100 }],
    targets: { roasTarget: 3 },
  }));
  assert(/BINDENDE ACTIERICHTINGEN/.test(out.bindingFacts), "bindende feiten dragen de kop");
  assert(/Slecht: REDUCE/.test(out.bindingFacts), "richting staat in kapitalen bij de campagne");
  assert(/REDUCE = je mag NIET/.test(out.bindingFacts), "expliciete tegen-regel voor reduce");
  const schoon = computeDecisionRules(base({
    campaignRows: [{ campaign_name: "Brand  Search", roas: 2.8, cost: 1200, conversions: 90, conversions_value: 3360, search_budget_lost_is: 0.05 }],
    previousCampaignRows: [{ campaign_name: "Brand  Search", cost: 1000 }],
    targets: { roasTarget: 2.2 },
  }));
  assert(!/\|\s*\|/.test(schoon.bindingFacts), "geen lege scheidingsfragmenten in de bindende feiten");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle decision-rules-tests geslaagd");

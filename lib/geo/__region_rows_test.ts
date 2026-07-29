// Test voor de staten-vertaling. Deterministisch, geen IO.
// Draaien: npx tsx lib/geo/__region_rows_test.ts

import { buildRegionRows, overslaanSamenvatting, type RuweRegioRij, type GeoDoelLabel } from "./region-rows";
import { uspsToEnglishName, regionNameToUsps, FIPS_TO_USPS } from "./us-fips";
import { demoRows } from "@/lib/demo/demo-rows";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const CA = "geoTargetConstants/21137";
const TX = "geoTargetConstants/21176";
const NH = "geoTargetConstants/20123"; // Noord-Holland: wél een regio, geen VS-staat

const labels = new Map<string, GeoDoelLabel>([
  [CA, { name: "California", countryCode: "US" }],
  [TX, { name: "Texas", countryCode: "US" }],
  [NH, { name: "North Holland", countryCode: "NL" }],
]);

function rij(o: Partial<RuweRegioRij> = {}): RuweRegioRij {
  return {
    month: "2026-07-01", campaignId: "c1", campaignName: "Campagne", geoTargetState: CA,
    impressions: 100, clicks: 10, cost: 50, conversions: 2, conversionsValue: 200, ...o,
  };
}

// ── De gelukkige weg ──
const basis = buildRegionRows([rij(), rij({ geoTargetState: TX })], labels);
assert(basis.rijen.length === 2, "twee staten geven twee rijen");
assert(basis.rijen.every((r) => r.country_code === "US"), "land komt uit het label");
assert(basis.rijen.every((r) => r.campaign_count === 1), "één campagne geeft campaign_count 1");
const ca = basis.rijen.find((r) => r.region_code === "CA");
assert(ca?.region_name === "California", "de leesbare naam blijft staan naast de code");
assert(Object.keys(basis.overgeslagen).length === 0, "niets overgeslagen op de gelukkige weg");
assert(overslaanSamenvatting(basis) === null, "geen samenvatting als er niets afviel");

// ── Optellen per (maand, campagne, staat) ──
const opgeteld = buildRegionRows([rij(), rij(), rij({ month: "2026-06-01" })], labels);
assert(opgeteld.rijen.length === 2, "dezelfde staat in dezelfde maand telt op tot één rij");
const juli = opgeteld.rijen.find((r) => r.month === "2026-07-01")!;
assert(juli.impressions === 200 && juli.clicks === 20 && juli.cost === 100, "de metrics worden opgeteld");
assert(juli.conversions === 4 && juli.conversions_value === 400, "conversies en waarde tellen mee");
assert(opgeteld.rijen.some((r) => r.month === "2026-06-01"), "een andere maand blijft een eigen rij");

// Twee campagnes op dezelfde staat worden één rij: ads_region_monthly heeft geen
// campagnekolommen maar een campaign_count. Deze test stond eerst andersom — het schema won.
const perCampagne = buildRegionRows([rij(), rij({ campaignId: "c2" })], labels);
assert(perCampagne.rijen.length === 1, "twee campagnes op dezelfde staat worden één rij");
assert(perCampagne.rijen[0].campaign_count === 2, "en campaign_count telt de campagnes");
assert(perCampagne.rijen[0].impressions === 200, "de metrics van beide campagnes tellen op");
// Dezelfde campagne die in twee ruwe rijen terugkomt telt maar één keer mee.
const dubbel = buildRegionRows([rij(), rij()], labels);
assert(dubbel.rijen[0].campaign_count === 1, "dezelfde campagne telt niet dubbel in campaign_count");

// ── Wat afvalt, valt zichtbaar af ──
const zonderDoel = buildRegionRows([rij({ geoTargetState: "" })], labels);
assert(zonderDoel.rijen.length === 0 && zonderDoel.overgeslagen.geen_geo_doel === 1, "een rij zonder geo-doel wordt geteld als geen_geo_doel");

const zonderLabel = buildRegionRows([rij({ geoTargetState: "geoTargetConstants/999999" })], labels);
assert(zonderLabel.overgeslagen.geen_label === 1, "een onopgeloste resource-naam telt als geen_label");

// Niet-VS: hoort niet op een VS-statenkaart, maar mag niet stil verdwijnen.
const nl = buildRegionRows([rij({ geoTargetState: NH })], labels);
assert(nl.rijen.length === 0, "een Nederlandse provincie levert geen statenrij");
assert(nl.overgeslagen.geen_usps_code === 1, "en wordt geteld");
assert(nl.onbekendeNamen.length === 0, "een niet-VS-naam is geen onbekende VS-naam");

// Een VS-staat die de vertaaltabel niet kent: dát wil je bij naam terugzien.
const raar = buildRegionRows(
  [rij({ geoTargetState: "geoTargetConstants/1" })],
  new Map([["geoTargetConstants/1", { name: "Nieuw Grondgebied", countryCode: "US" }]])
);
assert(raar.overgeslagen.geen_usps_code === 1, "een onvertaalbare VS-naam wordt geteld");
assert(raar.onbekendeNamen.includes("Nieuw Grondgebied"), "en staat bij naam in het resultaat");
assert((overslaanSamenvatting(raar) ?? "").includes("Nieuw Grondgebied"), "de samenvatting noemt hem");

// ── De regressie die dit bestand bestaansrecht geeft ──
// De oude sync schreef geographic_view.location_type in de regiokolom. Kwam die waarde ooit als
// label terug, dan mag er nog steeds geen rij uitrollen.
const oudeFout = buildRegionRows(
  [rij({ geoTargetState: "geoTargetConstants/2840" })],
  new Map([["geoTargetConstants/2840", { name: "LOCATION_OF_PRESENCE", countryCode: "US" }]])
);
assert(oudeFout.rijen.length === 0, "LOCATION_OF_PRESENCE levert geen staat op");
assert(oudeFout.onbekendeNamen.includes("LOCATION_OF_PRESENCE"), "en wordt zichtbaar gemeld");

// ── Lege invoer ──
const leeg = buildRegionRows([], labels);
assert(leeg.rijen.length === 0 && Object.keys(leeg.overgeslagen).length === 0, "lege invoer geeft een leeg, stil resultaat");

// ── Heen en terug ──
// De sync leest de Engelse naam van Google en vertaalt naar USPS; de demo doet het omgekeerd.
// Lopen die twee uiteen, dan ziet de demo er anders uit dan productie en test hij de vertaalstap
// niet meer — precies de blinde vlek waardoor dit ooit misging.
for (const usps of Object.values(FIPS_TO_USPS)) {
  const naam = uspsToEnglishName(usps);
  assert(regionNameToUsps(naam) === usps, `${usps} → "${naam}" → ${usps}`);
}

// ── De demo-rijen volgen diezelfde regel ──
const regioDemo = (demoRows() as unknown as Record<string, Record<string, unknown>[]>).ads_region_monthly ?? [];
assert(regioDemo.length > 0, "er zijn demo-rijen voor ads_region_monthly");
const scheef = regioDemo.filter((r) => regionNameToUsps(String(r.region_name)) !== r.region_code);
assert(scheef.length === 0, `elke demo-region_name vertaalt terug naar zijn region_code (${scheef.length} scheef)`);
assert(regioDemo.every((r) => r.country_code === "US"), "de demo-staten staan allemaal op US");

// De statenkaart tekent op USPS-codes uit us-atlas; een code die daar niet in staat is onzichtbaar.
const tekenbaar = new Set(Object.values(FIPS_TO_USPS));
assert(regioDemo.every((r) => tekenbaar.has(String(r.region_code))), "elke demo-staat is op de kaart te tekenen");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

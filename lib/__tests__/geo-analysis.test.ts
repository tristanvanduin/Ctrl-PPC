export {};
// Verificatie van de markt-analyse. Twee dingen die hier stil fout gaan: een oordeel vellen over
// een markt die nauwelijks verkeer had (dan is "geen conversies" ruis), en markten van
// verschillende niveaus tegen elkaar afzetten — Californië tegen Nederland leggen zou structurele
// marktverschillen als probleem markeren.
// Draaien: npx tsx lib/__tests__/geo-analysis.test.ts

import {
  buildGeoSignals, GEO_MIN_COST, GEO_MIN_CLICKS, GEO_CPA_HIGH, GEO_MIN_MARKETS,
} from "../signals/geo-analysis";
import type { GeoAgg } from "../demo/geo-demo";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

/** Bouwt een markt uit klikken + conversieratio + CPA, zodat de tests leesbaar blijven. */
function mk(code: string, clicks: number, convRate: number, cpa: number, impressions = 0): GeoAgg {
  const conversions = Math.round(clicks * convRate);
  return {
    code, clicks, conversions,
    cost: Math.round(conversions * cpa),
    impressions: impressions || clicks * 25,
    conversionsValue: conversions * 120,
  };
}
const ids = (r: { triggered: { id: string }[] }) => r.triggered.map((t) => t.id).join(",");

// Drie gezonde basismarkten: CPA 50, conversieratio 4%.
const BASE = [mk("NL", 500, 0.04, 50), mk("BE", 400, 0.04, 50), mk("DE", 300, 0.04, 50)];

console.log("\n1. Markt die kost maar nooit converteert");
{
  const rows = [...BASE, mk("FR", 200, 0, 0)];
  rows[3].cost = 400; // wel kosten, geen conversies
  const r = buildGeoSignals(rows, "country", "Google");
  check("gemarkeerd", r.triggered.some((t) => t.id === "geo_country_geen_conversies_FR"), ids(r));
  const t = r.triggered.find((x) => x.id.includes("FR"))!;
  check("actie noemt taal/landingspagina", /taal|landingspagina/i.test(t.actionDirection));
  check("bewezen, niet indicatie", t.certainty === "bewezen_binnen_platform");
}

console.log("\n2. Te weinig verkeer → geen oordeel (dit is de valkuil)");
{
  const thin = mk("FR", GEO_MIN_CLICKS - 1, 0, 0);
  thin.cost = 400;
  check("stil ondanks nul conversies", !buildGeoSignals([...BASE, thin], "country", "Google").triggered.some((t) => t.id.includes("FR")));

  const cheap = mk("FR", 200, 0, 0);
  cheap.cost = GEO_MIN_COST - 1;
  check("stil bij verwaarloosbare kosten", !buildGeoSignals([...BASE, cheap], "country", "Google").triggered.some((t) => t.id.includes("FR")));
}

console.log("\n3. Verkeer komt binnen maar converteert niet → wijst naar de pagina");
{
  // Zelfde CTR-kwaliteit, maar conversieratio ver onder de mediaan.
  const rows = [...BASE, mk("DK", 400, 0.012, 50)];
  const r = buildGeoSignals(rows, "country", "Google");
  const t = r.triggered.find((x) => x.id.includes("DK"));
  check("conversieratio-signaal", t?.id === "geo_country_conversieratio_DK", ids(r));
  check("zegt expliciet dat het geen targetingprobleem is", /geen targetingprobleem/i.test(t?.actionDirection ?? ""));
  check("categorie conversie_meting", t?.category === "conversie_meting");
}

console.log("\n4. Structureel dure markt");
{
  const rows = [...BASE, mk("CH", 300, 0.04, 50 * (GEO_CPA_HIGH + 0.5))];
  const r = buildGeoSignals(rows, "country", "Google");
  const t = r.triggered.find((x) => x.id.includes("CH"));
  check("dure-markt-signaal", t?.id === "geo_country_dure_markt_CH", ids(r));
  check("noemt de mediaan als norm", /mediaan/i.test(t?.story ?? ""));
  check("actie weegt strategie mee, roept niet meteen 'stoppen'", /weeg|strategisch/i.test(t?.actionDirection ?? ""));
}

console.log("\n5. Goedkoop en klein → schaalkans, maar eerlijk gelabeld");
{
  // Genoeg volume om de efficientie te dragen (12 conversies), maar klein aandeel van het budget.
  const rows = [...BASE, mk("AT", 200, 0.06, 20)];
  const r = buildGeoSignals(rows, "country", "Google");
  const t = r.triggered.find((x) => x.id.includes("AT"));
  check("schaalkans", t?.id === "geo_country_schaalkans_AT", ids(r));
  check("slechts indicatie: groeiruimte is een aanname", t?.certainty === "indicatie");
  check("waarschuwt voor beperkte marktomvang", /marktomvang/i.test(t?.actionDirection ?? ""));
}

console.log("\n6. Een grote goedkope markt is geen 'schaalkans'");
{
  // Goedkoop maar draagt het leeuwendeel van het budget: daar valt niets meer op te schalen.
  const rows = [mk("NL", 5000, 0.06, 20), mk("BE", 300, 0.04, 50), mk("DE", 300, 0.04, 50)];
  check("niet als schaalkans gemeld", !buildGeoSignals(rows, "country", "Google").triggered.some((t) => t.id.includes("schaalkans_NL")));
}

console.log("\n7. Te weinig markten → geen mediaan, geen oordeel");
{
  const rows = BASE.slice(0, GEO_MIN_MARKETS - 1);
  const r = buildGeoSignals(rows, "country", "Google");
  check("stil", r.triggered.length === 0);
  check("wel gerapporteerd wat onderzocht is", r.checked.length === 4);
}

console.log("\n8. Staten gebruiken staat-taal en een eigen norm");
{
  const rows = [mk("CA", 500, 0.04, 60), mk("TX", 400, 0.04, 60), mk("NY", 300, 0.04, 60), mk("FL", 300, 0.04, 60 * (GEO_CPA_HIGH + 0.5))];
  const r = buildGeoSignals(rows, "region", "Google");
  const t = r.triggered.find((x) => x.id.includes("FL"));
  check("staat-id", t?.id === "geo_region_dure_markt_FL", ids(r));
  check("leesbare staatsnaam", /Florida/.test(t?.story ?? ""), t?.story);
  check("spreekt over staten, niet over markten", /staten/.test(t?.story ?? "") || /staat/.test(t?.actionDirection ?? ""));
  check("norm is de mediaan van de staten (60), niet van landen", /€\s60\b/.test(t?.story ?? ""), t?.story);
}

console.log("\n9. Kanaal staat in de scope, zodat de wachtrij weet waar het over gaat");
{
  const rows = [...BASE, mk("CH", 300, 0.04, 200)];
  const r = buildGeoSignals(rows, "country", "Meta");
  check("scope noemt het kanaal", r.triggered.every((t) => t.scope.startsWith("Meta — ")), r.triggered.map((t) => t.scope).join(" | "));
}

console.log("\n10. Eén bevinding per markt, geen stapeling");
{
  // Duur én lage conversieratio tegelijk: hoort één verhaal op te leveren, niet twee.
  const rows = [...BASE, mk("IT", 400, 0.01, 300)];
  const r = buildGeoSignals(rows, "country", "Google");
  const it = r.triggered.filter((t) => t.id.includes("_IT"));
  check("één verhaal voor IT", it.length === 1, ids(r));
  check("geen dubbele ids over het geheel", new Set(r.triggered.map((t) => t.id)).size === r.triggered.length);
}

console.log("\n11. Gezonde markten leveren geen ruis op");
{
  const r = buildGeoSignals(BASE, "country", "Google");
  check("drie gelijkwaardige markten → stil", r.triggered.length === 0, ids(r));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

// Zelf-draaiende test voor de geo-clone-aggregator (Fase 1c). Draait via tsx.
// Controleert: filteren op geo-clone via de catalogus, per-maand sommeren, ratio's uit
// maandtotalen (niet uit gemiddelde deelwaarden), totalen uit maandtotalen, en lege invoer.

import { aggregateCampaignMonthlyByGeoClone, aggregateAllGeoClones, type CampaignMonthlyRow } from "./geo-clone-aggregate";
import type { GeoCloneVariant } from "./geo-clone-catalog";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}
function close(a: number | null, b: number, msg: string) {
  // De aggregator rondt ratio's op 4 decimalen af; tolerantie navenant.
  assert(a !== null && Math.abs(a - b) < 5e-5, `${msg} (kreeg ${a}, verwacht ${b})`);
}

// GRT = GreenTech Amsterdam (bevestigd). Twee GRT-campagnes over twee maanden, plus één
// AQM-campagne die NIET mee mag tellen en één onbekende campagne die genegeerd wordt.
const rows: CampaignMonthlyRow[] = [
  { campaign_name: "GRT | Search | NL", month: "2026-01-01", impressions: 1000, clicks: 100, cost: 200, conversions: 10, conversions_value: 800 },
  { campaign_name: "GRT | Display", month: "2026-01-01", impressions: 500, clicks: 20, cost: 50, conversions: 2, conversions_value: 100 },
  { campaign_name: "GRT | Search | NL", month: "2026-02-01", impressions: 2000, clicks: 300, cost: 400, conversions: 20, conversions_value: 2000 },
  { campaign_name: "AQM | Search", month: "2026-01-01", impressions: 9999, clicks: 9999, cost: 9999, conversions: 999, conversions_value: 9999 },
  { campaign_name: "Brand generic", month: "2026-01-01", impressions: 111, clicks: 11, cost: 11, conversions: 1, conversions_value: 11 },
];

console.log("aggregateCampaignMonthlyByGeoClone (GRT):");
const grt = aggregateCampaignMonthlyByGeoClone(rows, "GRT");

assert(grt.months.length === 2, "twee maanden");
assert(grt.months[0].month === "2026-01-01" && grt.months[1].month === "2026-02-01", "maanden gesorteerd oplopend");
assert(grt.campaignCount === 2, "twee unieke GRT-campagnes (geen dubbeltelling van dezelfde naam)");

// Januari: som van de twee GRT-rijen (AQM en generic niet meegeteld).
const jan = grt.months[0];
assert(jan.impressions === 1500 && jan.clicks === 120 && jan.cost === 250 && jan.conversions === 12 && jan.conversionsValue === 900, "januari-sommen alleen GRT");
close(jan.cpa, 250 / 12, "januari CPA uit totalen");
close(jan.roas, 900 / 250, "januari ROAS uit totalen");
close(jan.ctr, 120 / 1500, "januari CTR uit totalen");

// Totalen over beide maanden.
const t = grt.totals;
assert(t.impressions === 3500 && t.clicks === 420 && t.cost === 650 && t.conversions === 32 && t.conversionsValue === 2900, "totalen over beide maanden");
close(t.cpa, 650 / 32, "totaal CPA uit totalen (niet gemiddelde van maand-CPA's)");
close(t.roas, 2900 / 650, "totaal ROAS uit totalen");
close(t.ctr, 420 / 3500, "totaal CTR uit totalen");

console.log("lege / geen-match gevallen:");
const empty = aggregateCampaignMonthlyByGeoClone([], "GRT");
assert(empty.months.length === 0 && empty.campaignCount === 0, "lege invoer geeft leeg resultaat");
assert(empty.totals.cpa === null && empty.totals.roas === null && empty.totals.ctr === null, "lege totalen: ratio's null (geen deling door nul)");

const noMatch = aggregateCampaignMonthlyByGeoClone(rows, "ICC");
assert(noMatch.months.length === 0 && noMatch.campaignCount === 0, "geo-clone zonder campagnes geeft leeg resultaat");

// ── aggregateAllGeoClones: losse eenheden PLUS een combinatie-totaal (masterplan 17.12) ──────
console.log("aggregateAllGeoClones:");
{
  // Dezelfde vijf rijen: twee GRT-campagnes, één AQM-campagne (ook een echte, bestaande variant
  // in de catalogus) en één campagne die geen enkele afkorting matcht ("Brand generic").
  const breakdown = aggregateAllGeoClones(rows);

  assert(breakdown.perGeoClone.length === 2, `beide voorkomende geo-clones apart (kreeg ${breakdown.perGeoClone.length})`);
  const grtEntry = breakdown.perGeoClone.find((e) => e.geoClone === "GRT");
  const aqmEntry = breakdown.perGeoClone.find((e) => e.geoClone === "AQM");
  assert(!!grtEntry && grtEntry.summary.campaignCount === 2, "GRT-eenheid heeft zijn eigen twee campagnes, los van AQM");
  assert(!!aqmEntry && aqmEntry.summary.totals.cost === 9999, "AQM-eenheid blijft een aparte, ongemengde eenheid");
  assert(!!grtEntry && grtEntry.summary.totals.cost === 650, "GRT-cijfers blijven exact gelijk aan de losse aanroep hierboven — geen blending");

  assert(breakdown.unmatched !== null && breakdown.unmatched.totals.cost === 11, "de niet-matchende campagne staat apart, niet stilzwijgend bij een variant opgeteld");

  // Het totaal is het HELE account: alle vijf rijen samen, exact zoals de eigenaar vroeg
  // ("ik wil ze wel bij elkaar krijgen in het totaal overzicht van greentech zelf").
  const totaal = breakdown.total.totals;
  assert(totaal.cost === 200 + 50 + 400 + 9999 + 11, `totaal-cost is de som van ALLE rijen (kreeg ${totaal.cost})`);
  assert(totaal.conversions === 10 + 2 + 20 + 999 + 1, `totaal-conversions is de som van ALLE rijen (kreeg ${totaal.conversions})`);

  // Geen enkele geo-clone-afkorting in de campagnenamen -> lege segmentatie, geen verzonnen indeling.
  const geenGeoClones = aggregateAllGeoClones([{ campaign_name: "Generieke campagne", month: "2026-01-01", cost: 100, conversions: 1, conversions_value: 50 }]);
  assert(geenGeoClones.perGeoClone.length === 0, "geen geo-clone-afkortingen in de data -> lege segmentatie");
  assert(geenGeoClones.unmatched === null, "unmatched blijft null als er sowieso geen geo-clones gevonden zijn (niets om apart van te zetten)");
  assert(geenGeoClones.total.totals.cost === 100, "total blijft wel gewoon werken zonder geo-clones");

  // Een aangepaste catalogus wordt doorgegeven, niet stilzwijgend de standaardcatalogus gebruikt.
  const kleineCatalogus: GeoCloneVariant[] = [{ brand: "GreenTech", location: "Amsterdam", abbreviation: "GRT", confirmed: true, cadence: "annual" }];
  const metKleineCatalogus = aggregateAllGeoClones(rows, kleineCatalogus);
  assert(metKleineCatalogus.perGeoClone.length === 1 && metKleineCatalogus.perGeoClone[0].geoClone === "GRT", "een aangepaste catalogus wordt echt gebruikt, niet de standaard");
  // Met alleen GRT in de catalogus telt de AQM-rij nu mee als "unmatched" (geen AQM-variant meer bekend).
  assert(metKleineCatalogus.unmatched !== null && metKleineCatalogus.unmatched.totals.cost === 9999 + 11, "met een kleinere catalogus valt AQM nu onder unmatched, niet meer apart");
}

if (failed > 0) {
  console.error(`\n${failed} assertie(s) gefaald`);
  process.exit(1);
}
console.log("\nalle geo-clone-aggregate-tests geslaagd");

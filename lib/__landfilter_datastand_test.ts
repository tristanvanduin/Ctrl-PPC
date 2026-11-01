// Regressietest: het landfilter (lib/use-country-filtered-data.ts) houdt de datastand vast.
// Draaien: tsx lib/__landfilter_datastand_test.ts
//
// Waarom: de gefilterde data was een nieuw object zonder `dataStand` zodra er landrijen waren. De
// tak zonder landrijen spreidde fullData wél, dus alleen met een echt land ging het mis. De
// maandkaarten (monthly-overview.tsx) lezen de voortgang van de "huidige" kaart uit
// data.dataStand, terwijl hun forecast op accountniveau blijft. Met data t/m 25 augustus stond er
// dan "Aug 2026 Nog niet binnen", waar ongefilterd "Data t/m 25 aug" en 81% van de maand staat.

import * as land from "./use-country-filtered-data";
import type { ClientHistoricalData, MonthlyRecord } from "./types";
import type { CountryMonthlyRow } from "./use-client-data";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const rec = (month: number, conversions: number): MonthlyRecord =>
  ({ month, conversions, revenue: conversions * 100, adSpend: conversions * 40, weeks: [] });

const stand: NonNullable<ClientHistoricalData["dataStand"]> = {
  laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 },
  verwachteMaand: "2026-10", maandenAchter: 3, dataTot: "2026-08-25", uitgesloten: [],
};

const volledig: ClientHistoricalData = {
  clientId: "test",
  currentYear: 2026,
  targetCurrentYear: { conversions: 1200, revenue: 120_000, adSpend: 48_000 },
  historicalYears: { 2025: Array.from({ length: 12 }, (_, i) => rec(i + 1, 100)) },
  currentYearData: Array.from({ length: 12 }, (_, i) => (i <= 6 ? rec(i + 1, 100) : null)),
  dataStand: stand,
};

const rij = (countryCode: string, month: string, conversions: number): CountryMonthlyRow => ({
  countryCode, month, impressions: 0, clicks: 0, cost: conversions * 40, conversions, conversionsValue: conversions * 100,
  ctr: 0, avgCpc: 0, costPerConversion: 0, conversionRate: 0, roas: 0, campaignCount: 1, spendShare: 0.5,
});
const landRijen: CountryMonthlyRow[] = [
  ...Array.from({ length: 12 }, (_, i) => rij("NL", `2025-${String(i + 1).padStart(2, "0")}-01`, 50)),
  ...Array.from({ length: 7 }, (_, i) => rij("NL", `2026-${String(i + 1).padStart(2, "0")}-01`, 50)),
];

console.log("landGefilterdeData (use-country-filtered-data.ts)");
{
  const f = (land as { landGefilterdeData?: unknown }).landGefilterdeData as undefined
    | ((data: ClientHistoricalData, rijen: readonly CountryMonthlyRow[], landCode: string | null) => ClientHistoricalData);
  check("use-country-filtered-data.ts exporteert landGefilterdeData", typeof f === "function");
  if (typeof f === "function") {
    const nl = f(volledig, landRijen, "NL");
    check("voorwaarde: het land heeft eigen cijfers", nl.currentYearData[0]?.conversions === 50, JSON.stringify(nl.currentYearData[0]));
    check("met landrijen: de datastand blijft staan", nl.dataStand === stand, JSON.stringify(nl.dataStand));
    const leeg = f(volledig, landRijen, "DE");
    check("zonder landrijen: de datastand blijft staan (zoals al het geval was)", leeg.dataStand === stand);
    check("zonder filter: de accountdata ongewijzigd", f(volledig, landRijen, null) === volledig);
  }
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

// Microsoft geo per dag: het GeographicPerformanceReport (aggregation Daily) naar
// microsoft_breakdown_daily met breakdown_type country en region (naarGeoBreakdownRijen), en de
// landnamen en LinkedIn-urns naar alpha-2 (lib/geo/land-namen.ts) waar de kaart per dag op leunt.
// Draaien: tsx --tsconfig ./tsconfig.json lib/microsoft/__microsoft_geo_test.ts

import { naarGeoBreakdownRijen } from "./transform";
import { bouwReportRequest } from "./api";
import { landcodeUitLinkedInUrn, landcodeUitNaam } from "../geo/land-namen";
import { regionNameToUsps } from "../geo/us-fips";
import { fetchMicrosoftDaily } from "./analysis-data";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const rij = (dag: string, land: string, staat: string, spend: string, conv = "1") =>
  ({ TimePeriod: dag, Country: land, State: staat, Impressions: "100", Clicks: "10", Spend: spend, Conversions: conv, Revenue: "20" });

console.log("Land per dag");
{
  const { rijen, onbekend } = naarGeoBreakdownRijen([
    rij("2026-11-02", "Netherlands", "", "1.10"),
    rij("2026-11-02", "Netherlands", "", "2.20"),   // een tweede locatietype van dezelfde dag
    rij("2026-11-02", "Germany", "", "3.00"),
    rij("2026-11-03", "Atlantis", "", "9.00"),
  ], "k1", "acc", "country", landcodeUitNaam, regionNameToUsps);
  const nl = rijen.find((r) => r.breakdown_value === "NL");
  check("de Engelse naam wordt de alpha-2-code", !!nl && rijen.some((r) => r.breakdown_value === "DE"));
  check("twee rijen van dezelfde dag en hetzelfde land worden opgeteld, niet ontdubbeld", nl?.spend === 3.3 && nl?.impressions === 200, JSON.stringify(nl));
  check("in de vorm van microsoft_breakdown_daily", nl?.breakdown_type === "country" && nl?.level === "account" && nl?.entity_id === "acc" && nl?.date === "2026-11-02");
  check("een onbekend land valt af en wordt geteld", onbekend === 1 && rijen.length === 2);
}

console.log("Staat per dag");
{
  const { rijen, onbekend } = naarGeoBreakdownRijen([
    rij("2026-11-02", "United States", "California", "5"),
    rij("2026-11-02", "Netherlands", "North Holland", "5"),
  ], "k1", "acc", "region", landcodeUitNaam, regionNameToUsps);
  check("alleen Amerikaanse staten, als US-CA", rijen.length === 1 && rijen[0].breakdown_value === "US-CA" && rijen[0].breakdown_type === "region");
  check("een provincie elders valt af en wordt geteld", onbekend === 1);
}

console.log("Het rapportverzoek");
{
  const req = bouwReportRequest({
    type: "GeographicPerformanceReportRequest", aggregation: "Daily", accountId: "acc", since: "2026-11-01", until: "2026-11-12",
    columns: ["TimePeriod", "Country", "Impressions"],
  }) as unknown as Record<string, unknown>;
  const tekst = JSON.stringify(req);
  check("een GeographicPerformanceReport met aggregation Daily", tekst.includes("GeographicPerformanceReport") && tekst.includes("Daily") && tekst.includes("Country"), tekst.slice(0, 200));
}

console.log("Landnamen en LinkedIn-urns");
{
  check("alpha-2 blijft alpha-2", landcodeUitNaam("nl") === "NL");
  check("de Engelse naam", landcodeUitNaam("United States") === "US" && landcodeUitNaam("The Netherlands") === "NL");
  check("onbekend en leeg zijn null", landcodeUitNaam("Atlantis") === null && landcodeUitNaam("") === null && landcodeUitNaam(null) === null);
  check("een LinkedIn-landurn", landcodeUitLinkedInUrn("urn:li:geo:102890719") === "NL" && landcodeUitLinkedInUrn("urn:li:geo:1") === null);
}

async function analyseLeestNetwerk(): Promise<void> {
  console.log("De analyses lezen netwerk en apparaat, ook naast duizenden georijen");
  // Een nep-Supabase die net als PostgREST op 1000 rijen afkapt, en eq/gte/lte/in toepast.
  const tabel: Record<string, unknown>[] = [];
  for (let d = 1; d <= 14; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    for (let i = 0; i < 70; i++) tabel.push({ client_id: "k1", date, level: "account", breakdown_type: i < 20 ? "country" : "region", breakdown_value: `X${i}` });
    for (const v of ["search", "syndicated", "audience"]) tabel.push({ client_id: "k1", date, level: "account", breakdown_type: "network", breakdown_value: v });
    for (const v of ["computer", "smartphone", "tablet", "other"]) tabel.push({ client_id: "k1", date, level: "account", breakdown_type: "device", breakdown_value: v });
  }
  const nep = {
    from: () => {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return q; },
        lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return q; },
        in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
        then: (ok: (x: { data: unknown[] }) => unknown) => ok({ data: tabel.filter((r) => filters.every((f) => f(r))).slice(0, 1000) }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const rijen = await fetchMicrosoftDaily(nep, "k1", "microsoft_breakdown_daily", "2026-11-01", "2026-11-14");
  check("geen land of staat in wat de analyses krijgen", rijen.every((r) => r.breakdown_type === "network" || r.breakdown_type === "device"));
  check("alle 14 x 7 netwerk- en apparaatrijen komen mee (niet afgekapt)", rijen.length === 98, String(rijen.length));
}

void analyseLeestNetwerk().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
});

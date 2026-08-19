// Test voor lib/analysis/dimension-availability.ts. Bewijst de fix uit de live-test van de
// wekelijkse SOP tegen demo-greentech: een account zonder dimension-availability-rijen (bijv.
// een demo-account, nooit gesynchroniseerd via de reguliere Google Ads-orchestrator) mag niet
// worden gelezen als "alle dimensies ontbreken" -- dat blokkeerde eerder elke sectie, ook al was
// de daadwerkelijk aangeleverde data in dezelfde prompt compleet en vers.
// Draaien: npx tsx lib/analysis/__dimension_availability_test.ts

import { buildAvailabilitySummary, evaluateSopSections, type ClientDimensionProfile, type DimensionStatus } from "./dimension-availability";
import type { DimensionName } from "../types/dimensional";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function status(dim: DimensionName, isAvailable: boolean): DimensionStatus {
  return {
    dimension: dim, isAvailable, rowCount: isAvailable ? 10 : 0,
    latestMonth: isAvailable ? "2026-07-01" : null, earliestMonth: isAvailable ? "2026-01-01" : null,
    monthsAvailable: isAvailable ? 6 : 0, isPartial: false, dataSource: "google_ads", notes: null,
  };
}

function leegProfiel(clientId: string): ClientDimensionProfile {
  return { clientId, dimensions: new Map(), fetchedAt: new Date().toISOString() };
}

console.log("Nul dimension-availability-rijen: geen 'analyseer NIET' voor alle secties");
{
  const profile = leegProfiel("demo-greentech");
  const summary = buildAvailabilitySummary(profile, "weekly");
  check("geen 'Niet beschikbaar' claim in de samenvatting", !summary.includes("Niet beschikbaar"), summary);
  check("expliciete 'geen signaal'-melding staat er wel in", summary.includes("Geen dimension-availability-signaal"), summary);
  check("instructie om op de daadwerkelijke data te vertrouwen staat erin", summary.toLowerCase().includes("daadwerkelijk"), summary);
}

console.log("\nNul rijen is 'onbekend', geen 'ondersteund' -- evaluateSopSections blijft zelf ongemoeid (blokkeert alleen de tekst naar de LLM)");
{
  const profile = leegProfiel("demo-greentech");
  const sections = evaluateSopSections(profile, "weekly");
  check("evaluateSopSections zelf blijft intern 'unsupported' rapporteren (geen valse zekerheid elders)", sections.every((s) => s.support === "unsupported"));
}

console.log("\nMet echte availability-rijen (normale klant): het bestaande gedrag blijft ongewijzigd");
{
  const profile: ClientDimensionProfile = {
    clientId: "gads-123",
    dimensions: new Map<DimensionName, DimensionStatus>([
      ["account_weekly", status("account_weekly", true)],
      ["search_terms_wasteful", status("search_terms_wasteful", true)],
      ["campaign_monthly", status("campaign_monthly", false)],
    ]),
    fetchedAt: new Date().toISOString(),
  };
  const summary = buildAvailabilitySummary(profile, "weekly");
  check("geen 'geen signaal'-melding wanneer er wel rijen zijn", !summary.includes("Geen dimension-availability-signaal"), summary);
  check("Budget & Spend Anomalies (mist campaign_monthly) staat bij niet beschikbaar", summary.includes("Niet beschikbaar") && summary.includes("Budget & Spend Anomalies"), summary);
  check("Account Health Check (heeft account_weekly) staat bij volledig ondersteund", summary.includes("Volledig ondersteund") && summary.includes("Account Health Check"), summary);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

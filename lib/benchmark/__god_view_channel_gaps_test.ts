// Test voor de kanaalaanbeveling (God View channel gaps). Deterministisch, geen IO.
// Draaien: npx tsx lib/benchmark/__god_view_channel_gaps_test.ts

import { findChannelGaps } from "./god-view-channel-gaps";
import { TEST_DREMPELS } from "./cel";
import type { GodViewInvoerRij } from "./god-view";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rijen(channel: string, n: number, o: Partial<GodViewInvoerRij> = {}): GodViewInvoerRij[] {
  return Array.from({ length: n }, (_, i): GodViewInvoerRij => ({
    clientId: `${channel}-${i}`, agencyId: `a${i}`, channel,
    bedrijfsmodel: "b2b", niche: "software", spend: 1000, conversions: 20, conversionValue: 3000,
    ...o,
  }));
}

console.log("Kanaal dat het account al gebruikt komt niet terug als gap");
{
  const data = [...rijen("google_ads", 5), ...rijen("linkedin_ads", 5)];
  const gaps = findChannelGaps(data, ["google_ads"], "b2b", "software", TEST_DREMPELS);
  check("linkedin_ads staat erin", gaps.some((g) => g.channel === "linkedin_ads"));
  check("google_ads staat er niet in (al actief)", !gaps.some((g) => g.channel === "google_ads"));
}

console.log("Onder de drempel: geen gap, geen fout (insufficient_data-stilte)");
{
  const data = rijen("meta_ads", 1);
  const gaps = findChannelGaps(data, ["google_ads"], "b2b", "software"); // ECHTE drempels, niet TEST_DREMPELS
  check("geen gaps onder de echte k-anonimiteitsdrempel", gaps.length === 0, JSON.stringify(gaps));
}

console.log("Geen bedrijfsmodel/niche: lege lijst, geen crash");
{
  const gaps = findChannelGaps(rijen("meta_ads", 5), ["google_ads"], null, null, TEST_DREMPELS);
  check("lege lijst zonder segment", gaps.length === 0, JSON.stringify(gaps));
}

console.log("Sortering: meest onderbouwde cel (hoogste accounttelling) eerst");
{
  const data = [...rijen("meta_ads", 3), ...rijen("linkedin_ads", 6)];
  const gaps = findChannelGaps(data, ["google_ads"], "b2b", "software", TEST_DREMPELS);
  check("linkedin_ads (6 accounts) staat voor meta_ads (3 accounts)", gaps[0]?.channel === "linkedin_ads", JSON.stringify(gaps));
}

console.log("Geen enkel kanaal ontbreekt: lege lijst");
{
  const data = rijen("google_ads", 5, { bedrijfsmodel: "b2b" });
  const gaps = findChannelGaps(data, ["google_ads"], "b2b", "software", TEST_DREMPELS);
  check("actief kanaal is het enige kanaal in de data, dus geen gaps", gaps.length === 0, JSON.stringify(gaps));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

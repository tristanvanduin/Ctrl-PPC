// Fixture-test voor de pure delen van de Fase A evidence-laag (Master Synthesis, Pijler 6).
// De fetch-functies zelf (channel-synthesis.ts, cross-channel-facts.ts) zijn de LIVE-ONGETESTE
// grens, zelfde status als elders in deze codebase; dit test alleen buildEvidencePayload en
// isEvidencePayloadEmpty, die puur zijn.
// Draaien: npx tsx lib/decision/evidence/__evidence_payload_test.ts

import { buildEvidencePayload, isEvidencePayloadEmpty } from "./build-payload";
import type { ChannelSynthesis } from "./channel-synthesis";
import type { CrossChannelFacts } from "./cross-channel-facts";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function channel(overrides: Partial<ChannelSynthesis>): ChannelSynthesis {
  return {
    channel: "google_ads", sopType: "monthly", analysisDate: "2026-03-15",
    recommendations: [], tasks: [], truncated: false,
    ...overrides,
  };
}
function crossChannel(overrides: Partial<CrossChannelFacts>): CrossChannelFacts {
  return {
    analysisDate: "2026-03-15", periodStart: "2025-03-01", periodEnd: "2026-02-28",
    groups: [], degradations: [],
    ...overrides,
  };
}

// 1. buildEvidencePayload: availableChannels volgt uit de meegegeven kanalen, geen herberekening.
const payload = buildEvidencePayload({
  clientId: "client-1", periodEnd: "2026-02-28",
  channels: [channel({ channel: "google_ads" }), channel({ channel: "meta_ads" })],
  crossChannel: crossChannel({}),
});
assert(payload.availableChannels.length === 2 && payload.availableChannels.includes("google_ads") && payload.availableChannels.includes("meta_ads"), "availableChannels volgt de meegegeven kanalen");
assert(payload.clientId === "client-1" && payload.periodEnd === "2026-02-28", "clientId en periodEnd overgenomen");

// 2. isEvidencePayloadEmpty: leeg als geen kanaal iets heeft EN cross-channel niets triggerde.
const leeg = buildEvidencePayload({
  clientId: "c", periodEnd: "2026-02-28",
  channels: [channel({ recommendations: [], tasks: [] })],
  crossChannel: crossChannel({ groups: [{ key: "signals", title: "x", description: "x", triggered: 0, checked: ["a"] }] }),
});
assert(isEvidencePayloadEmpty(leeg) === true, "leeg payload (geen recs/tasks, geen getriggerde cross-channel-groep) is empty");

// 3. Niet leeg zodra een kanaal wel iets heeft.
const metChannelData = buildEvidencePayload({
  clientId: "c", periodEnd: "2026-02-28",
  channels: [channel({ recommendations: [{ hypothesis: "x", expected_result: "y", measurement_metric: "z", timeframe: "2 weken", ice_total: 7, status: "open" }] })],
  crossChannel: null,
});
assert(isEvidencePayloadEmpty(metChannelData) === false, "niet leeg zodra een kanaal recommendations heeft");

// 4. Niet leeg zodra cross-channel iets triggerde, ook zonder kanaaldata.
const metCrossChannelSignal = buildEvidencePayload({
  clientId: "c", periodEnd: "2026-02-28",
  channels: [],
  crossChannel: crossChannel({ groups: [{ key: "signals", title: "x", description: "x", triggered: 2, checked: ["a"] }] }),
});
assert(isEvidencePayloadEmpty(metCrossChannelSignal) === false, "niet leeg zodra cross-channel iets triggerde, ook zonder kanaaldata");

// 5. Leeg zonder cross-channel-feiten (null) en zonder kanaaldata.
const helemaalNiets = buildEvidencePayload({ clientId: "c", periodEnd: "2026-02-28", channels: [], crossChannel: null });
assert(isEvidencePayloadEmpty(helemaalNiets) === true, "leeg zonder kanalen en zonder cross-channel-feiten");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

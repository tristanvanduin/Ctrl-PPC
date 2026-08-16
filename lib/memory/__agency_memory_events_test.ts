// Draaien: npx tsx lib/memory/__agency_memory_events_test.ts
import { memoryEventsForVerdict } from "./agency-memory-events";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function eq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

assert(eq(memoryEventsForVerdict("uitgevoerd_en_gehaald"), ["hypothesis_executed", "hypothesis_outcome_met"]), "uitgevoerd_en_gehaald -> executed + outcome_met (twee losse feiten)");
assert(eq(memoryEventsForVerdict("uitgevoerd_en_niet_gehaald"), ["hypothesis_executed", "hypothesis_outcome_missed"]), "uitgevoerd_en_niet_gehaald -> executed + outcome_missed");
assert(eq(memoryEventsForVerdict("niet_uitgevoerd"), ["hypothesis_not_executed"]), "niet_uitgevoerd -> alleen not_executed, geen outcome (nooit gemeten aan een interventie)");
assert(eq(memoryEventsForVerdict("accepted"), ["hypothesis_outcome_met"]), "accepted (uitvoering onbekend) -> outcome_met");
assert(eq(memoryEventsForVerdict("rejected"), ["hypothesis_outcome_missed"]), "rejected (uitvoering onbekend) -> outcome_missed");
assert(eq(memoryEventsForVerdict("unmeasurable"), ["hypothesis_unmeasurable"]), "unmeasurable -> hypothesis_unmeasurable");
assert(eq(memoryEventsForVerdict("expired"), ["hypothesis_expired"]), "expired -> hypothesis_expired");
assert(eq(memoryEventsForVerdict("iets_onbekends"), []), "onbekende waarde -> lege lijst, geen gok en geen crash");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

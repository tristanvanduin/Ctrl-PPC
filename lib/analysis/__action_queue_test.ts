// Draaien: npx tsx lib/analysis/__action_queue_test.ts
import { beslisMislukkingsactie } from "./action-queue";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Eerste mislukking (attempts 0): terug naar queued met backoff, attempts wordt 1.
const eerste = beslisMislukkingsactie(0, "netwerkfout", 30, new Date("2026-08-16T10:00:00Z"));
assert(eerste.actie === "opnieuw_inplannen", "attempts 0 -> opnieuw inplannen, niet definitief");
if (eerste.actie === "opnieuw_inplannen") {
  assert(eerste.attempts === 1, "attempts gaat van 0 naar 1");
  assert(eerste.scheduledFor === "2026-08-16T10:30:00.000Z", "scheduled_for is nu + 30 minuten");
  assert(eerste.bericht.includes("30 minuten"), "bericht noemt de backofftermijn");
  assert(eerste.bericht.includes("netwerkfout"), "bericht bevat de onderliggende foutmelding");
}

// Tweede mislukking (attempts 1, na de eerste): definitief, geen backoff meer.
const tweede = beslisMislukkingsactie(1, "netwerkfout opnieuw", 30, new Date("2026-08-16T11:00:00Z"));
assert(tweede.actie === "definitief_mislukt", "attempts 1 -> definitief mislukt (tweede keer)");
if (tweede.actie === "definitief_mislukt") {
  assert(tweede.attempts === 2, "attempts gaat van 1 naar 2, ook al is de uitkomst definitief");
}

// Een job die al vaker mislukt is (bijv. door handmatige reset) blijft definitief, niet terug
// naar oneindig retryen.
const derde = beslisMislukkingsactie(3, "weer een fout", 30, new Date("2026-08-16T12:00:00Z"));
assert(derde.actie === "definitief_mislukt", "attempts > 1 blijft definitief mislukt, geen re-retry");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

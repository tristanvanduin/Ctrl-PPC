// Test voor de SOP-cadans-beslissing (nightly cron, klaargezet maar niet actief). Deterministisch,
// geen IO. Draaien: npx tsx lib/__tests__/__sop_cadence_test.ts

import {
  isIntervalDue, isMonthlyDue, isSopDue,
  WEEKLY_INTERVAL_DAYS, BIWEEKLY_INTERVAL_DAYS,
} from "../scheduler/sop-cadence";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const nu = new Date("2026-08-17T03:00:00Z"); // nachtelijke cron, vroeg in de ochtend UTC

// ── isIntervalDue ──
assert(isIntervalDue(null, WEEKLY_INTERVAL_DAYS, nu) === true, "nooit gedraaid is altijd due");
assert(isIntervalDue("2026-08-10", WEEKLY_INTERVAL_DAYS, nu) === true, "precies 7 dagen geleden is due");
assert(isIntervalDue("2026-08-11", WEEKLY_INTERVAL_DAYS, nu) === false, "6 dagen geleden is nog niet due");
assert(isIntervalDue("2026-08-03", BIWEEKLY_INTERVAL_DAYS, nu) === true, "precies 14 dagen geleden is due voor biweekly");
assert(isIntervalDue("2026-08-05", BIWEEKLY_INTERVAL_DAYS, nu) === false, "12 dagen geleden is nog niet due voor biweekly");
assert(isIntervalDue("niet-een-datum", WEEKLY_INTERVAL_DAYS, nu) === true, "onleesbare datum telt als nooit gedraaid");

// ── isMonthlyDue ──
assert(isMonthlyDue(null, nu) === true, "nooit gedraaid is altijd due");
assert(isMonthlyDue("2026-08-01", nu) === false, "al gedraaid deze kalendermaand is niet due");
assert(isMonthlyDue("2026-07-31", nu) === true, "gedraaid in de vorige kalendermaand is due");
assert(isMonthlyDue("2025-08-17", nu) === true, "gedraaid exact een jaar geleden (ander jaar) is due");

// Kalenderjaarwissel: december vorig jaar t.o.v. januari dit jaar.
const nieuwjaar = new Date("2026-01-05T03:00:00Z");
assert(isMonthlyDue("2025-12-20", nieuwjaar) === true, "december vorig jaar is due in januari");
assert(isMonthlyDue("2026-01-02", nieuwjaar) === false, "al gedraaid begin januari is niet due");

// ── isSopDue: de ene ingang ──
assert(isSopDue("weekly", "2026-08-11", nu) === false, "weekly respecteert het weekinterval");
assert(isSopDue("biweekly", "2026-08-05", nu) === false, "biweekly respecteert het biweekly-interval");
assert(isSopDue("monthly", "2026-08-01", nu) === false, "monthly respecteert de kalendermaand");
assert(isSopDue("monthly", "2026-07-31", nu) === true, "monthly is due na een kalendermaandwissel");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

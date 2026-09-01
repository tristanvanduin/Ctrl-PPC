// Test voor het BYO-geheimformaat: JSON-payload naast de platte token-string.
// Deterministisch, geen IO. Draaien: npx tsx lib/tenancy/__kanaal_credentials_test.ts

import { parseKanaalGeheim } from "./kanaal-credentials";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// Platte string: het Google-model, alleen een refresh token.
const plat = parseKanaalGeheim("token-123");
assert(plat.refreshToken === "token-123" && plat.clientId === null, "platte string is refresh-token-only");

// Volledige BYO-payload.
const byo = parseKanaalGeheim(JSON.stringify({
  refreshToken: "rt", clientId: "app", clientSecret: "geheim", developerToken: "dev", customerId: "42",
}));
assert(byo.refreshToken === "rt" && byo.clientId === "app" && byo.developerToken === "dev" && byo.customerId === "42", "JSON-payload volledig gelezen");

// Deel-payload: ontbrekende velden zijn null (app-deel valt dan terug op de omgeving).
const deel = parseKanaalGeheim(JSON.stringify({ refreshToken: "rt" }));
assert(deel.refreshToken === "rt" && deel.clientSecret === null, "deel-payload: ontbrekend veld is null");

// Lege strings in de payload tellen als afwezig, niet als lege sleutel.
const leeg = parseKanaalGeheim(JSON.stringify({ refreshToken: "rt", clientId: "  " }));
assert(leeg.clientId === null, "witruimte-veld is afwezig");

// Kapotte JSON die met { begint: telt als platte string -- een half formulier mag geen
// koppeling breken die met een gewone token zou werken.
const kapot = parseKanaalGeheim('{"refreshToken": kapot');
assert(kapot.refreshToken === '{"refreshToken": kapot', "onparseerbare JSON valt terug op platte string");

// Leeg of null: alles null.
assert(parseKanaalGeheim(null).refreshToken === null, "null-geheim");
assert(parseKanaalGeheim("   ").refreshToken === null, "witruimte-geheim");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

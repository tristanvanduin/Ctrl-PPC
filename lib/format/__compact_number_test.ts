import { compactNumber, compactCurrency } from "./compact-number";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("compactNumber:");
{
  assert(compactNumber(950) === "950", "onder 1000: geen suffix");
  assert(compactNumber(1000) === "1K", "1000 -> 1K");
  assert(compactNumber(38400) === "38.4K", "38400 -> 38.4K");
  assert(compactNumber(4200000) === "4.2M", "4.2M-voorbeeld uit de opdracht");
  assert(compactNumber(4000000) === "4M", "geen overbodig .0");
  assert(compactNumber(2_500_000_000) === "2.5B", "miljarden -> B");
  assert(compactNumber(-38400) === "-38.4K", "negatief blijft negatief, teken vooraan");
  assert(compactNumber(NaN) === "—", "NaN geeft een streepje, geen NaN in de UI");
}

console.log("compactCurrency:");
{
  assert(compactCurrency(4200000) === "€ 4.2M", "€ 4.2M, exact zoals de opdracht");
  assert(compactCurrency(950) === "€ 950", "onder 1000 zonder suffix");
}

console.log(`\n${failed === 0 ? "Alle checks geslaagd." : `${failed} check(s) gefaald.`}`);
if (failed > 0) process.exit(1);

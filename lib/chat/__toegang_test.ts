// Het licentieslot. Deterministisch, geen IO.
// Draaien: npx tsx lib/chat/__toegang_test.ts

import { magChatten, normaliseerLicentie, LICENTIES } from "./toegang";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

check("premium mag", magChatten("premium"));
check("enterprise mag", magChatten("enterprise"));
check("basis mag niet", !magChatten("basis"));

// HET GEVAL WAAR DE OPSOMMING VOOR IS. Een regel die "alles behalve basis" zegt, geeft elke
// toekomstige licentievorm stilzwijgend toegang -- ook een proefaccount of een opgezegd bureau.
check("een onbekende licentievorm mag niet", !magChatten("proef"),
  String(magChatten("proef")));
check("een lege waarde mag niet", !magChatten(""));
check("null mag niet", !magChatten(null));
check("undefined mag niet", !magChatten(undefined));

// Normalisatie valt naar beneden terug, nooit naar boven: een typefout hoort geen toegang te geven.
check("onbekend wordt basis", normaliseerLicentie("Prmium") === "basis",
  normaliseerLicentie("Prmium"));
check("null wordt basis", normaliseerLicentie(null) === "basis");
check("hoofdletters maken niet uit", normaliseerLicentie("PREMIUM") === "premium");
check("spaties eromheen maken niet uit", normaliseerLicentie("  premium  ") === "premium");

// En de normalisatie en de check horen bij elkaar te blijven: elke geldige vorm moet door
// normaliseerLicentie heen komen zonder te veranderen.
for (const l of LICENTIES) {
  check(`${l} overleeft normalisatie`, normaliseerLicentie(l) === l);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

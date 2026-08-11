// Het licentieslot. Deterministisch, geen IO.
// Draaien: npx tsx lib/chat/__toegang_test.ts

import { magChatten, normaliseerLicentie, heeftTenminste, LICENTIES } from "./toegang";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

check("basis mag niet chatten", !magChatten("basis"));
check("core mag niet chatten", !magChatten("core"));
check("growth mag chatten", magChatten("growth"));
check("scale mag chatten", magChatten("scale"));
check("professional mag chatten", magChatten("professional"));
check("enterprise mag chatten", magChatten("enterprise"));

// HET GEVAL WAAR DE OPSOMMING VOOR IS. Een regel die "alles behalve basis" zegt, geeft elke
// toekomstige licentievorm stilzwijgend toegang -- ook een proefaccount of een opgezegd bureau.
check("een onbekende licentievorm mag niet", !magChatten("proef"),
  String(magChatten("proef")));
check("een lege waarde mag niet", !magChatten(""));
check("null mag niet", !magChatten(null));
check("undefined mag niet", !magChatten(undefined));

console.log("\nheeftTenminste");
check("basis heeft tenminste basis", heeftTenminste("basis", "basis"));
check("basis heeft NIET tenminste core", !heeftTenminste("basis", "core"));
check("scale heeft tenminste core", heeftTenminste("scale", "core"));
check("scale heeft tenminste scale", heeftTenminste("scale", "scale"));
check("scale heeft NIET tenminste professional", !heeftTenminste("scale", "professional"));
check("enterprise heeft tenminste elke tier", LICENTIES.every((l) => heeftTenminste("enterprise", l)));
check(
  "een onbekende waarde zakt naar rang 0 (basis), dus heeft die NIET tenminste core",
  !heeftTenminste("proef", "core")
);
check(
  "een onbekende waarde heeft wel tenminste basis -- basis is de bodem van de ladder, geen slot",
  heeftTenminste("proef", "basis")
);

console.log("\nnormalisatie");
// Normalisatie valt naar beneden terug, nooit naar boven: een typefout hoort geen toegang te geven.
check("onbekend wordt basis", normaliseerLicentie("Gruwth") === "basis",
  normaliseerLicentie("Gruwth"));
check("null wordt basis", normaliseerLicentie(null) === "basis");
check("hoofdletters maken niet uit", normaliseerLicentie("GROWTH") === "growth");
check("spaties eromheen maken niet uit", normaliseerLicentie("  growth  ") === "growth");

// De oude 'premium'-waarde (voor migratie 071) is nu een onbekende licentievorm en hoort net als
// elke andere onbekende waarde naar basis te normaliseren, niet stiekem naar een betaalde tier.
check("het vervallen 'premium' normaliseert naar basis, niet naar growth",
  normaliseerLicentie("premium") === "basis");

// En de normalisatie en de check horen bij elkaar te blijven: elke geldige vorm moet door
// normaliseerLicentie heen komen zonder te veranderen.
for (const l of LICENTIES) {
  check(`${l} overleeft normalisatie`, normaliseerLicentie(l) === l);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

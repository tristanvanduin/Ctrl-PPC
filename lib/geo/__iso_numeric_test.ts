// Test: elk land dat de kaart tekent moet een alpha-2-code hebben.
// Draaien: npx tsx lib/geo/__iso_numeric_test.ts
//
// Deze test bestaat om één reden. De tabel stond op 55 landen terwijl de kaart er 177 tekent, en
// niets meldde dat. 125 landen werden dus getekend maar konden nooit inkleuren of op hover
// reageren — ook niet met data. Zonder deze controle is dat alleen te ontdekken door een klant
// die zich afvraagt waarom Polen grijs blijft.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NUMERIC_TO_ALPHA2 } from "./iso-numeric";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

interface Geom { id?: string | number; properties?: { name?: string } }
const topo = JSON.parse(
  readFileSync(join(process.cwd(), "node_modules", "world-atlas", "countries-110m.json"), "utf8")
) as { objects: { countries: { geometries: Geom[] } } };

const vormen = topo.objects.countries.geometries;
assert(vormen.length > 100, `het kaartbestand levert vormen (${vormen.length})`);

// Vormen zonder ISO-nummer kunnen per definitie geen koppeling hebben; die horen grijs te blijven.
const zonderNummer = vormen.filter((g) => Number.isNaN(Number(g.id)));
const metNummer = vormen.filter((g) => !Number.isNaN(Number(g.id)));

const ongekoppeld = metNummer.filter((g) => !NUMERIC_TO_ALPHA2[String(Number(g.id))]);
assert(
  ongekoppeld.length === 0,
  `elke getekende vorm met een ISO-nummer heeft een alpha-2 (${ongekoppeld.length} zonder: ${ongekoppeld.map((g) => g.properties?.name).join(", ")})`
);

// De bekende uitzonderingen vastleggen, zodat een groeiend aantal opvalt.
assert(zonderNummer.length <= 3, `hoogstens drie vormen zonder ISO-nummer (nu ${zonderNummer.length}: ${zonderNummer.map((g) => g.properties?.name).join(", ")})`);

// Codes moeten de vorm van een alpha-2 hebben; een typefout als "N" of "NLD" valt zo op.
for (const [nummer, code] of Object.entries(NUMERIC_TO_ALPHA2)) {
  assert(/^[A-Z]{2}$/.test(code), `${nummer} → "${code}" is een alpha-2-code`);
}

// Geen twee nummers naar dezelfde code: dat zou twee landen op elkaar laten stapelen.
const perCode = new Map<string, string[]>();
for (const [nummer, code] of Object.entries(NUMERIC_TO_ALPHA2)) {
  perCode.set(code, [...(perCode.get(code) ?? []), nummer]);
}
const dubbel = [...perCode.entries()].filter(([, ns]) => ns.length > 1);
assert(dubbel.length === 0, `geen code komt twee keer voor (${dubbel.map(([c, ns]) => `${c}: ${ns.join("+")}`).join(", ")})`);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

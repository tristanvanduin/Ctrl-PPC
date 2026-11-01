// Het venster van de verdeelring (components/dashboard/campaign-type-split.tsx). Geen IO.
// Draaien: tsx lib/__campagnetype_venster_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De ring leest maandrijen, en de `month`-kolom is een maandBEGIN (een DATE, "2026-08-01"). Het
// kanaaltabblad filterde op het maandbegin van 90 dagen terug, de tabbladen type en campagne op
// de kale datum van 90 dagen terug. Op 1 november is dat 3 augustus, en dan valt de rij van
// augustus ("2026-08-01" < "2026-08-03") eruit: het ene tabblad liet aug-nov zien, het andere
// sep-nov. Bij de demo, waarvan de data in augustus stopt, bleef er voor type niets over en
// verdween de kaart "Spend per campagnetype" helemaal van het Google-tabblad.

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Als namespace: tegen een versie zonder deze export een FAIL-regel, geen crash bij het laden.
import * as ring from "../components/dashboard/campaign-type-split";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("vensterVanaf (campaign-type-split.tsx)");
const vensterVanaf = (ring as { vensterVanaf?: (vandaag: string) => string }).vensterVanaf;
check("vensterVanaf bestaat", typeof vensterVanaf === "function");
if (vensterVanaf) {
  check("1 november: vanaf 1 augustus, niet vanaf 3 augustus", vensterVanaf("2026-11-01") === "2026-08-01", vensterVanaf("2026-11-01"));
  check("altijd een maandbegin, ook over de jaargrens", vensterVanaf("2027-01-15") === "2026-10-01", vensterVanaf("2027-01-15"));

  // Wat de database met het filter doet: `month >= vanaf` op maandbegin-datums.
  const maandrijen = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"];
  const vanaf = vensterVanaf("2026-11-01");
  const gezien = maandrijen.filter((m) => m >= vanaf);
  check("de ring ziet augustus t/m november", gezien.join(",") === "2026-08-01,2026-09-01,2026-10-01,2026-11-01", gezien.join(","));
  const demo = ["2026-06-01", "2026-07-01", "2026-08-01"].filter((m) => m >= vanaf);
  check("de demo (data t/m augustus) houdt augustus in de ring", demo.join(",") === "2026-08-01", demo.join(","));
}

// ── De bedrading: alle drie de tabbladen op hetzelfde maandbegin ───────────────────────────────
console.log("De bedrading");
{
  const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const bron = zonderCommentaar(readFileSync(join(import.meta.dirname, "..", "components/dashboard/campaign-type-split.tsx"), "utf8"));
  const filters = bron.match(/\{\s*op:\s*"gte",\s*column:\s*"month",\s*value:\s*([^}]+?)\s*\}/g) ?? [];
  check("twee maandfilters (kanaal, en type/campagne)", filters.length === 2, String(filters.length));
  check("allebei op dezelfde vanaf-maand", filters.every((f) => /value:\s*vanaf\s*\}/.test(f)), filters.join(" | "));
  check("die uit vensterVanaf(today()) komt", /const vanaf = vensterVanaf\(today\(\)\)/.test(bron));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

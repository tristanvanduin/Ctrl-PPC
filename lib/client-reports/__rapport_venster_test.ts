// Het datumvenster van de maandrapportage (app/api/client-reports/route.ts). Deterministisch, geen IO.
// Draaien: tsx lib/client-reports/__rapport_venster_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De route bouwde zijn grenzen met de hand: een eindmaand met "-31" erachter en een begin uit
// ((maand - 14 + 12) % 12) + 1. Dat gaf in zes van de twaalf rapportmaanden een datum die niet
// bestaat: "2026-11-31" voor november en "2026-00-01" voor januari. ads_account_monthly.month en
// meta_account_daily.date zijn DATE-kolommen, en PostgreSQL weigert zo'n datum met "date/time field
// value out of range". De route las daarna `res.data ?? []` zonder naar `.error` te kijken: geen
// foutmelding, een rapport met nul KPI's en lege grafieken. Op 1 december 2026 (de
// novemberrapportage) had dat elke echte klant geraakt.

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Als namespace: tegen een versie zonder deze export een FAIL-regel, geen crash bij het laden.
import * as venster from "./rapport-venster";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Bestaat deze datum echt? Date.UTC rolt "31 november" door naar 1 december; dan klopt de tekst niet meer. */
function bestaat(datum: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return false;
  const [j, m, d] = datum.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, d)).toISOString().slice(0, 10) === datum;
}

console.log("rapportVenster (lib/client-reports/rapport-venster.ts)");
const rapportVenster = (venster as { rapportVenster?: (m: string) => { van: string; tot: string } }).rapportVenster;
check("rapportVenster bestaat", typeof rapportVenster === "function");
if (rapportVenster) {
  // Elke rapportmaand van twee jaar, met een schrikkeljaar erin (februari 2028).
  for (const jaar of [2026, 2027, 2028]) {
    for (let m = 1; m <= 12; m++) {
      const maand = `${jaar}-${String(m).padStart(2, "0")}`;
      const { van, tot } = rapportVenster(maand);
      check(`${maand}: het begin bestaat (${van})`, bestaat(van));
      check(`${maand}: het eind bestaat (${tot})`, bestaat(tot));
      check(`${maand}: het eind is de laatste dag van de rapportmaand`,
        tot.slice(0, 7) === maand && !bestaat(`${maand}-${String(Number(tot.slice(8)) + 1).padStart(2, "0")}`), tot);
    }
  }
  // Dertien maanden terug: de grafieken tonen dertien maanden en de jaar-op-jaarmaand moet erin.
  check("oktober 2026 blijft wat het was: 2025-09-01 t/m 2026-10-31",
    JSON.stringify(rapportVenster("2026-10")) === JSON.stringify({ van: "2025-09-01", tot: "2026-10-31" }), JSON.stringify(rapportVenster("2026-10")));
  check("november 2026: t/m de 30e, niet de 31e",
    JSON.stringify(rapportVenster("2026-11")) === JSON.stringify({ van: "2025-10-01", tot: "2026-11-30" }), JSON.stringify(rapportVenster("2026-11")));
  check("januari 2027: het begin is december 2025, geen maand 00",
    JSON.stringify(rapportVenster("2027-01")) === JSON.stringify({ van: "2025-12-01", tot: "2027-01-31" }), JSON.stringify(rapportVenster("2027-01")));
  check("februari 2028 (schrikkeljaar): t/m de 29e",
    rapportVenster("2028-02").tot === "2028-02-29", rapportVenster("2028-02").tot);
}

// ── De bedrading: de route gebruikt het venster en ziet een leesfout ──────────────────────────
// Brongaranties: de route draait niet zonder Next, Supabase en het taalmodel.
console.log("De bedrading (app/api/client-reports/route.ts)");
{
  const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const route = zonderCommentaar(readFileSync(join(import.meta.dirname, "..", "..", "app/api/client-reports/route.ts"), "utf8"));
  check("de route haalt zijn venster uit rapportVenster", /rapportVenster\(rapportMaand\)/.test(route));
  check("geen met de hand geplakte maandeinde meer", !/-31`/.test(route) && !/lastMonth - 14/.test(route));
  // Een leesfout is geen lege maand: zonder dit stond er een rapport met nullen, zonder spoor.
  for (const res of ["accountMonthlyRes", "metaMonthlyRes", "linkedinMonthlyRes", "microsoftMonthlyRes"]) {
    check(`${res}: de leesfout wordt gelogd`, new RegExp(`meldLeesfout\\([^)]*${res}\\)`).test(route));
  }
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

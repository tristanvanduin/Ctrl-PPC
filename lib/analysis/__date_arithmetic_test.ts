// Datumrekenen over tijdzone- en zomertijdgrenzen.
// Draaien: npx tsx lib/analysis/__date_arithmetic_test.ts
//
// WAAROM DEZE TEST ZICHZELF IN TWEE TIJDZONES HERSTART
//
// Niet om buitenlandse gebruikers te ondersteunen — er wordt niet buiten Amsterdam
// gerapporteerd. Het gaat om de twee zones waarin deze code FEITELIJK draait: de
// serverprocessen staan op UTC, de ontwikkelmachines op Amsterdam. De uitkomst hoort in
// allebei identiek te zijn, en juist dat ging mis.
//
// De bug is per definitie onzichtbaar op een UTC-machine. `new Date("2025-01-01")` levert
// UTC-middernacht; `setDate()` telt er LOKAAL bij op; `toISOString()` gaat weer naar UTC. Bij
// offset nul vallen die drie samen en klopt alles. In Amsterdam schuift de uitkomst zodra het
// venster een zomertijdgrens kruist. Een test die alleen op de CI-machine draait bewijst dus
// niets: die zit in dezelfde blinde vlek als de code.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addDays, addYears, fmt, monthsAgo, daysAgo, today, REPORTING_TIMEZONE } from "./helpers";

const ZONES = ["UTC", "Europe/Amsterdam"];

// De ouderprocesrun start de kinderen en telt de uitkomsten op. Via tsx en niet via
// process.execPath: dit bestand is TypeScript, en kale node kan het niet laden.
//
// fileURLToPath(import.meta.url) i.p.v. import.meta.filename: dat laatste bleek undefined
// wanneer dit bestand draait via scripts/run-tests.mjs (dat het tsx-binary rechtstreeks aanroept
// i.p.v. via `npx tsx`, zie dat bestand) -- de spawnSync hieronder kreeg dan letterlijk de string
// "undefined" als pad mee ("Cannot find module '.../undefined'"), zichtbaar als "2 van de 2
// tijdzones faalde" ook al was er geen enkele echte assertie mislukt. import.meta.url is de
// oudere, overal ondersteunde vorm en levert in beide invocatiepaden hetzelfde pad.
if (!process.env.__TZ_CHILD) {
  const eigenPad = fileURLToPath(import.meta.url);
  let mislukt = 0;
  for (const zone of ZONES) {
    const res = spawnSync("npx", ["tsx", eigenPad], {
      env: { ...process.env, TZ: zone, __TZ_CHILD: "1" },
      encoding: "utf8",
      stdio: "inherit",
    });
    if (res.status !== 0) mislukt += 1;
  }
  if (mislukt > 0) {
    console.error(`\n${mislukt} van de ${ZONES.length} tijdzones faalde`);
    process.exit(1);
  }
  console.log(`\nAlle ${ZONES.length} tijdzones groen.`);
  process.exit(0);
}

const TZ = process.env.TZ ?? "onbekend";
let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL [${TZ}] ${label}  ${detail}`); }
}

// De referentie: dagen tellen als een doorlopende index, zonder Date-object.
function verwacht(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ── addDays over de volle breedte ──────────────────────────────────────────
// Vijf jaar maal elke dag maal een reeks stapgroottes, inclusief de stappen die een
// zomertijdgrens kruisen (90 en 365) en de stappen die er net binnen blijven.
{
  let afwijkingen = 0;
  let eerste = "";
  for (let y = 2023; y <= 2027; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      for (let d = 1; d <= 31; d += 1) {
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        // Sla niet-bestaande datums over: die hoeven niet door de helper heen.
        if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) continue;
        for (const n of [0, 1, -1, 6, 7, -7, 15, -15, 30, 90, -90, 180, 365, -365]) {
          if (addDays(iso, n) !== verwacht(iso, n)) {
            afwijkingen += 1;
            if (!eerste) eerste = `addDays("${iso}", ${n}) = ${addDays(iso, n)}, verwacht ${verwacht(iso, n)}`;
          }
        }
      }
    }
  }
  check("addDays klopt over vijf jaar en veertien stapgroottes", afwijkingen === 0, `${afwijkingen} afwijkingen, eerste: ${eerste}`);
}

// ── De zomertijdovergangen zelf ────────────────────────────────────────────
// De dagen waarop het misging. Europa schakelt de laatste zondag van maart en oktober,
// Amerika de tweede zondag van maart en de eerste van november, Nieuw-Zeeland andersom.
{
  const overgangen = [
    "2025-03-30", "2025-10-26", // Europa
    "2026-03-29", "2026-10-25",
    "2025-03-09", "2025-11-02", // Verenigde Staten
    "2026-03-08", "2026-11-01",
    "2025-04-06", "2025-09-28", // Nieuw-Zeeland
  ];
  for (const dag of overgangen) {
    for (const n of [-2, -1, 1, 2]) {
      check(`overgang ${dag} ${n >= 0 ? "+" : ""}${n}`, addDays(dag, n) === verwacht(dag, n),
        `${addDays(dag, n)} versus ${verwacht(dag, n)}`);
    }
    // Eromheen springen en weer terug moet op dezelfde dag uitkomen.
    check(`overgang ${dag} heen en terug`, addDays(addDays(dag, 7), -7) === dag);
  }
}

// ── Maand- en jaargrenzen ──────────────────────────────────────────────────
check("over de jaargrens", addDays("2025-12-31", 1) === "2026-01-01");
check("terug over de jaargrens", addDays("2026-01-01", -1) === "2025-12-31");
check("februari in een gewoon jaar", addDays("2025-02-28", 1) === "2025-03-01");
check("februari in een schrikkeljaar", addDays("2024-02-28", 1) === "2024-02-29");
check("29 februari plus een", addDays("2024-02-29", 1) === "2024-03-01");
check("een schrikkeljaar is 366 dagen", addDays("2024-01-01", 366) === "2025-01-01");
check("een gewoon jaar is 365 dagen", addDays("2025-01-01", 365) === "2026-01-01");
// 2000 was wel een schrikkeljaar, 1900 en 2100 niet.
check("eeuwjaar 2000 telt 366 dagen", addDays("2000-01-01", 366) === "2001-01-01");
check("eeuwjaar 2100 telt 365 dagen", addDays("2100-01-01", 365) === "2101-01-01");

// ── addYears ───────────────────────────────────────────────────────────────
check("een jaar terug", addYears("2025-06-01", -1) === "2024-06-01");
check("een jaar vooruit", addYears("2025-06-01", 1) === "2026-06-01");
check("de eerste van elke maand blijft de eerste", (() => {
  for (let m = 1; m <= 12; m += 1) {
    const iso = `2025-${String(m).padStart(2, "0")}-01`;
    if (addYears(iso, -1) !== `2024-${String(m).padStart(2, "0")}-01`) return false;
  }
  return true;
})());
// Het gedocumenteerde randgeval: 29 februari bestaat niet in een gewoon jaar en rolt door.
check("29 februari rolt door naar 1 maart", addYears("2024-02-29", -1) === "2023-03-01");
check("29 februari naar een schrikkeljaar blijft staan", addYears("2024-02-29", 4) === "2028-02-29");

// ── "Vandaag" is Amsterdam, waar het proces ook draait ─────────────────────

const amsterdamNu = new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE }).format(new Date());
check("fmt levert een datum zonder tijd", /^\d{4}-\d{2}-\d{2}$/.test(fmt(new Date())));
check("today() is de Amsterdamse kalenderdag", today() === amsterdamNu, `${today()} versus ${amsterdamNu}`);
check("daysAgo(0) is vandaag", daysAgo(0) === amsterdamNu);
check("monthsAgo levert de eerste van de maand", monthsAgo(1).endsWith("-01"));
check("monthsAgo(0) is de huidige Amsterdamse maand", monthsAgo(0) === `${amsterdamNu.slice(0, 7)}-01`);
// De reden dat monthsAgo bestaat: dertien maanden terug moet dertien maanden terug zijn.
check("monthsAgo(13) ligt dertien maanden terug", (() => {
  const [y, m] = amsterdamNu.split("-").map(Number);
  return monthsAgo(13) === new Date(Date.UTC(y, m - 1 - 13, 1)).toISOString().slice(0, 10);
})());
check("daysAgo telt kalenderdagen", daysAgo(7) === addDays(amsterdamNu, -7));

// Het venster waarin het misging: tussen middernacht en 02:00 Amsterdamse tijd staat UTC nog op
// de vorige dag, en aan het begin van een maand dus op de vorige MAAND. Onder de oude,
// UTC-verankerde versie was dat elke nacht opnieuw een maand ernaast — precies wanneer de
// syncs draaien. Deze check bewijst dat het antwoord niet meer van de procestijdzone afhangt.
{
  const moment = new Date("2026-07-31T22:30:00Z"); // 1 augustus 00:30 in Amsterdam
  const viaUtc = moment.toISOString().slice(0, 10);
  const viaAmsterdam = new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE }).format(moment);
  check("het nachtvenster verschilt echt", viaUtc === "2026-07-31" && viaAmsterdam === "2026-08-01");
  check("en Amsterdam is de maand die wij bedoelen", viaAmsterdam.slice(0, 7) === "2026-08");
}

console.log(`  ${TZ.padEnd(20)} ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

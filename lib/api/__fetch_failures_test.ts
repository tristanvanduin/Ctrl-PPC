// Ophaalfouten mogen niet meer geruisloos verdwijnen.
// Draaien: npx tsx lib/api/__fetch_failures_test.ts
//
// De 24 getters in google-ads.ts eindigden op `catch { return []; }` — zonder logregel, zonder
// signaal. Een quota-limiet, een netwerkfout en een verlopen token waren daardoor niet te
// onderscheiden van "deze klant heeft geen zoekwoorden". De sync boekte dat als een geslaagde
// dataset met nul rijen, en de analyse meldde vervolgens "geen data beschikbaar" — waarna een
// mens ging zoeken bij de klant in plaats van bij de sync.

import { readFileSync } from "node:fs";
import { withFetchFailures, recordFetchFailure, currentFetchFailures, hasFetchFailure } from "./fetch-failures";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

async function main() {
  console.log("De verzamelaar");
  {
    const { result, failures } = await withFetchFailures(async () => {
      recordFetchFailure("getKeywordPerformanceByMonth", new Error("quota exceeded"));
      return "klaar";
    });
    check("geeft het resultaat door", result === "klaar");
    check("en verzamelt de fout", failures.length === 1 && failures[0].source === "getKeywordPerformanceByMonth", JSON.stringify(failures));
    check("met de melding erbij", failures[0].message === "quota exceeded");
    check("en een tijdstip", !Number.isNaN(Date.parse(failures[0].at)));
  }

  console.log("\nRuns zitten elkaar niet in de weg");
  {
    // Twee klanten die tegelijk synchroniseren mogen elkaars fouten niet zien. Een module-globale
    // array zou dat wél doen; AsyncLocalStorage houdt ze gescheiden.
    const [a, b] = await Promise.all([
      withFetchFailures(async () => {
        await new Promise((r) => setTimeout(r, 10));
        recordFetchFailure("getA", new Error("fout A"));
        return currentFetchFailures();
      }),
      withFetchFailures(async () => {
        recordFetchFailure("getB", new Error("fout B"));
        await new Promise((r) => setTimeout(r, 20));
        return currentFetchFailures();
      }),
    ]);
    check("run A ziet alleen zijn eigen fout", a.failures.length === 1 && a.failures[0].source === "getA", JSON.stringify(a.failures));
    check("run B ziet alleen zijn eigen fout", b.failures.length === 1 && b.failures[0].source === "getB", JSON.stringify(b.failures));
    check("en binnen de run klopt de tussenstand ook", a.result.every((f) => f.source === "getA"));
  }

  console.log("\nhasFetchFailure");
  await withFetchFailures(async () => {
    recordFetchFailure("getGeoPerformanceByMonth", new Error("boem"));
    check("herkent de gefaalde bron", hasFetchFailure("getGeoPerformanceByMonth"));
    check("en niet een andere", !hasFetchFailure("getAccountMetricsByMonth"));
  });

  console.log("\nBuiten een run gaat het goed, alleen zonder verzameling");
  {
    let gooide = false;
    try { recordFetchFailure("losseAanroep", new Error("x")); } catch { gooide = true; }
    check("noteren zonder actieve run gooit niet", !gooide);
    check("en levert een lege lijst", currentFetchFailures().length === 0);
  }

  console.log("\nGeen stille catch meer in google-ads.ts");
  {
    const src = readFileSync(new URL("./google-ads.ts", import.meta.url).pathname, "utf8");
    // `catch {` zonder foutparameter kán legitiem zijn (per-klant overslaan, best-effort
    // verrijking), maar niet in combinatie met een lege teruggave: dat is precies het patroon
    // waarin een mislukte call op "geen data" lijkt.
    const stil = [...src.matchAll(/catch\s*\{\s*return\s*\[\s*\]\s*;?\s*\}/g)];
    check("geen `catch { return [] }` meer", stil.length === 0, `${stil.length} gevonden`);
    const genoteerd = [...src.matchAll(/recordFetchFailure\(/g)].length;
    check("en ruim twintig catches noteren hun bron", genoteerd >= 20, String(genoteerd));
    // Elke recordFetchFailure moet een echte functienaam meekrijgen, geen lege string.
    const leeg = [...src.matchAll(/recordFetchFailure\(\s*""/g)];
    check("altijd met een bronnaam", leeg.length === 0);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

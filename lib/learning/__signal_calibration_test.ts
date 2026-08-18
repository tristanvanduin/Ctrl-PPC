// Test voor Loop 5's kalibratieberekening (masterplan sectie 4, migratie 091). Deterministisch
// waar mogelijk; computeSourceHitRates() met een gemockte Supabase.
// Draaien: npx tsx lib/learning/__signal_calibration_test.ts

import { calibrateConfidence, computeSourceHitRates, type SourceHitRate } from "./signal-calibration";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rate(source: string, met: number, missed: number): SourceHitRate {
  const sampleSize = met + missed;
  return { source, totalMet: met, totalMissed: missed, hitRate: sampleSize > 0 ? met / sampleSize : 0, sampleSize };
}

async function main() {
  console.log("calibrateConfidence: geen bijstelling zonder bewijs");
  {
    const r1 = calibrateConfidence(5, undefined);
    check("geen hitRate -> ongewijzigd", r1.confidence === 5 && r1.applied === false);

    const r2 = calibrateConfidence(5, rate("second_opinion", 2, 1)); // sampleSize 3 < MIN_SAMPLE (5)
    check("te kleine steekproef -> ongewijzigd", r2.confidence === 5 && r2.applied === false, JSON.stringify(r2));
  }

  console.log("\ncalibrateConfidence: 50% trefzekerheid is neutraal, ongeacht steekproefgrootte");
  {
    const r = calibrateConfidence(5, rate("search_terms", 10, 10)); // 50%, sampleSize 20 (volle weging)
    check("exact 50% -> geen effect", r.confidence === 5 && r.applied === false, JSON.stringify(r));
  }

  console.log("\ncalibrateConfidence: hoge trefzekerheid verhoogt, begrensd op +2 en op 10");
  {
    const volleWeging = calibrateConfidence(5, rate("master_synthesis", 20, 0)); // 100%, sampleSize 20
    check("100% trefzeker, volle steekproef -> +2", volleWeging.confidence === 7, JSON.stringify(volleWeging));
    check("applied is true", volleWeging.applied === true);
    check("detail noemt de bron en het percentage", (volleWeging.detail?.includes("master_synthesis") && volleWeging.detail?.includes("100%")) === true, volleWeging.detail ?? "");

    const geclipt = calibrateConfidence(9.5, rate("master_synthesis", 20, 0));
    check("clip op maximaal 10", geclipt.confidence === 10, JSON.stringify(geclipt));
  }

  console.log("\ncalibrateConfidence: lage trefzekerheid verlaagt, begrensd op -2 en op 1");
  {
    const laag = calibrateConfidence(5, rate("bid_strategy", 0, 20)); // 0%, sampleSize 20
    check("0% trefzeker, volle steekproef -> -2", laag.confidence === 3, JSON.stringify(laag));

    const geclipt = calibrateConfidence(2, rate("bid_strategy", 0, 20));
    check("clip op minimaal 1", geclipt.confidence === 1, JSON.stringify(geclipt));
  }

  console.log("\ncalibrateConfidence: gedeeltelijke steekproef weegt minder zwaar mee");
  {
    // sampleSize 10 -> weight = 10/20 = 0.5. hitRate 1.0 -> delta = (1-0.5)*2*2*0.5 = 1.0
    const halveWeging = calibrateConfidence(5, rate("rsa_insights", 10, 0));
    check("halve steekproef, 100% trefzeker -> +1 (halve bijstelling)", halveWeging.confidence === 6, JSON.stringify(halveWeging));
  }

  console.log("\ncalibrateConfidence: bronnen blijven apart, nooit gemengd (elk zijn eigen berekening)");
  {
    const bronA = calibrateConfidence(5, rate("second_opinion", 20, 0));
    const bronB = calibrateConfidence(5, rate("search_terms", 0, 20));
    check("bron A (100% trefzeker) en bron B (0% trefzeker) geven totaal verschillende uitkomsten", bronA.confidence !== bronB.confidence, `${bronA.confidence} vs ${bronB.confidence}`);
  }

  console.log("\ncomputeSourceHitRates: telt per bron op via de sprint_hypotheses-relatie, negeert andere event-types");
  {
    const rows = [
      { event_type: "hypothesis_outcome_met", sprint_hypotheses: { source: "second_opinion" } },
      { event_type: "hypothesis_outcome_met", sprint_hypotheses: { source: "second_opinion" } },
      { event_type: "hypothesis_outcome_missed", sprint_hypotheses: { source: "second_opinion" } },
      { event_type: "hypothesis_outcome_met", sprint_hypotheses: { source: "search_terms" } },
      { event_type: "hypothesis_proposed", sprint_hypotheses: { source: "second_opinion" } }, // telt niet mee
      { event_type: "hypothesis_outcome_met", sprint_hypotheses: null }, // geen bron te herleiden, telt niet mee
    ];
    const fakeSupabase = {
      from() {
        return {
          select() { return this; },
          in: (_col: string, _vals: string[]) => Promise.resolve({ data: rows, error: null }),
        };
      },
    } as unknown as SupabaseClient;

    const result = await computeSourceHitRates(fakeSupabase);
    const so = result.get("second_opinion");
    check("second_opinion: 2 met, 1 missed", so?.totalMet === 2 && so?.totalMissed === 1, JSON.stringify(so));
    check("second_opinion hitRate is 2/3", Math.abs((so?.hitRate ?? 0) - 2 / 3) < 0.001, JSON.stringify(so));
    const st = result.get("search_terms");
    check("search_terms: 1 met, 0 missed", st?.totalMet === 1 && st?.totalMissed === 0, JSON.stringify(st));
    check("geen bron voor null-relatie, geen extra entry", result.size === 2, JSON.stringify([...result.keys()]));
  }

  console.log("\ncomputeSourceHitRates: een leesfout geeft een lege map, geen crash");
  {
    const fakeSupabase = {
      from() {
        return {
          select() { return this; },
          in: () => Promise.resolve({ data: null, error: { message: "kapot" } }),
        };
      },
    } as unknown as SupabaseClient;
    const result = await computeSourceHitRates(fakeSupabase);
    check("lege map bij leesfout", result.size === 0);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

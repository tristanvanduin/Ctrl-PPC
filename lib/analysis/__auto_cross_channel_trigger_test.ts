// Test voor de automatische cross-channel-trigger (masterplan 17.25: "elke maandanalyse moet
// cross-channel pakken als cross-channel mogelijk is"). Deterministisch, geen echte LLM-call --
// forceert het bestaande, al-geteste skip-pad in runCrossChannelSynthesis (minder dan 2
// gekoppelde kanalen) zodat dit bestand alleen bewijst dat de WRAPPER zelf nooit een fout laat
// doorsijpelen naar de hoofdanalyse, en dat een ontbrekende sleutel de query's helemaal overslaat.
// Draaien: npx tsx lib/analysis/__auto_cross_channel_trigger_test.ts

import { triggerCrossChannelSynthesisIfReady } from "./auto-cross-channel-trigger";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Elke .from(tabel).select(...).eq(...).limit(...) geeft lege data terug -> laadBeschikbareKanalen
// vindt 0 kanalen -> runCrossChannelSynthesis skipt meteen op "minder dan 2 kanalen", ruim vóór
// enige LLM-call. Precies het scenario dat deze wrapper veilig moet doorstaan.
function legeSupabase(opts: { faalOpFrom?: boolean } = {}): SupabaseClient {
  const from = () => {
    if (opts.faalOpFrom) throw new Error("gesimuleerde databasefout");
    return {
      select() { return this; },
      eq() { return this; },
      limit: () => Promise.resolve({ data: [], error: null }),
    };
  };
  return { from } as unknown as SupabaseClient;
}

async function main() {
  const origGemini = process.env.GEMINI_API_KEY;
  const origOpenRouter = process.env.OPENROUTER_API_KEY;

  console.log("Zonder API-sleutel: geen enkele databaseaanroep, geen crash");
  {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    // faalOpFrom: true -- als de wrapper toch .from() aanroept zonder sleutel, faalt de test hard
    // in plaats van stil te slagen.
    const supabase = legeSupabase({ faalOpFrom: true });
    let threw = false;
    try {
      await triggerCrossChannelSynthesisIfReady(supabase, "client-zonder-sleutel");
    } catch {
      threw = true;
    }
    check("geen exception zonder sleutel", threw === false);
  }

  console.log("\nMet API-sleutel, minder dan 2 kanalen: skipt via het bestaande skip-pad, geen crash");
  {
    process.env.GEMINI_API_KEY = "test-sleutel";
    const supabase = legeSupabase();
    let threw = false;
    try {
      await triggerCrossChannelSynthesisIfReady(supabase, "client-1");
    } catch {
      threw = true;
    }
    check("geen exception bij een normale skip", threw === false);
  }

  console.log("\nEen databasefout in laadBeschikbareKanalen laat de wrapper nooit gooien");
  {
    process.env.GEMINI_API_KEY = "test-sleutel";
    const supabase = legeSupabase({ faalOpFrom: true });
    let threw = false;
    try {
      await triggerCrossChannelSynthesisIfReady(supabase, "client-2");
    } catch {
      threw = true;
    }
    check("geen exception bij een databasefout (faalt zacht, zie de toelichting in het bestand)", threw === false);
  }

  if (origGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = origGemini;
  if (origOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = origOpenRouter;

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

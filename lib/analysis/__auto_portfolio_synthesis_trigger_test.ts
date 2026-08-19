// Test voor de automatische cross-account-trigger ("elke maand analyse moet cross channel
// pakken als cross channel mogelijk is, cross account als er meerdere accounts zijn en er betaald
// is... allemaal moeten automatisch zijn" -- cross-channel had die koppeling al,
// portfolio-synthese (cross-account) niet). Deterministisch, geen echte LLM-call -- forceert de
// bestaande skip-paden (geen bureau, licentie onder growth, minder dan 2 klanten) zodat dit
// bestand alleen bewijst dat de WRAPPER zelf nooit een fout laat doorsijpelen naar de
// hoofdanalyse, en dat de tier-gate ("er betaald is") echt vóór elke aanroep zit.
// Draaien: npx tsx lib/analysis/__auto_portfolio_synthesis_trigger_test.ts

import { triggerPortfolioSynthesisIfReady } from "./auto-portfolio-synthesis-trigger";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface TableResponse { data: unknown; error?: { message: string } | null }

// Bouwt een mock die per tabel een vaste respons teruggeeft op .maybeSingle(), en anders (voor
// lijstAccountsMetSops' kale await zonder .maybeSingle()) direct de data. Houdt bij welke tabellen
// zijn aangeroepen, zodat een test kan bewijzen dat een latere stap NOOIT werd bereikt.
function mockSupabase(perTabel: Record<string, TableResponse>, opts: { faalOp?: string } = {}) {
  const aangeroepen: string[] = [];
  const from = (tabel: string) => {
    aangeroepen.push(tabel);
    if (opts.faalOp === tabel) throw new Error(`gesimuleerde databasefout op ${tabel}`);
    const respons = perTabel[tabel] ?? { data: null, error: null };
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      maybeSingle: () => Promise.resolve(respons),
      then: (resolve: (v: TableResponse) => void) => resolve(respons),
    };
    return chain;
  };
  return { supabase: { from } as unknown as SupabaseClient, aangeroepen };
}

async function main() {
  const origOpenRouter = process.env.OPENROUTER_API_KEY;
  const origGemini = process.env.GEMINI_API_KEY;

  console.log("Zonder API-sleutel: geen enkele databaseaanroep, geen crash");
  {
    delete process.env.OPENROUTER_API_KEY; delete process.env.GEMINI_API_KEY;
    const { supabase, aangeroepen } = mockSupabase({}, { faalOp: "accounts" });
    let threw = false;
    try { await triggerPortfolioSynthesisIfReady(supabase, "client-zonder-sleutel"); } catch { threw = true; }
    check("geen exception zonder sleutel", threw === false);
    check("geen databaseaanroep zonder sleutel", aangeroepen.length === 0, aangeroepen.join(","));
  }

  console.log("\nMet sleutel, geen accounts-rij (geen bureau gekoppeld): skipt vóór de licentie-check");
  {
    process.env.OPENROUTER_API_KEY = "test-sleutel";
    const { supabase, aangeroepen } = mockSupabase({ accounts: { data: null } });
    let threw = false;
    try { await triggerPortfolioSynthesisIfReady(supabase, "client-zonder-bureau"); } catch { threw = true; }
    check("geen exception zonder bureau", threw === false);
    check("stopt na accounts, raakt agencies niet", !aangeroepen.includes("agencies"), aangeroepen.join(","));
  }

  console.log("\nMet sleutel, bureau onder Growth-tier: skipt, GEEN klantenlijst opgehaald (de tier-gate, 'er betaald is')");
  {
    process.env.OPENROUTER_API_KEY = "test-sleutel";
    const { supabase, aangeroepen } = mockSupabase({
      accounts: { data: { agency_id: "bureau-1" } },
      agencies: { data: { licentie: "basis" } },
    });
    let threw = false;
    try { await triggerPortfolioSynthesisIfReady(supabase, "client-basis-tier"); } catch { threw = true; }
    check("geen exception onder Growth-tier", threw === false);
    // lijstAccountsMetSops() roept ook 'accounts' aan (voor sops_enabled) -- die tweede aanroep
    // mag hier niet gebeuren zodra de tier-gate al skipt, dus max 2 aanroepen: accounts + agencies.
    check("stopt bij de tier-gate, geen klantenlijst-aanroep erna", aangeroepen.length === 2, aangeroepen.join(","));
  }

  console.log("\nMet sleutel, Growth-tier maar minder dan 2 klanten met sops_enabled: skipt via het bestaande skip-pad in runPortfolioSynthesis");
  {
    process.env.OPENROUTER_API_KEY = "test-sleutel";
    const { supabase } = mockSupabase({
      accounts: { data: { agency_id: "bureau-2", client_id: "solo-klant" } },
      agencies: { data: { licentie: "growth" } },
    });
    let threw = false;
    try { await triggerPortfolioSynthesisIfReady(supabase, "solo-klant"); } catch { threw = true; }
    check("geen exception bij minder dan 2 klanten", threw === false);
  }

  console.log("\nEen databasefout in de eerste stap (accounts) laat de wrapper nooit gooien");
  {
    process.env.OPENROUTER_API_KEY = "test-sleutel";
    const { supabase } = mockSupabase({}, { faalOp: "accounts" });
    let threw = false;
    try { await triggerPortfolioSynthesisIfReady(supabase, "client-db-fout"); } catch { threw = true; }
    check("geen exception bij een databasefout (faalt zacht)", threw === false);
  }

  if (origOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = origOpenRouter;
  if (origGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = origGemini;

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

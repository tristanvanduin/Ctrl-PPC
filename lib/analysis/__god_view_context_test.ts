// Test voor de God View-context in de hypotheses-stap (masterplan 16.7). Deterministisch;
// supabase is gemockt. Draaien: npx tsx lib/analysis/__god_view_context_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { godViewContext } from "./god-view-context";
import { monthsAgo } from "../reporting-date";

// fetchGodViewInvoerRijen filtert blended_account_monthly op month = monthsAgo(1) -- de
// testfixtures moeten dat veld dus dragen, anders valt alles weg bij de mock-eq-filter hieronder
// (die, anders dan __god_view_data_test.ts's losse mock, écht filtert in plaats van een no-op te
// zijn) en meldt de test "geen bureaus" terwijl het probleem in de fixture zit, niet in de code.
const MAAND = monthsAgo(1);

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface Tabellen {
  agencies: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
  client_settings: Record<string, unknown>[];
  blended_account_monthly: Record<string, unknown>[];
}

function mockSupabase(tabellen: Tabellen): SupabaseClient {
  const from = (naam: keyof Tabellen) => ({
    select() {
      let rows = tabellen[naam];
      const b = {
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => (r as Record<string, unknown>)[col] === val);
          return b;
        },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve: (r: { data: unknown[]; error: null }) => void) { resolve({ data: rows, error: null }); },
      };
      return b;
    },
  });
  return { from } as unknown as SupabaseClient;
}

// Vier opt-in-bureaus, elk één b2b-account op Google -- net genoeg om de model-cel deelbaar te
// maken (MIN_ACCOUNTS=10 zit niet in de weg zolang er tien ACCOUNTS zijn, dus tien bureaus met elk
// één account, of vier bureaus met samen tien accounts; hier: tien accounts over vier bureaus).
function vierBureausTienAccounts(): Tabellen {
  const agencies = ["a0", "a1", "a2", "a3"].map((id) => ({ id, benchmark_optin_at: "2026-07-01" }));
  const accounts = Array.from({ length: 10 }, (_, i) => ({ client_id: `c${i}`, agency_id: `a${i % 4}` }));
  const client_settings = accounts.map((a) => ({ client_id: a.client_id, bedrijfsmodel: "b2b", niche: null }));
  const blended_account_monthly = accounts.map((a) => ({
    client_id: a.client_id, channel: "google_ads", month: MAAND, spend: 1000, conversions: 10, conversion_value: 4000, leads: 0,
  }));
  return { agencies, accounts, client_settings, blended_account_monthly };
}

async function main() {
  console.log("godViewContext: genoeg bureaus -> echte context");
  {
    const tabellen = vierBureausTienAccounts();
    // Deze klant zelf (c0) heeft ook bedrijfsmodel b2b -- checkt haar eigen segment.
    const result = await godViewContext(mockSupabase(tabellen), "c0", "google_ads");
    check("available is true", result.available === true, result.promptContext);
    check("promptContext noemt de mediane CPA", result.promptContext.includes("Mediane CPA"), result.promptContext);
    check("promptContext noemt anonimiteit expliciet", result.promptContext.includes("anoniem"));
    check("promptContext waarschuwt tegen individuele herleiding", result.promptContext.includes("niet") && result.promptContext.toLowerCase().includes("herleid"));
  }

  console.log("godViewContext: klant zonder bedrijfsmodel/niche -> geen enkele lookup nodig, stil leeg");
  {
    const tabellen = vierBureausTienAccounts();
    tabellen.client_settings = tabellen.client_settings.map((s) =>
      (s as { client_id: string }).client_id === "c0" ? { client_id: "c0", bedrijfsmodel: null, niche: null } : s);
    const result = await godViewContext(mockSupabase(tabellen), "c0", "google_ads");
    check("available is false zonder eigen afbakening", result.available === false);
    check("promptContext is leeg", result.promptContext === "");
  }

  console.log("godViewContext: huidige realiteit (2 bureaus) -> stil degraderen, geen ruis");
  {
    // Realistische stand vandaag: twee bureaus, geen enkele cel haalt ooit de bureau-drempel (4).
    const agencies = [
      { id: "bureau-1", benchmark_optin_at: "2026-07-01" },
      { id: "bureau-2", benchmark_optin_at: "2026-07-01" },
    ];
    const accounts = [
      { client_id: "c0", agency_id: "bureau-1" },
      { client_id: "c1", agency_id: "bureau-2" },
    ];
    const client_settings = accounts.map((a) => ({ client_id: a.client_id, bedrijfsmodel: "b2b", niche: null }));
    const blended_account_monthly = accounts.map((a) => ({
      client_id: a.client_id, channel: "google_ads", month: MAAND, spend: 1000, conversions: 10, conversion_value: 4000, leads: 0,
    }));
    const result = await godViewContext(mockSupabase({ agencies, accounts, client_settings, blended_account_monthly }), "c0", "google_ads");
    check("available is false: k-anonimiteit, geen datagat", result.available === false);
    check("promptContext is leeg, geen 'onvoldoende data'-ruis", result.promptContext === "");
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

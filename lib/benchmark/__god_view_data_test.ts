// Test voor de God View IO-laag (masterplan 16.7). Deterministisch; supabase is gemockt.
// Draaien: npx tsx lib/benchmark/__god_view_data_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGodViewInvoerRijen } from "./god-view-data";
import { monthsAgo } from "../reporting-date";

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
        then(resolve: (r: { data: unknown[]; error: null }) => void) { resolve({ data: rows, error: null }); },
      };
      return b;
    },
  });
  return { from } as unknown as SupabaseClient;
}

async function main() {
  const basis: Tabellen = {
    agencies: [
      { id: "opt-in-1", benchmark_optin_at: "2026-07-01" },
      { id: "opt-in-2", benchmark_optin_at: "2026-07-01" },
      { id: "geen-optin", benchmark_optin_at: null },
    ],
    accounts: [
      { client_id: "c1", agency_id: "opt-in-1" }, // opt-in, afgebakend -> telt mee
      { client_id: "c2", agency_id: "opt-in-2" }, // opt-in, GEEN afbakening -> telt niet mee
      { client_id: "c3", agency_id: "geen-optin" }, // geen opt-in, wel afgebakend -> telt niet mee
    ],
    client_settings: [
      { client_id: "c1", bedrijfsmodel: "b2b", niche: null },
      { client_id: "c2", bedrijfsmodel: null, niche: null },
      { client_id: "c3", bedrijfsmodel: "b2b", niche: "saas" },
    ],
    blended_account_monthly: [
      { client_id: "c1", channel: "google_ads", month: MAAND, spend: 1000, conversions: 8, conversion_value: 4000, leads: 2 },
      { client_id: "c2", channel: "google_ads", month: MAAND, spend: 500, conversions: 5, conversion_value: 1000, leads: 0 },
      { client_id: "c3", channel: "google_ads", month: MAAND, spend: 2000, conversions: 20, conversion_value: 9000, leads: 0 },
    ],
  };

  console.log("fetchGodViewInvoerRijen: opt-in en afbakening samen bepalen wie meetelt");
  const rijen = await fetchGodViewInvoerRijen(mockSupabase(basis));
  check("alleen c1 haalt door (opt-in EN afgebakend)", rijen.length === 1, JSON.stringify(rijen));
  check("c2 valt af: opt-in maar geen bedrijfsmodel/niche", !rijen.some((r) => r.clientId === "c2"));
  check("c3 valt af: wel afgebakend maar geen opt-in bureau", !rijen.some((r) => r.clientId === "c3"));

  console.log("fetchGodViewInvoerRijen: conversies en leads samen als acquisitie-actie");
  const c1 = rijen[0];
  check("conversions = conversions + leads (8 + 2)", c1.conversions === 10, `${c1.conversions}`);
  check("spend en conversionValue komen ongewijzigd door", c1.spend === 1000 && c1.conversionValue === 4000);
  check("channel komt uit de data, geen aanname", c1.channel === "google_ads", c1.channel);

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

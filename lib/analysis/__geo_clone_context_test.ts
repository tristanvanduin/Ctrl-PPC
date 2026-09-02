// Test voor de geo-clone-context die sub-accounts (bijv. GreenTech Amsterdam/Americas/North
// America) als unieke, losse eenheden in de Google-monthly-analyse voedt, met een accounttotaal
// ernaast (masterplan 17.12). Deterministisch; supabase is gemockt.
// Draaien: npx tsx lib/analysis/__geo_clone_context_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { geoCloneContext } from "./geo-clone-context";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface Row { campaign_name: string; month: string; impressions?: number; clicks?: number; cost?: number; conversions?: number; conversions_value?: number }

function mockSupabase(rows: Row[]): SupabaseClient {
  // De keten eindigt sinds de herbouw op .lt (afgesloten-maanden-filter); de stub bootst de
  // volledige keten na en levert de rijen pas aan het eind.
  const from = () => ({
    select() {
      const b = {
        eq() { return b; },
        gte() { return b; },
        lt() { return Promise.resolve({ data: rows, error: null }); },
      };
      return b;
    },
  });
  return { from } as unknown as SupabaseClient;
}

async function main() {
  // ── Geen data: geen wijziging ──
  console.log("geoCloneContext: geen campagnedata");
  {
    const result = await geoCloneContext(mockSupabase([]), "demo-greentech");
    check("available is false", result.available === false);
    check("promptContext is leeg", result.promptContext === "");
    check("geoCloneCount is 0", result.geoCloneCount === 0);
  }

  // ── Data zonder geo-clone-afkortingen (het normale geval voor vrijwel elke klant) ──
  console.log("geoCloneContext: campagnedata zonder geo-clone-afkortingen");
  {
    const rows: Row[] = [
      { campaign_name: "Brand generic", month: "2026-07-01", cost: 100, conversions: 5, conversions_value: 500 },
      { campaign_name: "Non-brand Search", month: "2026-07-01", cost: 200, conversions: 3, conversions_value: 300 },
    ];
    const result = await geoCloneContext(mockSupabase(rows), "gewone-klant");
    check("available blijft false zonder geo-clones", result.available === false, JSON.stringify(result));
    check("promptContext is leeg: nul wijziging voor een gewone klant", result.promptContext === "");
  }

  // ── GreenTech-achtig account: drie sub-accounts, elk uniek behandeld, plus een totaal ──
  console.log("geoCloneContext: account met geo-clones (GRT/GRA/GRN)");
  {
    const rows: Row[] = [
      { campaign_name: "GRT | Search | NL", month: "2026-07-01", impressions: 1000, clicks: 100, cost: 500, conversions: 10, conversions_value: 4000 },
      { campaign_name: "GRA | Search | US", month: "2026-07-01", impressions: 800, clicks: 60, cost: 300, conversions: 4, conversions_value: 1200 },
      { campaign_name: "GRN | Search | US", month: "2026-07-01", impressions: 600, clicks: 40, cost: 200, conversions: 2, conversions_value: 500 },
    ];
    const result = await geoCloneContext(mockSupabase(rows), "demo-greentech");
    check("available is true", result.available === true);
    check("drie geo-clones herkend", result.geoCloneCount === 3, String(result.geoCloneCount));
    check("elk sub-account met naam en afkorting genoemd", result.promptContext.includes("GRT") && result.promptContext.includes("GRA") && result.promptContext.includes("GRN"));
    check("het accounttotaal staat er expliciet bij", result.promptContext.includes("Totaal van het hele account"));
    // Totaal = som van de drie: cost 500+300+200=1000, conversions 10+4+2=16.
    check("accounttotaal-cijfers kloppen (som van de drie sub-accounts)", result.promptContext.includes("€1000") && result.promptContext.includes("conversies 16"), result.promptContext);
    check("instructie zegt expliciet: niet blenden, elk apart behandelen", result.promptContext.toLowerCase().includes("unieke") && result.promptContext.toLowerCase().includes("niet stilzwijgend"));
  }

  // ── Gemengd: bekende geo-clones plus onbekende campagnes, apart gehouden ──
  console.log("geoCloneContext: onbekende campagnes blijven een apart segment");
  {
    const rows: Row[] = [
      { campaign_name: "GRT | Search | NL", month: "2026-07-01", cost: 500, conversions: 10, conversions_value: 4000 },
      { campaign_name: "Onbekende campagne zonder afkorting", month: "2026-07-01", cost: 50, conversions: 1, conversions_value: 100 },
    ];
    const result = await geoCloneContext(mockSupabase(rows), "demo-greentech");
    check("de onbekende campagne krijgt een eigen 'Overig'-regel", result.promptContext.includes("Overig"), result.promptContext);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

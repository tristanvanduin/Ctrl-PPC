// De voorberekende context voor de maandanalyse. Deterministisch; supabase is gemockt.
// Draaien: npx tsx lib/analysis/__monthly_prepared_context_test.ts
//
// Wat deze module oplevert gaat de prompt in onder koppen als "PRE-COMPUTED KPI-KETEN (gebruik
// als basis, reken NIET zelf)" en "Reken uitsluitend met deze exacte, deterministisch
// voorgerekende getallen". Het model krijgt dus expliciet te horen dat het deze cijfers niet
// hoort te controleren. Alles wat hier misgaat wordt met gezag doorgegeven en is stroomafwaarts
// door niets meer te vangen. Twee dingen stonden scheef:
//
//   1. Ontbrak de maandrij van de geanalyseerde maand, dan werd hij `{}` en maakte `Number(x||0)`
//      er nullen van. De keten meldde dan "Conversies -100%, CVR van 4,00% naar 0,00%, klikken
//      -100%": een sync die nog niet binnen was, las als een ineenstorting.
//   2. De campagneketens stonden hardgecodeerd op conversiewaarde. Een leadgen-account heeft die
//      niet, dus daar opende elke keten met "Conversiewaarde +0%" terwijl de conversies stegen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPreparedContextRow, type MonthlyPreparedInputs } from "./monthly-prepared-context";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Mock: alleen de twee lookups die buildPreparedContextRow zelf nog doet ──

function mockSupabase(): SupabaseClient {
  const from = () => ({
    select() {
      const b = {
        eq() { return b; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(res: (r: { data: unknown[]; error: null }) => void) { res({ data: [], error: null }); },
      };
      return b;
    },
  });
  return { from } as unknown as SupabaseClient;
}

const maand = (month: string, o: Record<string, unknown> = {}) => ({
  month, impressions: 120000, clicks: 6000, cost: 12000, conversions: 240,
  conversions_value: 48000, ctr: 0.05, avg_cpc: 2.0, conversion_rate: 0.04,
  cost_per_conversion: 50, roas: 4, ...o,
});

function inputs(o: Partial<MonthlyPreparedInputs> = {}): MonthlyPreparedInputs {
  const leeg: Record<string, unknown[]> = {};
  for (const k of ["weeklyData", "adgroupData", "isData", "searchData", "accountYoyData",
    "campaignYoyData", "campaignMetaData", "creativeData", "audienceData", "deviceData",
    "countryData", "countryYoyData", "networkData", "scheduleData", "productData",
    "keywordData", "enrichedProductData", "checkoutData"]) leeg[k] = [];
  return {
    analysisYear: 2026, lastCompleteMonth: 6,
    periodStart: "2025-06-01", periodEnd: "2026-06-30",
    accountData: [maand("2026-05-01"), maand("2026-06-01", { conversions: 260, conversions_value: 52000 })],
    campaignData: [],
    goalsSection: "## Doelen", accountType: "ecommerce_roas", targetResult: null,
    ...leeg, ...o,
  } as MonthlyPreparedInputs;
}

async function main() {
  const db = mockSupabase();

  // ── Een ontbrekende maand is geen maand vol nullen ──────────────────────

  console.log("Een ontbrekende maandrij");
  {
    // Juni ontbreekt: alleen mei is er.
    const { prepared } = await buildPreparedContextRow(db, "c1", inputs({ accountData: [maand("2026-05-01")] }));
    check("er wordt geen keten gebouwd", prepared.kpi_chain_account === null,
      JSON.stringify(prepared.kpi_chain_account)?.slice(0, 80));
    check("de tekst meldt dat de rij ontbreekt", /maandrij ontbreekt/.test(prepared.kpi_chain_text),
      prepared.kpi_chain_text.slice(0, 160));
    check("en noemt welke maand", /2026-06/.test(prepared.kpi_chain_text));
    // Dit is de kern: geen verzonnen ineenstorting.
    check("geen daling van 100%", !/-100%/.test(prepared.kpi_chain_text), prepared.kpi_chain_text.slice(0, 200));
    check("en het zegt er expliciet bij dat nul iets anders is dan niets",
      /niet dat de cijfers nul waren/.test(prepared.kpi_chain_text));
  }
  {
    // Ook andersom: de voorgaande maand ontbreekt.
    const { prepared } = await buildPreparedContextRow(db, "c1", inputs({ accountData: [maand("2026-06-01")] }));
    check("ook bij een ontbrekende vorige maand geen keten", prepared.kpi_chain_account === null);
    check("en de juiste maand wordt genoemd", /2026-05/.test(prepared.kpi_chain_text), prepared.kpi_chain_text.slice(0, 160));
  }
  {
    // Helemaal geen data.
    const { prepared } = await buildPreparedContextRow(db, "c1", inputs({ accountData: [] }));
    check("zonder accountdata geen keten", prepared.kpi_chain_account === null);
    check("beide maanden worden genoemd",
      /2026-06/.test(prepared.kpi_chain_text) && /2026-05/.test(prepared.kpi_chain_text), prepared.kpi_chain_text.slice(0, 160));
  }
  {
    // Zijn beide maanden er wel, dan hoort er gewoon een keten te staan.
    const { prepared } = await buildPreparedContextRow(db, "c1", inputs());
    check("met beide maanden komt er een keten", prepared.kpi_chain_account !== null);
    check("en die staat in de tekst", /wordt primair verklaard door/.test(prepared.kpi_chain_text),
      prepared.kpi_chain_text.slice(0, 160));
    check("zonder de melding over ontbrekende rijen", !/maandrij ontbreekt/.test(prepared.kpi_chain_text));
  }
  {
    // Een maand die er WEL is maar echt op nul staat, is iets anders dan een ontbrekende maand.
    const nul = maand("2026-06-01", { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, ctr: 0, conversion_rate: 0, avg_cpc: 0 });
    const { prepared } = await buildPreparedContextRow(db, "c1", inputs({ accountData: [maand("2026-05-01"), nul] }));
    check("een gemeten nul levert wel een keten op", prepared.kpi_chain_account !== null,
      "nul is een meting, ontbreken niet");
  }

  // ── De uitkomstmetriek volgt het accounttype ────────────────────────────

  console.log("\nDe uitkomstmetriek");
  {
    const campagnes = [
      { campaign_name: "Search Leads NL", month: "2026-05-01", impressions: 50000, clicks: 2500, cost: 5000, conversions: 100, conversions_value: 0 },
      { campaign_name: "Search Leads NL", month: "2026-06-01", impressions: 60000, clicks: 3000, cost: 6000, conversions: 150, conversions_value: 0 },
    ];
    const leadgenMaanden = [
      maand("2026-05-01", { conversions_value: 0, roas: 0 }),
      maand("2026-06-01", { conversions: 260, conversions_value: 0, roas: 0 }),
    ];
    const { prepared } = await buildPreparedContextRow(db, "c1",
      inputs({ accountType: "leadgen_cpa", campaignData: campagnes, accountData: leadgenMaanden }));

    // Eerder opende elke campagneketen met "Conversiewaarde +0%" terwijl de conversies stegen.
    check("een leadgen-campagneketen gaat niet over conversiewaarde",
      !/Conversiewaarde/.test(prepared.kpi_chain_text), prepared.kpi_chain_text.slice(0, 220));
    check("maar over conversies", /Conversies/.test(prepared.kpi_chain_text), prepared.kpi_chain_text.slice(0, 220));
    check("en de groei van 50% komt eruit", /\+50%/.test(prepared.kpi_chain_text), prepared.kpi_chain_text.slice(0, 220));
  }
  {
    // Bij ecommerce blijft het conversiewaarde, ook als een maand toevallig op nul staat.
    const ecom = [
      maand("2026-05-01"),
      maand("2026-06-01", { conversions_value: 0 }),
    ];
    const { prepared } = await buildPreparedContextRow(db, "c1", inputs({ accountType: "ecommerce_roas", accountData: ecom }));
    check("ecommerce blijft op conversiewaarde", /Conversiewaarde/.test(prepared.kpi_chain_text),
      prepared.kpi_chain_text.slice(0, 200));
  }

  // ── Stabiliteit ────────────────────────────────────────────────────────

  console.log("\nStabiliteit");
  {
    const a = await buildPreparedContextRow(db, "c1", inputs());
    const b = await buildPreparedContextRow(db, "c1", inputs());
    check("twee keer bouwen geeft dezelfde tekst", a.prepared.kpi_chain_text === b.prepared.kpi_chain_text);
    check("en dezelfde bindende feiten", a.prepared.binding_facts_text === b.prepared.binding_facts_text);
    // Geen NaN of undefined in wat de prompt in gaat.
    for (const [naam, tekst] of Object.entries({
      kpi_chain_text: a.prepared.kpi_chain_text,
      binding_facts_text: a.prepared.binding_facts_text,
      campaign_table_text: a.prepared.campaign_table_text,
    })) {
      check(`${naam} bevat geen NaN of undefined`, !/NaN|undefined/.test(tekst), tekst.slice(0, 120));
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

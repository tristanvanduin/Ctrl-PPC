// Test voor de expertlagen. Deterministisch, geen IO — Supabase wordt gemockt.
// Draaien: npx tsx lib/analysis/__expert_layers_test.ts
//
// Met 663 regels de grootste ongeteste module in lib/. De uitkomst van deze functies gaat
// rechtstreeks de LLM-prompt in, dus een verkeerde regel wordt letterlijk een aanname in de
// maandanalyse. Twee dingen zaten fout, allebei van het soort dat niets stukmaakt:
//
//   1. Zonder campagne-metadata stond er "Overig 100%" alsof het hele budget in onbekende
//      campagnetypes zat. Dat is een alarmerende uitspraak over een gat in de synchronisatie.
//   2. De grens tussen een volgroeide en een onvolgroeide week vergeleek een kalenderdatum met
//      een tijdstip, waardoor een week die precies op de rand eindigde als volgroeid gold —
//      precies de week waarvoor de onderdrukking bedoeld is.

import { calculatePortfolioAnalysis, calculateLeadingIndicators } from "./expert-layers";
import { addDays, today } from "./helpers";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Een Supabase die precies teruggeeft wat de test wil, en upserts opvangt.
function mockSupabase(tabellen: Record<string, unknown[]>) {
  const geschreven: Record<string, unknown[]> = {};
  const maakQuery = (tabel: string) => {
    const q: Record<string, unknown> = {};
    const zelf = () => q;
    for (const m of ["select", "eq", "is", "lte", "or", "order", "limit", "gte"]) q[m] = zelf;
    q.maybeSingle = async () => ({ data: (tabellen[tabel] ?? [])[0] ?? null, error: null });
    q.single = q.maybeSingle;
    q.upsert = async (rij: unknown) => {
      geschreven[tabel] = [...(geschreven[tabel] ?? []), rij];
      return { data: null, error: null };
    };
    q.then = (res: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: tabellen[tabel] ?? [], error: null }).then(res);
    return q;
  };
  return { sb: { from: (t: string) => maakQuery(t) } as never, geschreven };
}

const campagne = (id: string, naam: string, kosten: number, conv: number, waarde: number) => ({
  month: "2026-06", campaign_id: id, campaign_name: naam,
  cost: kosten, conversions: conv, conversions_value: waarde, roas: kosten > 0 ? waarde / kosten : 0,
});

async function main() {
  // ── Portfolio: een ontbrekend campagnetype is geen bevinding ───────────────

  console.log("Portfolio-analyse zonder campagne-metadata");
  {
    const campagnes = [campagne("1", "Search Merk", 5000, 100, 20000), campagne("2", "PMax", 3000, 40, 9000)];
    const { sb } = mockSupabase({});
    const tekst = await calculatePortfolioAnalysis(sb, "x", campagnes, []);
    check("er staat een waarschuwing over de metadata", /geen campagnetype bekend/i.test(tekst), tekst.slice(0, 200));
    check("en die noemt het aandeel", /100%/.test(tekst));
    check("en wijst naar de oorzaak", /ads_campaign_metadata/.test(tekst));
  }
  {
    // Mét metadata hoort er geen waarschuwing te staan, anders wordt het ruis.
    const campagnes = [campagne("1", "Search Merk", 5000, 100, 20000), campagne("2", "PMax", 3000, 40, 9000)];
    const { sb, geschreven } = mockSupabase({});
    const meta = [{ campaign_id: "1", campaign_type: "SEARCH" }, { campaign_id: "2", campaign_type: "PERFORMANCE_MAX" }];
    const tekst = await calculatePortfolioAnalysis(sb, "x", campagnes, meta);
    check("geen waarschuwing bij volledige metadata", !/geen campagnetype bekend/i.test(tekst));
    check("de verdeling klopt met de kosten", /Search 62.5%/.test(tekst), tekst.split("\n")[2]);
    check("PMax krijgt de rest", /PMAX 37.5%/.test(tekst));
    // Wat naar de database gaat moet dezelfde cijfers dragen als wat de LLM leest.
    const rij = (geschreven["ads_portfolio_analysis"] ?? [])[0] as Record<string, number>;
    check("de opgeslagen rij komt overeen", rij?.search_cost_pct === 62.5 && rij?.pmax_cost_pct === 37.5,
      JSON.stringify(rij ?? {}).slice(0, 120));
  }
  {
    // Deels bekend: onder de drempel geen waarschuwing, erboven wel.
    const veel = [campagne("1", "Bekend", 9500, 100, 20000), campagne("2", "Onbekend", 500, 5, 900)];
    const { sb } = mockSupabase({});
    const tekst = await calculatePortfolioAnalysis(sb, "x", veel, [{ campaign_id: "1", campaign_type: "SEARCH" }]);
    check("5 procent onbekend blijft onder de drempel", !/geen campagnetype bekend/i.test(tekst));

    const weinig = [campagne("1", "Bekend", 5000, 100, 20000), campagne("2", "Onbekend", 5000, 50, 9000)];
    const tekst2 = await calculatePortfolioAnalysis(mockSupabase({}).sb, "x", weinig, [{ campaign_id: "1", campaign_type: "SEARCH" }]);
    check("50 procent onbekend wordt wel gemeld", /geen campagnetype bekend/i.test(tekst2));
  }

  console.log("\nPortfolio-analyse randgevallen");
  {
    const { sb } = mockSupabase({});
    check("geen campagnes geeft een lege tekst", (await calculatePortfolioAnalysis(sb, "x", [], [])) === "");
  }
  {
    // Nul kosten mag geen deling door nul opleveren.
    const { sb } = mockSupabase({});
    const tekst = await calculatePortfolioAnalysis(sb, "x", [campagne("1", "Leeg", 0, 0, 0)], []);
    check("nul kosten geeft geen NaN", !/NaN|Infinity/.test(tekst), tekst.slice(0, 150));
  }

  // ── Leading indicators: de grens tussen volgroeid en onvolgroeid ──────────

  console.log("\nDe volwassenheidsgrens van een week");
  {
    const lag = 3;
    const vandaag = today();
    // Een week die precies op de grens eindigt: einddatum = vandaag - lag.
    const randWeekStart = addDays(vandaag, -lag - 6);
    const weken = [
      { week_start: addDays(randWeekStart, -7), ctr: 0.05, avg_cpc: 1, conversion_rate: 0.05, cost_per_conversion: 20, clicks: 1000, conversions: 50, cost: 1000 },
      { week_start: randWeekStart, ctr: 0.05, avg_cpc: 1, conversion_rate: 0.02, cost_per_conversion: 20, clicks: 1000, conversions: 20, cost: 1000 },
    ];
    // De mock levert weken aflopend, zoals de query doet.
    const { sb } = mockSupabase({
      client_settings: [{ conversion_lag_days: lag }],
      ads_account_weekly: [...weken].reverse(),
    });
    const tekst = await calculateLeadingIndicators(sb, "x");
    // De conversieratio zakte 60 procent. Zou die week ten onrechte als volgroeid gelden, dan
    // verschijnt de vlag; hij hoort onderdrukt te zijn omdat de conversies nog binnendruppelen.
    check("een week op de grens telt als onvolgroeid",
      !/conversieratio daalt|conv_rate_dropping/i.test(tekst), tekst.slice(0, 300));
  }
  {
    // Een week die ruim buiten het lag-venster ligt hoort wel beoordeeld te worden.
    const oudStart = addDays(today(), -60);
    const weken = [
      { week_start: addDays(oudStart, -7), ctr: 0.05, avg_cpc: 1, conversion_rate: 0.05, cost_per_conversion: 20, clicks: 1000, conversions: 50, cost: 1000 },
      { week_start: oudStart, ctr: 0.03, avg_cpc: 1, conversion_rate: 0.02, cost_per_conversion: 20, clicks: 1000, conversions: 20, cost: 1000 },
    ];
    const { sb } = mockSupabase({
      client_settings: [{ conversion_lag_days: 3 }],
      ads_account_weekly: [...weken].reverse(),
    });
    const tekst = await calculateLeadingIndicators(sb, "x");
    check("een oude week levert wel een uitkomst op", tekst.length > 0, `${tekst.length} tekens`);
    check("en bevat geen NaN", !/NaN|Infinity|undefined/.test(tekst));
  }
  {
    const { sb } = mockSupabase({ client_settings: [{ conversion_lag_days: 3 }], ads_account_weekly: [] });
    check("zonder weken een lege tekst", (await calculateLeadingIndicators(sb, "x")) === "");
  }

}

main().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });

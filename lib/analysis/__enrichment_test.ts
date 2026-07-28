// De enrichment-lagen die alle drie de SOP-prompts voeden. Geen IO; supabase is gemockt.
// Draaien: npx tsx lib/analysis/__enrichment_test.ts
//
// Elke laag vangt zijn eigen fout af en laat zijn veld dan op een lege string staan. Een lege
// string wordt in de prompt niets, dus een mislukte laag was niet te onderscheiden van een laag
// die niets te melden had. Dat is geen klein verschil: een wijzigingshistorie die niet opgehaald
// kon worden las als "er is niets gewijzigd", en een ontbrekende sectorbenchmark als "er valt
// niet te vergelijken". De fout werd wel gelogd, maar de logregel leest niemand terwijl de
// analyse wel gelezen wordt.
//
// De melding wordt aan dimensionAvailability geplakt omdat dat blok in stap 1 van alle drie de
// SOP's al wordt meegestuurd (`dimAvailText` in de routes). Zo bereikt hij de prompt zonder dat
// er twintig interpolatieplekken aangepast hoeven te worden.

import { buildEnrichmentContext, type SopType } from "./enrichment";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Een database die het begeeft: elke laag die hem aanraakt loopt stuk. */
const kapotteDb = {
  from() { throw new Error("verbinding verbroken"); },
  rpc() { throw new Error("verbinding verbroken"); },
} as unknown as SupabaseClient;

/** Een database die werkt maar niets teruggeeft. */
function legeDb(): SupabaseClient {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "gte", "lte", "lt", "gt", "in", "order", "limit", "not", "or", "is"]) {
    b[m] = () => b;
  }
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.single = () => Promise.resolve({ data: null, error: null });
  b.then = (res: (r: { data: unknown[]; error: null }) => void) => res({ data: [], error: null });
  return { from: () => b, rpc: () => Promise.resolve({ data: [], error: null }) } as unknown as SupabaseClient;
}

const opts = (sopType: SopType, supabase: SupabaseClient) => ({
  supabase, clientId: "c1", accountType: "ecommerce_roas" as const, sopType,
  analysisDate: "2026-06-30", campaignData: [], campaignMetaData: [],
});

async function main() {
  // ── Een kapotte database maakt het zichtbaar ────────────────────────────

  console.log("Als lagen niet opgehaald kunnen worden");
  {
    const r = await buildEnrichmentContext(opts("monthly", kapotteDb));

    check("er worden lagen als mislukt geregistreerd", r.failedLayers.length > 0,
      `${r.failedLayers.length} — als dit nul is, slikken de lagen hun fout zelf in`);
    // Dit is de kern: het staat in de tekst die de prompt in gaat, niet alleen in de logs.
    check("het staat in het beschikbaarheidsblok", /Niet opgehaalde context/.test(r.dimensionAvailability),
      r.dimensionAvailability.slice(0, 120));
    check("met de namen van de lagen erbij",
      r.failedLayers.every((l) => r.dimensionAvailability.includes(l)),
      `${r.failedLayers.join(", ")} vs ${r.dimensionAvailability.slice(0, 200)}`);
    // Zonder deze zin leest het model een ontbrekende laag alsnog als een leeg resultaat.
    check("en de uitleg dat leeg iets anders is dan niets",
      /betekent NIET dat daar niets te melden was/.test(r.dimensionAvailability));
    check("met de instructie om er geen uitspraak op te bouwen",
      /Doe geen uitspraak/.test(r.dimensionAvailability));

    console.log(`  gemeten: ${r.failedLayers.length} lagen melden hun uitval — ${r.failedLayers.join(", ")}`);
  }

  // ── Een werkende database meldt niets ───────────────────────────────────

  console.log("\nAls alles werkt");
  {
    const r = await buildEnrichmentContext(opts("monthly", legeDb()));
    check("geen mislukte lagen", r.failedLayers.length === 0, r.failedLayers.join(", "));
    // Anders wordt de melding ruis en gaat niemand er nog op letten.
    check("en geen melding in het blok", !/Niet opgehaalde context/.test(r.dimensionAvailability),
      r.dimensionAvailability.slice(0, 120));
  }

  // ── Voor elke SOP-soort ─────────────────────────────────────────────────

  console.log("\nOver de drie SOP-soorten");
  for (const soort of ["monthly", "weekly", "biweekly"] as SopType[]) {
    const r = await buildEnrichmentContext(opts(soort, kapotteDb));
    check(`${soort}: uitval wordt gemeld`, /Niet opgehaalde context/.test(r.dimensionAvailability),
      r.dimensionAvailability.slice(0, 80));
    // De matrix schakelt lagen uit per soort; een uitgeschakelde laag mag niet als mislukt gelden.
    check(`${soort}: alleen ingeschakelde lagen`, !r.failedLayers.includes("portfolioAnalysis") || soort === "monthly",
      r.failedLayers.join(", "));
  }

  // ── De vorm blijft bruikbaar ────────────────────────────────────────────

  console.log("\nDe uitvoer blijft bruikbaar");
  {
    const r = await buildEnrichmentContext(opts("monthly", kapotteDb));
    // Een kapotte database mag de analyse niet laten crashen; hij mag alleen minder weten.
    check("alle tekstvelden zijn strings", [r.strategicContext, r.portfolioAnalysis, r.hypothesisTracking,
      r.leadingIndicators, r.sectorBenchmarks, r.changeHistory, r.pmaxContext, r.geoContext]
      .every((v) => typeof v === "string"));
    check("geen undefined in het beschikbaarheidsblok", !/undefined|NaN/.test(r.dimensionAvailability),
      r.dimensionAvailability.slice(0, 120));
    check("failedLayers bevat geen dubbelen", new Set(r.failedLayers).size === r.failedLayers.length,
      r.failedLayers.join(", "));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Test voor de portfolio-synthese-stap (masterplan 17.15). Deterministisch; supabase en de
// LLM-call zijn gemockt.
// Draaien: npx tsx lib/analysis/__portfolio_synthesis_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchPortfolioSummaries, buildPortfolioSynthesisPrompt, parsePortfolioSynthesisOutput,
  alreadyPortfolioSynthesized, runPortfolioSynthesis, type ClientSummary, type PortfolioSynthesizedAction,
} from "./portfolio-synthesis";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface Row { output: string; analysis_date: string }
function mockSupabase(opts: {
  crossChannelByClient?: Record<string, Row | null>;
  channelByClient?: Record<string, Partial<Record<string, Row>>>; // clientId -> sopTypeKey -> row
  alreadySynthesized?: boolean;
}): SupabaseClient {
  const { crossChannelByClient = {}, channelByClient = {}, alreadySynthesized = false } = opts;
  const from = (table: string) => {
    let filters: Record<string, string> = {};
    const b = {
      select() { return b; },
      eq(col: string, val: string) { filters = { ...filters, [col]: val }; return b; },
      gte() { return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() {
        if (table === "agency_analysis_output") {
          return Promise.resolve({ data: alreadySynthesized ? { id: "existing" } : null, error: null });
        }
        if (table === "sop_analysis_output") {
          if (filters.sop_type === "cross_channel" && filters.section === "cross_channel_synthesis_v1") {
            const row = crossChannelByClient[filters.client_id] ?? null;
            return Promise.resolve({ data: row, error: null });
          }
          if (filters.section === "structured_monthly_v2") {
            const row = channelByClient[filters.client_id]?.[filters.sop_type] ?? null;
            return Promise.resolve({ data: row ?? null, error: null });
          }
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert() { return Promise.resolve({ data: null, error: null }); },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

function crossChannelRow(headline: string, actions: string[] = []): Row {
  return { output: JSON.stringify({ headline, narrative: `narratief: ${headline}`, synthesized_actions: actions.map((a) => ({ action: a })) }), analysis_date: "2026-08-01" };
}
function structuredRow(primaryThread: string, recs: string[] = []): Row {
  return { output: JSON.stringify({ final_sop: { primary_thread: primaryThread, root_cause: `oorzaak: ${primaryThread}`, recommendations: recs.map((h) => ({ handeling: h })) } }), analysis_date: "2026-08-01" };
}

async function main() {
  // ── fetchClientSummary: cross-channel-synthese heeft voorrang boven een los kanaal ──
  console.log("fetchPortfolioSummaries: voorkeur voor cross-channel-synthese");
  {
    const sb = mockSupabase({
      crossChannelByClient: { "client-a": crossChannelRow("A heeft een gesynthetiseerd verhaal") },
      channelByClient: { "client-a": { monthly: structuredRow("los Google-verhaal, zou nooit gekozen mogen worden") } },
    });
    const summaries = await fetchPortfolioSummaries(sb, [{ clientId: "client-a", clientName: "Client A" }]);
    const a = summaries.get("client-a");
    check("cross-channel-synthese wint van het losse kanaal", a?.primaryThread === "A heeft een gesynthetiseerd verhaal", JSON.stringify(a));
    check("fromCrossChannelSynthesis is true", a?.fromCrossChannelSynthesis === true);
  }

  console.log("fetchPortfolioSummaries: terugval op het beste losse kanaal zonder cross-channel-synthese");
  {
    const sb = mockSupabase({
      channelByClient: { "client-b": { monthly: structuredRow("Google-only klant") } },
    });
    const summaries = await fetchPortfolioSummaries(sb, [{ clientId: "client-b", clientName: "Client B" }]);
    const b = summaries.get("client-b");
    check("valt terug op het losse kanaal", b?.primaryThread === "Google-only klant", JSON.stringify(b));
    check("fromCrossChannelSynthesis is false", b?.fromCrossChannelSynthesis === false);
  }

  console.log("fetchPortfolioSummaries: geen enkele bron -> null, geen verzonnen klant");
  {
    const sb = mockSupabase({});
    const summaries = await fetchPortfolioSummaries(sb, [{ clientId: "client-c", clientName: "Client C" }]);
    check("null zonder enige recente data", summaries.get("client-c") === null);
  }

  // ── parsePortfolioSynthesisOutput ──
  console.log("parsePortfolioSynthesisOutput");
  const clients: ClientSummary[] = [
    { clientId: "client-a", clientName: "Broedservice", analysisDate: "2026-08-01", primaryThread: "x", rootCause: "y", topRecommendations: [], fromCrossChannelSynthesis: false },
    { clientId: "client-b", clientName: "Wobblez", analysisDate: "2026-08-01", primaryThread: "x", rootCause: "y", topRecommendations: [], fromCrossChannelSynthesis: false },
  ];
  {
    const geldig = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", recurring_patterns: ["patroon 1"], outliers: ["client-a valt op"],
      synthesized_actions: [
        { clientId: "client-a", action: "actie A", rationale: "r", priority: "hoog" },
        { clientId: "portfolio", action: "bureaubrede checklist", rationale: "r", priority: "midden" },
      ],
      markdown: "# Kop",
    });
    const r = parsePortfolioSynthesisOutput(geldig, clients);
    check("headline geparsed", r.headline === "Kop");
    check("recurring_patterns geparsed", r.recurring_patterns.length === 1);
    check("outliers geparsed", r.outliers.length === 1);
    check("actie met geldige clientId blijft staan", r.synthesized_actions.some((a) => a.clientId === "client-a"));
    check("het letterlijke woord 'portfolio' is toegestaan als clientId", r.synthesized_actions.some((a) => a.clientId === "portfolio"), JSON.stringify(r.synthesized_actions));
    check("clientName wordt erbij gezet voor de UI (niet door het model, maar bij het parsen)", r.synthesized_actions.find((a) => a.clientId === "client-a")?.clientName === "Broedservice");
    check("'portfolio' krijgt de leesbare naam 'Hele portfolio'", r.synthesized_actions.find((a) => a.clientId === "portfolio")?.clientName === "Hele portfolio");

    // Verzonnen clientId wordt gefilterd.
    const metVerzonnen = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", recurring_patterns: [], outliers: [],
      synthesized_actions: [
        { clientId: "client-a", action: "geldig", rationale: "r", priority: "hoog" },
        { clientId: "client-nooit-aangeleverd", action: "verzonnen", rationale: "r", priority: "laag" },
      ],
      markdown: "x",
    });
    const r2 = parsePortfolioSynthesisOutput(metVerzonnen, clients);
    check("verzonnen clientId wordt gefilterd", r2.synthesized_actions.length === 1, JSON.stringify(r2.synthesized_actions));

    // Model geeft de klantnaam terug i.p.v. de id (zelfde les als cross-channel-synthesis.ts).
    const metNaam = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", recurring_patterns: [], outliers: [],
      synthesized_actions: [{ clientId: "Wobblez", action: "actie via naam", rationale: "r", priority: "hoog" }],
      markdown: "x",
    });
    const r3 = parsePortfolioSynthesisOutput(metNaam, clients);
    check("klantnaam wordt teruggemapt naar de clientId", r3.synthesized_actions[0]?.clientId === "client-b", JSON.stringify(r3.synthesized_actions));

    // Code-fence en kapotte JSON.
    const metCodeFence = "```json\n" + geldig + "\n```";
    const r4 = parsePortfolioSynthesisOutput(metCodeFence, clients);
    check("code-fence wordt gestript", r4.headline === "Kop");
    const kapot = parsePortfolioSynthesisOutput("geen json {", clients);
    check("kapotte JSON valt terug op narrative-only, geen crash", kapot.narrative === "geen json {" && kapot.synthesized_actions.length === 0);
  }

  // ── buildPortfolioSynthesisPrompt ──
  console.log("buildPortfolioSynthesisPrompt");
  {
    const summaries = new Map<string, ClientSummary | null>([
      ["client-a", { clientId: "client-a", clientName: "Broedservice", analysisDate: "2026-08-01", primaryThread: "CPA loopt op", rootCause: "verzadiging", topRecommendations: ["verhoog budget"], fromCrossChannelSynthesis: false }],
      ["client-b", { clientId: "client-b", clientName: "Wobblez", analysisDate: "2026-08-01", primaryThread: "Frequency hoog", rootCause: "klein publiek", topRecommendations: ["verbreed doelgroep"], fromCrossChannelSynthesis: false }],
    ]);
    const { systemPrompt, userMessage } = buildPortfolioSynthesisPrompt(summaries);
    check("systemPrompt eist patronen bij minstens 2 klanten", systemPrompt.toLowerCase().includes("minstens twee klanten"));
    check("systemPrompt noemt de geldige clientIds expliciet", systemPrompt.includes('"client-a"') && systemPrompt.includes('"client-b"'));
    check("systemPrompt staat 'portfolio' toe als clientId", systemPrompt.includes('"portfolio"'));
    check("userMessage bevat beide klantnamen", userMessage.includes("Broedservice") && userMessage.includes("Wobblez"));
    check("userMessage bevat beide hoofddraden", userMessage.includes("CPA loopt op") && userMessage.includes("Frequency hoog"));
  }

  // ── alreadyPortfolioSynthesized ──
  console.log("alreadyPortfolioSynthesized");
  {
    check("nog niet gedaan geeft false", await alreadyPortfolioSynthesized(mockSupabase({}), "agency-1", "2026-08-17") === false);
    check("al gedaan geeft true", await alreadyPortfolioSynthesized(mockSupabase({ alreadySynthesized: true }), "agency-1", "2026-08-17") === true);
  }

  // ── runPortfolioSynthesis: skip-paden ──
  console.log("runPortfolioSynthesis: skip-paden");
  {
    const teWeinig = await runPortfolioSynthesis({
      supabase: mockSupabase({}), apiKey: "x", agencyId: "agency-1",
      clients: [{ clientId: "client-a", clientName: "Broedservice" }],
      analysisDate: "2026-08-17", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("< 2 klanten: skipped", teWeinig.skipped === true);

    const alGedaan = await runPortfolioSynthesis({
      supabase: mockSupabase({ alreadySynthesized: true }), apiKey: "x", agencyId: "agency-1",
      clients: [{ clientId: "client-a", clientName: "A" }, { clientId: "client-b", clientName: "B" }],
      analysisDate: "2026-08-17", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("al gesynthetiseerd: skipped", alGedaan.skipped === true);

    const nietGenoegVers = await runPortfolioSynthesis({
      supabase: mockSupabase({ crossChannelByClient: { "client-a": crossChannelRow("A") } }),
      apiKey: "x", agencyId: "agency-1",
      clients: [{ clientId: "client-a", clientName: "A" }, { clientId: "client-b", clientName: "B" }],
      analysisDate: "2026-08-17", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("maar 1 van de 2 heeft vers data: skipped", nietGenoegVers.skipped === true, JSON.stringify(nietGenoegVers));
  }

  // ── runPortfolioSynthesis: succesvol pad met gemockte LLM-call ──
  console.log("runPortfolioSynthesis: succesvol pad");
  {
    const mockOutput = JSON.stringify({
      headline: "Drie klanten verspillen budget op hetzelfde broad-match-patroon",
      narrative: "Zowel Broedservice als Wobblez lekken budget aan niet-commerciële zoektermen.",
      recurring_patterns: ["broad-match-verspilling komt bij beide klanten terug"],
      outliers: [],
      synthesized_actions: [{ clientId: "portfolio", action: "voer een negatieve-zoekwoorden-audit uit op alle klanten", rationale: "r", priority: "hoog" }],
      markdown: "# Drie klanten...",
    });
    let callFnAangeroepen = false;
    const mockCallFn = async (): Promise<OpenRouterResponse> => {
      callFnAangeroepen = true;
      return { output: mockOutput, model: "x-ai/grok-4.6", tokensUsed: 555, promptTokens: 400, completionTokens: 155, latencyMs: 300, retries: 0, cachedPromptTokens: 0, parseStatus: "ok" };
    };
    const sb = mockSupabase({
      crossChannelByClient: { "client-a": crossChannelRow("Broedservice-verhaal") },
      channelByClient: { "client-b": { monthly: structuredRow("Wobblez-verhaal") } },
    });
    const result = await runPortfolioSynthesis({
      supabase: sb, apiKey: "x", agencyId: "agency-1",
      clients: [{ clientId: "client-a", clientName: "Broedservice" }, { clientId: "client-b", clientName: "Wobblez" }],
      analysisDate: "2026-08-17", periodStart: "2026-07-01", periodEnd: "2026-07-31",
      callFn: mockCallFn,
    });
    check("niet geskipt", result.skipped === false);
    check("de gemockte LLM-call is aangeroepen", callFnAangeroepen);
    if (!result.skipped) {
      check("recurring_patterns bevat het gevonden patroon", result.result.recurring_patterns.length === 1);
      check("portfolio-actie blijft staan", (result.result.synthesized_actions[0] as PortfolioSynthesizedAction)?.clientId === "portfolio");
      check("clients_used bevat beide klanten", result.result.clients_used.length === 2);
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

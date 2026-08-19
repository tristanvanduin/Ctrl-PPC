// Test voor de kanaaloverstijgende synthese voor weekly/biweekly (masterplan 17.30).
// Deterministisch; supabase en de LLM-call zijn gemockt.
// Draaien: npx tsx lib/analysis/__cross_channel_synthesis_lite_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchLiteChannelSummaries, liteAlreadySynthesized, buildLiteSynthesisPrompt, runLiteCrossChannelSynthesis,
} from "./cross-channel-synthesis-lite";
import type { SopChannel } from "./sop-channel-config";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface Finding { severity: string; description: string }
interface Rec { hypothesis: string; expected_result: string; ice_total: number }

function mockSupabase(opts: {
  // sopType -> "heeft dit kanaal deze cyclus een afgeronde run?" (section="full" bestaat)
  fullByType?: Partial<Record<string, boolean>>;
  findingsByType?: Partial<Record<string, Finding[]>>;
  recsByType?: Partial<Record<string, Rec[]>>;
  synthesisExists?: boolean;
}): SupabaseClient {
  const { fullByType = {}, findingsByType = {}, recsByType = {}, synthesisExists = false } = opts;
  const from = (table: string) => {
    let filters: Record<string, string> = {};
    const arrayResult = (rows: unknown[]) => Promise.resolve({ data: rows, error: null });
    const b = {
      select() { return b; },
      eq(col: string, val: string) { filters = { ...filters, [col]: val }; return b; },
      maybeSingle() {
        if (table !== "sop_analysis_output") return Promise.resolve({ data: null, error: null });
        if (filters.section === "full") {
          const heeft = fullByType[filters.sop_type] ?? false;
          return Promise.resolve({ data: heeft ? { id: "x" } : null, error: null });
        }
        // liteAlreadySynthesized: sectionFor(cadence) is nooit "full"
        return Promise.resolve({ data: synthesisExists ? { id: "existing" } : null, error: null });
      },
      // sop_insights/sop_recommendations eindigen zonder .maybeSingle() -- awaitable via .then().
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === "sop_insights") return resolve(arrayResult(findingsByType[filters.sop_type] ?? []) as never);
        if (table === "sop_recommendations") return resolve(arrayResult(recsByType[filters.sop_type] ?? []) as never);
        return resolve({ data: [], error: null });
      },
      // saveAnalysisOutputSection() zonder opts.select: await de upsert-query direct.
      upsert() { return { then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }) }; },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

async function main() {
  console.log("liteAlreadySynthesized");
  {
    const nog = await liteAlreadySynthesized(mockSupabase({ synthesisExists: false }), "demo-greentech", "weekly", "2026-08-18");
    check("nog niet gedaan geeft false", nog === false);
    const wel = await liteAlreadySynthesized(mockSupabase({ synthesisExists: true }), "demo-greentech", "weekly", "2026-08-18");
    check("al gedaan geeft true", wel === true);
  }

  console.log("\nfetchLiteChannelSummaries: haalt findings/recommendations op per kanaal, null als section=full ontbreekt");
  {
    const sb = mockSupabase({
      fullByType: { weekly: true, meta_weekly: false },
      findingsByType: {
        weekly: [
          { severity: "laag", description: "kleine afwijking" },
          { severity: "kritiek", description: "CPA schiet omhoog" },
          { severity: "medium", description: "CTR daalt licht" },
        ],
      },
      recsByType: {
        weekly: [
          { hypothesis: "verlaag bod", expected_result: "CPA daalt", ice_total: 5 },
          { hypothesis: "sluit zoekterm uit", expected_result: "minder waste", ice_total: 8 },
        ],
      },
    });
    const summaries = await fetchLiteChannelSummaries(sb, "demo-greentech", ["google", "meta"], "weekly", "2026-08-18");
    const google = summaries.get("google_ads");
    check("Google-samenvatting is opgehaald", google !== null && google !== undefined);
    check("kritiek-finding staat vooraan (severity-sortering)", google?.topFindings[0]?.severity === "kritiek", JSON.stringify(google?.topFindings));
    check("aanbeveling met hoogste ice_total staat vooraan", google?.topRecommendations[0]?.hypothesis === "sluit zoekterm uit", JSON.stringify(google?.topRecommendations));
    check("Meta is null (section=full ontbreekt deze cyclus)", summaries.get("meta_ads") === null);
  }

  console.log("\nbuildLiteSynthesisPrompt: bevat beide kanalen, ander taalgebruik dan monthly (perspectief, geen root-cause-eis)");
  {
    const summaries = new Map<SopChannel, { channel: SopChannel; topFindings: { severity: string; description: string }[]; topRecommendations: { hypothesis: string; expectedResult: string }[] }>([
      ["google_ads", { channel: "google_ads", topFindings: [{ severity: "kritiek", description: "CPA schiet omhoog" }], topRecommendations: [{ hypothesis: "verlaag bod", expectedResult: "CPA daalt" }] }],
      ["meta_ads", { channel: "meta_ads", topFindings: [{ severity: "hoog", description: "Frequency te hoog" }], topRecommendations: [] }],
    ]);
    const { systemPrompt, userMessage } = buildLiteSynthesisPrompt(summaries, "weekly");
    check("systemPrompt noemt beide kanaalnamen", systemPrompt.includes("SEA") && systemPrompt.includes("Meta Ads"), systemPrompt);
    check("systemPrompt vraagt om perspectief (marktbreed vs. kanaal-specifiek)", systemPrompt.toLowerCase().includes("perspectief"));
    check("userMessage bevat de bevindingen van beide kanalen", userMessage.includes("CPA schiet omhoog") && userMessage.includes("Frequency te hoog"));
  }

  console.log("\nrunLiteCrossChannelSynthesis: skip-paden");
  {
    const teWeinigKanalen = await runLiteCrossChannelSynthesis({
      supabase: mockSupabase({}), apiKey: "x", clientId: "demo-greentech", cadence: "weekly",
      beschikbareKanalen: ["google"], analysisDate: "2026-08-18", periodStart: "2026-08-04", periodEnd: "2026-08-18",
    });
    check("< 2 kanalen: skipped", teWeinigKanalen.skipped === true);

    const alGedaan = await runLiteCrossChannelSynthesis({
      supabase: mockSupabase({ synthesisExists: true }), apiKey: "x", clientId: "demo-greentech", cadence: "weekly",
      beschikbareKanalen: ["google", "meta"], analysisDate: "2026-08-18", periodStart: "2026-08-04", periodEnd: "2026-08-18",
    });
    check("al gesynthetiseerd (dit cadence-slot): skipped", alGedaan.skipped === true);

    const nogNietAlleKlaar = await runLiteCrossChannelSynthesis({
      supabase: mockSupabase({ fullByType: { weekly: true, meta_weekly: false } }), apiKey: "x", clientId: "demo-greentech", cadence: "weekly",
      beschikbareKanalen: ["google", "meta"], analysisDate: "2026-08-18", periodStart: "2026-08-04", periodEnd: "2026-08-18",
    });
    check("niet alle kanalen klaar: skipped, wacht i.p.v. gedeeltelijk te draaien", nogNietAlleKlaar.skipped === true);
  }

  console.log("\nrunLiteCrossChannelSynthesis: succesvol pad met gemockte LLM-call, weekly EN biweekly hebben een eigen slot");
  {
    const mockLlmOutput = JSON.stringify({
      headline: "CPA-stijging is marktbreed, geen paniek",
      narrative: "Beide kanalen zien dezelfde week een vergelijkbare CPA-stijging op hetzelfde publiek.",
      contradictions: [],
      synthesized_actions: [{ channel: "meta_ads", action: "wacht een week af voor budgetwijziging", rationale: "patroon lijkt marktbreed, niet kanaal-specifiek", priority: "midden" }],
      markdown: "# CPA-stijging is marktbreed\n\n...",
    });
    const captured: { label: string | null } = { label: null };
    const mockCallFn = async (req: { label?: string }): Promise<OpenRouterResponse> => {
      captured.label = req.label ?? null;
      return { output: mockLlmOutput, model: "x-ai/grok-4.6", tokensUsed: 900, promptTokens: 700, completionTokens: 200, latencyMs: 300, retries: 0, cachedPromptTokens: 0, parseStatus: "ok" };
    };
    const sb = mockSupabase({
      fullByType: { weekly: true, meta_weekly: true },
      findingsByType: { weekly: [{ severity: "hoog", description: "CPA +30%" }], meta_weekly: [{ severity: "hoog", description: "CPA +28%" }] },
      recsByType: { weekly: [], meta_weekly: [] },
    });
    const result = await runLiteCrossChannelSynthesis({
      supabase: sb, apiKey: "x", clientId: "demo-greentech", cadence: "weekly",
      beschikbareKanalen: ["google", "meta"], analysisDate: "2026-08-18", periodStart: "2026-08-04", periodEnd: "2026-08-18",
      callFn: mockCallFn,
    });
    check("niet geskipt: alle gates gehaald", result.skipped === false);
    check("het label identificeert de cadence (weekly, niet monthly)", captured.label?.includes("weekly") ?? false, String(captured.label));
    if (!result.skipped) {
      check("headline uit de synthese", result.result.headline.includes("marktbreed"));
      check("tokensUsed komt uit de response", result.tokensUsed === 900);
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

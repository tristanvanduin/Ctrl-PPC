// Test voor de kanaaloverstijgende synthese-stap (masterplan 17.12). Deterministisch; supabase en
// de LLM-call zijn gemockt.
// Draaien: npx tsx lib/analysis/__cross_channel_synthesis_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readyForSynthesis, parseSynthesisOutput, buildSynthesisPrompt, alreadySynthesized,
  fetchChannelSummaries, runCrossChannelSynthesis, type SynthesizedAction,
} from "./cross-channel-synthesis";
import type { SopChannel } from "./sop-channel-config";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface StructuredRow { output: string }
function mockSupabase(opts: {
  structuredByChannel?: Partial<Record<string, StructuredRow | null>>;
  crossChannelSignals?: string | null;
  crossChannelSignalsDate?: string;
  synthesisExists?: boolean;
}): SupabaseClient {
  const { structuredByChannel = {}, crossChannelSignals = null, crossChannelSignalsDate = "2026-08-01", synthesisExists = false } = opts;
  const from = (table: string) => {
    let filters: Record<string, string> = {};
    const b = {
      select() { return b; },
      eq(col: string, val: string) { filters = { ...filters, [col]: val }; return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() {
        if (table !== "sop_analysis_output") return Promise.resolve({ data: null, error: null });
        if (filters.section === "structured_monthly_v2") {
          const row = structuredByChannel[filters.sop_type] ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if (filters.section === "cross_channel_v1") {
          return Promise.resolve({ data: crossChannelSignals ? { output: crossChannelSignals, analysis_date: crossChannelSignalsDate } : null, error: null });
        }
        if (filters.section === "cross_channel_synthesis_v1") {
          return Promise.resolve({ data: synthesisExists ? { id: "existing" } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert() { return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }; },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

function structuredOutputFor(primaryThread: string, recs: string[] = []): string {
  return JSON.stringify({
    final_sop: { primary_thread: primaryThread, root_cause: `oorzaak van ${primaryThread}`, recommendations: recs.map((h) => ({ handeling: h })) },
    executive_markdown: `# ${primaryThread}`,
  });
}

async function main() {
  // ── readyForSynthesis: puur, geen IO ──
  console.log("readyForSynthesis");
  {
    check("minder dan 2 kanalen is nooit klaar", readyForSynthesis(new Map([["google_ads", null] as const])) === false);
    const alleKlaar = new Map<SopChannel, unknown>([
      ["google_ads", { channel: "google_ads" }] as never,
      ["meta_ads", { channel: "meta_ads" }] as never,
    ]);
    check("2 kanalen, allebei klaar", readyForSynthesis(alleKlaar as never) === true);
    const éénOntbreekt = new Map<SopChannel, unknown>([
      ["google_ads", { channel: "google_ads" }] as never,
      ["meta_ads", null],
    ]);
    check("1 van de 2 nog niet klaar: niet klaar voor synthese", readyForSynthesis(éénOntbreekt as never) === false);
  }

  // ── parseSynthesisOutput ──
  console.log("parseSynthesisOutput");
  {
    const geldig = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", contradictions: ["tegenspraak 1"],
      synthesized_actions: [{ channel: "meta_ads", action: "doe iets", rationale: "reden", priority: "hoog" }],
      markdown: "# Kop\n\nVerhaal",
    });
    const r = parseSynthesisOutput(geldig, ["google_ads", "meta_ads"]);
    check("headline geparsed", r.headline === "Kop");
    check("narrative geparsed", r.narrative === "Verhaal");
    check("contradictions geparsed", r.contradictions.length === 1);
    check("actie met geldig kanaal blijft staan", r.synthesized_actions.length === 1);

    // Verzonnen kanaal (niet in de aangeleverde set) hoort eruit gefilterd te worden.
    const metVerzonnenKanaal = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", contradictions: [],
      synthesized_actions: [
        { channel: "meta_ads", action: "geldig", rationale: "r", priority: "hoog" },
        { channel: "tiktok_ads", action: "verzonnen kanaal", rationale: "r", priority: "laag" },
      ],
      markdown: "x",
    });
    const r2 = parseSynthesisOutput(metVerzonnenKanaal, ["google_ads", "meta_ads"]);
    check("verzonnen kanaal wordt gefilterd", r2.synthesized_actions.length === 1, JSON.stringify(r2.synthesized_actions));
    check("het geldige kanaal blijft staan", (r2.synthesized_actions[0] as SynthesizedAction).channel === "meta_ads");

    // Code-fence rondom JSON (zoals bij jsonMode soms gebeurt) moet gestript worden.
    const metCodeFence = "```json\n" + geldig + "\n```";
    const r3 = parseSynthesisOutput(metCodeFence, ["google_ads", "meta_ads"]);
    check("code-fence wordt gestript vóór het parsen", r3.headline === "Kop");

    // 17 augustus 2026, live testrun (demo-greentech): het model schreef de leesbare headerLabel
    // ("SEA", "Meta Ads") in plaats van de interne sleutel in `channel` -- de oude, strikte check
    // zag dat als verzonnen en filterde ALLE acties weg, terwijl de markdown ze wél toonde.
    const metLeesbareLabels = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", contradictions: [],
      synthesized_actions: [
        { channel: "SEA", action: "budgetknip", rationale: "r", priority: "hoog" },
        { channel: "Meta Ads", action: "landingspagina fixen", rationale: "r", priority: "hoog" },
        { channel: "meta ads", action: "hoofdletterongevoelig moet ook werken", rationale: "r", priority: "laag" },
      ],
      markdown: "x",
    });
    const r5 = parseSynthesisOutput(metLeesbareLabels, ["google_ads", "meta_ads"]);
    check("headerLabel 'SEA' wordt teruggemapt naar 'google_ads'", r5.synthesized_actions.some((a) => a.channel === "google_ads"), JSON.stringify(r5.synthesized_actions));
    check("headerLabel 'Meta Ads' wordt teruggemapt naar 'meta_ads'", r5.synthesized_actions.filter((a) => a.channel === "meta_ads").length === 2, JSON.stringify(r5.synthesized_actions));
    check("geen enkele actie verloren gegaan door de labelvorm", r5.synthesized_actions.length === 3, JSON.stringify(r5.synthesized_actions));

    // Kapotte JSON: gedegradeerde fallback, geen crash.
    const kapot = "dit is geen json { headline:";
    const r4 = parseSynthesisOutput(kapot, ["google_ads"]);
    check("kapotte JSON crasht niet en valt terug op narrative-only", r4.narrative === kapot);
    check("fallback heeft lege actielijst", r4.synthesized_actions.length === 0);
  }

  // ── buildSynthesisPrompt: kanaalscope en signalen zitten in de prompt ──
  console.log("buildSynthesisPrompt");
  {
    const summaries = new Map<SopChannel, { channel: SopChannel; primaryThread: string; rootCause: string; topRecommendations: string[]; executiveMarkdown: string }>([
      ["google_ads", { channel: "google_ads", primaryThread: "CPA loopt op", rootCause: "verzadiging", topRecommendations: ["verhoog budget"], executiveMarkdown: "" }],
      ["meta_ads", { channel: "meta_ads", primaryThread: "Frequency te hoog", rootCause: "klein publiek", topRecommendations: ["verbreed doelgroep"], executiveMarkdown: "" }],
    ]);
    const { systemPrompt, userMessage } = buildSynthesisPrompt(summaries, "## Cross-channel-signalen\n\nDubbele warme pool.", "2026-07-01");
    check("systemPrompt noemt beide kanaalnamen", systemPrompt.includes("SEA") && systemPrompt.includes("Meta Ads"), systemPrompt);
    check("systemPrompt eist één samenhangend verhaal, geen los-per-kanaal", systemPrompt.toLowerCase().includes("synthese"));
    check("systemPrompt verbiedt een verzonnen kanaal", systemPrompt.toLowerCase().includes("verzin nooit een kanaal"));
    check("userMessage bevat beide primary threads", userMessage.includes("CPA loopt op") && userMessage.includes("Frequency te hoog"));
    check("userMessage bevat de deterministische signalen", userMessage.includes("Dubbele warme pool"));
    // Geen valse versheid: de datum van de laatst opgeslagen cross_channel_v1-rij moet in de
    // prompt staan, want die rij kan van een eerdere cyclus zijn dan deze synthese.
    check("userMessage meldt de datum van de signalen (geen valse versheid)", userMessage.includes("2026-07-01") && userMessage.toLowerCase().includes("eerdere cyclus"));
    const { userMessage: zonderDatum } = buildSynthesisPrompt(summaries, "## Cross-channel-signalen\n\nDubbele warme pool.", null);
    check("zonder datum blijft de kop neutraal (geen gegokte datum)", !zonderDatum.toLowerCase().includes("eerdere cyclus") && zonderDatum.includes("Deterministische cross-channel-signalen"));
  }

  // ── alreadySynthesized ──
  console.log("alreadySynthesized");
  {
    const nog = await alreadySynthesized(mockSupabase({ synthesisExists: false }), "demo-greentech", "2026-08-01");
    check("nog niet gedaan geeft false", nog === false);
    const wel = await alreadySynthesized(mockSupabase({ synthesisExists: true }), "demo-greentech", "2026-08-01");
    check("al gedaan geeft true", wel === true);
  }

  // ── fetchChannelSummaries: haalt structured_monthly_v2 op per kanaal, null als die ontbreekt ──
  console.log("fetchChannelSummaries");
  {
    const sb = mockSupabase({
      structuredByChannel: {
        monthly: { output: structuredOutputFor("Google-verhaal", ["actie A"]) },
        meta_monthly: null, // Meta heeft deze cyclus nog niet afgerond
      },
    });
    const summaries = await fetchChannelSummaries(sb, "demo-greentech", ["google", "meta"], "2026-08-01");
    check("Google-samenvatting is opgehaald", summaries.get("google_ads")?.primaryThread === "Google-verhaal");
    check("Meta is null (nog niet afgerond)", summaries.get("meta_ads") === null);
  }

  // ── runCrossChannelSynthesis: de skip-paden, zonder een echte LLM-call nodig te hebben ──
  console.log("runCrossChannelSynthesis: skip-paden");
  {
    const teWeinigKanalen = await runCrossChannelSynthesis({
      supabase: mockSupabase({}), apiKey: "x", clientId: "demo-greentech",
      beschikbareKanalen: ["google"], analysisDate: "2026-08-01", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("< 2 kanalen: skipped", teWeinigKanalen.skipped === true);
    check("reden noemt het aantal kanalen", teWeinigKanalen.skipped && teWeinigKanalen.reason.includes("2 gekoppelde"));

    const alGedaan = await runCrossChannelSynthesis({
      supabase: mockSupabase({ synthesisExists: true }), apiKey: "x", clientId: "demo-greentech",
      beschikbareKanalen: ["google", "meta"], analysisDate: "2026-08-01", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("al gesynthetiseerd: skipped, geen dubbele call", alGedaan.skipped === true);

    const nogNietAlleKlaar = await runCrossChannelSynthesis({
      supabase: mockSupabase({ structuredByChannel: { monthly: { output: structuredOutputFor("x") }, meta_monthly: null } }),
      apiKey: "x", clientId: "demo-greentech",
      beschikbareKanalen: ["google", "meta"], analysisDate: "2026-08-01", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("niet alle kanalen klaar: skipped, wacht i.p.v. gedeeltelijk te draaien", nogNietAlleKlaar.skipped === true);
    check("reden noemt het ontbrekende kanaal", nogNietAlleKlaar.skipped && nogNietAlleKlaar.reason.includes("Meta"), nogNietAlleKlaar.skipped ? nogNietAlleKlaar.reason : "");
  }

  // ── runCrossChannelSynthesis: de echte call, met een gemockte callFn (geen netwerk nodig) ──
  console.log("runCrossChannelSynthesis: succesvol pad met gemockte LLM-call");
  {
    const mockLlmOutput = JSON.stringify({
      headline: "Beide kanalen concurreren om dezelfde koude doelgroep",
      narrative: "Google en Meta targeten grotendeels hetzelfde koude publiek zonder afstemming.",
      contradictions: [],
      synthesized_actions: [{ channel: "meta_ads", action: "verleg budget naar retargeting", rationale: "Google dekt prospecting al", priority: "hoog" }],
      markdown: "# Beide kanalen concurreren\n\n...",
    });
    let callFnAangeroepenMet: { model?: string; jsonMode?: boolean } | null = null;
    const mockCallFn = async (): Promise<OpenRouterResponse> => {
      callFnAangeroepenMet = { model: "x-ai/grok-4.6", jsonMode: true };
      return {
        output: mockLlmOutput, model: "x-ai/grok-4.6", tokensUsed: 1234, promptTokens: 1000, completionTokens: 234,
        latencyMs: 500, retries: 0, cachedPromptTokens: 0, parseStatus: "ok",
      };
    };
    const sb = mockSupabase({
      structuredByChannel: {
        monthly: { output: structuredOutputFor("CPA loopt op", ["verhoog tCPA"]) },
        meta_monthly: { output: structuredOutputFor("Frequency te hoog", ["verbreed doelgroep"]) },
      },
      crossChannelSignals: "## Cross-channel-signalen\n\nDubbele warme pool.",
    });
    const result = await runCrossChannelSynthesis({
      supabase: sb, apiKey: "x", clientId: "demo-greentech",
      beschikbareKanalen: ["google", "meta"], analysisDate: "2026-08-01", periodStart: "2026-07-01", periodEnd: "2026-07-31",
      callFn: mockCallFn,
    });
    check("niet geskipt: alle gates gehaald", result.skipped === false);
    check("de gemockte LLM-call is echt aangeroepen", callFnAangeroepenMet !== null);
    if (!result.skipped) {
      check("headline uit de synthese", result.result.headline.includes("koude doelgroep"));
      check("synthesized action met geldig kanaal", result.result.synthesized_actions.length === 1);
      check("channels_used bevat beide kanalen", result.result.channels_used.length === 2);
      check("tokensUsed komt uit de response", result.tokensUsed === 1234);
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

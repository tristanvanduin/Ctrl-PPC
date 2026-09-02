// Test voor de portfolio-synthese-stap (masterplan 17.15), herbouwd 2 september 2026.
// Deterministisch: FakeSupabase (lib/decision/__fake_supabase.ts) en een geïnjecteerde callFn.
// Draaien: npx tsx lib/analysis/__portfolio_synthesis_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import {
  fetchPortfolioSummaries, buildPortfolioSynthesisPrompt, parsePortfolioSynthesisOutput,
  alreadyPortfolioSynthesized, runPortfolioSynthesis, type ClientSummary,
} from "./portfolio-synthesis";
import { DataLaagFout } from "./db-veilig";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const VANDAAG = "2026-08-17";
const BUREAU = "agency-1";

function crossChannelRij(clientId: string, headline: string, analysisDate = "2026-08-10", actions: string[] = []) {
  return {
    client_id: clientId, sop_type: "cross_channel", section: "cross_channel_synthesis_v1", analysis_date: analysisDate,
    output: JSON.stringify({ headline, narrative: `narratief: ${headline}`, synthesized_actions: actions.map((a) => ({ action: a })) }),
  };
}
function structuredRij(clientId: string, sopType: string, primaryThread: string, analysisDate = "2026-08-01", recs: string[] = []) {
  return {
    client_id: clientId, sop_type: sopType, section: "structured_monthly_v2", analysis_date: analysisDate,
    output: JSON.stringify({ final_sop: { primary_thread: primaryThread, root_cause: `oorzaak: ${primaryThread}`, recommendations: recs.map((h) => ({ handeling: h })) } }),
  };
}
function portfolioRij(analysisDate: string) {
  return { agency_id: BUREAU, section: "portfolio_synthesis_v1", analysis_date: analysisDate, output: "{}" };
}
/** Telt de queries per tabel, om te bewijzen dat de ophaling gebundeld is. */
function tellend(sb: FakeSupabase): Record<string, number> {
  const tellingen: Record<string, number> = {};
  const orig = sb.from.bind(sb);
  sb.from = (t: string) => { tellingen[t] = (tellingen[t] ?? 0) + 1; return orig(t); };
  return tellingen;
}
function llm(output: string): () => Promise<OpenRouterResponse> {
  return async () => ({ output, model: "fake-model", tokensUsed: 555, promptTokens: 400, completionTokens: 155, latencyMs: 300, retries: 0, cachedPromptTokens: 0, parseStatus: "ok" });
}
const KLANTEN = [{ clientId: "client-a", clientName: "Broedservice" }, { clientId: "client-b", clientName: "Wobblez" }];
function run(sb: FakeSupabase, extra: Partial<Parameters<typeof runPortfolioSynthesis>[0]> = {}) {
  return runPortfolioSynthesis({
    supabase: sb as never, apiKey: "x", agencyId: BUREAU, clients: KLANTEN,
    analysisDate: VANDAAG, periodStart: "2026-07-01", periodEnd: "2026-07-31", ...extra,
  });
}

async function main() {
  console.log("fetchPortfolioSummaries: gebundeld, voorkeur voor cross-channel-synthese, terugval op nieuwste kanaal");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [
      crossChannelRij("client-a", "A heeft een gesynthetiseerd verhaal"),
      structuredRij("client-a", "monthly", "los Google-verhaal, mag nooit winnen"),
      structuredRij("client-b", "meta_monthly", "Meta-only klant", "2026-08-03"),
      structuredRij("client-b", "monthly", "oudere Google-run", "2026-07-20"),
      structuredRij("client-d", "monthly", "te oud", "2026-06-01"),
    ]);
    sb.seed("client_settings", [{ client_id: "client-a", bedrijfsmodel: "b2c", niche: null }]);
    const tellingen = tellend(sb);
    const klanten = [...KLANTEN, { clientId: "client-c", clientName: "C" }, { clientId: "client-d", clientName: "D" }];
    const f = await fetchPortfolioSummaries(sb as never, klanten, VANDAAG);
    check("cross-channel-synthese wint van het losse kanaal", f.summaries.get("client-a")?.primaryThread === "A heeft een gesynthetiseerd verhaal");
    check("fromCrossChannelSynthesis is true", f.summaries.get("client-a")?.fromCrossChannelSynthesis === true);
    check("bedrijfsmodel komt uit client_settings", f.summaries.get("client-a")?.bedrijfsmodel === "b2c");
    check("zonder synthese: het nieuwste kanaal, over alle kanalen heen (Meta wint van oudere Google)", f.summaries.get("client-b")?.primaryThread === "Meta-only klant" && f.summaries.get("client-b")?.fromCrossChannelSynthesis === false);
    check("klant zonder enige bron: null", f.summaries.get("client-c") === null);
    check("klant met alleen een run buiten het versheidsvenster: null", f.summaries.get("client-d") === null);
    check("hoogstens 1 query op client_settings en 2 op sop_analysis_output, ongeacht het aantal klanten", tellingen.client_settings === 1 && tellingen.sop_analysis_output === 2, JSON.stringify(tellingen));

    const kapot = new FakeSupabase();
    kapot.faalOp("client_settings", "relation does not exist");
    let fout: unknown = null;
    try { await fetchPortfolioSummaries(kapot as never, KLANTEN, VANDAAG); } catch (e) { fout = e; }
    check("een queryfout gooit DataLaagFout", fout instanceof DataLaagFout, String(fout));
  }

  console.log("parsePortfolioSynthesisOutput");
  const clients: ClientSummary[] = [
    { clientId: "client-a", clientName: "Broedservice", analysisDate: "2026-08-01", primaryThread: "x", rootCause: "y", topRecommendations: [], bedrijfsmodel: null, niche: null, fromCrossChannelSynthesis: false },
    { clientId: "client-b", clientName: "Wobblez", analysisDate: "2026-08-01", primaryThread: "x", rootCause: "y", topRecommendations: [], bedrijfsmodel: null, niche: null, fromCrossChannelSynthesis: false },
  ];
  {
    const geldig = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", recurring_patterns: ["patroon 1"], outliers: ["client-a valt op"],
      synthesized_actions: [
        { clientId: "client-a", action: "actie A", rationale: "r", priority: "hoog" },
        { clientId: "portfolio", action: "bureaubrede checklist", rationale: "r", priority: "URGENT" },
        { clientId: "Wobblez", action: "actie via naam", rationale: "r", priority: "laag" },
        { clientId: "client-nooit-aangeleverd", action: "verzonnen", rationale: "r", priority: "laag" },
      ],
      markdown: "# Kop",
    });
    const r = parsePortfolioSynthesisOutput(geldig, clients);
    check("parseOk en velden geparsed", r.parseOk && r.result.headline === "Kop" && r.result.recurring_patterns.length === 1 && r.result.outliers.length === 1);
    check("'portfolio' is toegestaan en krijgt 'Hele portfolio'", r.result.synthesized_actions.find((a) => a.clientId === "portfolio")?.clientName === "Hele portfolio");
    check("onbekende prioriteit wordt 'midden'", r.result.synthesized_actions.find((a) => a.clientId === "portfolio")?.priority === "midden");
    check("klantnaam wordt teruggemapt naar de clientId", r.result.synthesized_actions.some((a) => a.clientId === "client-b"));
    check("verzonnen clientId wordt gefilterd", r.result.synthesized_actions.length === 3, JSON.stringify(r.result.synthesized_actions));
    const kapot = parsePortfolioSynthesisOutput("geen json {", clients);
    check("kapotte JSON: parseOk false, geen crash", kapot.parseOk === false && kapot.result.narrative === "geen json {");
  }

  console.log("buildPortfolioSynthesisPrompt");
  {
    const summaries = new Map<string, ClientSummary | null>([
      ["client-a", { ...clients[0], primaryThread: "CPA loopt op", rootCause: "verzadiging", bedrijfsmodel: "b2c" }],
      ["client-b", { ...clients[1], primaryThread: "Frequency hoog", rootCause: "klein publiek" }],
    ]);
    const { systemPrompt, userMessage } = buildPortfolioSynthesisPrompt(summaries);
    check("systemPrompt eist patronen bij minstens 2 klanten", systemPrompt.toLowerCase().includes("minstens twee klanten"));
    check("systemPrompt verbiedt ongegronde cijfers", systemPrompt.toLowerCase().includes("percentages en bedragen"));
    check("userMessage bevat beide klantnamen en hoofddraden", userMessage.includes("Broedservice") && userMessage.includes("Wobblez") && userMessage.includes("CPA loopt op"));
    check("userMessage toont bedrijfsmodel en 'onbekend'", userMessage.includes("b2c") && userMessage.includes("onbekend"));
  }

  console.log("alreadyPortfolioSynthesized: dekt het nieuwste klantverhaal?");
  {
    check("zonder rij: false", (await alreadyPortfolioSynthesized(new FakeSupabase() as never, BUREAU, "2026-08-10")) === false);
    const nieuwer = new FakeSupabase(); nieuwer.seed("agency_analysis_output", [portfolioRij("2026-08-12")]);
    check("synthese van ná het nieuwste verhaal: true", (await alreadyPortfolioSynthesized(nieuwer as never, BUREAU, "2026-08-10")) === true);
    const ouder = new FakeSupabase(); ouder.seed("agency_analysis_output", [portfolioRij("2026-08-01")]);
    check("synthese van vóór het nieuwste verhaal: false", (await alreadyPortfolioSynthesized(ouder as never, BUREAU, "2026-08-10")) === false);
  }

  console.log("runPortfolioSynthesis: skip-paden");
  {
    const teWeinig = await run(new FakeSupabase(), { clients: [KLANTEN[0]] });
    check("< 2 klanten: skipped", teWeinig.skipped === true);
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [crossChannelRij("client-a", "A")]);
    const nietVers = await run(sb);
    check("maar 1 van de 2 met vers verhaal: skipped, reden noemt de klant zonder", nietVers.skipped === true && nietVers.reason.includes("Wobblez"), nietVers.skipped ? nietVers.reason : "");
    const sb2 = new FakeSupabase();
    sb2.seed("sop_analysis_output", [crossChannelRij("client-a", "A"), structuredRij("client-b", "monthly", "B")]);
    sb2.seed("agency_analysis_output", [portfolioRij("2026-08-12")]);
    const gedaan = await run(sb2);
    check("bestaande synthese dekt het nieuwste verhaal: skipped", gedaan.skipped === true && gedaan.reason.includes("dekt"));
  }

  console.log("runPortfolioSynthesis: succes, cijferpoort en opslag; onleesbaar niet opgeslagen");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [crossChannelRij("client-a", "Broedservice lekt €120 aan broad match"), structuredRij("client-b", "monthly", "Wobblez-verhaal")]);
    const output = JSON.stringify({
      headline: "Twee klanten verspillen budget op hetzelfde broad-match-patroon",
      narrative: "Zowel Broedservice (€120) als Wobblez lekken budget; dat is 40% van de spend.",
      recurring_patterns: ["broad-match-verspilling komt bij beide klanten terug"],
      outliers: [],
      synthesized_actions: [{ clientId: "portfolio", action: "voer een negatieve-zoekwoorden-audit uit", rationale: "r", priority: "hoog" }],
      markdown: "# Twee klanten...",
    });
    const result = await run(sb, { callFn: llm(output) });
    check("niet geskipt", result.skipped === false);
    if (!result.skipped) {
      check("gegrond bedrag blijft, ongegrond percentage gemarkeerd", result.result.narrative.includes("€120") && result.result.narrative.includes("[percentage niet uit data]"));
      check("ongegronde_cijfers noemt 40", JSON.stringify(result.result.ongegronde_cijfers) === "[40]");
      check("dekking noemt beide klanten en het nieuwste verhaal", result.dekking.klantenMetVersVerhaal.length === 2 && result.dekking.nieuwsteVerhaal === "2026-08-10");
      check("opgeslagen in agency_analysis_output", (sb.tables["agency_analysis_output"] ?? []).length === 1);
    }
    const sb2 = new FakeSupabase();
    sb2.seed("sop_analysis_output", [crossChannelRij("client-a", "A"), structuredRij("client-b", "monthly", "B")]);
    let fout: unknown = null;
    try { await run(sb2, { callFn: llm("geen json") }); } catch (e) { fout = e; }
    check("onleesbaar gooit en slaat niets op", fout instanceof Error && fout.message.includes("onleesbaar") && (sb2.tables["agency_analysis_output"] ?? []).length === 0);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

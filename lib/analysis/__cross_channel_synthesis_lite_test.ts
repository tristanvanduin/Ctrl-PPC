// Test voor de kanaaloverstijgende synthese voor weekly/biweekly (masterplan 17.30), herbouwd
// 2 september 2026. Deterministisch: FakeSupabase (lib/decision/__fake_supabase.ts) en een
// geïnjecteerde callFn. De severity-fixtures zijn de ECHTE waarden van sop_insights.severity
// (SeverityEnum, Engels) -- de vorige test fabriceerde Nederlandse labels en slaagde daardoor
// terwijl productie andersom sorteerde.
// Draaien: npx tsx lib/analysis/__cross_channel_synthesis_lite_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import {
  fetchLiteChannelSummaries, liteAlreadySynthesized, buildLiteSynthesisPrompt, runLiteCrossChannelSynthesis, SEVERITY_RANK,
} from "./cross-channel-synthesis-lite";
import { SeverityEnum } from "@/lib/schema/analysis-schema";
import { DataLaagFout } from "./db-veilig";
import type { SopChannel } from "./sop-channel-config";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const KLANT = "demo-greentech";
const DATUM = "2026-08-18";

function fullRij(sopType: string, analysisDate = DATUM) {
  return { client_id: KLANT, sop_type: sopType, section: "full", analysis_date: analysisDate, output: "# rapport" };
}
function finding(sopType: string, severity: string, description: string) {
  return { client_id: KLANT, sop_type: sopType, analysis_date: DATUM, severity, description };
}
function rec(sopType: string, hypothesis: string, expected_result: string, ice_total: number) {
  return { client_id: KLANT, sop_type: sopType, analysis_date: DATUM, hypothesis, expected_result, ice_total };
}
function llm(output: string): (req: { label?: string }) => Promise<OpenRouterResponse> {
  return async () => ({ output, model: "fake-model", tokensUsed: 900, promptTokens: 700, completionTokens: 200, latencyMs: 300, retries: 0, cachedPromptTokens: 0, parseStatus: "ok" });
}
function run(sb: FakeSupabase, extra: Partial<Parameters<typeof runLiteCrossChannelSynthesis>[0]> = {}) {
  return runLiteCrossChannelSynthesis({
    supabase: sb as never, apiKey: "x", clientId: KLANT, cadence: "weekly",
    beschikbareKanalen: ["google", "meta"], analysisDate: DATUM, periodStart: "2026-08-04", periodEnd: DATUM,
    ...extra,
  });
}

async function main() {
  console.log("SEVERITY_RANK dekt exact de enum, ernstigste eerst");
  {
    check("elke enum-waarde heeft een rang", SeverityEnum.options.every((s) => typeof SEVERITY_RANK[s] === "number"));
    check("critical < high < medium < low < positive", SEVERITY_RANK.critical < SEVERITY_RANK.high && SEVERITY_RANK.high < SEVERITY_RANK.medium && SEVERITY_RANK.medium < SEVERITY_RANK.low && SEVERITY_RANK.low < SEVERITY_RANK.positive);
  }

  console.log("liteAlreadySynthesized");
  {
    const leeg = new FakeSupabase();
    check("nog niet gedaan geeft false", (await liteAlreadySynthesized(leeg as never, KLANT, "weekly", DATUM)) === false);
    const wel = new FakeSupabase();
    wel.seed("sop_analysis_output", [{ client_id: KLANT, sop_type: "cross_channel", section: "cross_channel_synthesis_weekly_v1", analysis_date: DATUM, output: "{}" }]);
    check("al gedaan (dit slot, deze datum) geeft true", (await liteAlreadySynthesized(wel as never, KLANT, "weekly", DATUM)) === true);
    check("het biweekly-slot is een ander slot", (await liteAlreadySynthesized(wel as never, KLANT, "biweekly", DATUM)) === false);
  }

  console.log("fetchLiteChannelSummaries: echte severities, ernstigste eerst, null zonder section=full");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [fullRij("weekly")]);
    sb.seed("sop_insights", [
      finding("weekly", "low", "kleine afwijking"),
      finding("weekly", "positive", "CTR verbeterd"),
      finding("weekly", "medium", "CTR daalt licht"),
      finding("weekly", "critical", "CPA schiet omhoog"),
      finding("weekly", "high", "budget bijna op"),
    ]);
    sb.seed("sop_recommendations", [rec("weekly", "verlaag bod", "CPA daalt", 5), rec("weekly", "sluit zoekterm uit", "minder waste", 8)]);
    const summaries = await fetchLiteChannelSummaries(sb as never, KLANT, ["google", "meta"], "weekly", DATUM);
    const google = summaries.get("google_ads");
    check("Google-samenvatting is opgehaald", !!google);
    check("volgorde critical, high, medium, low, positive", google?.topFindings.map((f) => f.severity).join(",") === "critical,high,medium,low,positive", JSON.stringify(google?.topFindings));
    check("aanbeveling met hoogste ice_total staat vooraan", google?.topRecommendations[0]?.hypothesis === "sluit zoekterm uit");
    check("Meta is null (geen section=full deze cyclus)", summaries.get("meta_ads") === null);

    const kapot = new FakeSupabase();
    kapot.seed("sop_analysis_output", [fullRij("weekly")]);
    kapot.faalOp("sop_insights", "permission denied");
    let fout: unknown = null;
    try { await fetchLiteChannelSummaries(kapot as never, KLANT, ["google"], "weekly", DATUM); } catch (e) { fout = e; }
    check("een kapotte sop_insights-query gooit DataLaagFout, geen lege bevindingenlijst", fout instanceof DataLaagFout, String(fout));
  }

  console.log("buildLiteSynthesisPrompt");
  {
    const summaries = new Map<SopChannel, { channel: SopChannel; topFindings: { severity: string; description: string }[]; topRecommendations: { hypothesis: string; expectedResult: string }[] }>([
      ["google_ads", { channel: "google_ads", topFindings: [{ severity: "critical", description: "CPA schiet omhoog" }], topRecommendations: [{ hypothesis: "verlaag bod", expectedResult: "CPA daalt" }] }],
      ["meta_ads", { channel: "meta_ads", topFindings: [{ severity: "high", description: "Frequency te hoog" }], topRecommendations: [] }],
    ]);
    const { systemPrompt, userMessage } = buildLiteSynthesisPrompt(summaries, "weekly");
    check("systemPrompt noemt beide kanaalnamen", systemPrompt.includes("SEA") && systemPrompt.includes("Meta Ads"));
    check("systemPrompt vraagt om perspectief", systemPrompt.toLowerCase().includes("perspectief"));
    check("userMessage bevat de bevindingen van beide kanalen", userMessage.includes("CPA schiet omhoog") && userMessage.includes("Frequency te hoog"));
  }

  console.log("runLiteCrossChannelSynthesis: skip-paden");
  {
    const teWeinig = await run(new FakeSupabase(), { beschikbareKanalen: ["google"] });
    check("< 2 kanalen: skipped", teWeinig.skipped === true);
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [fullRij("weekly")]);
    const nietKlaar = await run(sb);
    check("niet alle kanalen klaar: skipped", nietKlaar.skipped === true);
  }

  console.log("runLiteCrossChannelSynthesis: succes met cijferpoort, en onleesbaar wordt niet opgeslagen");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [fullRij("weekly"), fullRij("meta_weekly")]);
    sb.seed("sop_insights", [finding("weekly", "high", "CPA +30%"), finding("meta_weekly", "high", "CPA +28%")]);
    const output = JSON.stringify({
      headline: "CPA-stijging is marktbreed, geen paniek",
      narrative: "Beide kanalen zien dezelfde week een CPA-stijging van 30% (Google) en 28% (Meta); verlaag budgetten met 15%.",
      contradictions: [],
      synthesized_actions: [{ channel: "meta_ads", action: "wacht een week af", rationale: "patroon lijkt marktbreed", priority: "midden" }],
      markdown: "# CPA-stijging is marktbreed",
    });
    const captured: { label: string | null } = { label: null };
    const result = await run(sb, { callFn: async (req) => { captured.label = req.label ?? null; return llm(output)(req); } });
    check("niet geskipt", result.skipped === false);
    check("het label identificeert de cadence", captured.label?.includes("weekly") ?? false);
    if (!result.skipped) {
      check("gegronde percentages (30%, 28%) blijven staan", result.result.narrative.includes("30%") && result.result.narrative.includes("28%"));
      check("ongegrond percentage (15%) is gemarkeerd", result.result.narrative.includes("[percentage niet uit data]") && JSON.stringify(result.result.ongegronde_cijfers) === "[15]");
      check("opgeslagen in het weekly-slot", (sb.tables["sop_analysis_output"] ?? []).some((r) => r.section === "cross_channel_synthesis_weekly_v1"));
    }

    const sb2 = new FakeSupabase();
    sb2.seed("sop_analysis_output", [fullRij("weekly"), fullRij("meta_weekly")]);
    let fout: unknown = null;
    try { await run(sb2, { callFn: llm("geen json") }); } catch (e) { fout = e; }
    check("onleesbare uitkomst gooit", fout instanceof Error && fout.message.includes("onleesbaar"));
    check("en is niet opgeslagen", (sb2.tables["sop_analysis_output"] ?? []).every((r) => r.section !== "cross_channel_synthesis_weekly_v1"));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

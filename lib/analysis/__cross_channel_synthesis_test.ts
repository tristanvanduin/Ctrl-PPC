// Test voor de kanaaloverstijgende synthese-stap (masterplan 17.12), herbouwd 2 september 2026.
// Deterministisch: Supabase is de in-memory FakeSupabase (lib/decision/__fake_supabase.ts), de
// LLM-call is een geïnjecteerde callFn. Dit draait de ECHTE poorten, cijferpoort en opslag.
// Draaien: npx tsx lib/analysis/__cross_channel_synthesis_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import {
  readyForSynthesis, parseSynthesisOutput, buildSynthesisPrompt, alreadySynthesized,
  fetchChannelSummaries, runCrossChannelSynthesis, CYCLUS_VENSTER_DAGEN,
  type ChannelSummary,
} from "./cross-channel-synthesis";
import { DataLaagFout } from "./db-veilig";
import type { SopChannel } from "./sop-channel-config";
import type { OpenRouterResponse } from "./openrouter-client";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const KLANT = "demo-greentech";
const VANDAAG = "2026-09-01";

function structuredRij(sopType: string, analysisDate: string, primaryThread: string, recs: string[] = []) {
  return {
    client_id: KLANT, sop_type: sopType, section: "structured_monthly_v2", analysis_date: analysisDate,
    output: JSON.stringify({
      final_sop: { primary_thread: primaryThread, root_cause: `oorzaak van ${primaryThread}`, recommendations: recs.map((h) => ({ handeling: h })) },
      executive_markdown: `# ${primaryThread}`,
    }),
  };
}
function syntheseRij(analysisDate: string) {
  return { client_id: KLANT, sop_type: "cross_channel", section: "cross_channel_synthesis_v1", analysis_date: analysisDate, output: "{}" };
}
function signalenRij(analysisDate: string, tekst: string) {
  return { client_id: KLANT, sop_type: "cross_channel", section: "cross_channel_v1", analysis_date: analysisDate, output: tekst };
}
function llm(output: string): () => Promise<OpenRouterResponse> {
  return async () => ({
    output, model: "fake-model", tokensUsed: 1234, promptTokens: 1000, completionTokens: 234,
    latencyMs: 500, retries: 0, cachedPromptTokens: 0, parseStatus: "ok",
  });
}
function run(sb: FakeSupabase, extra: Partial<Parameters<typeof runCrossChannelSynthesis>[0]> = {}) {
  return runCrossChannelSynthesis({
    supabase: sb as never, apiKey: "x", clientId: KLANT,
    beschikbareKanalen: ["google", "meta"], analysisDate: VANDAAG, periodStart: "2026-08-01", periodEnd: "2026-08-31",
    ...extra,
  });
}
function samenvatting(channel: SopChannel, primaryThread: string, analysisDate = "2026-08-30"): ChannelSummary {
  return { channel, analysisDate, primaryThread, rootCause: "verzadiging", topRecommendations: ["verhoog budget"], executiveMarkdown: "" };
}

async function main() {
  console.log("readyForSynthesis (puur)");
  {
    check("minder dan 2 kanalen is nooit klaar", readyForSynthesis(new Map([["google_ads", null] as const])) === false);
    const alleKlaar = new Map<SopChannel, unknown>([["google_ads", {}], ["meta_ads", {}]]);
    check("2 kanalen, allebei klaar", readyForSynthesis(alleKlaar) === true);
    const éénOntbreekt = new Map<SopChannel, unknown>([["google_ads", {}], ["meta_ads", null]]);
    check("1 van de 2 nog niet klaar: niet klaar voor synthese", readyForSynthesis(éénOntbreekt) === false);
  }

  console.log("parseSynthesisOutput");
  {
    const geldig = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", contradictions: ["tegenspraak 1"],
      synthesized_actions: [{ channel: "meta_ads", action: "doe iets", rationale: "reden", priority: "hoog" }],
      markdown: "# Kop\n\nVerhaal",
    });
    const r = parseSynthesisOutput(geldig, ["google_ads", "meta_ads"]);
    check("parseOk bij geldige JSON", r.parseOk === true);
    check("headline en narrative geparsed", r.result.headline === "Kop" && r.result.narrative === "Verhaal");
    check("actie met geldig kanaal blijft staan", r.result.synthesized_actions.length === 1);

    const metVerzonnenKanaal = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", contradictions: [],
      synthesized_actions: [
        { channel: "meta_ads", action: "geldig", rationale: "r", priority: "URGENT" },
        { channel: "tiktok_ads", action: "verzonnen kanaal", rationale: "r", priority: "laag" },
      ],
      markdown: "x",
    });
    const r2 = parseSynthesisOutput(metVerzonnenKanaal, ["google_ads", "meta_ads"]);
    check("verzonnen kanaal wordt gefilterd", r2.result.synthesized_actions.length === 1, JSON.stringify(r2.result.synthesized_actions));
    check("onbekende prioriteit wordt 'midden', niet blind overgenomen", r2.result.synthesized_actions[0].priority === "midden");

    const r3 = parseSynthesisOutput("```json\n" + geldig + "\n```", ["google_ads", "meta_ads"]);
    check("code-fence wordt gestript vóór het parsen", r3.parseOk && r3.result.headline === "Kop");

    const metLeesbareLabels = JSON.stringify({
      headline: "Kop", narrative: "Verhaal", contradictions: [],
      synthesized_actions: [
        { channel: "SEA", action: "budgetknip", rationale: "r", priority: "hoog" },
        { channel: "Meta Ads", action: "landingspagina fixen", rationale: "r", priority: "hoog" },
      ],
      markdown: "x",
    });
    const r5 = parseSynthesisOutput(metLeesbareLabels, ["google_ads", "meta_ads"]);
    check("headerLabels worden teruggemapt naar sleutels", r5.result.synthesized_actions.map((a) => a.channel).sort().join() === "google_ads,meta_ads");

    const kapot = parseSynthesisOutput("dit is geen json { headline:", ["google_ads"]);
    check("kapotte JSON: parseOk false, geen crash", kapot.parseOk === false && kapot.result.narrative.startsWith("dit is geen json"));
    const zonderNarrative = parseSynthesisOutput(JSON.stringify({ headline: "alleen kop" }), ["google_ads"]);
    check("JSON zonder narrative telt als onleesbaar", zonderNarrative.parseOk === false);
  }

  console.log("buildSynthesisPrompt");
  {
    const summaries = new Map<SopChannel, ChannelSummary | null>([
      ["google_ads", samenvatting("google_ads", "CPA loopt op")],
      ["meta_ads", samenvatting("meta_ads", "Frequency te hoog", "2026-08-29")],
    ]);
    const { systemPrompt, userMessage } = buildSynthesisPrompt(summaries, "## Cross-channel-signalen\n\nDubbele warme pool.", "2026-07-01");
    check("systemPrompt noemt beide kanaalnamen", systemPrompt.includes("SEA") && systemPrompt.includes("Meta Ads"));
    check("systemPrompt verbiedt ongegronde cijfers", systemPrompt.toLowerCase().includes("percentages en bedragen"));
    check("userMessage bevat beide primary threads met rundatum", userMessage.includes("CPA loopt op") && userMessage.includes("d.d. 2026-08-29"));
    check("userMessage meldt de datum van de signalen (geen valse versheid)", userMessage.includes("2026-07-01") && userMessage.toLowerCase().includes("eerdere cyclus"));
  }

  console.log("fetchChannelSummaries: cyclusvenster en tolerantie");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "Google-verhaal", ["actie A"]), structuredRij("meta_monthly", "2026-08-29", "Meta-verhaal")]);
    const f = await fetchChannelSummaries(sb as never, KLANT, ["google", "meta"], VANDAAG);
    check("beide kanalen in dezelfde cyclus tellen mee", f.summaries.get("google_ads")?.primaryThread === "Google-verhaal" && f.summaries.get("meta_ads")?.primaryThread === "Meta-verhaal");
    check("nieuwsteRun is de jongste van de twee", f.nieuwsteRun === "2026-08-30");
    check("niets ontbreekt, niets loopt achter", f.ontbrekend.length === 0 && f.achterlopend.length === 0);

    const sb2 = new FakeSupabase();
    sb2.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "Google-verhaal"), structuredRij("meta_monthly", "2026-06-01", "Oude Meta")]);
    const f2 = await fetchChannelSummaries(sb2 as never, KLANT, ["google", "meta"], VANDAAG);
    check(`Meta-run buiten ${CYCLUS_VENSTER_DAGEN} dagen telt niet mee`, !f2.summaries.has("meta_ads"));
    check("en staat als ontbrekend met zijn laatste rundatum", f2.ontbrekend[0]?.channel === "meta_ads" && f2.ontbrekend[0]?.laatsteRun === "2026-06-01", JSON.stringify(f2.ontbrekend));

    const sb3 = new FakeSupabase();
    sb3.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "Google-verhaal"), structuredRij("meta_monthly", "2026-08-05", "Meta van vorige cyclus")]);
    const f3 = await fetchChannelSummaries(sb3 as never, KLANT, ["google", "meta"], VANDAAG);
    check("Meta binnen het venster maar >10 dagen achter de nieuwste: achterlopend (null in de map)", f3.summaries.get("meta_ads") === null && f3.achterlopend[0]?.laatsteRun === "2026-08-05");
    check("readyForSynthesis leest dat als 'nog niet klaar'", readyForSynthesis(f3.summaries) === false);

    const sb4 = new FakeSupabase();
    sb4.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "Google-verhaal")]);
    const f4 = await fetchChannelSummaries(sb4 as never, KLANT, ["google", "meta"], VANDAAG);
    check("kanaal zonder enige run: ontbrekend met laatsteRun null", f4.ontbrekend[0]?.channel === "meta_ads" && f4.ontbrekend[0]?.laatsteRun === null);

    const sb5 = new FakeSupabase();
    sb5.faalOp("sop_analysis_output", "column analysis_date does not exist");
    let fout: unknown = null;
    try { await fetchChannelSummaries(sb5 as never, KLANT, ["google", "meta"], VANDAAG); } catch (e) { fout = e; }
    check("een queryfout gooit DataLaagFout, geen 'wachten op Meta'", fout instanceof DataLaagFout, String(fout));
  }

  console.log("alreadySynthesized: dekt de nieuwste kanaalrun?");
  {
    const leeg = new FakeSupabase();
    check("zonder synthese: false", (await alreadySynthesized(leeg as never, KLANT, "2026-08-30")) === false);
    const nieuwer = new FakeSupabase(); nieuwer.seed("sop_analysis_output", [syntheseRij("2026-08-31")]);
    check("synthese van ná de nieuwste run: true", (await alreadySynthesized(nieuwer as never, KLANT, "2026-08-30")) === true);
    const ouder = new FakeSupabase(); ouder.seed("sop_analysis_output", [syntheseRij("2026-08-20")]);
    check("synthese van vóór de nieuwste run: false (verouderd, opnieuw draaien)", (await alreadySynthesized(ouder as never, KLANT, "2026-08-30")) === false);
  }

  console.log("runCrossChannelSynthesis: skip-paden");
  {
    const teWeinig = await run(new FakeSupabase(), { beschikbareKanalen: ["google"] });
    check("< 2 kanalen: skipped", teWeinig.skipped === true && teWeinig.reason.includes("2 gekoppelde"));

    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "x")]);
    const éénRecent = await run(sb);
    check("maar 1 kanaal met recente run: skipped, reden noemt het ontbrekende kanaal", éénRecent.skipped === true && éénRecent.reason.includes("Meta Ads") && éénRecent.reason.includes("nooit gedraaid"), éénRecent.skipped ? éénRecent.reason : "");

    const sb2 = new FakeSupabase();
    sb2.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "x"), structuredRij("meta_monthly", "2026-08-05", "y")]);
    const achter = await run(sb2);
    check("achterlopend kanaal: skipped met naam en datum", achter.skipped === true && achter.reason.includes("Meta Ads") && achter.reason.includes("2026-08-05"), achter.skipped ? achter.reason : "");

    const sb3 = new FakeSupabase();
    sb3.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "x"), structuredRij("meta_monthly", "2026-08-29", "y"), syntheseRij("2026-08-31")]);
    const gedaan = await run(sb3);
    check("synthese dekt de nieuwste run al: skipped, geen LLM-call", gedaan.skipped === true && gedaan.reason.includes("dekt"));
  }

  console.log("runCrossChannelSynthesis: succes, cijferpoort en opslag");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [
      structuredRij("monthly", "2026-08-30", "CPA loopt op naar €42", ["verhoog tCPA"]),
      structuredRij("meta_monthly", "2026-08-29", "Frequency te hoog", ["verbreed doelgroep"]),
      signalenRij("2026-08-28", "## Cross-channel-signalen\n\nDubbele warme pool."),
    ]);
    const output = JSON.stringify({
      headline: "Beide kanalen concurreren om dezelfde koude doelgroep",
      narrative: "Google en Meta targeten hetzelfde publiek; de CPA van €42 komt daarvandaan. Verleg 25% van het budget.",
      contradictions: [],
      synthesized_actions: [{ channel: "meta_ads", action: "verleg 25% naar retargeting", rationale: "Google dekt prospecting al", priority: "hoog" }],
      markdown: "# Beide kanalen concurreren\n\nVerleg 25%.",
    });
    const result = await run(sb, { callFn: llm(output) });
    check("niet geskipt", result.skipped === false);
    if (!result.skipped) {
      check("gegrond bedrag (€42 uit de samenvatting) blijft staan", result.result.narrative.includes("€42"));
      check("ongegrond percentage (25%) is gemarkeerd in narrative en actie", result.result.narrative.includes("[percentage niet uit data]") && result.result.synthesized_actions[0].action.includes("[percentage niet uit data]"));
      check("ongegronde_cijfers noemt 25", JSON.stringify(result.result.ongegronde_cijfers) === "[25]", JSON.stringify(result.result.ongegronde_cijfers));
      check("dekking noemt beide kanaalruns en de nieuwste", result.dekking.kanalen.length === 2 && result.dekking.nieuwsteRun === "2026-08-30");
      const opgeslagen = (sb.tables["sop_analysis_output"] ?? []).filter((r) => r.section === "cross_channel_synthesis_v1");
      check("de synthese is opgeslagen met de geschoonde tekst", opgeslagen.length === 1 && String(opgeslagen[0].output).includes("ongegronde_cijfers"));
      check("channels_used is de aangeleverde kanaalset", result.result.channels_used.length === 2);
    }
  }

  console.log("runCrossChannelSynthesis: onleesbare modeluitkomst wordt niet opgeslagen");
  {
    const sb = new FakeSupabase();
    sb.seed("sop_analysis_output", [structuredRij("monthly", "2026-08-30", "x"), structuredRij("meta_monthly", "2026-08-29", "y")]);
    let fout: unknown = null;
    try { await run(sb, { callFn: llm("dit is geen json") }); } catch (e) { fout = e; }
    check("gooit met 'onleesbaar'", fout instanceof Error && fout.message.includes("onleesbaar"), String(fout));
    check("geen synthese-rij opgeslagen (herkansing blijft mogelijk)", (sb.tables["sop_analysis_output"] ?? []).every((r) => r.section !== "cross_channel_synthesis_v1"));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

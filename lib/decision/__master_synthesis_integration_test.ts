// Integratietest voor de Master Synthesis-keten (Pijler 6, Fase A -> B -> C), met een
// in-memory FakeSupabase (__fake_supabase.ts) en een geinjecteerde callFn (zelfde
// "caller is injecteerbaar voor tests"-patroon als callRouted() zelf) in plaats van een echte
// OpenRouter-call. Dit draait de ECHTE fetchChannelSynthesis/fetchCrossChannelFacts/
// runMasterSynthesis/saveMasterSynthesis-code, niet een herimplementatie -- alleen de twee
// IO-grenzen (Supabase, OpenRouter) zijn vervangen. De dunne route-wrapper zelf
// (app/api/analysis/monthly-decision/route.ts: tenant-check, periodEnd-berekening, JSON-vorm)
// is de LIVE-ONGETESTE grens, zelfde status als elke andere route in deze codebase.
// Draaien: npx tsx lib/decision/__master_synthesis_integration_test.ts

import { FakeSupabase } from "./__fake_supabase";
import { fetchChannelSynthesis } from "./evidence/channel-synthesis";
import { fetchCrossChannelFacts } from "./evidence/cross-channel-facts";
import { runMasterSynthesis } from "./master-synthesis";
import { saveMasterSynthesis } from "./master-synthesis-storage";
import type { OpenRouterResponse } from "@/lib/analysis/openrouter-client";
import { DataLaagFout } from "@/lib/analysis/db-veilig";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const CLIENT_ID = "client-integration";

function seedTwoChannelsPlusCrossChannel(supabase: FakeSupabase): void {
  // Kanaal-detectie (heeftKanaalData): één rij is genoeg om "aanwezig" te zijn.
  supabase.seed("ads_account_monthly", [{ client_id: CLIENT_ID, month: "2026-02-01" }]);
  supabase.seed("meta_account_daily", [{ client_id: CLIENT_ID, date: "2026-02-15" }]);
  // Geen linkedin_account_daily-rij: LinkedIn is dus NIET actief voor deze klant.

  // Google's monthly-run: één aanbeveling.
  supabase.seed("sop_recommendations", [
    {
      id: "rec-google-1", client_id: CLIENT_ID, sop_type: "monthly", analysis_date: "2026-03-15",
      hypothesis: "Search-campagne 'Brand NL' verliest impression share door budgetlimiet.",
      expected_result: "IS omhoog naar >90%", measurement_metric: "Impression Share (lost, budget)",
      timeframe: "2 weken", ice_total: 7, status: "open",
    },
    // Meta's monthly-run: één aanbeveling.
    {
      id: "rec-meta-1", client_id: CLIENT_ID, sop_type: "meta_monthly", analysis_date: "2026-03-15",
      hypothesis: "CPL op Meta daalde 18% MoM na de creative-refresh in 'Retargeting NL'.",
      expected_result: "CPL blijft onder €35", measurement_metric: "CPL",
      timeframe: "4 weken", ice_total: 6, status: "open",
    },
  ]);
  supabase.seed("sop_tasks", [
    { id: "task-google-1", client_id: CLIENT_ID, recommendation_id: "rec-google-1", analysis_date: "2026-03-15", title: "Verhoog dagbudget Brand NL", description: "Budgetlimiet kost impression share.", action_type: "budget", priority: "high", status: "open" },
  ]);

  // Cross-channel-feiten (gedeterministeerde run, zelfde vorm als cross-channel/route.ts).
  supabase.seed("sop_analysis_output", [{
    client_id: CLIENT_ID, sop_type: "cross_channel", section: "cross_channel_groups_v1",
    analysis_date: "2026-03-16", period_start: "2025-03-01", period_end: "2026-02-28",
    output: JSON.stringify({
      groups: [{ key: "signals", title: "Zaai-oogst, arbitrage & mix-shift", description: "Merkvraag, CPL-arbitrage en mix-verschuivingen.", triggered: 1, checked: ["cross_zaai_oogst", "cross_cpl_arbitrage", "cross_mix_shift"] }],
      degradations: [],
    }),
  }]);
}

function fakeCallFn(output: Record<string, unknown>): (req?: unknown) => Promise<OpenRouterResponse> {
  return async () => ({
    output: JSON.stringify(output),
    model: "fake-model", tokensUsed: 100, promptTokens: 80, completionTokens: 20,
    latencyMs: 5, retries: 0, cachedPromptTokens: 0, parseStatus: "ok",
  });
}

const VALID_SYNTHESIS_OUTPUT = {
  narrative: "x".repeat(60),
  log_entries: ["Hypothese: budgetverschuiving - kanalen: google_ads, meta_ads - onderbouwing: x - evidence: inferred."],
  hypotheses: [{
    hypothesis: "Budgetverschuiving tussen Google en Meta verklaart de blended CPA-stijging.",
    expected_result: "CPA daalt richting het niveau van de CPL-daling (18%)", measurement_metric: "CPA", timeframe: "4 weken",
    rationale: "Google meldt budgetdruk, Meta meldt CPL-daling, cross-channel mix-shift getriggerd.",
    contributing_channels: ["google_ads", "meta_ads"],
    ice_impact: 7, ice_confidence: 6, ice_ease: 5, ice_total: 6,
  }],
  tasks: [{
    title: "Verhoog budget Google Ads Brand NL", description: "Vangt de merkvraag op die Meta genereert.",
    action_type: "budget", contributing_channels: ["google_ads", "meta_ads"], hypothesis_index: 0,
    priority: "high", frequency: "direct", due_date_days: 7,
  }],
  step_conclusion: "Budgetverschuiving tussen Google en Meta verklaart de blended CPA-stijging.",
};

async function main() {
  // ── 1. Fase A: fetchChannelSynthesis vindt alleen actieve kanalen, LinkedIn ontbreekt. ──
  const sb1 = new FakeSupabase();
  seedTwoChannelsPlusCrossChannel(sb1);
  const channels = await fetchChannelSynthesis(sb1 as never, CLIENT_ID, "2026-02-28");
  assert(channels.length === 2, `precies 2 actieve kanalen gevonden (kreeg ${channels.length})`);
  assert(channels.some((c) => c.channel === "google_ads"), "google_ads is actief");
  assert(channels.some((c) => c.channel === "meta_ads"), "meta_ads is actief");
  assert(!channels.some((c) => c.channel === "linkedin_ads"), "linkedin_ads is NIET actief (geen data gezaaid)");
  assert(channels.find((c) => c.channel === "google_ads")?.tasks.length === 1, "Google's taak is meegekomen, correct gekoppeld via recommendation_id");

  const crossChannel = await fetchCrossChannelFacts(sb1 as never, CLIENT_ID, "2026-02-28");
  assert(crossChannel !== null, "cross-channel-feiten gevonden");
  assert(crossChannel?.groups.length === 1, "1 cross-channel-groep");

  // ── 2. Fase A+B samen: runMasterSynthesis met een geinjecteerde callFn (geen netwerk). ──
  const result = await runMasterSynthesis({
    supabase: sb1 as never, apiKey: "fake-key", clientId: CLIENT_ID, periodEnd: "2026-02-28",
    callFn: fakeCallFn(VALID_SYNTHESIS_OUTPUT),
  });
  assert(result.skipped === false, "niet geskipt: er is evidence");
  assert(result.output !== null, "output geparsed");
  assert(result.validation?.valid === true, "output valideert (geen gehallucineerd kanaal)");
  assert(result.evidencePayload.availableChannels.length === 2, "evidence_payload draagt de 2 actieve kanalen");
  assert(result.repaired === false, "geen repair nodig bij een geldig eerste antwoord");

  // ── 3. Fase C: saveMasterSynthesis schrijft naar sprint_hypotheses, sprint_items en
  // sop_analysis_output, met contributing_channels in metadata en de juiste hypothesis_id-koppeling. ──
  if (result.output) {
    const saved = await saveMasterSynthesis({
      supabase: sb1 as never, clientId: CLIENT_ID, analysisDate: "2026-03-17",
      periodStart: "2025-03-01", periodEnd: "2026-02-28",
      output: result.output, model: result.model ?? "fake-model", tokensUsed: result.tokensUsed,
    });
    assert(saved.hypothesesSaved === 1, "1 hypothese opgeslagen");
    assert(saved.tasksSaved === 1, "1 taak opgeslagen");
    assert(saved.tasksUnlinked === 0, "de taak is correct gekoppeld aan zijn hypothese (niet unlinked)");

    const hypRows = sb1.tables["sprint_hypotheses"] ?? [];
    assert(hypRows.length === 1, "precies 1 rij in sprint_hypotheses");
    assert(hypRows[0].source === "master_synthesis", "source is master_synthesis");
    assert(hypRows[0].status === "pending", "status is pending (goedkeuringswachtrij)");
    const metadata = hypRows[0].metadata as { contributing_channels?: string[] } | undefined;
    assert(Array.isArray(metadata?.contributing_channels) && metadata!.contributing_channels!.length === 2, "metadata draagt contributing_channels");

    const itemRows = sb1.tables["sprint_items"] ?? [];
    assert(itemRows.length === 1, "precies 1 rij in sprint_items");
    assert(itemRows[0].hypothesis_id === hypRows[0].id, "sprint_items.hypothesis_id verwijst naar de echte sprint_hypotheses-id");

    const outputRows = (sb1.tables["sop_analysis_output"] ?? []).filter((r) => r.sop_type === "master_synthesis");
    assert(outputRows.length === 1, "1 sop_analysis_output-rij voor de catalogus-tracking");
    assert(String(outputRows[0].output).includes("Budgetverschuiving"), "de opgeslagen markdown bevat de synthese-tekst");
  }

  // ── 4. Hard-skip: zonder kanaaldata en zonder cross-channel-signalen geen LLM-call. ──
  const sb2 = new FakeSupabase();
  let callFnAangeroepen = false;
  const result2 = await runMasterSynthesis({
    supabase: sb2 as never, apiKey: "fake-key", clientId: "client-zonder-data", periodEnd: "2026-02-28",
    callFn: async () => { callFnAangeroepen = true; return fakeCallFn(VALID_SYNTHESIS_OUTPUT)(); },
  });
  assert(result2.skipped === true, "lege evidence -> geskipt");
  assert(callFnAangeroepen === false, "geen LLM-call bij een lege evidence_payload (hard-skip)");

  // ── 5. Hallucinatie: het model noemt LinkedIn terwijl dat niet is aangeleverd. De fake callFn
  // geeft dezelfde foute output bij elke aanroep terug, dus de repair-poging wordt WEL gedaan
  // (2 aanroepen) maar terecht NIET overgenomen -- gelijke fouten houdt het origineel vast
  // (pickBetterAttempt), zelfde "een repair maakt het nooit slechter"-regel als
  // pickBetterStepAttempt in monthly/route.ts. result.repaired betekent dus "de reparatie is
  // overgenomen", niet "er is een poging gedaan"; dat laatste toetst de aanroepteller. ──
  const hallucinatieOutput = {
    ...VALID_SYNTHESIS_OUTPUT,
    hypotheses: [{ ...VALID_SYNTHESIS_OUTPUT.hypotheses[0], contributing_channels: ["google_ads", "linkedin_ads"] }],
  };
  const sb3 = new FakeSupabase();
  seedTwoChannelsPlusCrossChannel(sb3);
  let aanroepen3 = 0;
  const result3 = await runMasterSynthesis({
    supabase: sb3 as never, apiKey: "fake-key", clientId: CLIENT_ID, periodEnd: "2026-02-28",
    callFn: async (req) => { aanroepen3++; return fakeCallFn(hallucinatieOutput)(req); },
  });
  assert(result3.validation?.valid === false, "hallucinatie van linkedin_ads (niet aangeleverd) blijft invalid, ook na repair");
  assert(aanroepen3 === 2, "een repair-poging is wel gedaan (2 LLM-aanroepen: origineel + repair)");
  assert(result3.repaired === false, "de repair is terecht NIET overgenomen (gelijke fouten, origineel blijft staan)");

  // ── 6. Cijferpoort: een percentage dat nergens in het evidence_payload staat is een fout. ──
  const sb6 = new FakeSupabase();
  seedTwoChannelsPlusCrossChannel(sb6);
  const ongegrond = {
    ...VALID_SYNTHESIS_OUTPUT,
    hypotheses: [{ ...VALID_SYNTHESIS_OUTPUT.hypotheses[0], expected_result: "CPA daalt 10%" }],
  };
  const result6 = await runMasterSynthesis({
    supabase: sb6 as never, apiKey: "fake-key", clientId: CLIENT_ID, periodEnd: "2026-02-28",
    callFn: fakeCallFn(ongegrond),
  });
  assert(result6.validation?.valid === false, "een ongegrond percentage (10%) valt door de cijferpoort");
  assert((result6.validation?.errors ?? []).some((e) => e.includes("Ongegrond cijfer")), "de fout noemt het ongegronde cijfer");
  assert(result6.toegestaneCijfers > 0, "de cijferpoort-set is uit de prompt gehaald (90%, 18%, €35)");
  assert(result.validation?.valid === true, "een gegrond percentage (18% uit Meta's aanbeveling) passeert wel");

  // ── 7. Dekking: de rundatums en spreiding staan in de payload en in de prompt. ──
  assert(result.evidencePayload.dekking.runDatums.length === 2, "dekking kent de twee kanaalruns");
  assert(result.evidencePayload.dekking.spreidingDagen === 0, "beide runs op dezelfde dag: spreiding 0");
  assert(result.evidencePayload.dekking.verouderd === false, "runs van ná periodEnd zijn niet verouderd");

  // ── 8. Datalaagfout is een fout, geen 'geen_data'. ──
  const sb8 = new FakeSupabase();
  seedTwoChannelsPlusCrossChannel(sb8);
  sb8.faalOp("sop_recommendations", "column ice_total does not exist");
  let fout8: unknown = null;
  try {
    await runMasterSynthesis({ supabase: sb8 as never, apiKey: "fake-key", clientId: CLIENT_ID, periodEnd: "2026-02-28", callFn: fakeCallFn(VALID_SYNTHESIS_OUTPUT) });
  } catch (e) { fout8 = e; }
  assert(fout8 instanceof DataLaagFout, "een kapotte sop_recommendations-query gooit DataLaagFout (voorheen: stil 'geen_data')");

  // ── 9. Herrun: weestaken van de vorige run worden opgeruimd, schrijffouten gooien. ──
  if (result.output) {
    const sb9 = new FakeSupabase();
    seedTwoChannelsPlusCrossChannel(sb9);
    sb9.seed("sprint_items", [
      { client_id: CLIENT_ID, hypothesis_id: null, task: "wees van vorige run", status: "todo", metadata: { source: "master_synthesis" } },
      { client_id: CLIENT_ID, hypothesis_id: null, task: "handmatige taak, blijft", status: "todo", metadata: { source: "handmatig" } },
    ]);
    const saved9 = await saveMasterSynthesis({
      supabase: sb9 as never, clientId: CLIENT_ID, analysisDate: "2026-03-17",
      periodStart: "2025-03-01", periodEnd: "2026-02-28",
      output: result.output, model: "fake-model", tokensUsed: 1,
    });
    assert(saved9.wezenOpgeruimd === 1, "precies de wees van deze bron is opgeruimd");
    const items9 = sb9.tables["sprint_items"] ?? [];
    assert(items9.some((r) => r.task === "handmatige taak, blijft"), "de handmatige taak is met rust gelaten");
    assert(items9.filter((r) => (r.metadata as { source?: string })?.source === "master_synthesis").length === 1, "één nieuwe taak van deze bron, geen wezen erbij");

    const sb10 = new FakeSupabase();
    seedTwoChannelsPlusCrossChannel(sb10);
    sb10.faalOp("sprint_items", "permission denied");
    let fout10: unknown = null;
    try {
      await saveMasterSynthesis({ supabase: sb10 as never, clientId: CLIENT_ID, analysisDate: "2026-03-17", periodStart: "2025-03-01", periodEnd: "2026-02-28", output: result.output, model: "m", tokensUsed: 1 });
    } catch (e) { fout10 = e; }
    assert(fout10 instanceof DataLaagFout, "een schrijffout op sprint_items gooit (voorheen: 'opgeslagen' zonder rij)");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

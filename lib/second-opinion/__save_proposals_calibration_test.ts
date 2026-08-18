// Test voor de kalibratie-wiring in saveProposalsReplacingPending (masterplan sectie 4 /
// lib/learning/signal-calibration.ts). Dit is de ENE schrijfplek voor alle 22 ProposalSource-
// waarden, dus hier moet bewezen worden dat de ice_confidence daadwerkelijk wordt bijgesteld en
// dat het confidence_recalibrated-event alleen verschijnt wanneer er ook echt iets is bijgesteld.
// Draaien: npx tsx lib/second-opinion/__save_proposals_calibration_test.ts

import { saveProposalsReplacingPending, type SprintHypothesisRow } from "./findings-to-hypotheses";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface FakeState {
  hitRateEvents: { event_type: string; sprint_hypotheses: { source: string } | null }[];
  insertedHypotheses: (SprintHypothesisRow & { id: string })[];
  insertedMemoryEvents: { client_id: string | null; hypothesis_id: string | null; event_type: string; reason: string | null; metrics: unknown }[];
  nextId: number;
}

function buildFakeSupabase(state: FakeState): SupabaseClient {
  const from = (table: string) => {
    if (table === "agency_memory_events") {
      return {
        select() { return this; },
        in: (_col: string, _vals: string[]) => Promise.resolve({ data: state.hitRateEvents, error: null }),
        insert(row: { client_id: string | null; hypothesis_id: string | null; event_type: string; reason?: string | null; metrics?: unknown }) {
          state.insertedMemoryEvents.push({
            client_id: row.client_id, hypothesis_id: row.hypothesis_id, event_type: row.event_type,
            reason: row.reason ?? null, metrics: row.metrics ?? null,
          });
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "sprint_hypotheses") {
      let filters: Record<string, string> = {};
      return {
        select() { return this; },
        eq(col: string, val: string) { filters = { ...filters, [col]: val }; return this; },
        // .select("id").eq(...).eq(...).eq("status","pending") -- geen bestaande pending in deze test.
        then(resolve: (v: { data: unknown[]; error: null }) => void) { resolve({ data: [], error: null }); },
        insert(rows: SprintHypothesisRow[]) {
          const withIds = rows.map((r) => ({ ...r, id: `hyp-${state.nextId++}` }));
          state.insertedHypotheses.push(...withIds);
          return {
            select: () => Promise.resolve({ data: withIds.map((r) => ({ id: r.id })), error: null }),
          };
        },
        delete() { return { in: () => Promise.resolve({ error: null }) }; },
      };
    }
    throw new Error(`onverwachte tabel in test-mock: ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

function row(overrides: Partial<SprintHypothesisRow>): SprintHypothesisRow {
  return {
    client_id: "client-1", analysis_id: null, hypothesis: "test", expected_result: "x",
    measurement_metric: "y", timeframe: "1 week", rationale: "z",
    ice_impact: 5, ice_confidence: 5, ice_ease: 5, ice_total: 5,
    status: "pending", source: "second_opinion",
    ...overrides,
  };
}

async function main() {
  console.log("saveProposalsReplacingPending: kalibratie past ice_confidence en ice_total echt aan");
  {
    // second_opinion: 20 gehaald, 0 gemist -> 100% trefzeker, volle steekproef -> +2.
    const hitRateEvents = Array.from({ length: 20 }, () => ({ event_type: "hypothesis_outcome_met", sprint_hypotheses: { source: "second_opinion" } }));
    const state: FakeState = { hitRateEvents, insertedHypotheses: [], insertedMemoryEvents: [], nextId: 1 };
    const supabase = buildFakeSupabase(state);

    await saveProposalsReplacingPending(supabase, "client-1", "second_opinion", [row({ ice_impact: 5, ice_confidence: 5, ice_ease: 5 })]);

    const inserted = state.insertedHypotheses[0];
    check("ice_confidence is bijgesteld van 5 naar 7", inserted.ice_confidence === 7, String(inserted.ice_confidence));
    check("ice_total is herberekend, afgerond op 1 decimaal ((5+7+5)/3 -> 5.7)", inserted.ice_total === 5.7, String(inserted.ice_total));

    const recalEvent = state.insertedMemoryEvents.find((e) => e.event_type === "confidence_recalibrated");
    check("er is een confidence_recalibrated-event geschreven", recalEvent !== undefined);
    check("dat event hangt aan de echte hypothesis_id", recalEvent?.hypothesis_id === inserted.id, JSON.stringify(recalEvent));
    check("de metrics bevatten bron, oude en nieuwe confidence", (recalEvent?.metrics as Record<string, unknown>)?.source === "second_opinion"
      && (recalEvent?.metrics as Record<string, unknown>)?.base_confidence === 5
      && (recalEvent?.metrics as Record<string, unknown>)?.calibrated_confidence === 7, JSON.stringify(recalEvent?.metrics));

    const proposedEvent = state.insertedMemoryEvents.find((e) => e.event_type === "hypothesis_proposed");
    check("het gewone hypothesis_proposed-event blijft ook bestaan", proposedEvent !== undefined);

    const metadata = inserted.metadata as { confidence_recalibration?: { base: number; calibrated: number } } | undefined;
    check("metadata.confidence_recalibration staat op de rij zelf (voor de UI, geen extra join nodig)", metadata?.confidence_recalibration?.base === 5 && metadata?.confidence_recalibration?.calibrated === 7, JSON.stringify(metadata));
  }

  console.log("\nsaveProposalsReplacingPending: bestaande metadata (bijv. master_synthesis) wordt aangevuld, niet overschreven");
  {
    const hitRateEvents = Array.from({ length: 20 }, () => ({ event_type: "hypothesis_outcome_met", sprint_hypotheses: { source: "master_synthesis" } }));
    const state: FakeState = { hitRateEvents, insertedHypotheses: [], insertedMemoryEvents: [], nextId: 1 };
    const supabase = buildFakeSupabase(state);

    await saveProposalsReplacingPending(supabase, "client-1", "master_synthesis", [
      row({ source: "master_synthesis", ice_confidence: 5, metadata: { contributing_channels: ["google_ads", "meta_ads"] } }),
    ]);

    const inserted = state.insertedHypotheses[0];
    const metadata = inserted.metadata as { contributing_channels?: string[]; confidence_recalibration?: { base: number } } | undefined;
    check("de oorspronkelijke master_synthesis-metadata blijft staan", JSON.stringify(metadata?.contributing_channels) === JSON.stringify(["google_ads", "meta_ads"]), JSON.stringify(metadata));
    check("de kalibratie-metadata is ernaast toegevoegd", metadata?.confidence_recalibration?.base === 5, JSON.stringify(metadata));
  }

  console.log("\nsaveProposalsReplacingPending: geen kalibratie-event zonder voldoende bewijs (geen ruis)");
  {
    // Geen hitRateEvents beschikbaar voor deze bron -> geen bijstelling, geen event.
    const state: FakeState = { hitRateEvents: [], insertedHypotheses: [], insertedMemoryEvents: [], nextId: 1 };
    const supabase = buildFakeSupabase(state);

    await saveProposalsReplacingPending(supabase, "client-1", "search_terms", [row({ source: "search_terms", ice_confidence: 5, ice_total: 5 })]);

    const inserted = state.insertedHypotheses[0];
    check("ice_confidence blijft ongewijzigd zonder bewijs", inserted.ice_confidence === 5, String(inserted.ice_confidence));
    check("geen confidence_recalibrated-event zonder bijstelling", !state.insertedMemoryEvents.some((e) => e.event_type === "confidence_recalibrated"));
    check("het hypothesis_proposed-event verschijnt nog gewoon", state.insertedMemoryEvents.some((e) => e.event_type === "hypothesis_proposed"));
  }

  console.log("\nsaveProposalsReplacingPending: elke bron heeft zijn eigen kalibratie, ook binnen dezelfde batch");
  {
    // second_opinion: 100% trefzeker (bijstelling). search_terms: geen data (geen bijstelling).
    const hitRateEvents = Array.from({ length: 20 }, () => ({ event_type: "hypothesis_outcome_met", sprint_hypotheses: { source: "second_opinion" } }));
    const state: FakeState = { hitRateEvents, insertedHypotheses: [], insertedMemoryEvents: [], nextId: 1 };
    const supabase = buildFakeSupabase(state);

    // saveProposalsReplacingPending schrijft per bron, dus twee losse aanroepen (zoals de echte
    // aanroepers ook per bron apart schrijven).
    await saveProposalsReplacingPending(supabase, "client-1", "second_opinion", [row({ source: "second_opinion", ice_confidence: 4 })]);
    await saveProposalsReplacingPending(supabase, "client-1", "search_terms", [row({ source: "search_terms", ice_confidence: 4 })]);

    const so = state.insertedHypotheses.find((r) => r.source === "second_opinion");
    const st = state.insertedHypotheses.find((r) => r.source === "search_terms");
    check("second_opinion (wel bewijs) wordt bijgesteld", so?.ice_confidence === 6, String(so?.ice_confidence));
    check("search_terms (geen bewijs voor die bron) blijft ongewijzigd", st?.ice_confidence === 4, String(st?.ice_confidence));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();

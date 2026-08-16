// Fase 4 (docs/MASTERPLAN.md sectie 9), punt 3: agency_memory_events retroactief vullen vanuit
// de bestaande sprint_hypotheses-rijen. Eenmalig script, geen doorlopend onderdeel van de app.
//
// TWEE BRONNEN VOOR DE AFWIJZINGSREDEN: decision_reason (proposal-queue.tsx-pad) EN de
// rationale-JSON's rejected_reason-veld (monthly-hypotheses/route.ts-pad -- vóór de Fase 4-fix
// in die route altijd leeg in decision_reason). Zonder beide te lezen mist de backfill een deel
// van de negatieve leermomenten stilzwijgend.
//
// IDEMPOTENT: een hypothese met al minstens één event wordt overgeslagen. agency_memory_events
// is append-only (migratie 091 weigert update/delete op databaseniveau), dus een tweede run mag
// nooit dubbel schrijven.
//
// Draaien: npx tsx scripts/backfill-agency-memory-events.ts --dry-run
//          npx tsx scripts/backfill-agency-memory-events.ts

import { createClient } from "@supabase/supabase-js";
import { memoryEventsForVerdict, type AgencyMemoryEventType } from "../lib/memory/agency-memory-events";
import { decodeHypothesisPersistenceMetadata } from "../lib/analysis/monthly-hypotheses-insights";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes("--dry-run");

interface Row {
  id: string;
  client_id: string;
  status: string;
  decision_reason: string | null;
  rationale: string | null;
  outcome: string | null;
  learning: string | null;
  verdict_metrics: unknown;
  evaluated_at: string | null;
}

interface NewEvent {
  client_id: string;
  hypothesis_id: string;
  event_type: AgencyMemoryEventType;
  reason: string | null;
  metrics: unknown;
}

function rejectReasonFor(row: Row): string | null {
  if (row.decision_reason) return row.decision_reason;
  const decoded = decodeHypothesisPersistenceMetadata(row.rationale);
  return decoded?.rejected_reason ?? null;
}

async function main() {
  const { data: existing, error: existingErr } = await supabase.from("agency_memory_events").select("hypothesis_id");
  if (existingErr) throw new Error(`kon bestaande events niet lezen: ${existingErr.message}`);
  const alreadyBackfilled = new Set((existing ?? []).map((r) => r.hypothesis_id).filter((id): id is string => Boolean(id)));

  const { data: rows, error } = await supabase
    .from("sprint_hypotheses")
    .select("id, client_id, status, decision_reason, rationale, outcome, learning, verdict_metrics, evaluated_at");
  if (error) throw new Error(`kon sprint_hypotheses niet lezen: ${error.message}`);

  const toInsert: NewEvent[] = [];
  let skipped = 0;
  let proposed = 0, accepted = 0, rejected = 0, outcomeEvents = 0;

  for (const row of (rows ?? []) as Row[]) {
    if (alreadyBackfilled.has(row.id)) { skipped++; continue; }

    // Elke rij is ooit voorgesteld, ongeacht wat er daarna gebeurde.
    toInsert.push({ client_id: row.client_id, hypothesis_id: row.id, event_type: "hypothesis_proposed", reason: null, metrics: null });
    proposed++;

    if (row.status === "accepted" || row.status === "completed") {
      toInsert.push({ client_id: row.client_id, hypothesis_id: row.id, event_type: "hypothesis_accepted", reason: null, metrics: null });
      accepted++;
    } else if (row.status === "rejected") {
      toInsert.push({ client_id: row.client_id, hypothesis_id: row.id, event_type: "hypothesis_rejected", reason: rejectReasonFor(row), metrics: null });
      rejected++;
    }

    if (row.evaluated_at && row.outcome) {
      for (const eventType of memoryEventsForVerdict(row.outcome)) {
        toInsert.push({ client_id: row.client_id, hypothesis_id: row.id, event_type: eventType, reason: row.learning, metrics: row.verdict_metrics });
        outcomeEvents++;
      }
    }
  }

  console.log(
    `${rows?.length ?? 0} sprint_hypotheses-rijen bekeken, ${skipped} al eerder gevuld (idempotent overgeslagen).\n` +
    `${toInsert.length} nieuwe events: ${proposed} proposed, ${accepted} accepted, ${rejected} rejected, ${outcomeEvents} outcome-gerelateerd.`
  );

  if (DRY_RUN) {
    console.log("\n--dry-run: niets weggeschreven.");
    return;
  }

  const BATCH = 200;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from("agency_memory_events").insert(batch);
    if (insErr) throw new Error(`insert mislukt bij batch vanaf index ${i}: ${insErr.message}`);
    console.log(`  batch ${i}-${i + batch.length}: weggeschreven.`);
  }
  console.log(`\n${toInsert.length} events weggeschreven.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

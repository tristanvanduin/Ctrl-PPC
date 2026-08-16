// Fase 4 (docs/MASTERPLAN.md sectie 9), punt 5: de aggregatie achter het trackrecordscherm uit
// sectie 3.3. Leest agency_memory_events (append-only, migratie 091) samen met
// sprint_hypotheses (voor de source-uitsplitsing) en rekent de tellingen/hitrate uit.
//
// GEEN NIEUWE VIEW OF RPC: de datavolumes hier zijn klein (127 hypotheses, een veelvoud aan
// events) -- de aggregatie in JavaScript is eenvoudiger te lezen en te testen dan een SQL-view,
// en snel genoeg op deze schaal.
//
// UITSPLITSING PER "SIGNAALTYPE": sectie 3.3's voorbeeld ("creative fatigue op Meta") suggereert
// een fijnmazige categorie die vandaag nergens als apart veld bestaat. sprint_hypotheses.source
// (analysis/second_opinion/search_terms/meta_signals/...) is de dichtstbijzijnde ECHTE, al
// gevulde indeling. Een fijnere categorie verzinnen uit de hypothese-tekst zou precies de gok
// zijn die de vertrouwensdoctrine (sectie 3) verbiedt -- dus dit gebruikt source, eerlijk
// grover dan het voorbeeld.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";

interface EventRow {
  hypothesis_id: string | null;
  event_type: string;
  reason: string | null;
  created_at: string;
}

interface HypothesisRow {
  id: string;
  source: string | null;
  hypothesis: string;
}

const OUTCOME_MET = "hypothesis_outcome_met";
const OUTCOME_MISSED = "hypothesis_outcome_missed";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const [eventsRes, hypothesesRes] = await Promise.all([
    supabase.from("agency_memory_events").select("hypothesis_id, event_type, reason, created_at").eq("client_id", clientId),
    supabase.from("sprint_hypotheses").select("id, source, hypothesis").eq("client_id", clientId),
  ]);

  if (eventsRes.error) return Response.json({ error: eventsRes.error.message }, { status: 500 });
  if (hypothesesRes.error) return Response.json({ error: hypothesesRes.error.message }, { status: 500 });

  const events = (eventsRes.data ?? []) as EventRow[];
  const sourceByHypothesisId = new Map<string, string>();
  const textByHypothesisId = new Map<string, string>();
  for (const h of (hypothesesRes.data ?? []) as HypothesisRow[]) {
    sourceByHypothesisId.set(h.id, h.source ?? "onbekend");
    textByHypothesisId.set(h.id, h.hypothesis);
  }

  const count = (type: string) => events.filter((e) => e.event_type === type).length;

  const totals = {
    proposed: count("hypothesis_proposed"),
    accepted: count("hypothesis_accepted"),
    rejected: count("hypothesis_rejected"),
    executed: count("hypothesis_executed"),
    notExecuted: count("hypothesis_not_executed"),
    outcomeMet: count(OUTCOME_MET),
    outcomeMissed: count(OUTCOME_MISSED),
    unmeasurable: count("hypothesis_unmeasurable"),
    expired: count("hypothesis_expired"),
  };

  const evaluatedTotal = totals.outcomeMet + totals.outcomeMissed;
  const hitRate = evaluatedTotal > 0 ? totals.outcomeMet / evaluatedTotal : null;

  const bySourceMap = new Map<string, { proposed: number; met: number; missed: number }>();
  for (const e of events) {
    if (!e.hypothesis_id) continue;
    const source = sourceByHypothesisId.get(e.hypothesis_id) ?? "onbekend";
    const bucket = bySourceMap.get(source) ?? { proposed: 0, met: 0, missed: 0 };
    if (e.event_type === "hypothesis_proposed") bucket.proposed++;
    if (e.event_type === OUTCOME_MET) bucket.met++;
    if (e.event_type === OUTCOME_MISSED) bucket.missed++;
    bySourceMap.set(source, bucket);
  }
  const bySource = [...bySourceMap.entries()]
    .map(([source, b]) => ({
      source, proposed: b.proposed, met: b.met, missed: b.missed,
      hitRate: b.met + b.missed > 0 ? b.met / (b.met + b.missed) : null,
    }))
    .sort((a, b) => (b.met + b.missed) - (a.met + a.missed));

  const recentRejections = events
    .filter((e) => e.event_type === "hypothesis_rejected" && e.reason)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10)
    .map((e) => ({
      hypothesis: e.hypothesis_id ? (textByHypothesisId.get(e.hypothesis_id) ?? "") : "",
      reason: e.reason,
      createdAt: e.created_at,
    }));

  return Response.json({ totals, hitRate, bySource, recentRejections });
}

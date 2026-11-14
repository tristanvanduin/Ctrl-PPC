// Test: generation_jobs.triggered_by wordt gevuld, met "cron" voor de cron (CRON_SECRET en de vlag
// automatisch) en "handmatig" voor de rest (lib/progress/gestart-door.ts, createProgressJob in lib/progress/server.ts).
// Draaien: tsx lib/progress/__gestart_door_test.ts
//
// Tot 14 november 2026 zette buildQueuedJob triggered_by vast op null; elke rij in generation_jobs
// had hem leeg, en het slagingspercentage kon geplande en handmatige runs niet scheiden.

import { gestartDoorUitVerzoek, GESTART_DOOR_CRON, GESTART_DOOR_HANDMATIG } from "./gestart-door";
import { buildQueuedJob } from "./core";
import { createProgressJob } from "./server";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const kop = (auth?: string) => new Headers(auth ? { authorization: auth } : {});

// ── wie startte het verzoek ──────────────────────────────────────────────────
// Cron = het CRON_SECRET als Bearer EN de vlag automatisch. Het geheim alleen is een handmatige
// aanroep die langs de toegangscheck moet (scripts/score-evaluatieset.mjs --vers); de vlag alleen
// kan iedereen meesturen.
check("geheim met de vlag (app/api/cron/trigger-sops): cron",
  gestartDoorUitVerzoek(kop("Bearer geheim"), true, { cronSecret: "geheim" }) === GESTART_DOOR_CRON);
check("geheim zonder de vlag (de verse evaluatierun): handmatig",
  gestartDoorUitVerzoek(kop("Bearer geheim"), false, { cronSecret: "geheim" }) === GESTART_DOOR_HANDMATIG);
check("de vlag zonder het geheim: handmatig",
  gestartDoorUitVerzoek(kop(), true, { cronSecret: "geheim" }) === GESTART_DOOR_HANDMATIG);
check("geen Authorization en geen vlag (de knop in de browser): handmatig",
  gestartDoorUitVerzoek(kop(), false, { cronSecret: "geheim" }) === GESTART_DOOR_HANDMATIG);
check("een ander Bearer-token met de vlag: handmatig, niet cron",
  gestartDoorUitVerzoek(kop("Bearer iets-anders"), true, { cronSecret: "geheim" }) === GESTART_DOOR_HANDMATIG);
// Zonder geheim in de omgeving mag "Bearer " (leeg) geen cron worden: dan zou elk verzoek met een
// lege Bearer als gepland tellen.
check("geen CRON_SECRET en een lege Bearer: handmatig",
  gestartDoorUitVerzoek(kop("Bearer "), true, { cronSecret: "" }) === GESTART_DOOR_HANDMATIG
  && gestartDoorUitVerzoek(kop("Bearer undefined"), true, { cronSecret: null }) === GESTART_DOOR_HANDMATIG);
check("een bekende gebruiker: zijn id in plaats van 'handmatig'",
  gestartDoorUitVerzoek(kop(), false, { cronSecret: "geheim", gebruikerId: "user-42" }) === "user-42");
check("de cron wint van een gebruikers-id",
  gestartDoorUitVerzoek(kop("Bearer geheim"), true, { cronSecret: "geheim", gebruikerId: "user-42" }) === GESTART_DOOR_CRON);

// ── de rij die geschreven wordt ──────────────────────────────────────────────
check("buildQueuedJob neemt triggeredBy over",
  buildQueuedJob({ jobId: "j1", jobType: "weekly_sop", triggeredBy: "cron", now: "2026-11-14T05:20:00Z" }).triggered_by === "cron");
check("buildQueuedJob zonder triggeredBy: null (rijen van andere bouwers blijven zoals ze waren)",
  buildQueuedJob({ jobId: "j2", jobType: "weekly_sop", now: "2026-11-14T05:20:00Z" }).triggered_by === null);

// createProgressJob met een nep-client die vastlegt wat er naar generation_jobs gaat.
const geschreven: { tabel: string; rij: Record<string, unknown> }[] = [];
const nepSupabase = {
  from(tabel: string) {
    return {
      upsert(rij: Record<string, unknown>) {
        geschreven.push({ tabel, rij });
        return Promise.resolve({ error: null });
      },
    };
  },
} as unknown as SupabaseClient;

async function main(): Promise<void> {
  await createProgressJob(nepSupabase, {
    jobId: "job-cron", clientId: "demo-greentech", jobType: "monthly_sop", triggeredBy: GESTART_DOOR_CRON,
  });
  await createProgressJob(nepSupabase, {
    jobId: "job-knop", clientId: "demo-greentech", jobType: "weekly_sop", triggeredBy: GESTART_DOOR_HANDMATIG,
  });
  const jobRijen = geschreven.filter((g) => g.tabel === "generation_jobs").map((g) => g.rij);
  check("createProgressJob schrijft triggered_by = cron naar generation_jobs",
    jobRijen.some((r) => r.job_id === "job-cron" && r.triggered_by === "cron"), JSON.stringify(jobRijen));
  check("createProgressJob schrijft triggered_by = handmatig naar generation_jobs",
    jobRijen.some((r) => r.job_id === "job-knop" && r.triggered_by === "handmatig"), JSON.stringify(jobRijen));

  console.log(`gestart-door: ${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });

-- 089: Fase 3 (docs/MASTERPLAN.md sectie 9) — claim-logica voor generation_jobs als action
-- queue, plus het job_type dat de queue-mechaniek bewijst zonder een bestaande, synchrone
-- SOP-route aan te raken (zie de sessiebeslissing "infrastructuur eerst, ontkoppelen later" --
-- welk echt job_type ooit via deze weg draait is een aparte, latere beslissing).
--
-- DRAAIEN: idempotent. Breidt generation_jobs' job_type-constraint uit en maakt één functie aan;
-- verwijdert of wijzigt niets bestaands.
--
-- ── WAAROM job_type UITBREIDEN EN GEEN NIEUWE TABEL ─────────────────────────
--
-- Migratie 004 koos al expliciet voor generation_jobs als enige plek voor run-administratie
-- ("conform de no-go: geen dubbele administratie") en gaf de tabel toen al attempts/
-- scheduled_for/triggered_by — precies de kolommen die een queue nodig heeft, tot nu toe
-- ongebruikt buiten die migratie zelf. Dezelfde keuze geldt hier onverkort.
--
-- ── RETRY-BELEID, AL VASTGELEGD IN 004'S KOLOMCOMMENTAAR ────────────────────
--
-- "failed met attempts 0 gaat na minimaal 30 minuten terug naar pending met attempts 1; een
-- tweede mislukking is definitief." attempts telt dus MISLUKKINGEN, niet claims — de claim-
-- functie hieronder raakt attempts niet aan, alleen de aanroepende route (bij een mislukte
-- verwerking) telt op en beslist retry-met-backoff vs. definitief falen.
--
-- ── WAAROM FOR UPDATE SKIP LOCKED EN GEEN advisory lock ─────────────────────
--
-- Twee gelijktijdige cron-invocaties (of een handmatige test naast een echte run) mogen nooit
-- dezelfde rij claimen. SKIP LOCKED laat een tweede aanroeper simpelweg de volgende beschikbare
-- rij pakken in plaats van te wachten of te falen — precies het gedrag van een queue-worker, niet
-- van een kritieke sectie. select ... for update en de update staan in dezelfde functie, dus in
-- dezelfde impliciete transactie: claimen en op running zetten is atomisch, geen race tussen twee
-- workers die allebei dezelfde net-vrijgekomen rij zien.

alter table generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table generation_jobs add constraint generation_jobs_job_type_check check (job_type in (
  'monthly_sop',
  'biweekly_sop',
  'weekly_sop',
  'second_opinion',
  'report_generation',
  'pdf_generation',
  'queue_smoke_test'
));

comment on constraint generation_jobs_job_type_check on generation_jobs is
  'queue_smoke_test (089): bewijst de action-queue-mechaniek (claim/llm-router/uitgavenplafond) '
  'zonder een bestaande synchrone SOP-route te ontkoppelen. Geen consument buiten '
  'app/api/cron/process-action-queue en de bijbehorende verificatiescripts.';

create or replace function claim_generation_job(p_job_types text[] default null)
returns generation_jobs
language plpgsql
as $$
declare
  claimed generation_jobs;
begin
  select * into claimed
  from generation_jobs
  where status = 'queued'
    and (scheduled_for is null or scheduled_for <= now())
    and (p_job_types is null or job_type = any(p_job_types))
  order by coalesce(scheduled_for, started_at)
  limit 1
  for update skip locked;

  if claimed.job_id is null then
    return null;
  end if;

  update generation_jobs
  set status = 'running', started_at = now(), updated_at = now()
  where job_id = claimed.job_id
  returning * into claimed;

  return claimed;
end;
$$;

comment on function claim_generation_job(text[]) is
  '089: atomisch de oudste beschikbare queued job claimen (status->running), of null als er '
  'niets beschikbaar is. FOR UPDATE SKIP LOCKED zodat gelijktijdige aanroepen nooit dezelfde '
  'rij claimen. Raakt attempts niet aan -- dat telt mislukkingen, zie de kolomcommentaar op '
  'generation_jobs.attempts (migratie 004) en app/api/cron/process-action-queue/route.ts.';

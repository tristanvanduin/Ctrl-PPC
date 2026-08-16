-- 090: twee bugfixes gevonden tijdens de live verificatie van 089's action queue.
--
-- ── BUG 1: claim_generation_job retourneerde geen SQL NULL bij een lege queue ────────────────
--
-- 089's functie was `returns generation_jobs` (een enkel composiet type) met `return null;` als
-- er niets te claimen viel. In PL/pgSQL serialiseert een composiet-`return null` niet als een
-- echte SQL NULL naar de aanroeper toe -- PostgREST geeft een RIJ VAN NULLS terug (job_id: null,
-- job_type: null, ...), geen JSON null. In JavaScript is zo'n object truthy: de aanroepende
-- route's `if (!claimed) break` sloeg daardoor nooit aan, en de verwerkingslus bleef 24 keer een
-- fantoomrij "claimen" tot de eigen veiligheidscap (25 pogingen) hem stopte. Live gevonden met
-- de verificatie: een derde claim-poging op een lege queue gaf een object terug in plaats van
-- null, en een echte route-run verwerkte "25" jobs terwijl er maar 1 echte klaarstond.
--
-- FIX: `returns setof generation_jobs` i.p.v. een los composiet, met `return;` (geen rijen) bij
-- niets te claimen. Een lege result-set levert via `.maybeSingle()` correct JavaScript `null` op
-- -- geen composiet-null-gotcha meer. app/api/cron/process-action-queue/route.ts kreeg
-- daarnaast een tweede, onafhankelijke check (`!claimed.job_id`) zodat een toekomstige variant
-- van dezelfde fout niet opnieuw een fantoomlus kan veroorzaken.
--
-- ── BUG 2: generation_job_events.upsert() had nergens een unique constraint om tegen te matchen
--
-- lib/progress/server.ts's upsertEvent() doet al sinds het progress-systeem bestaat
-- `.upsert(event, { onConflict: "job_id,phase_key" })`, maar geen enkele migratie heeft ooit een
-- unique constraint op (job_id, phase_key) gezet -- alleen de losse `id`-primary-key uit
-- scripts/generation-progress.sql. Zonder die constraint weigert Postgres de upsert met "there
-- is no unique or exclusion constraint matching the ON CONFLICT specification". De aanroeper
-- (upsertEvent) logt die fout alleen (logOnce), gooit hem niet door -- dus dit faalde stil, voor
-- elke fase-overgang, in elke echte monthly/weekly/biweekly/second-opinion/report-run, zonder dat
-- de zichtbare voortgangsbalk (die via een plain update() op generation_jobs zelf loopt, niet via
-- deze tabel) er iets van liet merken. Geverifieerd voor deze fix: 1.926 bestaande rijen, nul
-- duplicaten op (job_id, phase_key) -- de constraint hieronder kan dus veilig toegevoegd worden.
--
-- FIX: de ontbrekende unique constraint alsnog toevoegen. Puur additief, raakt geen bestaande rij.

-- create or replace kan het returntype niet wijzigen (composiet -> setof); Postgres eist een
-- expliciete drop eerst (42P13: cannot change return type of existing function).
drop function if exists claim_generation_job(text[]);

create function claim_generation_job(p_job_types text[] default null)
returns setof generation_jobs
language plpgsql
as $$
declare
  v_job_id uuid;
begin
  select job_id into v_job_id
  from generation_jobs
  where status = 'queued'
    and (scheduled_for is null or scheduled_for <= now())
    and (p_job_types is null or job_type = any(p_job_types))
  order by coalesce(scheduled_for, started_at)
  limit 1
  for update skip locked;

  if v_job_id is null then
    return; -- lege result-set, geen composiet-rij-van-nulls
  end if;

  return query
    update generation_jobs
    set status = 'running', started_at = now(), updated_at = now()
    where job_id = v_job_id
    returning *;
end;
$$;

comment on function claim_generation_job(text[]) is
  '090 (was 089, gefixt): atomisch de oudste beschikbare queued job claimen (status->running), '
  'setof zodat een lege queue een echte lege result-set geeft en niet een composiet-rij-van-nulls. '
  'FOR UPDATE SKIP LOCKED zodat gelijktijdige aanroepen nooit dezelfde rij claimen. Raakt attempts '
  'niet aan -- dat telt mislukkingen, zie generation_jobs.attempts (migratie 004) en '
  'app/api/cron/process-action-queue/route.ts.';

alter table generation_job_events drop constraint if exists generation_job_events_job_phase_key;
alter table generation_job_events
  add constraint generation_job_events_job_phase_key unique (job_id, phase_key);

comment on constraint generation_job_events_job_phase_key on generation_job_events is
  '090: ontbrak sinds het progress-systeem is gebouwd, waardoor upsertEvent()''s '
  'onConflict:"job_id,phase_key" altijd faalde (stil gelogd, nooit doorgegooid). Geverifieerd '
  'voor toevoeging: 1.926 bestaande rijen, nul duplicaten op dit paar.';

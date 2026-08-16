-- 091: Fase 4 (docs/MASTERPLAN.md sectie 9) — agency_memory_events, de append-only geheugenlaag
-- achter het trackrecordscherm uit sectie 3.3.
--
-- ── DE TIEN EVENTTYPES ───────────────────────────────────────────────────────
--
-- Nergens in deze repo (of de negentien strategische documenten die sectie 0 van
-- MASTERPLAN.md noemt -- die bestaan hier niet als bestand) staat een kant-en-klare lijst.
-- Deze indeling is opnieuw ontworpen tegen wat al bestaat: sprint_hypotheses.status
-- (pending/accepted/rejected/completed, lib/learning/hypothesis-status.ts) en
-- sprint_hypotheses.outcome (accepted/rejected/unmeasurable/expired/niet_uitgevoerd/
-- uitgevoerd_en_gehaald/uitgevoerd_en_niet_gehaald, geschreven door
-- app/api/cron/evaluate-hypotheses/route.ts). Negen van de tien krijgen in dit werk al een
-- echte schrijver; confidence_recalibrated (loop 5, sectie 4: "als het systeem weet waar het
-- misgokt, kan de confidence op dat signaaltype omlaag") krijgt bewust nog GEEN automatische
-- schrijver -- dat vergt een kalibratieberekening die nog niet bestaat. Het eventtype staat
-- er alvast, leeg, zodat het schema niet nogmaals hoeft te wijzigen zodra die berekening er wel
-- komt. Niet stiekem doen alsof het al gebeurt.
--
-- ── WAAROM GEEN agency_id ────────────────────────────────────────────────────
--
-- fact_core en llm_usage dragen agency_id, maar die kregen dat pas in latere migraties
-- (075/076 respectievelijk 061) toen er een echte tweede-bureau-vraag lag. Vandaag is er één
-- bureau. agency_id nu al toevoegen betekent een accounts-lookup bij elke schrijfactie voor
-- een kolom die niemand vandaag leest -- precies de vroegtijdige complexiteit die dit plan
-- elders (sectie 9, fase 2-poort) afwijst. client_id is genoeg; een latere migratie kan
-- agency_id toevoegen met een backfill, zoals fact_core al voordeed.
--
-- ── WAAROM ECHTE APPEND-ONLY-TRIGGERS EN NIET ALLEEN EEN RLS-CONVENTIE ───────
--
-- Schrijven loopt in deze app via de service role (app/api/data/[table]/route.ts), die RLS
-- volledig omzeilt. Een RLS-policy die update/delete gewoon niet definieert beschermt dus
-- niets tegen toekomstige servercode die per ongeluk een update() op deze tabel schrijft. Een
-- trigger die UPDATE/DELETE altijd weigert werkt wel, ongeacht rol: dat is hier het punt van
-- "append-only" -- een geschiedenis die nooit wordt herschreven, ook niet per ongeluk.

create table if not exists agency_memory_events (
  id uuid primary key default gen_random_uuid(),
  client_id text,
  hypothesis_id uuid references sprint_hypotheses(id) on delete cascade,
  event_type text not null check (event_type in (
    'hypothesis_proposed',
    'hypothesis_accepted',
    'hypothesis_rejected',
    'hypothesis_executed',
    'hypothesis_not_executed',
    'hypothesis_outcome_met',
    'hypothesis_outcome_missed',
    'hypothesis_unmeasurable',
    'hypothesis_expired',
    'confidence_recalibrated'
  )),
  -- Bij hypothesis_rejected: de afwijzingsreden (decision_reason, of de rationale-JSON's
  -- rejected_reason -- zie de kop van scripts/backfill-agency-memory-events.ts voor waarom
  -- beide bronnen nodig zijn). Bij een outcome-event: een korte samenvatting.
  reason text,
  -- Bij een outcome-event: hetzelfde soort cijfermateriaal als sprint_hypotheses.verdict_metrics
  -- (baseline/measured/delta/predicted), zodat het trackrecordscherm "voorspeld 12%, gerealiseerd
  -- 9%" kan tonen zonder terug te hoeven joinen naar de brontabel voor elk cijfer.
  metrics jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agency_memory_events_client on agency_memory_events (client_id, created_at);
create index if not exists idx_agency_memory_events_hypothesis on agency_memory_events (hypothesis_id);
create index if not exists idx_agency_memory_events_type on agency_memory_events (event_type);

alter table agency_memory_events enable row level security;
drop policy if exists agency_memory_events_zichtbaar on agency_memory_events;
create policy agency_memory_events_zichtbaar on agency_memory_events for select
  using (client_id in (select app_zichtbare_klanten()));

create or replace function agency_memory_events_geen_mutaties()
returns trigger
language plpgsql
as $$
begin
  raise exception 'agency_memory_events is append-only: % is niet toegestaan', TG_OP;
end;
$$;

drop trigger if exists agency_memory_events_geen_update on agency_memory_events;
create trigger agency_memory_events_geen_update
  before update on agency_memory_events
  for each row execute function agency_memory_events_geen_mutaties();

drop trigger if exists agency_memory_events_geen_delete on agency_memory_events;
create trigger agency_memory_events_geen_delete
  before delete on agency_memory_events
  for each row execute function agency_memory_events_geen_mutaties();

comment on table agency_memory_events is
  '091, Fase 4 (docs/MASTERPLAN.md sectie 9): append-only geheugenlaag achter het '
  'trackrecordscherm (sectie 3.3). Schrijvers: lib/second-opinion/findings-to-hypotheses.ts '
  '(hypothesis_proposed), app/api/insights/monthly-hypotheses/route.ts en '
  'components/insights/proposal-queue.tsx (accepted/rejected), '
  'app/api/cron/evaluate-hypotheses/route.ts (executed/not_executed/outcome_met/'
  'outcome_missed/unmeasurable/expired). confidence_recalibrated heeft nog geen schrijver.';

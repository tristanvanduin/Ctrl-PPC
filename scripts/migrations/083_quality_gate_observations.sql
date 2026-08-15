-- 083: observatietabel voor de negen kwaliteitspoorten (lib/decision/quality-gates.ts).
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- Onderzocht op verzoek van de gebruiker (masterplan: "kwaliteitspoorten van shadow naar
-- blocking"): runGates() bleek nergens aan de echte, live maandanalyse te hangen -- alleen aan
-- een admin-diagnosescherm (app/api/admin/kwaliteitspoorten/route.ts, on-demand, read-only) en
-- een niet-blootgestelde skeleton-route (lib/decision/decision-skeleton.ts). Er was dus geen
-- shadow-observatie van de live pijplijn om ooit naar blocking te promoveren.
--
-- Gekozen aanpak: eerst ECHT observeren. app/api/analysis/monthly/route.ts roept runGates() nu
-- aan het eind van elke run aan (lib/decision/gate-observations.ts), met de data die de run toch
-- al in het geheugen heeft -- geen extra bevraging, geen wijziging aan wat er bewaard of getoond
-- wordt, nooit blokkerend (fire-and-forget, alle fouten worden geslikt en gelogd). Deze tabel is
-- waar dat in landt, zodat over tijd te zien is hoe vaak elke poort pass/warn/fail geeft op echte
-- runs, voordat er ooit iets van gaat blokkeren.
--
-- Alleen service_role: dit is intern observatiemateriaal, geen klantdata om te tonen.

create table if not exists quality_gate_observations (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  client_id text not null,
  agency_id uuid not null,
  analysis_date date not null,
  gate_name text not null,
  status text not null,           -- pass / warn / fail (GateStatus)
  reason text,
  affected_entity text,
  created_at timestamptz not null default now()
);

create index if not exists idx_quality_gate_observations_gate on quality_gate_observations (gate_name, status, created_at);
create index if not exists idx_quality_gate_observations_client on quality_gate_observations (client_id, analysis_date);

comment on table quality_gate_observations is
  'Observaties van de negen kwaliteitspoorten op echte maandruns, puur diagnostisch. Nooit blokkerend -- zie de kop van deze migratie en lib/decision/gate-observations.ts.';

alter table quality_gate_observations enable row level security;

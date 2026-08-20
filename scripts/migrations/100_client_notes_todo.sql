-- 100: client_notes krijgt een to-do-vorm naast de vrije notitie.
--
-- Feedback punt 12: notities splitsen in notities en to-do's met een afvinksysteem, plus een
-- "nog X taken open"-teller op de Vandaag-pagina. Geen aparte tabel -- dezelfde rij, twee velden
-- extra: `is_todo` (is dit een taak of een vrije notitie) en `done` (voor een taak: afgevinkt of
-- niet). Een gewone notitie heeft `is_todo = false` en `done` blijft dan betekenisloos (niet
-- getoond in de UI), zodat bestaande notities zonder migratie-datawijziging gewoon notities
-- blijven.
--
-- NIET UITGEVOERD TEGEN DE DATABASE — deze sandbox heeft geen SUPABASE_ACCESS_TOKEN (zie
-- scripts/supabase-sql.mjs: DDL kan niet via de service-role-sleutel, alleen via de Management
-- API met een personal access token). Handmatig draaien voordat de to-do-UI iets aan deze
-- kolommen probeert te schrijven.

alter table client_notes
  add column if not exists is_todo boolean not null default false,
  add column if not exists done    boolean not null default false;

comment on column client_notes.is_todo is 'true = to-do met afvinkstatus, false = vrije notitie (done is dan betekenisloos)';
comment on column client_notes.done    is 'alleen relevant als is_todo = true';

-- Snelle telling "nog X taken open" op de Vandaag-pagina, cross-client (zie use-today-feed.ts):
-- filtert op is_todo = true and done = false over de zichtbare klanten van de gebruiker.
create index if not exists client_notes_open_todos_idx
  on client_notes (client_id)
  where is_todo = true and done = false;

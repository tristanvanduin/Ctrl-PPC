-- 104: sop_tasks krijgt de sop_type-kolom die zijn twee zustertabellen al hadden.
--
-- ── HET PROBLEEM ─────────────────────────────────────────────────────────────
--
-- sop_insights en sop_recommendations dragen allebei een sop_type; sop_tasks als enige niet:
--
--   sop_insights          ... analysis_id, sop_type, analysis_date, insight_type, ...
--   sop_recommendations   ... analysis_id, insight_id, sop_type, analysis_date, ...
--   sop_tasks             ... recommendation_id, analysis_date, title, ...        <-- geen sop_type
--
-- Twee lezers betalen daarvoor.
--
-- 1. lib/tasks/prior-tasks.ts (priorTasksVoorGrounding) filtert op client_id en datum, meer kan
--    het niet. De maandprompt krijgt daardoor de taken van de Meta- en LinkedIn-runs ongelabeld
--    binnen, mét de instructie "herhaal afgeronde taken niet". Een Google-analyse leest dan dat
--    een LinkedIn-formulierwijziging al is uitgevoerd en laat een echte Google-actie liggen. Dat
--    is de gevaarlijke kant: een verkeerde bewering, niet een ontbrekende.
--
-- 2. components/insights/tasks-block.tsx leidt het kanaal van een taak af via zijn aanbeveling en
--    valt terug op "google" als die ontbreekt. Van de 1156 taken in deze database hebben er 768
--    geen recommendation_id -- twee derde krijgt dus een Google-badge, ongeacht het echte kanaal.
--
-- ── WAAROM sop_type EN NIET channel ──────────────────────────────────────────
--
-- Een kanaalkolom zou het kanaal geven en de cadans niet, terwijl sop_type allebei draagt en al
-- de sleutel is die de rest van de keten gebruikt (CHANNEL_CONFIG.sopTypeKey in
-- lib/analysis/sop-channel-config.ts, sop_analysis_output, de twee zustertabellen). Een tweede,
-- grovere as ernaast zou betekenen dat "welk kanaal is dit" op twee manieren te beantwoorden is.
-- Het kanaal volgt uit sop_type via channelOfSopType(), dat er al staat.
--
-- ── DE BACKFILL ──────────────────────────────────────────────────────────────
--
-- Twee stappen, van precies naar minder precies, en wat daarna nog onbekend is blijft null.
-- Nullable dus, en geen default: een verzonnen sop_type is erger dan een lege kolom, want hij
-- leest als een meting.
--
--   stap 1  via recommendation_id -> sop_recommendations.sop_type          388 van 1156
--   stap 2  via (client_id, analysis_date) in sop_analysis_output, maar    582 van 1156
--           UITSLUITEND waar die dag precies EEN sop_type kent. Draaiden
--           er die dag meer cadansen of kanalen, dan is de taak niet toe
--           te wijzen en blijft hij null.
--   rest    186 rijen, allemaal op demo-klanten, op dagen waarop alle       0 van 1156
--           kanalen tegelijk zijn gedraaid. Geen productieklant blijft
--           over: die zijn na stap 2 volledig gelabeld.
--
-- Stap 2 is geldig omdat sop_tasks.analysis_date en sop_analysis_output.analysis_date uit
-- dezelfde variabele van dezelfde run komen (app/api/analysis/monthly/route.ts,
-- lib/analysis/extract-structured.ts) -- ze kunnen dus niet uiteenlopen.

alter table sop_tasks add column if not exists sop_type text;

-- Stap 1: de harde koppeling.
update sop_tasks t
set sop_type = sr.sop_type
from sop_recommendations sr
where sr.id = t.recommendation_id
  and t.sop_type is null
  and sr.sop_type is not null;

-- Stap 2: de dag als sleutel, alleen waar die dag eenduidig is.
with eenduidige_dag as (
  select client_id, analysis_date, min(sop_type) as sop_type
  from sop_analysis_output
  where sop_type is not null
  group by client_id, analysis_date
  having count(distinct sop_type) = 1
)
update sop_tasks t
set sop_type = d.sop_type
from eenduidige_dag d
where d.client_id = t.client_id
  and d.analysis_date = t.analysis_date
  and t.sop_type is null;

-- 034 legde al idx_sop_tasks_client_datum aan voor (client_id, analysis_date desc). De
-- grounding-query filtert voortaan ook op sop_type; die kolom hoort dus vóór de datum in de
-- index, want hij wordt op gelijkheid bevraagd (`in`) en de datum op bereik (`lt`).
create index if not exists idx_sop_tasks_client_soptype_datum
  on sop_tasks (client_id, sop_type, analysis_date desc);

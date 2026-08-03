-- 034: de ontbrekende indexen op client_id.
--
-- DRAAIEN: idempotent, veilig te herhalen, en op elk moment. Puur additief — geen kolom, rij,
-- policy of trigger wordt aangeraakt. Terugdraaien is `drop index`.
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- Elke query in deze app begint met "voor deze klant". Van de 24 tabellen met meer dan 500 rijen
-- hadden er zeven geen index op client_id, dus die deden een sequentiële scan over álle klanten
-- om er één te vinden. Gemeten vóór deze migratie:
--
--   sop_insights                  183,8 ms   Seq Scan
--   search_term_analysis           36,5 ms   Seq Scan
--   ads_campaign_country_monthly   37,3 ms   Seq Scan
--
-- Bij 60 klanten valt dat niet op. Bij 400 wordt diezelfde scan bijna zeven keer zo duur, en
-- omdat het per query is telt het op over elk scherm dat meerdere kaarten laadt.
--
-- ── WAAROM SAMENGESTELD EN NIET ALLEEN client_id ────────────────────────────
--
-- Geen enkele query vraagt "alles van deze klant" zonder periode. Ze vragen een maand, een
-- reeks maanden of een analysedatum. Een index op alleen client_id brengt de scan terug van alle
-- klanten naar één klant; met de tijdkolom erbij wordt het de gevraagde periode binnen die klant.
-- Dat verschil groeit met de historie, en historie is precies wat er elke maand bij komt.
--
-- De volgorde is client_id eerst: dat is de kolom waarop altijd exact gefilterd wordt, de
-- tijdkolom is een bereik. Andersom zou de index alleen bruikbaar zijn als de periode vaststaat.
--
-- ── NIET IN DEZE MIGRATIE ───────────────────────────────────────────────────
--
-- generation_job_events stond in mijn eerste inventarisatie bij de tabellen zonder client-index,
-- maar die tabel heeft helemaal geen client_id-kolom; hij hangt aan generation_jobs. Een tabel
-- zonder de kolom heeft er per definitie geen index op. Het waren er dus zeven, geen acht.

create index if not exists idx_sop_insights_client_datum
  on sop_insights (client_id, analysis_date desc);

create index if not exists idx_search_term_analysis_client_datum
  on search_term_analysis (client_id, analysis_date desc);

create index if not exists idx_sop_tasks_client_datum
  on sop_tasks (client_id, analysis_date desc);

create index if not exists idx_ads_campaign_country_monthly_client_maand
  on ads_campaign_country_monthly (client_id, month desc);

create index if not exists idx_ads_pmax_network_breakdown_client_maand
  on ads_pmax_network_breakdown (client_id, month desc);

create index if not exists idx_ads_asset_group_perf_client_maand
  on ads_asset_group_performance_monthly (client_id, month desc);

create index if not exists idx_ads_product_performance_client_maand
  on ads_product_performance_monthly (client_id, month desc);

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hierna hoort elk van de zeven een index op client_id te hebben.

select tablename, count(*) as indexen_op_client
from pg_indexes
where schemaname = 'public'
  and indexdef like '%client_id%'
  and tablename in ('sop_insights','search_term_analysis','sop_tasks',
                    'ads_campaign_country_monthly','ads_pmax_network_breakdown',
                    'ads_asset_group_performance_monthly','ads_product_performance_monthly')
group by tablename
order by tablename;

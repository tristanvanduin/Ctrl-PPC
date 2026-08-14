-- 076: de zes kolommen uit 075 vullen en dwingend maken waar dat kan.
--
-- DRAAIEN: idempotent (elke UPDATE is een no-op op een rij die al klopt). Volgt op 075; draai
-- nooit vóór die migratie.
--
-- ── agency_id / client_id: altijd afleidbaar, dus NOT NULL ──────────────────
--
-- Elke fact_core/fact_dimension-rij heeft een account_id die naar accounts wijst (foreign key,
-- bestaat al). agency_id en client_id zijn dus voor GEEN ENKELE rij onbekend -- vandaar dwingend
-- na de backfill, in tegenstelling tot currency en leads hieronder.

update fact_core f set agency_id = a.agency_id, client_id = a.client_id
  from accounts a where a.id = f.account_id and (f.agency_id is distinct from a.agency_id
    or f.client_id is distinct from a.client_id);

update fact_dimension f set agency_id = a.agency_id, client_id = a.client_id
  from accounts a where a.id = f.account_id and (f.agency_id is distinct from a.agency_id
    or f.client_id is distinct from a.client_id);

-- ── source_table: precies per kanaal/niveau, zodat de backfill dezelfde herkomst draagt als de
--    vernieuwde refresh_fact_from_legacy() straks voor nieuwe rijen zet (migratie 077) ──────────

update fact_core set source_table = case
    when channel = 'google' and level = 'account'  then 'ads_account_monthly_legacy'
    when channel = 'google' and level = 'campaign' then 'ads_campaign_monthly_legacy'
    when channel = 'meta'     and level = 'account'  then 'meta_account_daily_legacy'
    when channel = 'meta'     and level = 'campaign' then 'meta_campaign_daily_legacy'
    when channel = 'meta'     and level = 'creative' then 'meta_ad_daily_legacy'
    when channel = 'linkedin' and level = 'account'  then 'linkedin_account_daily_legacy'
    when channel = 'linkedin' and level = 'campaign' then 'linkedin_campaign_daily_legacy'
    when channel = 'linkedin' and level = 'creative' then 'linkedin_creative_daily_legacy'
  end
where source_table is null;

-- De twee 'region'-inserts uit migratie 043 schrijven naar dezelfde dimension-waarde vanuit twee
-- verschillende brontabellen; alleen campaign_id onderscheidt ze (leeg = accountbreed = uit
-- ads_region_monthly, gevuld = per campagne = uit ads_geo_performance_monthly).
update fact_dimension set source_table = case
    when channel = 'google' and dimension = 'search_term' then 'ads_search_terms_monthly'
    when channel = 'google' and dimension = 'keyword'     then 'ads_keyword_performance_monthly'
    when channel = 'google' and dimension = 'device'      then 'ads_device_performance_monthly'
    when channel = 'google' and dimension = 'network'     then 'ads_network_performance_monthly'
    when channel = 'google' and dimension = 'audience'    then 'ads_audience_performance_monthly'
    when channel = 'google' and dimension = 'country'     then 'ads_country_monthly'
    when channel = 'google' and dimension = 'region' and campaign_id <> '' then 'ads_geo_performance_monthly'
    when channel = 'google' and dimension = 'region' and campaign_id  = '' then 'ads_region_monthly'
    when channel = 'linkedin' then 'linkedin_demographic_daily'
  end
where source_table is null;

-- ── currency: bekend waar er een connectie is, eerlijk onbekend voor Google en oudere rijen ─────

update fact_core f set currency = c.currency
  from meta_connections c where c.client_id = f.client_id and f.channel = 'meta' and f.currency is null;

update fact_core f set currency = c.currency
  from linkedin_connections c where c.client_id = f.client_id and f.channel = 'linkedin' and f.currency is null;

update fact_dimension f set currency = c.currency
  from meta_connections c where c.client_id = f.client_id and f.channel = 'meta' and f.currency is null;

update fact_dimension f set currency = c.currency
  from linkedin_connections c where c.client_id = f.client_id and f.channel = 'linkedin' and f.currency is null;

-- ── leads / data_quality_score: veilige defaults, geen verzonnen precisie ───────────────────────
--
-- leads op 0 en niet op een herrekende waarde: de precieze leads/conversions-splitsing voor
-- bestaande Meta/LinkedIn-rijen komt vanzelf goed zodra migratie 077's vernieuwde
-- refresh_fact_from_legacy() nogmaals over deze rijen heen loopt (on conflict do update). Deze
-- migratie hoeft dat dus niet te herhalen; 0 is intussen een correcte ondergrens, geen gok.

update fact_core set leads = 0 where leads is null;
update fact_dimension set leads = 0 where leads is null;
update fact_core set data_quality_score = 1.0 where data_quality_score is null;
update fact_dimension set data_quality_score = 1.0 where data_quality_score is null;

alter table fact_core
  alter column agency_id set not null,
  alter column client_id set not null,
  alter column leads set not null,
  alter column leads set default 0,
  alter column data_quality_score set not null,
  alter column data_quality_score set default 1.0,
  alter column source_table set not null;

alter table fact_dimension
  alter column agency_id set not null,
  alter column client_id set not null,
  alter column leads set not null,
  alter column leads set default 0,
  alter column data_quality_score set not null,
  alter column data_quality_score set default 1.0,
  alter column source_table set not null;

-- Voor de aggregaties die dit juist toevoegde: God Mode, macrotrends, de toekomstige God
-- View-laag. Zonder deze index scant elke "per bureau"-query fact_core/fact_dimension volledig.
create index if not exists idx_fact_core_agency on fact_core (agency_id, channel, grain, period_start desc);
create index if not exists idx_fact_dimension_agency on fact_dimension (agency_id, channel, dimension, grain, period_start desc);

-- ── Controle ────────────────────────────────────────────────────────────────
select
  (select count(*) from fact_core where agency_id is null or client_id is null or source_table is null) as fact_core_gaten,
  (select count(*) from fact_dimension where agency_id is null or client_id is null or source_table is null) as fact_dimension_gaten;

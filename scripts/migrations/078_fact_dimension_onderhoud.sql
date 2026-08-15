-- 078: refresh_fact_from_legacy() onderhoudt voortaan ook fact_dimension, en fact_core krijgt
-- Google week-grain op accountniveau.
--
-- DRAAIEN: idempotent, veilig te herhalen. Vervangt de functie; raakt geen bestaande rij totdat
-- hij voor het eerst wordt aangeroepen.
--
-- ── DE KERNVONDST VAN FASE 1 ───────────────────────────────────────────────
--
-- fact_dimension had sinds migratie 043 GEEN doorlopend onderhoud. Die migratie vulde de tabel
-- één keer met `on conflict do nothing` en niets heeft er sindsdien in bijgeschreven -- ook niet
-- toen de Google-sync nog draaide. refresh_fact_from_legacy() (migratie 044/050) hield alleen
-- fact_core, google_metrics, meta_metrics en linkedin_metrics bij; fact_dimension stond er niet
-- bij. Zelfs met een volledig gezonde sync zou deze tabel dus nooit meer bewogen zijn dan op de
-- dag dat migratie 043 draaide.
--
-- Dit bestand herhaalt de negen dimensie-inserts uit migratie 043, met twee wijzigingen:
--
--   1. `on conflict do update` in plaats van `do nothing` -- een sync herschrijft dertien maanden
--      aan data, dus een gewijzigd cijfer (Google herrekent conversies op de klikdatum, ruim
--      nadat de maand is afgesloten) moet meebewegen. Zie de motivering bij fact_core in
--      migratie 044/050, die hetzelfde argument voor die tabel al maakte.
--   2. De vijf kolommen uit migratie 075/076 worden vanaf nu bij elke rij gezet, niet pas
--      achteraf gebackfilld: agency_id, client_id, source_table (precies de herkomst, dezelfde
--      mapping als de backfill in migratie 076), leads (0 -- geen van de negen bronnen draagt een
--      apart leads-veld) en data_quality_score (1.0).
--
-- ── GOOGLE WEEK-GRAIN IN FACT_CORE ────────────────────────────────────────────
--
-- fact_core kende alleen maandgrain voor Google (uit ads_account_monthly_legacy en
-- ads_campaign_monthly_legacy). ads_account_weekly bestaat als levende, doorlopend gesyncte
-- tabel op accountniveau -- geen campagne-equivalent, dus alleen accountniveau hieronder. Dit is
-- precies de dekkinguitbreiding die docs/MASTERPLAN.md fase 1 vroeg.

create or replace function refresh_fact_from_legacy(p_client_id text default null)
returns table (onderdeel text, rijen bigint)
language plpgsql
as $$
declare
  n bigint;
  r record;
begin
  -- ── fact_core: Google maand (ongewijzigd, uit migratie 050) ─────────────────

  insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value,
                         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'account', '', a.name, 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_account_monthly_legacy', 0, 1.0
  from ads_account_monthly_legacy s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
        agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_core google/account maand'; rijen := n; return next;

  insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value,
                         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'campaign', coalesce(s.campaign_id,''), s.campaign_name, 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_campaign_monthly_legacy', 0, 1.0
  from ads_campaign_monthly_legacy s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value,
        entity_name = excluded.entity_name, synced_at = now(),
        agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_core google/campaign maand'; rijen := n; return next;

  -- ── fact_core: Google week, accountniveau (NIEUW, migratie 078) ─────────────
  --
  -- Geen campagne-equivalent: ads_account_weekly bestaat alleen op accountniveau.

  insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value,
                         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'account', '', a.name, 'week', s.week_start,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_account_weekly', 0, 1.0
  from ads_account_weekly s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
        agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_core google/account week'; rijen := n; return next;

  -- Meta (ongewijzigd, uit migratie 050)
  insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value,
                         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'meta', niveau.lvl, coalesce(niveau.eid,''), 'day', niveau.dag,
         coalesce(niveau.imp,0), coalesce(niveau.clk,0), coalesce(niveau.spd,0),
         coalesce(niveau.cnv,0), coalesce(niveau.val,0),
         a.agency_id, a.client_id, niveau.bron, coalesce(niveau.lds,0), 1.0
  from (
    select client_id, 'account'::text lvl, entity_id eid, date dag, impressions imp, clicks_all clk,
           spend spd, coalesce(conversions,0)+coalesce(leads,0) cnv, conversion_value val,
           leads lds, 'meta_account_daily_legacy'::text bron
      from meta_account_daily_legacy
    union all
    select client_id, 'campaign', entity_id, date, impressions, clicks_all, spend,
           coalesce(conversions,0)+coalesce(leads,0), conversion_value,
           leads, 'meta_campaign_daily_legacy' from meta_campaign_daily_legacy
    union all
    select client_id, 'creative', entity_id, date, impressions, clicks_all, spend,
           coalesce(conversions,0)+coalesce(leads,0), conversion_value,
           leads, 'meta_ad_daily_legacy' from meta_ad_daily_legacy
  ) niveau
  join accounts a on a.client_id = niveau.client_id
  where p_client_id is null or niveau.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
        agency_id = excluded.agency_id, client_id = excluded.client_id, leads = excluded.leads;
  get diagnostics n = row_count; onderdeel := 'fact_core meta'; rijen := n; return next;

  -- LinkedIn (ongewijzigd, uit migratie 050)
  insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value,
                         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'linkedin', niveau.lvl, coalesce(niveau.eid,''), 'day', niveau.dag,
         coalesce(niveau.imp,0), coalesce(niveau.clk,0), coalesce(niveau.spd,0),
         coalesce(niveau.cnv,0), coalesce(niveau.val,0),
         a.agency_id, a.client_id, niveau.bron, coalesce(niveau.lds,0), 1.0
  from (
    select client_id, 'account'::text lvl, entity_urn eid, date dag, impressions imp, clicks clk,
           spend spd, coalesce(one_click_leads,0)+coalesce(external_website_conversions,0) cnv,
           conversion_value val, one_click_leads lds, 'linkedin_account_daily_legacy'::text bron
      from linkedin_account_daily_legacy
    union all
    select client_id, 'campaign', entity_urn, date, impressions, clicks, spend,
           coalesce(one_click_leads,0)+coalesce(external_website_conversions,0), conversion_value,
           one_click_leads, 'linkedin_campaign_daily_legacy'
      from linkedin_campaign_daily_legacy
    union all
    select client_id, 'creative', entity_urn, date, impressions, clicks, spend,
           coalesce(one_click_leads,0)+coalesce(external_website_conversions,0), conversion_value,
           one_click_leads, 'linkedin_creative_daily_legacy'
      from linkedin_creative_daily_legacy
  ) niveau
  join accounts a on a.client_id = niveau.client_id
  where p_client_id is null or niveau.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
        agency_id = excluded.agency_id, client_id = excluded.client_id, leads = excluded.leads;
  get diagnostics n = row_count; onderdeel := 'fact_core linkedin'; rijen := n; return next;

  -- ── fact_dimension: de negen dimensies uit migratie 043, nu doorlopend (NIEUW, migratie 078) ──

  insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
         campaign_id, adgroup_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'search_term', s.search_term, s.search_term, coalesce(s.match_type,''),
         coalesce(s.campaign_id,''), coalesce(s.ad_group_id,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_search_terms_monthly', 0, 1.0
  from ads_search_terms_monthly s join accounts a on a.client_id = s.client_id
  where s.search_term is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/search_term'; rijen := n; return next;

  insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
         campaign_id, adgroup_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'keyword', coalesce(s.keyword_id, s.keyword_text), s.keyword_text,
         coalesce(s.match_type,''), coalesce(s.campaign_id,''), coalesce(s.ad_group_id,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_keyword_performance_monthly', 0, 1.0
  from ads_keyword_performance_monthly s join accounts a on a.client_id = s.client_id
  where coalesce(s.keyword_id, s.keyword_text) is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/keyword'; rijen := n; return next;

  insert into fact_dimension (account_id, channel, dimension, key, key_label,
         campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'device', s.device, s.device, coalesce(s.campaign_id,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_device_performance_monthly', 0, 1.0
  from ads_device_performance_monthly s join accounts a on a.client_id = s.client_id
  where s.device is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/device'; rijen := n; return next;

  insert into fact_dimension (account_id, channel, dimension, key, key_label,
         campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'network', s.network_type, s.network_type, coalesce(s.campaign_id,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_network_performance_monthly', 0, 1.0
  from ads_network_performance_monthly s join accounts a on a.client_id = s.client_id
  where s.network_type is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/network'; rijen := n; return next;

  -- Regio per campagne (uit ads_geo_performance_monthly -- niet ads_region_monthly, zie migratie 043).
  insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
         campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'region', coalesce(s.geo_target_id, s.region_name), s.region_name,
         coalesce(s.country_code,''), coalesce(s.campaign_id,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_geo_performance_monthly', 0, 1.0
  from ads_geo_performance_monthly s join accounts a on a.client_id = s.client_id
  where coalesce(s.geo_target_id, s.region_name) is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/region (geo)'; rijen := n; return next;

  insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
         campaign_id, adgroup_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'audience', coalesce(s.audience_id, s.audience_name), s.audience_name,
         coalesce(s.audience_type,''), coalesce(s.campaign_id,''), coalesce(s.ad_group_id,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_audience_performance_monthly', 0, 1.0
  from ads_audience_performance_monthly s join accounts a on a.client_id = s.client_id
  where coalesce(s.audience_id, s.audience_name) is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/audience'; rijen := n; return next;

  -- Land op accountniveau (campaign_id blijft leeg -- dat is wat hem onderscheidt van de
  -- campagne-regio's hierboven).
  insert into fact_dimension (account_id, channel, dimension, key, key_label,
         grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'country', s.country_code, s.country_code, 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_country_monthly', 0, 1.0
  from ads_country_monthly s join accounts a on a.client_id = s.client_id
  where s.country_code is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/country'; rijen := n; return next;

  -- Regio op accountniveau (uit ads_region_monthly -- campaign_id blijft leeg, dat onderscheidt
  -- deze van de campagne-regio's hierboven).
  insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
         grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'google', 'region', coalesce(s.region_code, s.region_name), s.region_name,
         coalesce(s.country_code,''), 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0),
         a.agency_id, a.client_id, 'ads_region_monthly', 0, 1.0
  from ads_region_monthly s join accounts a on a.client_id = s.client_id
  where coalesce(s.region_code, s.region_name) is not null and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension google/region (account)'; rijen := n; return next;

  -- LinkedIn demografie (pivot_type is de dimensie, pivot_value_urn de sleutel).
  insert into fact_dimension (account_id, channel, dimension, key, key_label,
         campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value,
         agency_id, client_id, source_table, leads, data_quality_score)
  select a.id, 'linkedin', lower(s.pivot_type), s.pivot_value_urn, s.pivot_value_urn,
         coalesce(s.entity_urn,''), 'day', s.date,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.spend,0),
         coalesce(s.conversions,0), 0,
         a.agency_id, a.client_id, 'linkedin_demographic_daily', 0, 1.0
  from linkedin_demographic_daily s join accounts a on a.client_id = s.client_id
  where s.pivot_type is not null and s.pivot_value_urn is not null
    and (p_client_id is null or s.client_id = p_client_id)
  on conflict (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
    do update set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
      agency_id = excluded.agency_id, client_id = excluded.client_id;
  get diagnostics n = row_count; onderdeel := 'fact_dimension linkedin/demografie'; rijen := n; return next;

  -- ── kanaalmetrieken (ongewijzigd, uit migratie 050) ──────────────────────────

  insert into google_metrics (account_id, level, entity_id, grain, period_start,
    campaign_status, campaign_type, video_views,
    video_quartile_p25, video_quartile_p50, video_quartile_p75, video_quartile_p100,
    ctr, avg_cpc, cost_per_conversion, conversion_rate, avg_cpm, avg_cpv, video_view_rate)
  select a.id, 'campaign', coalesce(s.campaign_id,''), 'month', s.month,
    s.campaign_status, s.campaign_type, s.video_views,
    s.video_quartile_p25, s.video_quartile_p50, s.video_quartile_p75, s.video_quartile_p100,
    s.ctr, s.avg_cpc, s.cost_per_conversion, s.conversion_rate, s.avg_cpm, s.avg_cpv,
    s.video_view_rate
  from ads_campaign_monthly_legacy s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, level, entity_id, grain, period_start) do update
    set campaign_status = excluded.campaign_status, campaign_type = excluded.campaign_type,
        video_views = excluded.video_views,
        video_quartile_p25 = excluded.video_quartile_p25,
        video_quartile_p50 = excluded.video_quartile_p50,
        video_quartile_p75 = excluded.video_quartile_p75,
        video_quartile_p100 = excluded.video_quartile_p100,
        ctr = excluded.ctr, avg_cpc = excluded.avg_cpc,
        cost_per_conversion = excluded.cost_per_conversion,
        conversion_rate = excluded.conversion_rate, avg_cpm = excluded.avg_cpm,
        avg_cpv = excluded.avg_cpv, video_view_rate = excluded.video_view_rate;
  get diagnostics n = row_count; onderdeel := 'google_metrics campaign'; rijen := n; return next;

  insert into google_metrics (account_id, level, entity_id, grain, period_start,
    ctr, avg_cpc, cost_per_conversion, conversion_rate)
  select a.id, 'account', '', 'month', s.month,
    s.ctr, s.avg_cpc, s.cost_per_conversion, s.conversion_rate
  from ads_account_monthly_legacy s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, level, entity_id, grain, period_start) do update
    set ctr = excluded.ctr, avg_cpc = excluded.avg_cpc,
        cost_per_conversion = excluded.cost_per_conversion,
        conversion_rate = excluded.conversion_rate;
  get diagnostics n = row_count; onderdeel := 'google_metrics account'; rijen := n; return next;

  insert into meta_metrics (account_id, level, entity_id, grain, period_start,
    reach, frequency, link_clicks, landing_page_views, leads, add_to_cart, initiate_checkout,
    views, video_3s_views, video_thruplay, video_p25, video_p50, video_p75, video_p100,
    post_engagement, hook_rate, hold_rate, quality_ranking, engagement_rate_ranking,
    conversion_rate_ranking, cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions)
  select a.id, m.lvl, coalesce(m.eid,''), 'day', m.dag, m.reach, m.frequency, m.link_clicks,
         m.landing_page_views, m.leads, m.add_to_cart, m.initiate_checkout, m.views,
         m.video_3s_views, m.video_thruplay, m.video_p25, m.video_p50, m.video_p75, m.video_p100,
         m.post_engagement, m.hook_rate, m.hold_rate, m.qr, m.err, m.crr,
         m.cpm, m.cpc_link, m.ctr_link, m.purchase_roas, m.cpa, m.roas, m.conversions
  from (
    select client_id, 'account'::text lvl, entity_id eid, date dag, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, null::text qr, null::text err, null::text crr,
           cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions from meta_account_daily_legacy
    union all
    select client_id, 'campaign', entity_id, date, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, null, null, null,
           cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions from meta_campaign_daily_legacy
    union all
    select client_id, 'creative', entity_id, date, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, quality_ranking, engagement_rate_ranking, conversion_rate_ranking,
           cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions from meta_ad_daily_legacy
  ) m
  join accounts a on a.client_id = m.client_id
  where p_client_id is null or m.client_id = p_client_id
  on conflict (account_id, level, entity_id, grain, period_start) do update
    set reach = excluded.reach, frequency = excluded.frequency, link_clicks = excluded.link_clicks,
        landing_page_views = excluded.landing_page_views, leads = excluded.leads,
        add_to_cart = excluded.add_to_cart, initiate_checkout = excluded.initiate_checkout,
        views = excluded.views, video_3s_views = excluded.video_3s_views,
        video_thruplay = excluded.video_thruplay, video_p25 = excluded.video_p25,
        video_p50 = excluded.video_p50, video_p75 = excluded.video_p75,
        video_p100 = excluded.video_p100, post_engagement = excluded.post_engagement,
        hook_rate = excluded.hook_rate, hold_rate = excluded.hold_rate,
        quality_ranking = excluded.quality_ranking,
        engagement_rate_ranking = excluded.engagement_rate_ranking,
        conversion_rate_ranking = excluded.conversion_rate_ranking,
        cpm = excluded.cpm, cpc_link = excluded.cpc_link, ctr_link = excluded.ctr_link,
        purchase_roas = excluded.purchase_roas, cpa = excluded.cpa, roas = excluded.roas,
        conversions = excluded.conversions;
  get diagnostics n = row_count; onderdeel := 'meta_metrics'; rijen := n; return next;

  insert into linkedin_metrics (account_id, level, entity_id, grain, period_start,
    landing_page_clicks, one_click_lead_form_opens, one_click_leads, external_website_conversions,
    post_click_conversions, form_completion_rate, video_starts, video_views, video_completions,
    video_completion_rate, total_engagements, follows, reactions, comments, shares,
    ctr, cpc, cpm, cpl)
  select a.id, l.lvl, coalesce(l.eid,''), 'day', l.dag, l.landing_page_clicks,
         l.one_click_lead_form_opens, l.one_click_leads, l.external_website_conversions,
         l.post_click_conversions, l.form_completion_rate, l.video_starts, l.video_views,
         l.video_completions, l.video_completion_rate, l.total_engagements, l.follows,
         l.reactions, l.comments, l.shares, l.ctr, l.cpc, l.cpm, l.cpl
  from (
    select client_id, 'account'::text lvl, entity_urn eid, date dag, landing_page_clicks,
           one_click_lead_form_opens, one_click_leads, external_website_conversions,
           post_click_conversions, form_completion_rate, video_starts, video_views,
           video_completions, video_completion_rate, total_engagements, follows, reactions,
           comments, shares, ctr, cpc, cpm, cpl from linkedin_account_daily_legacy
    union all
    select client_id, 'campaign', entity_urn, date, landing_page_clicks, one_click_lead_form_opens,
           one_click_leads, external_website_conversions, post_click_conversions,
           form_completion_rate, video_starts, video_views, video_completions,
           video_completion_rate, total_engagements, follows, reactions, comments, shares,
           ctr, cpc, cpm, cpl from linkedin_campaign_daily_legacy
    union all
    select client_id, 'creative', entity_urn, date, landing_page_clicks, one_click_lead_form_opens,
           one_click_leads, external_website_conversions, post_click_conversions,
           form_completion_rate, video_starts, video_views, video_completions,
           video_completion_rate, total_engagements, follows, reactions, comments, shares,
           ctr, cpc, cpm, cpl from linkedin_creative_daily_legacy
  ) l
  join accounts a on a.client_id = l.client_id
  where p_client_id is null or l.client_id = p_client_id
  on conflict (account_id, level, entity_id, grain, period_start) do update
    set landing_page_clicks = excluded.landing_page_clicks,
        one_click_lead_form_opens = excluded.one_click_lead_form_opens,
        one_click_leads = excluded.one_click_leads,
        external_website_conversions = excluded.external_website_conversions,
        post_click_conversions = excluded.post_click_conversions,
        form_completion_rate = excluded.form_completion_rate, video_starts = excluded.video_starts,
        video_views = excluded.video_views, video_completions = excluded.video_completions,
        video_completion_rate = excluded.video_completion_rate,
        total_engagements = excluded.total_engagements, follows = excluded.follows,
        reactions = excluded.reactions, comments = excluded.comments, shares = excluded.shares,
        ctr = excluded.ctr, cpc = excluded.cpc, cpm = excluded.cpm, cpl = excluded.cpl;
  get diagnostics n = row_count; onderdeel := 'linkedin_metrics'; rijen := n; return next;

  -- ── rollups (ongewijzigd, uit migratie 050) ─────────────────────────────────
  for r in select id from accounts where p_client_id is null or client_id = p_client_id loop
    perform refresh_rollups(r.id, null);
  end loop;
  onderdeel := 'rollups bijgewerkt'; rijen := 0; return next;
end;
$$;

revoke execute on function refresh_fact_from_legacy(text) from public, anon, authenticated;
grant execute on function refresh_fact_from_legacy(text) to service_role;

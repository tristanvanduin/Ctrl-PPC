-- 054: FASE 3. De acht oude tabellen heten voortaan `*_legacy`; onder hun oude naam staat nu
-- een view die uit fact_core leest.
--
-- DIT IS DE EERSTE MIGRATIE DIE DE DRAAIENDE APP RAAKT. Alles ervoor was additief.
--
-- TERUGWEG, per tabel twee regels:
--
--   drop view ads_campaign_monthly;
--   alter table ads_campaign_monthly_legacy rename to ads_campaign_monthly;
--
-- Seconden werk, geen dataverlies: de tabellen zelf worden alleen hernoemd, geen rij verandert.
--
-- ── WAAROM DIT NU MAG ───────────────────────────────────────────────────────
--
-- scripts/check-view-dekking.mjs vergelijkt sinds migratie 046 elke kandidaat-view met zijn tabel,
-- HELE RIJEN met `except all` in beide richtingen, en draait mee in scripts/gates.sh. Stand bij
-- het schrijven van deze migratie:
--
--   ads_account_monthly        775 / 775      alle kolommen gelijk
--   ads_campaign_monthly      4707 / 4707     idem
--   meta_account_daily         160 / 160      idem
--   meta_campaign_daily        128 / 128      idem
--   meta_ad_daily              256 / 256      idem
--   linkedin_account_daily     160 / 160      idem
--   linkedin_campaign_daily    128 / 128      idem
--   linkedin_creative_daily     92 / 92       idem
--
-- Met twee gemeten en begrensde uitzonderingen: `roas` staat in de oude tabellen op 1049 + 58 rijen
-- scheef met zijn eigen kolommen (Google stelt conversiewaarde na de klikdatum bij), en
-- `clicks_all` plus `conversion_value` waren leeg in de bron waar fact_core een nul draagt.
--
-- ── DE DEFINITIES ZIJN NIET OVERGETYPT ──────────────────────────────────────
--
-- De views hieronder komen uit pg_get_viewdef() van de kandidaat-views zoals ze NU in de database
-- staan -- dus letterlijk wat de controle heeft goedgekeurd. Ze met de hand overschrijven zou de
-- kans introduceren dat wat er draait iets anders is dan wat er is gecontroleerd, en dat is precies
-- het soort verschil dat niemand terugvindt.
--
-- ── DE PROJECTIE MOET MEE ───────────────────────────────────────────────────
--
-- refresh_fact_from_legacy leest uit deze acht tabellen. Zonder aanpassing zou hij na de hernoeming
-- uit de VIEWS lezen die zelf uit fact_core komen: fact_core vult zichzelf, en de sync landt
-- nergens meer. Geen foutmelding -- de getallen zouden alleen niet meer veranderen. Vandaar dat de
-- functie hier in dezelfde migratie meegaat, met `_legacy` als bron.
--
-- De SCHRIJFPADEN in de code wijzen via lib/data-access/feitentabellen.ts naar deze namen; die
-- module gaat in dezelfde commit mee. Een view is niet schrijfbaar, dus zonder dat zou de eerste
-- sync na deze migratie `cannot insert into view` geven -- per dataset weggevangen en dus stil.

-- ── 1. Hernoemen ────────────────────────────────────────────────────────────

alter table ads_account_monthly rename to ads_account_monthly_legacy;
alter table ads_campaign_monthly rename to ads_campaign_monthly_legacy;
alter table meta_account_daily rename to meta_account_daily_legacy;
alter table meta_campaign_daily rename to meta_campaign_daily_legacy;
alter table meta_ad_daily rename to meta_ad_daily_legacy;
alter table linkedin_account_daily rename to linkedin_account_daily_legacy;
alter table linkedin_campaign_daily rename to linkedin_campaign_daily_legacy;
alter table linkedin_creative_daily rename to linkedin_creative_daily_legacy;

-- ── 2. De views onder de oude namen ─────────────────────────────────────────

create view ads_account_monthly as
SELECT NULL::uuid AS id,
    a.client_id,
    f.period_start AS month,
    f.impressions,
    f.clicks,
    f.cost,
    f.conversions,
    f.conv_value AS conversions_value,
    g.ctr,
    g.avg_cpc,
    g.cost_per_conversion,
    g.conversion_rate,
        CASE
            WHEN f.cost > 0::numeric THEN round(f.conv_value / f.cost, 4)
            ELSE 0::numeric
        END AS roas,
    f.synced_at AS created_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN google_metrics g ON g.account_id = f.account_id AND g.level = 'account'::text AND g.entity_id = ''::text AND g.grain = 'month'::text AND g.period_start = f.period_start
  WHERE f.channel = 'google'::text AND f.level = 'account'::text AND f.grain = 'month'::text;

create view ads_campaign_monthly as
SELECT NULL::uuid AS id,
    a.client_id,
    f.entity_id AS campaign_id,
    f.entity_name AS campaign_name,
    g.campaign_status,
    f.period_start AS month,
    f.impressions,
    f.clicks,
    f.cost,
    f.conversions,
    f.conv_value AS conversions_value,
    g.ctr,
    g.avg_cpc,
    g.cost_per_conversion,
    g.conversion_rate,
        CASE
            WHEN f.cost > 0::numeric THEN round(f.conv_value / f.cost, 4)
            ELSE 0::numeric
        END AS roas,
    f.synced_at AS created_at,
    g.avg_cpm,
    g.campaign_type,
    g.video_views,
    g.avg_cpv,
    g.video_view_rate,
    g.video_quartile_p25,
    g.video_quartile_p50,
    g.video_quartile_p75,
    g.video_quartile_p100
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN google_metrics g ON g.account_id = f.account_id AND g.level = 'campaign'::text AND g.entity_id = f.entity_id AND g.grain = 'month'::text AND g.period_start = f.period_start
  WHERE f.channel = 'google'::text AND f.level = 'campaign'::text AND f.grain = 'month'::text;

create view meta_account_daily as
SELECT a.client_id,
    f.period_start AS date,
    f.entity_id,
    f.impressions,
    m.views,
    m.reach,
    m.frequency,
    f.clicks AS clicks_all,
    m.link_clicks,
    f.cost AS spend,
    m.cpm,
    m.cpc_link,
    m.ctr_link,
    m.conversions,
    f.conv_value AS conversion_value,
    m.purchase_roas,
    m.cpa,
    m.roas,
    m.leads,
    m.add_to_cart,
    m.initiate_checkout,
    m.landing_page_views,
    m.video_3s_views,
    m.video_thruplay,
    m.video_p25,
    m.video_p50,
    m.video_p75,
    m.video_p100,
    m.post_engagement,
    m.hook_rate,
    m.hold_rate,
    NULL::jsonb AS raw,
    f.synced_at AS created_at,
    f.synced_at AS updated_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN meta_metrics m ON m.account_id = f.account_id AND m.level = 'account'::text AND m.entity_id = f.entity_id AND m.grain = 'day'::text AND m.period_start = f.period_start
  WHERE f.channel = 'meta'::text AND f.level = 'account'::text AND f.grain = 'day'::text;

create view meta_campaign_daily as
SELECT a.client_id,
    f.period_start AS date,
    f.entity_id,
    f.impressions,
    m.views,
    m.reach,
    m.frequency,
    f.clicks AS clicks_all,
    m.link_clicks,
    f.cost AS spend,
    m.cpm,
    m.cpc_link,
    m.ctr_link,
    m.conversions,
    f.conv_value AS conversion_value,
    m.purchase_roas,
    m.cpa,
    m.roas,
    m.leads,
    m.add_to_cart,
    m.initiate_checkout,
    m.landing_page_views,
    m.video_3s_views,
    m.video_thruplay,
    m.video_p25,
    m.video_p50,
    m.video_p75,
    m.video_p100,
    m.post_engagement,
    m.hook_rate,
    m.hold_rate,
    NULL::jsonb AS raw,
    f.synced_at AS created_at,
    f.synced_at AS updated_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN meta_metrics m ON m.account_id = f.account_id AND m.level = 'campaign'::text AND m.entity_id = f.entity_id AND m.grain = 'day'::text AND m.period_start = f.period_start
  WHERE f.channel = 'meta'::text AND f.level = 'campaign'::text AND f.grain = 'day'::text;

create view meta_ad_daily as
SELECT a.client_id,
    f.period_start AS date,
    f.entity_id,
    f.impressions,
    m.views,
    m.reach,
    m.frequency,
    f.clicks AS clicks_all,
    m.link_clicks,
    f.cost AS spend,
    m.cpm,
    m.cpc_link,
    m.ctr_link,
    m.conversions,
    f.conv_value AS conversion_value,
    m.purchase_roas,
    m.cpa,
    m.roas,
    m.leads,
    m.add_to_cart,
    m.initiate_checkout,
    m.landing_page_views,
    m.video_3s_views,
    m.video_thruplay,
    m.video_p25,
    m.video_p50,
    m.video_p75,
    m.video_p100,
    m.post_engagement,
    m.hook_rate,
    m.hold_rate,
    m.quality_ranking,
    m.engagement_rate_ranking,
    m.conversion_rate_ranking,
    NULL::jsonb AS raw,
    f.synced_at AS created_at,
    f.synced_at AS updated_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN meta_metrics m ON m.account_id = f.account_id AND m.level = 'creative'::text AND m.entity_id = f.entity_id AND m.grain = 'day'::text AND m.period_start = f.period_start
  WHERE f.channel = 'meta'::text AND f.level = 'creative'::text AND f.grain = 'day'::text;

create view linkedin_account_daily as
SELECT a.client_id,
    f.period_start AS date,
    f.entity_id AS entity_urn,
    f.impressions,
    f.clicks,
    f.cost AS spend,
    m.ctr,
    m.cpc,
    m.cpm,
    m.landing_page_clicks,
    m.one_click_lead_form_opens,
    m.one_click_leads,
    m.external_website_conversions,
    m.post_click_conversions,
    f.conv_value AS conversion_value,
    m.cpl,
    m.form_completion_rate,
    m.video_starts,
    m.video_views,
    m.video_completions,
    m.video_completion_rate,
    m.total_engagements,
    m.follows,
    m.reactions,
    m.comments,
    m.shares,
    NULL::jsonb AS raw,
    f.synced_at AS created_at,
    f.synced_at AS updated_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN linkedin_metrics m ON m.account_id = f.account_id AND m.level = 'account'::text AND m.entity_id = f.entity_id AND m.grain = 'day'::text AND m.period_start = f.period_start
  WHERE f.channel = 'linkedin'::text AND f.level = 'account'::text AND f.grain = 'day'::text;

create view linkedin_campaign_daily as
SELECT a.client_id,
    f.period_start AS date,
    f.entity_id AS entity_urn,
    f.impressions,
    f.clicks,
    f.cost AS spend,
    m.ctr,
    m.cpc,
    m.cpm,
    m.landing_page_clicks,
    m.one_click_lead_form_opens,
    m.one_click_leads,
    m.external_website_conversions,
    m.post_click_conversions,
    f.conv_value AS conversion_value,
    m.cpl,
    m.form_completion_rate,
    m.video_starts,
    m.video_views,
    m.video_completions,
    m.video_completion_rate,
    m.total_engagements,
    m.follows,
    m.reactions,
    m.comments,
    m.shares,
    NULL::jsonb AS raw,
    f.synced_at AS created_at,
    f.synced_at AS updated_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN linkedin_metrics m ON m.account_id = f.account_id AND m.level = 'campaign'::text AND m.entity_id = f.entity_id AND m.grain = 'day'::text AND m.period_start = f.period_start
  WHERE f.channel = 'linkedin'::text AND f.level = 'campaign'::text AND f.grain = 'day'::text;

create view linkedin_creative_daily as
SELECT a.client_id,
    f.period_start AS date,
    f.entity_id AS entity_urn,
    f.impressions,
    f.clicks,
    f.cost AS spend,
    m.ctr,
    m.cpc,
    m.cpm,
    m.landing_page_clicks,
    m.one_click_lead_form_opens,
    m.one_click_leads,
    m.external_website_conversions,
    m.post_click_conversions,
    f.conv_value AS conversion_value,
    m.cpl,
    m.form_completion_rate,
    m.video_starts,
    m.video_views,
    m.video_completions,
    m.video_completion_rate,
    m.total_engagements,
    m.follows,
    m.reactions,
    m.comments,
    m.shares,
    NULL::jsonb AS raw,
    f.synced_at AS created_at,
    f.synced_at AS updated_at
   FROM fact_core f
     JOIN accounts a ON a.id = f.account_id
     LEFT JOIN linkedin_metrics m ON m.account_id = f.account_id AND m.level = 'creative'::text AND m.entity_id = f.entity_id AND m.grain = 'day'::text AND m.period_start = f.period_start
  WHERE f.channel = 'linkedin'::text AND f.level = 'creative'::text AND f.grain = 'day'::text;

-- ── 3. De kandidaten opruimen ───────────────────────────────────────────────
-- Ze hebben hun werk gedaan: ze bestonden om de vergelijking te kunnen maken.

drop view if exists kandidaat_ads_account_monthly;
drop view if exists kandidaat_ads_campaign_monthly;
drop view if exists kandidaat_meta_account_daily;
drop view if exists kandidaat_meta_campaign_daily;
drop view if exists kandidaat_meta_ad_daily;
drop view if exists kandidaat_linkedin_account_daily;
drop view if exists kandidaat_linkedin_campaign_daily;
drop view if exists kandidaat_linkedin_creative_daily;

-- ── 4. De projectie leest voortaan uit _legacy ──────────────────────────────

create or replace function refresh_fact_from_legacy(p_client_id text default null)
returns table (onderdeel text, rijen bigint)
language plpgsql
as $$
declare
  n bigint;
  r record;
begin
  -- ── fact_core ─────────────────────────────────────────────────────────────
  -- Dezelfde afbeelding als migratie 036 en 042. `do update` en niet `do nothing`: een sync
  -- herschrijft veertien maanden, dus bestaande rijen MOETEN meebewegen. Met `do nothing` zou een
  -- conversie die na de klik binnenkomt nooit in fact_core landen.

  insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value)
  select a.id, 'google', 'account', '', a.name, 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0)
  from ads_account_monthly_legacy s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();
  get diagnostics n = row_count; onderdeel := 'fact_core google/account'; rijen := n; return next;

  insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value)
  select a.id, 'google', 'campaign', coalesce(s.campaign_id,''), s.campaign_name, 'month', s.month,
         coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
         coalesce(s.conversions,0), coalesce(s.conversions_value,0)
  from ads_campaign_monthly_legacy s join accounts a on a.client_id = s.client_id
  where p_client_id is null or s.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value,
        entity_name = excluded.entity_name, synced_at = now();
  get diagnostics n = row_count; onderdeel := 'fact_core google/campaign'; rijen := n; return next;

  -- Meta: conversions = conversions + leads (de standaard uit channel-conversion-config).
  insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value)
  -- coalesce op de buitenste select en niet in de drie takken: de demodata heeft rijen met
  -- impressies maar clicks_all leeg, en fact_core staat geen null toe. Migratie 036 ving dat per
  -- kolom af; bij het herschrijven naar een union raakte dat kwijt en viel deze functie er meteen
  -- over. Hier geldt het voor alle takken tegelijk, dus het kan niet nog eens sluipen.
  select a.id, 'meta', niveau.lvl, coalesce(niveau.eid,''), 'day', niveau.dag,
         coalesce(niveau.imp,0), coalesce(niveau.clk,0), coalesce(niveau.spd,0),
         coalesce(niveau.cnv,0), coalesce(niveau.val,0)
  from (
    select client_id, 'account'::text lvl, entity_id eid, date dag, impressions imp, clicks_all clk,
           spend spd, coalesce(conversions,0)+coalesce(leads,0) cnv, conversion_value val
      from meta_account_daily_legacy
    union all
    select client_id, 'campaign', entity_id, date, impressions, clicks_all, spend,
           coalesce(conversions,0)+coalesce(leads,0), conversion_value from meta_campaign_daily_legacy
    union all
    select client_id, 'creative', entity_id, date, impressions, clicks_all, spend,
           coalesce(conversions,0)+coalesce(leads,0), conversion_value from meta_ad_daily_legacy
  ) niveau
  join accounts a on a.client_id = niveau.client_id
  where p_client_id is null or niveau.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();
  get diagnostics n = row_count; onderdeel := 'fact_core meta'; rijen := n; return next;

  -- LinkedIn: conversions = one_click_leads + external_website_conversions (de standaard).
  insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                         impressions, clicks, cost, conversions, conv_value)
  select a.id, 'linkedin', niveau.lvl, coalesce(niveau.eid,''), 'day', niveau.dag,
         coalesce(niveau.imp,0), coalesce(niveau.clk,0), coalesce(niveau.spd,0),
         coalesce(niveau.cnv,0), coalesce(niveau.val,0)
  from (
    select client_id, 'account'::text lvl, entity_urn eid, date dag, impressions imp, clicks clk,
           spend spd, coalesce(one_click_leads,0)+coalesce(external_website_conversions,0) cnv,
           conversion_value val from linkedin_account_daily_legacy
    union all
    select client_id, 'campaign', entity_urn, date, impressions, clicks, spend,
           coalesce(one_click_leads,0)+coalesce(external_website_conversions,0), conversion_value
      from linkedin_campaign_daily_legacy
    union all
    select client_id, 'creative', entity_urn, date, impressions, clicks, spend,
           coalesce(one_click_leads,0)+coalesce(external_website_conversions,0), conversion_value
      from linkedin_creative_daily_legacy
  ) niveau
  join accounts a on a.client_id = niveau.client_id
  where p_client_id is null or niveau.client_id = p_client_id
  on conflict (account_id, channel, level, entity_id, grain, period_start) do update
    set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
        conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();
  get diagnostics n = row_count; onderdeel := 'fact_core linkedin'; rijen := n; return next;

  -- ── kanaalmetrieken ───────────────────────────────────────────────────────

  -- NIEUW in deze migratie: google_metrics. Campagne- en accountniveau apart, want
  -- ads_account_monthly draagt geen videokolommen en geen campagne-eigenschappen.
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

  -- Meta: nu inclusief de zeven kolommen uit migratie 049.
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

  -- LinkedIn: nu inclusief ctr, cpc, cpm en cpl uit migratie 049.
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

  -- ── rollups ───────────────────────────────────────────────────────────────
  -- Zonder dit lopen week en maand achter op de dagen die zojuist zijn bijgewerkt, en dat is
  -- precies de drift waar migratie 038 voor bestaat.
  --
  -- Een LUS en geen subquery: zie de toelichting bovenaan. Een klant met twee advertentieaccounts
  -- liet de oude vorm omvallen met `more than one row returned by a subquery`.
  for r in select id from accounts where p_client_id is null or client_id = p_client_id loop
    perform refresh_rollups(r.id, null);
  end loop;
  onderdeel := 'rollups bijgewerkt'; rijen := 0; return next;
end;
$$;

revoke execute on function refresh_fact_from_legacy(text) from public, anon, authenticated;
grant execute on function refresh_fact_from_legacy(text) to service_role;

-- ── Controle ────────────────────────────────────────────────────────────────
-- Rijaantallen door de view en in de tabel eronder. Hoort gelijk te zijn; draai daarna
-- scripts/check-view-dekking.mjs voor de volledige vergelijking.

select 'ads_campaign_monthly' as naam,
       (select count(*) from ads_campaign_monthly) as via_view,
       (select count(*) from ads_campaign_monthly_legacy) as in_tabel
union all
select 'meta_ad_daily',
       (select count(*) from meta_ad_daily),
       (select count(*) from meta_ad_daily_legacy)
union all
select 'linkedin_creative_daily',
       (select count(*) from linkedin_creative_daily),
       (select count(*) from linkedin_creative_daily_legacy);

-- 050: de projectie dekt nu ook google_metrics en de platformverhoudingen.
--
-- DRAAIEN: idempotent, veilig te herhalen. Vervangt één functie; verandert geen tabelstructuur.
--
-- ── WAAROM DIT NODIG IS ─────────────────────────────────────────────────────
--
-- refresh_fact_from_legacy uit migratie 044 vult fact_core, meta_metrics en linkedin_metrics na
-- elke sync. Sindsdien zijn erbij gekomen:
--
--   045  google_metrics                          — bestond nog niet
--   047  google_metrics.ctr/avg_cpc/…            — de door Google berekende verhoudingen
--   049  meta_metrics.cpm/cpc_link/…/conversions — idem voor Meta
--   049  linkedin_metrics.ctr/cpc/cpm/cpl        — idem voor LinkedIn
--
-- Die vult de projectie niet. Zolang niemand ze leest is dat onzichtbaar, maar de kandidaat-views
-- lezen ze wél. Zou fase 3 nu doorgaan, dan zou de eerste sync na de hernoeming fact_core
-- bijwerken en de metriektabellen laten staan: kosten en klikken van vandaag naast een cpm van
-- vorige maand. Twee waarheden in één rij, en geen enkele foutmelding.
--
-- Vandaar dat dit vóór de hernoeming gebeurt en niet erna.
--
-- ── EN EEN FOUT DIE ER AL IN ZAT ────────────────────────────────────────────
--
-- Onderaan 044 stond:
--
--     perform refresh_rollups((select id from accounts where client_id = p_client_id), null);
--
-- Die subquery gaat ervan uit dat één klant precies één account heeft. Vandaag klopt dat — 71
-- accounts, 71 verschillende client_ids, nul dubbele — maar het is de aanname die het hele
-- accounts-model juist moet opheffen. De dag dat een klant een tweede advertentieaccount krijgt,
-- geeft deze regel `more than one row returned by a subquery` en valt de hele sync om.
--
-- Dat is geen theoretisch bezwaar: dat account bijkopen is precies wat er gebeurt als een bureau
-- groeit. Nu een lus over de accounts, wat hoe dan ook klopt.

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
  from ads_account_monthly s join accounts a on a.client_id = s.client_id
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
  from ads_campaign_monthly s join accounts a on a.client_id = s.client_id
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
      from meta_account_daily
    union all
    select client_id, 'campaign', entity_id, date, impressions, clicks_all, spend,
           coalesce(conversions,0)+coalesce(leads,0), conversion_value from meta_campaign_daily
    union all
    select client_id, 'creative', entity_id, date, impressions, clicks_all, spend,
           coalesce(conversions,0)+coalesce(leads,0), conversion_value from meta_ad_daily
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
           conversion_value val from linkedin_account_daily
    union all
    select client_id, 'campaign', entity_urn, date, impressions, clicks, spend,
           coalesce(one_click_leads,0)+coalesce(external_website_conversions,0), conversion_value
      from linkedin_campaign_daily
    union all
    select client_id, 'creative', entity_urn, date, impressions, clicks, spend,
           coalesce(one_click_leads,0)+coalesce(external_website_conversions,0), conversion_value
      from linkedin_creative_daily
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
  from ads_campaign_monthly s join accounts a on a.client_id = s.client_id
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
  from ads_account_monthly s join accounts a on a.client_id = s.client_id
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
           cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions from meta_account_daily
    union all
    select client_id, 'campaign', entity_id, date, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, null, null, null,
           cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions from meta_campaign_daily
    union all
    select client_id, 'creative', entity_id, date, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, quality_ranking, engagement_rate_ranking, conversion_rate_ranking,
           cpm, cpc_link, ctr_link, purchase_roas, cpa, roas, conversions from meta_ad_daily
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
           comments, shares, ctr, cpc, cpm, cpl from linkedin_account_daily
    union all
    select client_id, 'campaign', entity_urn, date, landing_page_clicks, one_click_lead_form_opens,
           one_click_leads, external_website_conversions, post_click_conversions,
           form_completion_rate, video_starts, video_views, video_completions,
           video_completion_rate, total_engagements, follows, reactions, comments, shares,
           ctr, cpc, cpm, cpl from linkedin_campaign_daily
    union all
    select client_id, 'creative', entity_urn, date, landing_page_clicks, one_click_lead_form_opens,
           one_click_leads, external_website_conversions, post_click_conversions,
           form_completion_rate, video_starts, video_views, video_completions,
           video_completion_rate, total_engagements, follows, reactions, comments, shares,
           ctr, cpc, cpm, cpl from linkedin_creative_daily
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
-- Draaien op de demoklant. Hoort dezelfde getallen te geven als er al staan, en de
-- viewdekking hoort daarna nog steeds schoon te zijn.

select * from refresh_fact_from_legacy('demo-greentech');

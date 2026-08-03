-- 044: de nieuwe tabellen bijwerken vanuit de oude, herhaalbaar.
--
-- DRAAIEN: idempotent, veilig te herhalen. Maakt één functie aan; raakt geen bestaande tabel.
--
-- ── WAAROM DIT GEEN WIJZIGING AAN DE SYNC IS ────────────────────────────────
--
-- Het plan was fase 2c: de sync naar beide plekken laten schrijven. Dat is bij nader inzien de
-- verkeerde vorm, om een heel praktische reden — er zijn op dit moment geen werkende API-sleutels
-- voor Google, Meta en LinkedIn. Dubbelschrijf-code in de sync zou dus een flinke wijziging aan
-- draaiende code zijn die pas over weken voor het eerst uitgevoerd wordt, en tot die tijd niet
-- één keer bewezen.
--
-- Deze vorm doet hetzelfde en is nu wél te testen: de sync blijft ongemoeid en schrijft naar de
-- oude tabellen zoals altijd; daarna projecteert deze functie die tabellen naar de nieuwe. Precies
-- wat migraties 036 tot en met 043 eenmalig deden, nu als herhaalbare stap.
--
-- Wat dat oplevert:
--
--   - nul risico voor wat nu werkt: de sync verandert niet van gedrag
--   - volledig testbaar op de demodata, vandaag
--   - zodra er sleutels zijn volgt het vanzelf; er hoeft niets extra's te gebeuren
--   - de oude tabellen blijven de waarheid tot fase 3, wat het migratieplan ook zo bedoelde
--
-- De prijs is dat de nieuwe tabellen een stap achterlopen tot deze functie draait. Dat is
-- acceptabel zolang niets ze leest — en niets leest ze, dat is nu juist het punt van fase 2.
--
-- ── AANROEPEN ──────────────────────────────────────────────────────────────
--
--   select * from refresh_fact_from_legacy();                  -- alles
--   select * from refresh_fact_from_legacy('demo-greentech');   -- één klant
--
-- De sync roept hem aan het eind van syncClient aan voor de klant die net ververst is.

create or replace function refresh_fact_from_legacy(p_client_id text default null)
returns table (onderdeel text, rijen bigint)
language plpgsql
as $$
declare
  n bigint;
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

  insert into meta_metrics (account_id, level, entity_id, grain, period_start,
    reach, frequency, link_clicks, landing_page_views, leads, add_to_cart, initiate_checkout,
    views, video_3s_views, video_thruplay, video_p25, video_p50, video_p75, video_p100,
    post_engagement, hook_rate, hold_rate, quality_ranking, engagement_rate_ranking, conversion_rate_ranking)
  select a.id, m.lvl, coalesce(m.eid,''), 'day', m.dag, m.reach, m.frequency, m.link_clicks,
         m.landing_page_views, m.leads, m.add_to_cart, m.initiate_checkout, m.views,
         m.video_3s_views, m.video_thruplay, m.video_p25, m.video_p50, m.video_p75, m.video_p100,
         m.post_engagement, m.hook_rate, m.hold_rate, m.qr, m.err, m.crr
  from (
    select client_id, 'account'::text lvl, entity_id eid, date dag, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, null::text qr, null::text err, null::text crr from meta_account_daily
    union all
    select client_id, 'campaign', entity_id, date, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, null, null, null from meta_campaign_daily
    union all
    select client_id, 'creative', entity_id, date, reach, frequency, link_clicks,
           landing_page_views, leads, add_to_cart, initiate_checkout, views, video_3s_views,
           video_thruplay, video_p25, video_p50, video_p75, video_p100, post_engagement,
           hook_rate, hold_rate, quality_ranking, engagement_rate_ranking, conversion_rate_ranking
      from meta_ad_daily
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
        conversion_rate_ranking = excluded.conversion_rate_ranking;
  get diagnostics n = row_count; onderdeel := 'meta_metrics'; rijen := n; return next;

  insert into linkedin_metrics (account_id, level, entity_id, grain, period_start,
    landing_page_clicks, one_click_lead_form_opens, one_click_leads, external_website_conversions,
    post_click_conversions, form_completion_rate, video_starts, video_views, video_completions,
    video_completion_rate, total_engagements, follows, reactions, comments, shares)
  select a.id, l.lvl, coalesce(l.eid,''), 'day', l.dag, l.landing_page_clicks,
         l.one_click_lead_form_opens, l.one_click_leads, l.external_website_conversions,
         l.post_click_conversions, l.form_completion_rate, l.video_starts, l.video_views,
         l.video_completions, l.video_completion_rate, l.total_engagements, l.follows,
         l.reactions, l.comments, l.shares
  from (
    select client_id, 'account'::text lvl, entity_urn eid, date dag, landing_page_clicks,
           one_click_lead_form_opens, one_click_leads, external_website_conversions,
           post_click_conversions, form_completion_rate, video_starts, video_views,
           video_completions, video_completion_rate, total_engagements, follows, reactions,
           comments, shares from linkedin_account_daily
    union all
    select client_id, 'campaign', entity_urn, date, landing_page_clicks, one_click_lead_form_opens,
           one_click_leads, external_website_conversions, post_click_conversions,
           form_completion_rate, video_starts, video_views, video_completions,
           video_completion_rate, total_engagements, follows, reactions, comments, shares
      from linkedin_campaign_daily
    union all
    select client_id, 'creative', entity_urn, date, landing_page_clicks, one_click_lead_form_opens,
           one_click_leads, external_website_conversions, post_click_conversions,
           form_completion_rate, video_starts, video_views, video_completions,
           video_completion_rate, total_engagements, follows, reactions, comments, shares
      from linkedin_creative_daily
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
        reactions = excluded.reactions, comments = excluded.comments, shares = excluded.shares;
  get diagnostics n = row_count; onderdeel := 'linkedin_metrics'; rijen := n; return next;

  -- ── rollups ───────────────────────────────────────────────────────────────
  -- Zonder dit lopen week en maand achter op de dagen die zojuist zijn bijgewerkt, en dat is
  -- precies de drift waar migratie 038 voor bestaat.
  perform refresh_rollups(
    (select id from accounts where client_id = p_client_id),
    null);
  onderdeel := 'rollups bijgewerkt'; rijen := 0; return next;
end;
$$;

revoke execute on function refresh_fact_from_legacy(text) from public, anon, authenticated;
grant execute on function refresh_fact_from_legacy(text) to service_role;

-- ── Controle ────────────────────────────────────────────────────────────────
-- Draaien op de demoklant. Hoort dezelfde getallen te geven als er al staan.

select * from refresh_fact_from_legacy('demo-greentech');

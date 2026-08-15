-- 080: blended_account_monthly herschreven op fact_core -- één waarheid in plaats van twee.
--
-- DRAAIEN: idempotent, `create or replace view`. Geen migratie van data, alleen van de definitie.
--
-- ── HET PROBLEEM DAT DIT OPLOST ───────────────────────────────────────────────
--
-- ads_account_monthly (de Google-view) leest al uit fact_core sinds migratie 054. Deze view las
-- voor Meta en LinkedIn nog rechtstreeks uit de *_legacy-tabellen, langs fact_core heen. Twee
-- lezers van "hetzelfde" cijfer die niet noodzakelijk hetzelfde antwoord geven zodra fact_core en
-- de legacy-tabellen ooit uiteen zouden lopen -- en dat kon, want er was tot migratie 078 geen
-- garantie dat fact_core voor Meta/LinkedIn even actueel was. God Mode, platform-pulse, de
-- agency-macrotrends en cross-channel draaien allemaal op deze view.
--
-- ── KOLOMVERTALING ────────────────────────────────────────────────────────────
--
-- fact_core gebruikt 'google'/'meta'/'linkedin'; elke consument van deze view (channel-adapter.ts
-- ChannelId, de prompts, alle dashboardcomponenten) verwacht de gevestigde '_ads'-conventie
-- ('google_ads'/'meta_ads'/'linkedin_ads', geverifieerd 14 augustus 2026 tegen tientallen
-- plekken). De view vertaalt; fact_core zelf verandert niet.
--
-- cost -> spend, conv_value -> conversion_value: dezelfde hernoeming die de oude view ook al deed.
-- currency en leads komen nu rechtstreeks uit fact_core (migratie 075/076), zonder de eigen join
-- naar meta_connections/linkedin_connections die de oude view ervoor nodig had.
--
-- impressions/clicks expliciet naar numeric: fact_core draagt ze als bigint, maar de oude view
-- gaf numeric (de Meta/LinkedIn-tak somde met sum(), en UNION ALL koos daardoor overal numeric).
-- `create or replace view` staat geen kolomtypewijziging toe -- gevangen bij het toepassen, vóór
-- er iets kapot kon gaan bij een lezer die het type aanneemt.

drop view if exists blended_account_monthly;
create view blended_account_monthly as
select
  client_id,
  period_start as month,
  case channel
    when 'google'   then 'google_ads'
    when 'meta'     then 'meta_ads'
    when 'linkedin' then 'linkedin_ads'
  end as channel,
  currency,
  impressions::numeric as impressions,
  clicks::numeric as clicks,
  cost as spend,
  conversions,
  conv_value as conversion_value,
  leads
from fact_core
where level = 'account' and grain = 'month';

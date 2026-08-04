-- 049: kandidaat-views voor de zes Meta- en LinkedIn-tabellen. NOG GEEN hernoeming.
--
-- DRAAIEN: idempotent, veilig te herhalen. Additief: vier kolommen bij twee metriektabellen en
-- zes views onder een NIEUWE naam. Geen bestaande tabel wordt hernoemd, geen regel code leest ze.
--
-- ── DE CENSUS EERST ─────────────────────────────────────────────────────────
--
-- Zoals bij Google (045-048): eerst tellen wat er werkelijk in staat, dan pas bouwen. Per kolom
-- geteld hoeveel niet-lege waarden er zijn:
--
--   meta_account_daily      160 rijen, 13 kolommen gevuld, 21 leeg
--   linkedin_account_daily  160 rijen, 14 kolommen gevuld, 15 leeg
--
-- Leeg zijn onder meer cpm, cpc_link, ctr_link, cpa, roas, purchase_roas (Meta) en ctr, cpc, cpm,
-- cpl (LinkedIn). Nul van de 160. Dat is dezelfde situatie als bij de Google-videokolommen: de
-- backfill vult ze niet, de live sync wel. Ze krijgen daarom een echte kolom in plaats van een
-- berekening in de view — anders staat er straks een som waar een platformwaarde hoort.
--
-- Waarom niet gewoon berekenen? Omdat bij Google precies dat is misgegaan: conversion_rate leek
-- een deling en was het niet. Een lege kolom bewijst niet dat hij reproduceerbaar is; hij bewijst
-- alleen dat er nog niets in staat. Zolang dat zo is, is dragen de enige keuze die later niet
-- stilzwijgend fout blijkt.
--
-- ── EEN VERLIES DAT IK NIET KAN REPAREREN, EN DUS TEL ───────────────────────
--
-- fact_core.clicks is `not null default 0` en migratie 036 vulde hem met coalesce(clicks_all, 0).
-- In meta_account_daily is clicks_all bij ALLE 160 rijen leeg. Die NULL is in fact_core een 0
-- geworden en daar is hij niet meer uit te halen: 0 klikken en "onbekend" zien er hetzelfde uit.
--
-- Dat is dezelfde vorm als de roas-nul bij Google — een leegte die zich voordoet als een meting —
-- maar met een verschil dat telt: die kon ik nabootsen, deze niet. De view geeft 0 waar de tabel
-- NULL heeft, en dat verschil is echt. check-view-dekking.mjs telt het per kolom onder
-- `nul_vs_leeg` in plaats van het in een negeer-lijst te laten verdwijnen.
--
-- Voor de meeste lezers maakt het niets uit: die schrijven `Number(x ?? 0)`. Voor een gemiddelde
-- wel — NULL telt niet mee in avg(), 0 wel. Dat hoort een besluit te zijn bij fase 4, per scherm,
-- en niet iets wat hier ongemerkt gebeurt.
--
-- ── conversions IS TERUG TE REKENEN ─────────────────────────────────────────
--
-- fact_core.conversions draagt voor Meta de som conversions + leads en voor LinkedIn
-- one_click_leads + external_website_conversions (migratie 036). De componenten staan alle vier in
-- de metriektabellen, dus de oorspronkelijke kolom is een aftrekking. Dat is geen tweede waarheid
-- maar dezelfde waarheid andersom gelezen.

alter table meta_metrics add column if not exists cpm           numeric;
alter table meta_metrics add column if not exists cpc_link      numeric;
alter table meta_metrics add column if not exists ctr_link      numeric;
alter table meta_metrics add column if not exists purchase_roas numeric;
alter table meta_metrics add column if not exists cpa           numeric;
alter table meta_metrics add column if not exists roas          numeric;
alter table meta_metrics add column if not exists conversions   numeric;

alter table linkedin_metrics add column if not exists ctr numeric;
alter table linkedin_metrics add column if not exists cpc numeric;
alter table linkedin_metrics add column if not exists cpm numeric;
alter table linkedin_metrics add column if not exists cpl numeric;

comment on column meta_metrics.conversions is
  'De conversiekolom van de bron, LOS van leads. fact_core.conversions draagt de som van die twee; '
  'hier staat de component, zodat de view de oude kolom exact kan teruggeven.';

-- ── Vullen: de platformverhoudingen en de losse conversiekolom ──────────────

update meta_metrics m set cpm = s.cpm, cpc_link = s.cpc_link, ctr_link = s.ctr_link,
       purchase_roas = s.purchase_roas, cpa = s.cpa, roas = s.roas, conversions = s.conversions
from meta_account_daily s join accounts a on a.client_id = s.client_id
where m.account_id = a.id and m.level = 'account' and m.grain = 'day'
  and m.entity_id = coalesce(s.entity_id,'') and m.period_start = s.date;

update meta_metrics m set cpm = s.cpm, cpc_link = s.cpc_link, ctr_link = s.ctr_link,
       purchase_roas = s.purchase_roas, cpa = s.cpa, roas = s.roas, conversions = s.conversions
from meta_campaign_daily s join accounts a on a.client_id = s.client_id
where m.account_id = a.id and m.level = 'campaign' and m.grain = 'day'
  and m.entity_id = coalesce(s.entity_id,'') and m.period_start = s.date;

update meta_metrics m set cpm = s.cpm, cpc_link = s.cpc_link, ctr_link = s.ctr_link,
       purchase_roas = s.purchase_roas, cpa = s.cpa, roas = s.roas, conversions = s.conversions
from meta_ad_daily s join accounts a on a.client_id = s.client_id
where m.account_id = a.id and m.level = 'creative' and m.grain = 'day'
  and m.entity_id = coalesce(s.entity_id,'') and m.period_start = s.date;

update linkedin_metrics m set ctr = s.ctr, cpc = s.cpc, cpm = s.cpm, cpl = s.cpl
from linkedin_account_daily s join accounts a on a.client_id = s.client_id
where m.account_id = a.id and m.level = 'account' and m.grain = 'day'
  and m.entity_id = coalesce(s.entity_urn,'') and m.period_start = s.date;

update linkedin_metrics m set ctr = s.ctr, cpc = s.cpc, cpm = s.cpm, cpl = s.cpl
from linkedin_campaign_daily s join accounts a on a.client_id = s.client_id
where m.account_id = a.id and m.level = 'campaign' and m.grain = 'day'
  and m.entity_id = coalesce(s.entity_urn,'') and m.period_start = s.date;

update linkedin_metrics m set ctr = s.ctr, cpc = s.cpc, cpm = s.cpm, cpl = s.cpl
from linkedin_creative_daily s join accounts a on a.client_id = s.client_id
where m.account_id = a.id and m.level = 'creative' and m.grain = 'day'
  and m.entity_id = coalesce(s.entity_urn,'') and m.period_start = s.date;

-- ── De views ────────────────────────────────────────────────────────────────
--
-- Drie keer dezelfde vorm per kanaal, alleen `level` verschilt. De join op de metriektabel is
-- LEFT: een fact-rij zonder metriekrij hoort een rij te blijven met lege metriekvelden.

drop view if exists kandidaat_meta_account_daily;
create view kandidaat_meta_account_daily as
select a.client_id, f.period_start as date, f.entity_id,
  f.impressions, m.views, m.reach, m.frequency,
  f.clicks as clicks_all, m.link_clicks, f.cost as spend,
  m.cpm, m.cpc_link, m.ctr_link,
  m.conversions, f.conv_value as conversion_value,
  m.purchase_roas, m.cpa, m.roas,
  m.leads, m.add_to_cart, m.initiate_checkout, m.landing_page_views,
  m.video_3s_views, m.video_thruplay, m.video_p25, m.video_p50, m.video_p75, m.video_p100,
  m.post_engagement, m.hook_rate, m.hold_rate,
  null::jsonb as raw, f.synced_at as created_at, f.synced_at as updated_at
from fact_core f join accounts a on a.id = f.account_id
left join meta_metrics m on m.account_id = f.account_id and m.level = 'account'
  and m.entity_id = f.entity_id and m.grain = 'day' and m.period_start = f.period_start
where f.channel = 'meta' and f.level = 'account' and f.grain = 'day';

drop view if exists kandidaat_meta_campaign_daily;
create view kandidaat_meta_campaign_daily as
select a.client_id, f.period_start as date, f.entity_id,
  f.impressions, m.views, m.reach, m.frequency,
  f.clicks as clicks_all, m.link_clicks, f.cost as spend,
  m.cpm, m.cpc_link, m.ctr_link,
  m.conversions, f.conv_value as conversion_value,
  m.purchase_roas, m.cpa, m.roas,
  m.leads, m.add_to_cart, m.initiate_checkout, m.landing_page_views,
  m.video_3s_views, m.video_thruplay, m.video_p25, m.video_p50, m.video_p75, m.video_p100,
  m.post_engagement, m.hook_rate, m.hold_rate,
  null::jsonb as raw, f.synced_at as created_at, f.synced_at as updated_at
from fact_core f join accounts a on a.id = f.account_id
left join meta_metrics m on m.account_id = f.account_id and m.level = 'campaign'
  and m.entity_id = f.entity_id and m.grain = 'day' and m.period_start = f.period_start
where f.channel = 'meta' and f.level = 'campaign' and f.grain = 'day';

drop view if exists kandidaat_meta_ad_daily;
create view kandidaat_meta_ad_daily as
select a.client_id, f.period_start as date, f.entity_id,
  f.impressions, m.views, m.reach, m.frequency,
  f.clicks as clicks_all, m.link_clicks, f.cost as spend,
  m.cpm, m.cpc_link, m.ctr_link,
  m.conversions, f.conv_value as conversion_value,
  m.purchase_roas, m.cpa, m.roas,
  m.leads, m.add_to_cart, m.initiate_checkout, m.landing_page_views,
  m.video_3s_views, m.video_thruplay, m.video_p25, m.video_p50, m.video_p75, m.video_p100,
  m.post_engagement, m.hook_rate, m.hold_rate,
  m.quality_ranking, m.engagement_rate_ranking, m.conversion_rate_ranking,
  null::jsonb as raw, f.synced_at as created_at, f.synced_at as updated_at
from fact_core f join accounts a on a.id = f.account_id
left join meta_metrics m on m.account_id = f.account_id and m.level = 'creative'
  and m.entity_id = f.entity_id and m.grain = 'day' and m.period_start = f.period_start
where f.channel = 'meta' and f.level = 'creative' and f.grain = 'day';

drop view if exists kandidaat_linkedin_account_daily;
create view kandidaat_linkedin_account_daily as
select a.client_id, f.period_start as date, f.entity_id as entity_urn,
  f.impressions, f.clicks, f.cost as spend,
  m.ctr, m.cpc, m.cpm,
  m.landing_page_clicks, m.one_click_lead_form_opens, m.one_click_leads,
  m.external_website_conversions, m.post_click_conversions,
  f.conv_value as conversion_value, m.cpl, m.form_completion_rate,
  m.video_starts, m.video_views, m.video_completions, m.video_completion_rate,
  m.total_engagements, m.follows, m.reactions, m.comments, m.shares,
  null::jsonb as raw, f.synced_at as created_at, f.synced_at as updated_at
from fact_core f join accounts a on a.id = f.account_id
left join linkedin_metrics m on m.account_id = f.account_id and m.level = 'account'
  and m.entity_id = f.entity_id and m.grain = 'day' and m.period_start = f.period_start
where f.channel = 'linkedin' and f.level = 'account' and f.grain = 'day';

drop view if exists kandidaat_linkedin_campaign_daily;
create view kandidaat_linkedin_campaign_daily as
select a.client_id, f.period_start as date, f.entity_id as entity_urn,
  f.impressions, f.clicks, f.cost as spend,
  m.ctr, m.cpc, m.cpm,
  m.landing_page_clicks, m.one_click_lead_form_opens, m.one_click_leads,
  m.external_website_conversions, m.post_click_conversions,
  f.conv_value as conversion_value, m.cpl, m.form_completion_rate,
  m.video_starts, m.video_views, m.video_completions, m.video_completion_rate,
  m.total_engagements, m.follows, m.reactions, m.comments, m.shares,
  null::jsonb as raw, f.synced_at as created_at, f.synced_at as updated_at
from fact_core f join accounts a on a.id = f.account_id
left join linkedin_metrics m on m.account_id = f.account_id and m.level = 'campaign'
  and m.entity_id = f.entity_id and m.grain = 'day' and m.period_start = f.period_start
where f.channel = 'linkedin' and f.level = 'campaign' and f.grain = 'day';

drop view if exists kandidaat_linkedin_creative_daily;
create view kandidaat_linkedin_creative_daily as
select a.client_id, f.period_start as date, f.entity_id as entity_urn,
  f.impressions, f.clicks, f.cost as spend,
  m.ctr, m.cpc, m.cpm,
  m.landing_page_clicks, m.one_click_lead_form_opens, m.one_click_leads,
  m.external_website_conversions, m.post_click_conversions,
  f.conv_value as conversion_value, m.cpl, m.form_completion_rate,
  m.video_starts, m.video_views, m.video_completions, m.video_completion_rate,
  m.total_engagements, m.follows, m.reactions, m.comments, m.shares,
  null::jsonb as raw, f.synced_at as created_at, f.synced_at as updated_at
from fact_core f join accounts a on a.id = f.account_id
left join linkedin_metrics m on m.account_id = f.account_id and m.level = 'creative'
  and m.entity_id = f.entity_id and m.grain = 'day' and m.period_start = f.period_start
where f.channel = 'linkedin' and f.level = 'creative' and f.grain = 'day';

select 'draai nu scripts/check-view-dekking.mjs' as volgende_stap;

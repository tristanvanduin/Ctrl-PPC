-- 041: de kanaaleigen metrieken, getypeerd, één tabel per kanaal.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief: twee nieuwe tabellen, gevuld uit de
-- bestaande. Geen bestaande tabel of rij wordt aangeraakt en geen regel code leest ze nog.
-- Terugdraaien is `drop table meta_metrics, linkedin_metrics`.
--
-- Zie docs/ONTWERP_multitenant_schema.md §2.2, laag 2.
--
-- ── WAAROM GETYPEERDE KOLOMMEN EN GEEN JSONB ────────────────────────────────
--
-- De eerste versie van het ontwerp zette alles buiten de vijf kanonieke grootheden in een
-- jsonb-veld. Geteld bleek dat driekwart van alle metrieken te zijn: 175 van de 235 numerieke
-- kolommen in de veertien grootste tabellen. Creative fatigue draait op frequency, hook_rate en
-- hold_rate; video op thruplay en de kwartielen; LinkedIn op zijn lead-varianten. Al die analyses
-- zouden ongetypeerd door jsonb moeten en trager worden dan ze nu zijn.
--
-- Dus: echte kolommen, per kanaal één tabel, met dezelfde sleutel als fact_core.
--
-- ── ÉÉN TABEL VOOR ALLE NIVEAUS ─────────────────────────────────────────────
--
-- account, campagne en creative dragen binnen een kanaal vrijwel dezelfde metrieken, dus `level`
-- zit in de sleutel in plaats van dat er drie tabellen komen. Daarmee vervangt één tabel er drie.
--
-- Vrijwel, niet helemaal: meta_ad_daily heeft drie kolommen die de andere twee niveaus niet
-- hebben — quality_ranking, engagement_rate_ranking en conversion_rate_ranking. Die staan hier
-- gewoon in en blijven leeg op account- en campagneniveau. Dat is goedkoper dan een aparte tabel
-- voor drie velden.
--
-- ── WAT ER BEWUST NIET IN ZIT ───────────────────────────────────────────────
--
-- Afgeleide verhoudingen die uit fact_core te berekenen zijn, staan hier niet: ctr, cpc, cpm,
-- cpa, roas, cpl, ctr_link, cpc_link en purchase_roas. Die worden berekend waar ze getoond
-- worden. Zo kan §1.4 zich niet herhalen — daar staan 552 rijen met een conversieratio die niet
-- klopt met hun eigen invoer, precies omdat de ratio los is opgeslagen naast de componenten.
--
-- WEL bewaard, en dat is geen inconsistentie: verhoudingen die het platform zelf berekent op een
-- manier die wij niet kunnen reproduceren. hook_rate, hold_rate, video_completion_rate en
-- form_completion_rate horen daarbij, net als reach en frequency — reach telt niet op over dagen
-- omdat personen ontdubbeld worden. Die dragen de betekenis "dit zegt het platform", naast wat de
-- componenten zeggen. Het verschil hoort zichtbaar te zijn, niet weggepoetst.
--
-- De raw-jsonb kolommen gaan niet mee. Ze staan in alle gecontroleerde tabellen op nul rijen
-- gevuld, en ruwe API-antwoorden zijn precies de plek waar ongemerkt persoonsgegevens in kunnen
-- belanden. Wie ze wil bewaren, doet dat als bewuste keuze met een bewaartermijn erbij.

create table if not exists meta_metrics (
  account_id     uuid not null references accounts(id) on delete cascade,
  level          text not null check (level in ('account','campaign','adgroup','creative')),
  entity_id      text not null default '',
  grain          text not null check (grain in ('day','week','month')),
  period_start   date not null,

  -- bereik: niet optelbaar over periodes, komt daarom van het platform
  reach                   bigint,
  frequency               numeric,

  -- klikvarianten naast de kanonieke clicks in fact_core
  link_clicks             bigint,
  landing_page_views      bigint,

  -- uitkomsten die naast de gekozen conversietelling bestaan
  leads                   numeric,
  add_to_cart             numeric,
  initiate_checkout       numeric,

  -- video
  views                   bigint,
  video_3s_views          bigint,
  video_thruplay          bigint,
  video_p25               bigint,
  video_p50               bigint,
  video_p75               bigint,
  video_p100              bigint,

  -- betrokkenheid en de door Meta berekende verhoudingen
  post_engagement         bigint,
  hook_rate               numeric,
  hold_rate               numeric,

  -- alleen op advertentieniveau
  quality_ranking         text,
  engagement_rate_ranking text,
  conversion_rate_ranking text,

  primary key (account_id, level, entity_id, grain, period_start)
);

create index if not exists idx_meta_metrics_periode
  on meta_metrics (account_id, grain, period_start desc);

create table if not exists linkedin_metrics (
  account_id     uuid not null references accounts(id) on delete cascade,
  level          text not null check (level in ('account','campaign','adgroup','creative')),
  entity_id      text not null default '',
  grain          text not null check (grain in ('day','week','month')),
  period_start   date not null,

  landing_page_clicks           bigint,

  -- de drie conversiesoorten die LinkedIn los levert; welke meetellen in fact_core.conversions
  -- is een instelling per klant (client_settings.channel_conversion_config, zie migratie 036).
  -- Ze staan hier alle drie los, zodat die keuze altijd terug te rekenen is.
  one_click_lead_form_opens     bigint,
  one_click_leads               numeric,
  external_website_conversions  numeric,
  post_click_conversions        numeric,
  form_completion_rate          numeric,

  video_starts                  bigint,
  video_views                   bigint,
  video_completions             bigint,
  video_completion_rate         numeric,

  total_engagements             bigint,
  follows                       bigint,
  reactions                     bigint,
  comments                      bigint,
  shares                        bigint,

  primary key (account_id, level, entity_id, grain, period_start)
);

create index if not exists idx_linkedin_metrics_periode
  on linkedin_metrics (account_id, grain, period_start desc);

-- ── Vullen ──────────────────────────────────────────────────────────────────

insert into meta_metrics (account_id, level, entity_id, grain, period_start,
  reach, frequency, link_clicks, landing_page_views, leads, add_to_cart, initiate_checkout,
  views, video_3s_views, video_thruplay, video_p25, video_p50, video_p75, video_p100,
  post_engagement, hook_rate, hold_rate)
select a.id, 'account', coalesce(s.entity_id,''), 'day', s.date,
  s.reach, s.frequency, s.link_clicks, s.landing_page_views, s.leads, s.add_to_cart,
  s.initiate_checkout, s.views, s.video_3s_views, s.video_thruplay, s.video_p25, s.video_p50,
  s.video_p75, s.video_p100, s.post_engagement, s.hook_rate, s.hold_rate
from meta_account_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do nothing;

insert into meta_metrics (account_id, level, entity_id, grain, period_start,
  reach, frequency, link_clicks, landing_page_views, leads, add_to_cart, initiate_checkout,
  views, video_3s_views, video_thruplay, video_p25, video_p50, video_p75, video_p100,
  post_engagement, hook_rate, hold_rate)
select a.id, 'campaign', coalesce(s.entity_id,''), 'day', s.date,
  s.reach, s.frequency, s.link_clicks, s.landing_page_views, s.leads, s.add_to_cart,
  s.initiate_checkout, s.views, s.video_3s_views, s.video_thruplay, s.video_p25, s.video_p50,
  s.video_p75, s.video_p100, s.post_engagement, s.hook_rate, s.hold_rate
from meta_campaign_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do nothing;

insert into meta_metrics (account_id, level, entity_id, grain, period_start,
  reach, frequency, link_clicks, landing_page_views, leads, add_to_cart, initiate_checkout,
  views, video_3s_views, video_thruplay, video_p25, video_p50, video_p75, video_p100,
  post_engagement, hook_rate, hold_rate,
  quality_ranking, engagement_rate_ranking, conversion_rate_ranking)
select a.id, 'creative', coalesce(s.entity_id,''), 'day', s.date,
  s.reach, s.frequency, s.link_clicks, s.landing_page_views, s.leads, s.add_to_cart,
  s.initiate_checkout, s.views, s.video_3s_views, s.video_thruplay, s.video_p25, s.video_p50,
  s.video_p75, s.video_p100, s.post_engagement, s.hook_rate, s.hold_rate,
  s.quality_ranking, s.engagement_rate_ranking, s.conversion_rate_ranking
from meta_ad_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do nothing;

insert into linkedin_metrics (account_id, level, entity_id, grain, period_start,
  landing_page_clicks, one_click_lead_form_opens, one_click_leads, external_website_conversions,
  post_click_conversions, form_completion_rate, video_starts, video_views, video_completions,
  video_completion_rate, total_engagements, follows, reactions, comments, shares)
select a.id, 'account', coalesce(s.entity_urn,''), 'day', s.date,
  s.landing_page_clicks, s.one_click_lead_form_opens, s.one_click_leads,
  s.external_website_conversions, s.post_click_conversions, s.form_completion_rate,
  s.video_starts, s.video_views, s.video_completions, s.video_completion_rate,
  s.total_engagements, s.follows, s.reactions, s.comments, s.shares
from linkedin_account_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do nothing;

insert into linkedin_metrics (account_id, level, entity_id, grain, period_start,
  landing_page_clicks, one_click_lead_form_opens, one_click_leads, external_website_conversions,
  post_click_conversions, form_completion_rate, video_starts, video_views, video_completions,
  video_completion_rate, total_engagements, follows, reactions, comments, shares)
select a.id, 'campaign', coalesce(s.entity_urn,''), 'day', s.date,
  s.landing_page_clicks, s.one_click_lead_form_opens, s.one_click_leads,
  s.external_website_conversions, s.post_click_conversions, s.form_completion_rate,
  s.video_starts, s.video_views, s.video_completions, s.video_completion_rate,
  s.total_engagements, s.follows, s.reactions, s.comments, s.shares
from linkedin_campaign_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do nothing;

insert into linkedin_metrics (account_id, level, entity_id, grain, period_start,
  landing_page_clicks, one_click_lead_form_opens, one_click_leads, external_website_conversions,
  post_click_conversions, form_completion_rate, video_starts, video_views, video_completions,
  video_completion_rate, total_engagements, follows, reactions, comments, shares)
select a.id, 'creative', coalesce(s.entity_urn,''), 'day', s.date,
  s.landing_page_clicks, s.one_click_lead_form_opens, s.one_click_leads,
  s.external_website_conversions, s.post_click_conversions, s.form_completion_rate,
  s.video_starts, s.video_views, s.video_completions, s.video_completion_rate,
  s.total_engagements, s.follows, s.reactions, s.comments, s.shares
from linkedin_creative_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do nothing;

-- ── Controle ────────────────────────────────────────────────────────────────

select 'meta_metrics' as tabel, level, count(*) as rijen from meta_metrics group by level
union all
select 'linkedin_metrics', level, count(*) from linkedin_metrics group by level
order by tabel, level;

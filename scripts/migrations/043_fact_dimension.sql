-- 043: negen dimensietabellen worden er één.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief: één nieuwe tabel, gevuld uit de
-- bestaande. Geen bestaande tabel of rij wordt aangeraakt en geen regel code leest hem nog.
-- Terugdraaien is `drop table fact_dimension`.
--
-- Vervangt bij het lezen: ads_search_terms_monthly, ads_keyword_performance_monthly,
-- ads_device_performance_monthly, ads_network_performance_monthly, ads_geo_performance_monthly,
-- ads_audience_performance_monthly, ads_country_monthly, ads_region_monthly en
-- linkedin_demographic_daily. Negen tabellen met negen bijna-identieke vormen.
--
-- Hier is de winst het grootst en het risico het kleinst: deze tabellen dragen allemaal dezelfde
-- vier grootheden, alleen met een andere dimensiekolom ervoor.
--
-- ── DE SLEUTEL, IN DRIE RONDES GEMETEN ──────────────────────────────────────
--
-- De eerste opzet had `key` = de dimensiewaarde en `parent_id` = de campagne. Geteld hoeveel
-- rijen daarop zouden botsen, en dus met `on conflict do nothing` stilzwijgend zouden verdwijnen:
--
--   ronde 1  key = tekst, parent = campagne                13.784 botsingen
--   ronde 2  + variant (match_type, audience_type, land)    3.696 botsingen
--   ronde 3  + advertentiegroep, en id in plaats van naam        0 botsingen
--
-- Dat zijn drie keer een correctie op mijn eigen aanname, en de eerste zou 13.784 rijen hebben
-- gekost zonder één foutmelding. De echte korrel is de ADVERTENTIEGROEP, niet de campagne, en de
-- stabiele sleutel is het id waar het platform er een geeft (keyword_id, audience_id,
-- geo_target_id) — niet de naam, want twee doelgroepen kunnen dezelfde naam dragen.
--
-- Vandaar de opzet hieronder:
--
--   key        het id waar dat bestaat, anders de tekst zelf (zoekterm, device, netwerk)
--   key_label  wat een mens leest; gelijk aan key waar er geen apart id is
--   variant    wat twee overigens gelijke rijen onderscheidt: match_type, audience_type, land
--   campaign_id / adgroup_id   leeg betekent: dit is een accountbrede rij
--
-- Het NIVEAU staat er niet apart in, want het volgt uit die twee kolommen. Gecontroleerd op
-- ads_device_performance_monthly, de enige bron met een eigen level-kolom: alle 2.735
-- account-rijen hebben geen campaign_id en alle 12.668 campagne-rijen wel. Een aparte
-- level-kolom zou dus hetzelfde twee keer zeggen, en dat is precies hoe twee waarheden uit de pas
-- gaan lopen.
--
-- ── AFGELEIDE WAARDEN GAAN NIET MEE ─────────────────────────────────────────
--
-- ctr, conversion_rate, avg_cpc, cost_per_conversion, roas, spend_share: allemaal te berekenen
-- uit de vier grootheden hieronder. Zie §2.4 van het ontwerp en de 552 rijen die bewijzen waarom.

create table if not exists fact_dimension (
  account_id    uuid not null references accounts(id) on delete cascade,
  channel       text not null,
  dimension     text not null,
  key           text not null,
  key_label     text,
  variant       text not null default '',
  campaign_id   text not null default '',
  adgroup_id    text not null default '',
  grain         text not null check (grain in ('day','week','month')),
  period_start  date not null,

  impressions   bigint  not null default 0,
  clicks        bigint  not null default 0,
  cost          numeric not null default 0,
  conversions   numeric not null default 0,
  conv_value    numeric not null default 0,

  synced_at     timestamptz not null default now(),
  primary key (account_id, channel, dimension, key, variant, campaign_id, adgroup_id, grain, period_start)
);

create index if not exists idx_fact_dimension_zoeken
  on fact_dimension (account_id, channel, dimension, grain, period_start desc);
-- "de duurste zoektermen van deze klant" is de query die het vaakst gesteld wordt.
create index if not exists idx_fact_dimension_kosten
  on fact_dimension (account_id, dimension, cost desc);

-- ── Vullen ──────────────────────────────────────────────────────────────────

insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
       campaign_id, adgroup_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'search_term', s.search_term, s.search_term, coalesce(s.match_type,''),
       coalesce(s.campaign_id,''), coalesce(s.ad_group_id,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_search_terms_monthly s join accounts a on a.client_id = s.client_id
where s.search_term is not null
on conflict do nothing;

insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
       campaign_id, adgroup_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'keyword', coalesce(s.keyword_id, s.keyword_text), s.keyword_text,
       coalesce(s.match_type,''), coalesce(s.campaign_id,''), coalesce(s.ad_group_id,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_keyword_performance_monthly s join accounts a on a.client_id = s.client_id
where coalesce(s.keyword_id, s.keyword_text) is not null
on conflict do nothing;

insert into fact_dimension (account_id, channel, dimension, key, key_label,
       campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'device', s.device, s.device, coalesce(s.campaign_id,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_device_performance_monthly s join accounts a on a.client_id = s.client_id
where s.device is not null
on conflict do nothing;

insert into fact_dimension (account_id, channel, dimension, key, key_label,
       campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'network', s.network_type, s.network_type, coalesce(s.campaign_id,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_network_performance_monthly s join accounts a on a.client_id = s.client_id
where s.network_type is not null
on conflict do nothing;

-- Regio per campagne. city_name is bij alle 1642 rijen leeg, dus dit is regioniveau; de
-- geo_target_id is de stabiele sleutel en het land is de variant die twee gelijknamige regio's
-- uit elkaar houdt.
insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
       campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'region', coalesce(s.geo_target_id, s.region_name), s.region_name,
       coalesce(s.country_code,''), coalesce(s.campaign_id,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_geo_performance_monthly s join accounts a on a.client_id = s.client_id
where coalesce(s.geo_target_id, s.region_name) is not null
on conflict do nothing;

insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
       campaign_id, adgroup_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'audience', coalesce(s.audience_id, s.audience_name), s.audience_name,
       coalesce(s.audience_type,''), coalesce(s.campaign_id,''), coalesce(s.ad_group_id,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_audience_performance_monthly s join accounts a on a.client_id = s.client_id
where coalesce(s.audience_id, s.audience_name) is not null
on conflict do nothing;

-- Land en regio op ACCOUNTNIVEAU: campaign_id blijft leeg, en dat is wat ze onderscheidt van de
-- campagne-rijen hierboven. Zonder dat onderscheid zou een som over dimension='region' de
-- accountcijfers bij de campagnecijfers optellen.
insert into fact_dimension (account_id, channel, dimension, key, key_label,
       grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'country', s.country_code, s.country_code, 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_country_monthly s join accounts a on a.client_id = s.client_id
where s.country_code is not null
on conflict do nothing;

insert into fact_dimension (account_id, channel, dimension, key, key_label, variant,
       grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'region', coalesce(s.region_code, s.region_name), s.region_name,
       coalesce(s.country_code,''), 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_region_monthly s join accounts a on a.client_id = s.client_id
where coalesce(s.region_code, s.region_name) is not null
on conflict do nothing;

-- LinkedIn had deze vorm al: pivot_type is de dimensie, pivot_value_urn de sleutel. Dat is de
-- beste bevestiging dat de opzet klopt — iemand kwam er onafhankelijk op uit.
insert into fact_dimension (account_id, channel, dimension, key, key_label,
       campaign_id, grain, period_start, impressions, clicks, cost, conversions, conv_value)
select a.id, 'linkedin', lower(s.pivot_type), s.pivot_value_urn, s.pivot_value_urn,
       coalesce(s.entity_urn,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.spend,0),
       coalesce(s.conversions,0), 0
from linkedin_demographic_daily s join accounts a on a.client_id = s.client_id
where s.pivot_type is not null and s.pivot_value_urn is not null
on conflict do nothing;

-- ── Controle ────────────────────────────────────────────────────────────────

select channel, dimension, count(*) as rijen,
       count(*) filter (where campaign_id = '') as accountbreed
from fact_dimension group by channel, dimension order by rijen desc;

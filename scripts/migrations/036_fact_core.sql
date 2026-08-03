-- 036: fact_core — de vijf grootheden die elk platform levert, kanaalneutraal.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief. Er wordt één nieuwe tabel aangemaakt en
-- gevuld uit de bestaande tabellen. Geen bestaande tabel, kolom of rij wordt aangeraakt, en geen
-- regel code leest fact_core nog. Terugdraaien is `drop table fact_core`.
--
-- Zie docs/ONTWERP_multitenant_schema.md §2.2.
--
-- ── DE KORREL STAAT IN DE DATA ──────────────────────────────────────────────
--
-- Google staat per maand, Meta en LinkedIn per dag. Dat is geen fout die rechtgezet moet worden
-- maar de huidige werkelijkheid, en `grain` maakt hem uitdrukbaar in plaats van dat een maandrij
-- moet doen alsof hij een dag is. Een query die optelt MOET een grain kiezen; dagen en maanden
-- bij elkaar optellen is daardoor geen slordigheid meer maar onmogelijk.
--
-- ── DE VERTALING VAN DE NAMEN ───────────────────────────────────────────────
--
-- Dit is de kern: drie woordenboeken worden er één.
--
--   begrip        Google              Meta                LinkedIn
--   kosten        cost                spend               spend
--   klikken       clicks              clicks_all          clicks
--   waarde        conversions_value   conversion_value    conversion_value
--   entiteit      campaign_id         entity_id           entity_urn
--
-- Bij klikken is een keuze gemaakt: Meta's `clicks_all` wordt de kanonieke `clicks`, omdat dat
-- overeenkomt met wat Google `clicks` noemt (alle klikken). `link_clicks` is iets anders en hoort
-- in de kanaaltabel, niet hier. Zou `link_clicks` hier staan, dan zou een cross-channel
-- vergelijking Meta stelselmatig te laag zetten.
--
-- ── CONVERSIES ZIJN EEN INSTELLING, GEEN KOLOM ──────────────────────────────
--
-- LET OP. Google heeft één `conversions`. Meta en LinkedIn niet: daar is "wat telt als conversie"
-- een keuze die per klant instelbaar is via client_settings.channel_conversion_config, met als
-- standaard (zie lib/analysis/channel-conversion-config.ts):
--
--   meta_ads      conversions + leads
--   linkedin_ads  one_click_leads + external_website_conversions
--
-- Geteld voor deze migratie: geen enkele klant heeft een afwijkende instelling, dus de standaard
-- geldt overal. Deze backfill past die standaard toe.
--
-- Het gevolg dat je moet weten: `fact_core.conversions` is voor deze twee kanalen een AFGELEIDE
-- van een instelling, en niet een ruw feit. Wijzigt een klant zijn conversie-selectie, dan moeten
-- zijn rijen opnieuw berekend worden. De ruwe componenten blijven in de kanaaltabellen staan, dus
-- dat kan altijd — maar het gebeurt niet vanzelf. Dat hoort in de sync (fase 2c) als een
-- herberekening bij het opslaan van die instelling.
--
-- De alternatieven waren slechter: de componenten hier los opslaan maakt de kolom niet meer
-- optelbaar over kanalen heen, en pas bij het lezen kiezen zet de vertaalregels terug in elke
-- leesplek — precies wat dit ontwerp opheft.

create table if not exists fact_core (
  account_id    uuid not null references accounts(id) on delete cascade,
  channel       text not null,
  level         text not null check (level in ('account','campaign','adgroup','creative')),
  entity_id     text not null default '',
  entity_name   text,
  grain         text not null check (grain in ('day','week','month')),
  period_start  date not null,

  impressions   bigint  not null default 0,
  clicks        bigint  not null default 0,
  cost          numeric not null default 0,
  conversions   numeric not null default 0,
  conv_value    numeric not null default 0,

  synced_at     timestamptz not null default now(),
  primary key (account_id, channel, level, entity_id, grain, period_start)
);

create index if not exists idx_fact_core_account_kanaal_periode
  on fact_core (account_id, channel, grain, period_start desc);
create index if not exists idx_fact_core_account_niveau
  on fact_core (account_id, grain, period_start desc) where level = 'account';

-- ── Vullen ──────────────────────────────────────────────────────────────────
--
-- `on conflict do update` en niet `do nothing`: zo is de migratie herhaalbaar en corrigeert een
-- tweede run een eerdere onvolledige vulling in plaats van hem te laten staan.

-- Google, accountniveau (maand)
insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'account', '', a.name, 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_account_monthly s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

-- Google, campagneniveau (maand)
insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'google', 'campaign', coalesce(s.campaign_id,''), s.campaign_name, 'month', s.month,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.cost,0),
       coalesce(s.conversions,0), coalesce(s.conversions_value,0)
from ads_campaign_monthly s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value,
      entity_name = excluded.entity_name, synced_at = now();

-- Meta, account- en campagneniveau (dag). conversions = conversions + leads (de standaard).
insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'meta', 'account', coalesce(s.entity_id,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks_all,0), coalesce(s.spend,0),
       coalesce(s.conversions,0) + coalesce(s.leads,0), coalesce(s.conversion_value,0)
from meta_account_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'meta', 'campaign', coalesce(s.entity_id,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks_all,0), coalesce(s.spend,0),
       coalesce(s.conversions,0) + coalesce(s.leads,0), coalesce(s.conversion_value,0)
from meta_campaign_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

-- LinkedIn. conversions = one_click_leads + external_website_conversions (de standaard).
insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'linkedin', 'account', coalesce(s.entity_urn,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.spend,0),
       coalesce(s.one_click_leads,0) + coalesce(s.external_website_conversions,0),
       coalesce(s.conversion_value,0)
from linkedin_account_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'linkedin', 'campaign', coalesce(s.entity_urn,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.spend,0),
       coalesce(s.one_click_leads,0) + coalesce(s.external_website_conversions,0),
       coalesce(s.conversion_value,0)
from linkedin_campaign_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

-- ── Controle ────────────────────────────────────────────────────────────────
select channel, level, grain, count(*) as rijen,
       min(period_start) as van, max(period_start) as tot
from fact_core group by channel, level, grain order by channel, level;

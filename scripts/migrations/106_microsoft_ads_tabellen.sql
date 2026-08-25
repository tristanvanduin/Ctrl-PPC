-- 106: de microsoft_*-tabellen voor het vierde kanaal (Microsoft Ads / Bing).
--
-- ── VORM ─────────────────────────────────────────────────────────────────────
--
-- De dagtabellen spiegelen het Meta-patroon (007): een accounttabel, en campagne/adgroup via
-- `like ... including all` zodat kolommen, defaults, de unique-constraint en de lookup-index in
-- één definitie leven. De maandtabellen spiegelen de Google-search-vormen
-- (ads_keyword_performance_monthly, ads_search_terms_monthly, ads_campaign_impression_share):
-- Microsoft IS search, en de consumenten lezen die tabellen per maand.
--
-- Kanaal-eigen kolommen, en waarom ze bestaan:
--   microsoft_campaigns.import_source    accounts worden hier vrijwel altijd als Google-import
--                                        geboren; import-DRIFT is de standaardfout die pijler 2
--                                        niveau B detecteert. NULL = native gebouwd.
--   microsoft_profile_monthly            LinkedIn-profieldimensies (industry/company/function) --
--                                        het enige searchkanaal met B2B-profieltargeting; voedt
--                                        pijler 4 niveau A.
--   microsoft_breakdown_daily            long format zoals meta_breakdown_daily, met
--                                        breakdown_type network|device: het Audience Network als
--                                        eigen analyse-as (pijler 5) en de desktop-zwaarte
--                                        (pijler 4 niveau B).
--
-- GEEN video-/funnelkolommen zoals Meta: dit is search. GEEN fact_core-projectie: die hoort bij
-- het bevroren fase-3-project (docs/ONTWERP_multitenant_schema.md) en volgt daar; deze tabellen
-- zijn gewone brontabellen zoals meta_adsets dat vandaag ook nog is.
--
-- Dagkorrel waar de Microsoft Reporting API dagkorrel levert (account/campagne/adgroup/breakdown):
-- daarmee krijgt de Microsoft-weekly échte week-op-week-vergelijkingen -- de beperking die
-- Google's weekly gedocumenteerd heeft ("de korrel is maandelijks") erft dit kanaal niet.
--
-- Idempotent: alles `if not exists` / `drop policy if exists`.

-- ── Entiteiten ───────────────────────────────────────────────────────────────

create table if not exists microsoft_campaigns (
  campaign_id text primary key,
  client_id text not null,
  name text,
  campaign_type text,
  status text,
  daily_budget numeric,
  bid_strategy text,
  import_source text,
  imported_at timestamptz,
  serving_status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_microsoft_campaigns_client on microsoft_campaigns (client_id);

create table if not exists microsoft_adgroups (
  adgroup_id text primary key,
  campaign_id text,
  client_id text not null,
  name text,
  status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_microsoft_adgroups_client on microsoft_adgroups (client_id);
create index if not exists idx_microsoft_adgroups_campaign on microsoft_adgroups (campaign_id);

-- ── Dagtabellen ──────────────────────────────────────────────────────────────

create table if not exists microsoft_account_daily (
  client_id text not null,
  date date not null,
  entity_id text not null,
  impressions bigint,
  clicks bigint,
  spend numeric,
  conversions numeric,
  conversion_value numeric,
  ctr numeric,
  avg_cpc numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, entity_id)
);
create index if not exists idx_microsoft_account_daily_lookup on microsoft_account_daily (client_id, date);

create table if not exists microsoft_campaign_daily (like microsoft_account_daily including all);
create table if not exists microsoft_adgroup_daily (like microsoft_account_daily including all);

create table if not exists microsoft_breakdown_daily (
  client_id text not null,
  date date not null,
  level text not null,
  entity_id text not null,
  breakdown_type text not null,
  breakdown_value text not null,
  impressions bigint,
  clicks bigint,
  spend numeric,
  conversions numeric,
  conversion_value numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, level, entity_id, breakdown_type, breakdown_value)
);
create index if not exists idx_microsoft_breakdown_daily_lookup on microsoft_breakdown_daily (client_id, date, level, breakdown_type);

-- ── Maandtabellen (de search-vormen) ─────────────────────────────────────────

create table if not exists microsoft_keyword_monthly (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  month date not null,
  campaign_id text,
  campaign_name text not null,
  ad_group_id text,
  ad_group_name text not null,
  keyword_id text not null,
  keyword_text text not null,
  match_type text not null,
  impressions integer default 0,
  clicks integer default 0,
  cost numeric default 0,
  conversions numeric default 0,
  conversions_value numeric default 0,
  ctr numeric default 0,
  avg_cpc numeric default 0,
  conversion_rate numeric default 0,
  cost_per_conversion numeric default 0,
  quality_score integer,
  synced_at timestamptz default now(),
  unique (client_id, keyword_id, month)
);
create index if not exists idx_microsoft_keyword_monthly_lookup on microsoft_keyword_monthly (client_id, month);

create table if not exists microsoft_search_terms_monthly (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  month date not null,
  campaign_id text,
  ad_group_id text,
  campaign_name text not null,
  ad_group_name text not null,
  search_term text not null,
  match_type text,
  impressions integer default 0,
  clicks integer default 0,
  cost numeric default 0,
  conversions numeric default 0,
  conversions_value numeric default 0,
  ctr numeric default 0,
  conversion_rate numeric default 0,
  synced_at timestamptz default now(),
  unique (client_id, search_term, campaign_name, ad_group_name, month)
);
create index if not exists idx_microsoft_search_terms_monthly_lookup on microsoft_search_terms_monthly (client_id, month);

create table if not exists microsoft_campaign_impression_share (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  campaign_id text not null,
  campaign_name text not null,
  campaign_type text,
  month date not null,
  impressions integer default 0,
  clicks integer default 0,
  cost numeric default 0,
  conversions numeric default 0,
  impression_share numeric,
  budget_lost_is numeric,
  rank_lost_is numeric,
  daily_budget numeric,
  budget_utilization numeric,
  synced_at timestamptz default now(),
  unique (client_id, campaign_id, month)
);
create index if not exists idx_microsoft_cis_client_month on microsoft_campaign_impression_share (client_id, month);

create table if not exists microsoft_profile_monthly (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  month date not null,
  pivot_type text not null,
  pivot_value text not null,
  impressions integer default 0,
  clicks integer default 0,
  spend numeric default 0,
  conversions numeric default 0,
  synced_at timestamptz default now(),
  unique (client_id, month, pivot_type, pivot_value)
);
create index if not exists idx_microsoft_profile_monthly_lookup on microsoft_profile_monthly (client_id, month);

-- ── RLS: het 067-patroon, per tabel een _zichtbaar-SELECT-policy ─────────────
--
-- Alleen SELECT-policies; schrijven loopt via de service role (bypassrls), zoals bij alle
-- kanaaltabellen. app_zichtbare_klanten() komt uit migratie 065.

do $$
declare t text;
begin
  foreach t in array array[
    'microsoft_campaigns', 'microsoft_adgroups',
    'microsoft_account_daily', 'microsoft_campaign_daily', 'microsoft_adgroup_daily',
    'microsoft_breakdown_daily', 'microsoft_keyword_monthly', 'microsoft_search_terms_monthly',
    'microsoft_campaign_impression_share', 'microsoft_profile_monthly'
  ] loop
    execute format('drop policy if exists %I_zichtbaar on %I', t, t);
    execute format(
      'create policy %I_zichtbaar on %I for select using (client_id in (select app_zichtbare_klanten()))',
      t, t
    );
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

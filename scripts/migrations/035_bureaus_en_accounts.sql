-- 035: de twee ontbrekende niveaus bovenaan — bureau en account.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief. Er worden alleen NIEUWE tabellen
-- aangemaakt en gevuld; geen bestaande tabel, kolom, rij, policy of trigger wordt aangeraakt.
-- Op dit moment leest geen enkele regel code deze tabellen, dus er kan niets van breken.
-- Terugdraaien is `drop table user_agencies, accounts, agencies`.
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- 99 tabellen dragen een client_id; nul dragen iets wat zegt van wie die klant is. De klant is
-- het hoogste niveau dat bestaat. Zolang er één bureau is valt dat niet op — het is dan gewoon
-- "onze klanten". Bij twintig bureaus is er geen enkele plek waar staat welke accounts bij wie
-- horen, en dus ook geen plek waarop een leesrecht te hangen valt.
--
-- Zie docs/ONTWERP_multitenant_schema.md, §1.1 en §2.1.
--
-- ── WAAROM client_id BLIJFT ─────────────────────────────────────────────────
--
-- accounts.client_id is dezelfde tekstsleutel die nu al in 99 tabellen staat. Die wordt NIET
-- hernoemd en niet vervangen. Daardoor is de koppeling naar een bureau een join en geen migratie
-- van data: geen enkele bestaande rij hoeft aangeraakt te worden. De uuid erboven is voor de
-- nieuwe relaties; de tekstsleutel blijft de natuurlijke sleutel naar alles wat er al is.

create table if not exists agencies (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists accounts (
  id           uuid primary key default gen_random_uuid(),
  -- restrict en niet cascade: een bureau verwijderen mag nooit stilzwijgend de historie van
  -- twintig accounts meenemen. Wie een bureau wil opheffen, verplaatst eerst de accounts.
  agency_id    uuid not null references agencies(id) on delete restrict,
  client_id    text not null unique,
  name         text not null,
  source       text,          -- 'google-ads' | 'demo' | later 'meta' | 'tiktok' | ...
  external_id  text,          -- het klant-id bij het platform zelf, bv. googleAdsCustomerId
  created_at   timestamptz not null default now()
);

create index if not exists idx_accounts_agency on accounts (agency_id);

-- Het bureau-equivalent van user_clients uit migratie 032. Die blijft bestaan en blijft gelden:
-- 032 regelt welke BEURZEN iemand ziet binnen zijn bureau, dit regelt bij welk bureau hij hoort.
-- Twee assen, geen vervanging.
create table if not exists user_agencies (
  user_id     uuid not null references auth.users(id) on delete cascade,
  agency_id   uuid not null references agencies(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, agency_id)
);

create index if not exists idx_user_agencies_agency on user_agencies (agency_id);

-- ── Vullen ──────────────────────────────────────────────────────────────────
--
-- Twee bureaus en niet één, met opzet. De demo-klant komt onder een eigen bureau te staan.
-- Daardoor bestaan er vanaf het eerste moment twee tenants, en valt een scoping-fout op zodra
-- hij gemaakt wordt — in plaats van pas bij de eerste echte tweede klant, wanneer er data van
-- iemand anders in het geding is.

insert into agencies (slug, name) values
  ('ranking-masters', 'Ranking Masters'),
  ('demo',            'Demo')
on conflict (slug) do nothing;

-- De accountlijst komt uit app_settings.api_clients — dat is nu de enige plek waar de namen
-- staan. Geteld voor deze migratie: 71 accounts in die lijst, 63 daarvan hebben ook echt data,
-- en alle 63 staan in de lijst. Er raakt dus niets kwijt.
insert into accounts (agency_id, client_id, name, source, external_id)
select
  (select id from agencies where slug = case when c->>'source' = 'demo' then 'demo' else 'ranking-masters' end),
  c->>'id',
  coalesce(nullif(c->>'name', ''), c->>'id'),
  c->>'source',
  c->>'googleAdsCustomerId'
from app_settings, jsonb_array_elements(value::jsonb) as c
where key = 'api_clients'
on conflict (client_id) do nothing;

-- De eerste admin bij het bureau. Zonder deze regel ziet hij straks onder RLS niets.
insert into user_agencies (user_id, agency_id)
select u.id, a.id
from auth.users u
cross join agencies a
where a.slug = 'ranking-masters'
on conflict do nothing;

-- ── Controle ────────────────────────────────────────────────────────────────
--
-- Hierna hoort elke client_id die ergens data heeft, ook een account te hebben. Blijft
-- `zonder_account` op 0 staan, dan is er niets over het hoofd gezien.

with met_data as (
  select client_id from ads_campaign_monthly
  union select client_id from ads_account_monthly
  union select client_id from meta_campaign_daily
  union select client_id from linkedin_campaign_daily
  union select client_id from sop_insights
  union select client_id from client_settings
)
select
  (select count(*) from agencies)                              as bureaus,
  (select count(*) from accounts)                              as accounts,
  (select count(*) from user_agencies)                         as gebruiker_bureau_koppelingen,
  (select count(*) from met_data d
     left join accounts a on a.client_id = d.client_id
     where a.id is null)                                       as zonder_account;

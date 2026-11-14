-- 111: Google per dag. ads_account_daily, ads_campaign_daily, ads_country_daily, ads_region_daily
-- en google_ads_checkout_funnel_daily, plus google_dag_stand (tot waar de sync elke dagtabel vulde).
--
-- STATUS: GEDRAAID op 14 november 2026, met akkoord van de eigenaar (RLS aan, een leespolicy per
-- tabel). Geschreven op 13 november 2026. Het zijn zes nieuwe tabellen (RLS aan, een leespolicy per tabel), en er verandert niets
-- aan bestaande tabellen of data. De code werkt zonder deze tabellen:
-- - de Google-sync (lib/sync/orchestrator.ts, lib/sync/google-dagen.ts) leest eerst
--   google_dag_stand; zonder die tabel vraagt hij Google niets per dag, schrijft een logregel en
--   laat de run niet mislukken. google_ads_checkout_funnel_daily loopt in dezelfde lus mee;
-- - de kerncijfers (lib/period/use-dag-telling.ts) krijgen van /api/data de code tabel_ontbreekt
--   (status 200, geen 500: lib/data-access/lees-fout.ts) en tellen Google dan per maand of week,
--   zoals vóór deze migratie, met dat in het label; de kaart (lib/geo/geo-periode.ts) leest server-side
--   en valt op een fout terug op de maandtabellen;
-- - de datagrondpoort (scripts/check-datagrond.mjs) noemt deze tabellen als KLAARGEZET.
-- Na het draaien: de schemafoto verversen (node scripts/check-datagrond.mjs --vernieuw) en de
-- tabellen uit KLAARGEZET halen. De eerste sync daarna haalt de dagen zo ver terug als we Google
-- vragen, in maandstukken met een tijdbudget per run; elke volgende run gaat verder waar de vorige
-- stopte, en daarna alleen een naloopvenster voor late conversies.
-- Terugdraaien: drop table if exists ads_account_daily, ads_campaign_daily, ads_country_daily,
-- ads_region_daily, google_ads_checkout_funnel_daily, google_dag_stand;
--
-- ── WAAROM ───────────────────────────────────────────────────────────────────
--
-- Besluit van de eigenaar: elke periode werkt overal hetzelfde, per dag. De platforms leveren per
-- dag; dat Google bij ons per maand (ads_*_monthly) en per week (ads_account_weekly) stond, was onze
-- eigen opslagkeuze. Daardoor telde een event of een vrije periode bij Google per hele week of
-- maand, en de kaart over een vast venster van 180 dagen. Vanaf nu bewaren we zelf per dag en
-- gooien we niets weg: de sync upsert per dag en wist nooit buiten het opgehaalde venster. Zo houden
-- we onze eigen geschiedenis, ook als een dag buiten de bewaartermijn van het platform valt.
--
-- Dezelfde vorm als de maandtabellen, met `date` in plaats van `month`, en een unieke sleutel per
-- dag zodat een herhaalde sync dezelfde dag overschrijft in plaats van verdubbelt. Geen afgeleide
-- kolommen (ctr, roas): die komen bij het lezen uit de totalen van de gekozen periode, nooit uit een
-- gemiddelde van dagwaarden.

create table if not exists ads_account_daily (
  client_id          text    not null,
  date               date    not null,
  impressions        bigint  not null default 0,
  clicks             bigint  not null default 0,
  cost               numeric not null default 0,
  conversions        numeric not null default 0,
  conversions_value  numeric not null default 0,
  synced_at          timestamptz not null default now(),
  unique (client_id, date)
);
create index if not exists idx_ads_account_daily_lookup on ads_account_daily (client_id, date);

create table if not exists ads_campaign_daily (
  client_id          text    not null,
  date               date    not null,
  campaign_id        text    not null,
  campaign_name      text,
  campaign_type      text,
  impressions        bigint  not null default 0,
  clicks             bigint  not null default 0,
  cost               numeric not null default 0,
  conversions        numeric not null default 0,
  conversions_value  numeric not null default 0,
  synced_at          timestamptz not null default now(),
  unique (client_id, date, campaign_id)
);
create index if not exists idx_ads_campaign_daily_lookup on ads_campaign_daily (client_id, date);

-- Per land: de som over de campagnes, zoals ads_country_monthly.
create table if not exists ads_country_daily (
  client_id          text    not null,
  date               date    not null,
  country_code       text    not null,
  impressions        bigint  not null default 0,
  clicks             bigint  not null default 0,
  cost               numeric not null default 0,
  conversions        numeric not null default 0,
  conversions_value  numeric not null default 0,
  synced_at          timestamptz not null default now(),
  unique (client_id, date, country_code)
);
create index if not exists idx_ads_country_daily_lookup on ads_country_daily (client_id, date);

-- Per regio (VS-staten, region_code is de USPS-code), zoals ads_region_monthly.
create table if not exists ads_region_daily (
  client_id          text    not null,
  date               date    not null,
  country_code       text    not null,
  region_code        text    not null,
  region_name        text,
  impressions        bigint  not null default 0,
  clicks             bigint  not null default 0,
  cost               numeric not null default 0,
  conversions        numeric not null default 0,
  conversions_value  numeric not null default 0,
  synced_at          timestamptz not null default now(),
  unique (client_id, date, country_code, region_code)
);
create index if not exists idx_ads_region_daily_lookup on ads_region_daily (client_id, date);

-- De checkouttrechter per dag: dezelfde kolommen als google_ads_checkout_funnel (de maandtabel, met
-- `date` op de eerste van de maand), maar met een echte dag. Ook de drie ratio's, net als daar als
-- gegenereerde kolommen uit de tellingen van dezelfde rij: wie de maandtabel leest, kan deze lezen.
-- Over een periode horen ze bij het lezen uit de opgetelde tellingen te komen, niet uit een
-- gemiddelde van dagratio's. synced_at staat er extra bij, zoals bij de andere dagtabellen.
create table if not exists google_ads_checkout_funnel_daily (
  id                         uuid    default gen_random_uuid() primary key,
  client_id                  text    not null,
  date                       date    not null,
  campaign_id                text    not null default '',
  campaign_name              text,
  device                     text    not null default 'UNSPECIFIED',
  sessions                   integer,
  add_to_cart_count          numeric not null default 0,
  add_to_cart_value          numeric not null default 0,
  begin_checkout_count       numeric not null default 0,
  begin_checkout_value       numeric not null default 0,
  purchase_count             numeric not null default 0,
  purchase_value             numeric not null default 0,
  atc_to_checkout_rate       numeric(8,4) generated always as (
    case when add_to_cart_count > 0 then begin_checkout_count / add_to_cart_count else 0 end
  ) stored,
  checkout_to_purchase_rate  numeric(8,4) generated always as (
    case when begin_checkout_count > 0 then purchase_count / begin_checkout_count else 0 end
  ) stored,
  overall_conversion_rate    numeric(8,4) generated always as (
    case when add_to_cart_count > 0 then purchase_count / add_to_cart_count else 0 end
  ) stored,
  created_at                 timestamptz not null default now(),
  synced_at                  timestamptz not null default now(),
  unique (client_id, date, campaign_id, device)
);
create index if not exists idx_google_ads_checkout_funnel_daily_lookup on google_ads_checkout_funnel_daily (client_id, date);

-- Tot waar de sync elke dagtabel vulde (lib/sync/google-dagen.ts). Niet afgeleid uit de laatste
-- rij: een tabel zonder activiteit heeft geen rijen en zou dan elke run opnieuw drie jaar ophalen.
-- `vanaf` is het begin van de opslag, `tot` de laatste dag die zeker geschreven is,
-- `conversie_selectie` de gekozen conversieacties (gesorteerd, komma's; leeg = alle): verandert die,
-- dan rekent de sync account en campagne opnieuw vanaf `vanaf`.
create table if not exists google_dag_stand (
  client_id           text not null,
  tabel               text not null,
  vanaf               date not null,
  tot                 date not null,
  conversie_selectie  text not null default '',
  bijgewerkt_at       timestamptz not null default now(),
  unique (client_id, tabel)
);

-- ── RLS: het 067-patroon, per tabel een _zichtbaar-SELECT-policy ─────────────
--
-- Zoals de Google-maandtabellen (067) en de *_daily-tabellen van Meta en Microsoft (106): alleen
-- SELECT; schrijven loopt via de service role (bypassrls). app_zichtbare_klanten() komt uit 065.

do $$
declare t text;
begin
  foreach t in array array[
    'ads_account_daily', 'ads_campaign_daily', 'ads_country_daily', 'ads_region_daily',
    'google_ads_checkout_funnel_daily', 'google_dag_stand'
  ] loop
    execute format('drop policy if exists %I_zichtbaar on %I', t, t);
    execute format(
      'create policy %I_zichtbaar on %I for select using (client_id in (select app_zichtbare_klanten()))',
      t, t
    );
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ── CONTROLEQUERY, na toepassing ─────────────────────────────────────────────
-- select tablename, count(*) from pg_policies
--   where tablename in ('ads_account_daily','ads_campaign_daily','ads_country_daily',
--                       'ads_region_daily','google_ads_checkout_funnel_daily','google_dag_stand')
--   group by tablename;
-- Verwacht: precies een policy per tabel.

-- 076: de zes kolommen uit 075 vullen en dwingend maken waar dat kan.
--
-- DRAAIEN: idempotent (elke UPDATE is een no-op op een rij die al klopt). Volgt op 075; draai
-- nooit vóór die migratie.
--
-- ── TOEGEPAST OP 14 AUGUSTUS 2026, EN WAT DAT KOSTTE ─────────────────────────
--
-- De fact_dimension-UPDATE hieronder (330.601 rijen) in één keer sturen via de Management API
-- vulde de schijf van het toenmalige nano-compute-project en liet Postgres crashen: WAL kon niet
-- meer wegschrijven ("No space left on device"), het serverproces stierf op signal 6, en de
-- database deed 92 seconden crash-recovery voor hij weer online was. Geen dataverlies -- Postgres'
-- eigen WAL-redo garandeert dat -- maar wel een productie-uitval van enkele minuten.
--
-- Toegepast is dit UITEINDELIJK in zeven batches van 50.000 rijen, elk als eigen verzoek, met een
-- telling ertussen (`where agency_id is null limit 50000` -- vanzelf hervatbaar, dus een
-- afgebroken batch kost geen herhaald werk). Na afloop stond fact_dimension door de vele
-- tupelversies op 275 MB; `vacuum full` bracht dat terug naar 148 MB, iets boven de originele
-- 142 MB (de zes nieuwe kolommen zelf). Dit liep pas soepel nadat het project van nano naar micro
-- compute ging -- dezelfde soort batch duurde daarvoor tientallen seconden, daarna 2 tot 8.
--
-- Wie dit bestand als geheel opnieuw stuurt op een klein compute-tier loopt hetzelfde risico. Op
-- een tabel van deze omvang: batches van hooguit 50.000 rijen, apart verzonden, met een
-- `vacuum full` erna zodra de laatste batch klaar is.
--
-- ── ÉÉN DOORGANG PER TABEL, NIET VIER ────────────────────────────────────────
--
-- De eerste versie deed vier aparte UPDATE's over fact_dimension (330.601 rijen, 142 MB): eerst
-- agency_id/client_id, dan source_table, dan leads/data_quality_score, dan twee keer currency.
-- Als één samenhangende SQL-tekst via de Management API duurde dat samen langer dan de
-- HTTP-timeout van die API (Cloudflare gaf een 524 terug) -- en omdat de hele tekst één
-- transactie is, ging de volledige migratie daarmee onderuit, inclusief het werk dat al klaar
-- was. Hieronder staat elke tabel in ÉÉN UPDATE die alle kolommen in een keer zet; dat is niet
-- alleen sneller maar ook het enige dat deze migratie nog uitvoerbaar maakt op deze
-- projectgrootte. Wie dit bestand in zijn geheel opnieuw stuurt na een 524, verliest niets: elke
-- losse instructie is nog steeds idempotent.
--
-- ── agency_id / client_id: altijd afleidbaar, dus NOT NULL ──────────────────
--
-- Elke fact_core/fact_dimension-rij heeft een account_id die naar accounts wijst (foreign key,
-- bestaat al). agency_id en client_id zijn dus voor GEEN ENKELE rij onbekend.
--
-- ── source_table: precies per kanaal/niveau/dimensie ─────────────────────────
--
-- Dezelfde herkomst die de vernieuwde refresh_fact_from_legacy() straks voor nieuwe rijen zet
-- (migratie 077). De twee 'region'-dimensierijen uit migratie 043 komen uit twee verschillende
-- brontabellen; alleen campaign_id onderscheidt ze (leeg = accountbreed = ads_region_monthly,
-- gevuld = per campagne = ads_geo_performance_monthly).
--
-- ── leads / data_quality_score: veilige defaults, geen verzonnen precisie ───
--
-- leads op 0 en niet op een herrekende waarde: de precieze leads/conversions-splitsing voor
-- bestaande Meta/LinkedIn-rijen komt vanzelf goed zodra migratie 077's vernieuwde
-- refresh_fact_from_legacy() nogmaals over deze rijen heen loopt (on conflict do update).
--
-- ── currency: bekend waar er een connectie is, eerlijk onbekend voor Google ──

update fact_core f set
  agency_id = a.agency_id,
  client_id = a.client_id,
  leads = coalesce(f.leads, 0),
  data_quality_score = coalesce(f.data_quality_score, 1.0),
  source_table = case
    when f.channel = 'google'   and f.level = 'account'  then 'ads_account_monthly_legacy'
    when f.channel = 'google'   and f.level = 'campaign' then 'ads_campaign_monthly_legacy'
    when f.channel = 'meta'     and f.level = 'account'  then 'meta_account_daily_legacy'
    when f.channel = 'meta'     and f.level = 'campaign' then 'meta_campaign_daily_legacy'
    when f.channel = 'meta'     and f.level = 'creative' then 'meta_ad_daily_legacy'
    when f.channel = 'linkedin' and f.level = 'account'  then 'linkedin_account_daily_legacy'
    when f.channel = 'linkedin' and f.level = 'campaign' then 'linkedin_campaign_daily_legacy'
    when f.channel = 'linkedin' and f.level = 'creative' then 'linkedin_creative_daily_legacy'
  end
from accounts a
where a.id = f.account_id;

update fact_dimension f set
  agency_id = a.agency_id,
  client_id = a.client_id,
  leads = coalesce(f.leads, 0),
  data_quality_score = coalesce(f.data_quality_score, 1.0),
  source_table = case
    when f.channel = 'google' and f.dimension = 'search_term' then 'ads_search_terms_monthly'
    when f.channel = 'google' and f.dimension = 'keyword'     then 'ads_keyword_performance_monthly'
    when f.channel = 'google' and f.dimension = 'device'      then 'ads_device_performance_monthly'
    when f.channel = 'google' and f.dimension = 'network'     then 'ads_network_performance_monthly'
    when f.channel = 'google' and f.dimension = 'audience'    then 'ads_audience_performance_monthly'
    when f.channel = 'google' and f.dimension = 'country'     then 'ads_country_monthly'
    when f.channel = 'google' and f.dimension = 'region' and f.campaign_id <> '' then 'ads_geo_performance_monthly'
    when f.channel = 'google' and f.dimension = 'region' and f.campaign_id  = '' then 'ads_region_monthly'
    when f.channel = 'linkedin' then 'linkedin_demographic_daily'
  end
from accounts a
where a.id = f.account_id;

-- currency: kleine, gefilterde subset (alleen meta/linkedin-rijen), losse pass omdat de bron een
-- andere tabel is dan accounts.

update fact_core f set currency = c.currency
  from meta_connections c where c.client_id = f.client_id and f.channel = 'meta' and f.currency is null;
update fact_core f set currency = c.currency
  from linkedin_connections c where c.client_id = f.client_id and f.channel = 'linkedin' and f.currency is null;
update fact_dimension f set currency = c.currency
  from meta_connections c where c.client_id = f.client_id and f.channel = 'meta' and f.currency is null;
update fact_dimension f set currency = c.currency
  from linkedin_connections c where c.client_id = f.client_id and f.channel = 'linkedin' and f.currency is null;

-- Eén ALTER TABLE per tabel met alle kolommen erin: Postgres doet dan één validatiescan per
-- tabel, niet één per kolom.

alter table fact_core
  alter column agency_id set not null,
  alter column client_id set not null,
  alter column leads set not null,
  alter column leads set default 0,
  alter column data_quality_score set not null,
  alter column data_quality_score set default 1.0,
  alter column source_table set not null;

alter table fact_dimension
  alter column agency_id set not null,
  alter column client_id set not null,
  alter column leads set not null,
  alter column leads set default 0,
  alter column data_quality_score set not null,
  alter column data_quality_score set default 1.0,
  alter column source_table set not null;

-- Voor de aggregaties die dit juist toevoegde: God Mode, macrotrends, de toekomstige God
-- View-laag. Zonder deze index scant elke "per bureau"-query fact_core/fact_dimension volledig.
create index if not exists idx_fact_core_agency on fact_core (agency_id, channel, grain, period_start desc);
create index if not exists idx_fact_dimension_agency on fact_dimension (agency_id, channel, dimension, grain, period_start desc);

-- ── Controle ────────────────────────────────────────────────────────────────
select
  (select count(*) from fact_core where agency_id is null or client_id is null or source_table is null) as fact_core_gaten,
  (select count(*) from fact_dimension where agency_id is null or client_id is null or source_table is null) as fact_dimension_gaten;

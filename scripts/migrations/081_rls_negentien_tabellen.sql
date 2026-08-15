-- 081: RLS aan op de 19 tabellen die zonder policy stonden.
--
-- DRAAIEN: idempotent (create policy if not exists-stijl via drop policy if exists ervoor).
--
-- ── WAT HIER MIS WAS ──────────────────────────────────────────────────────────
--
-- Supabase geeft elke nieuwe public-tabel standaard brede rechten (INSERT/SELECT/UPDATE/DELETE/
-- TRUNCATE) aan anon en authenticated -- exact dezelfde grant die fact_core ook draagt. Op een
-- RLS-beschermde tabel is dat onschadelijk: Postgres weigert een commando zonder bijpassende
-- policy, ongeacht de grant. Op deze 19 tabellen stond RLS uit, dus gold de brede grant
-- ongefilterd. Concreet: de publieke anon-key (NEXT_PUBLIC_SUPABASE_ANON_KEY, met opzet publiek --
-- zie docs/MASTERPLAN.md) kon ads_account_monthly_legacy (de volledige historie van het enige
-- echte bureau in de database), generation_jobs, sync_runs en meer lezen, wijzigen en wissen
-- zonder enige authenticatie.
--
-- Gevonden tijdens een verificatiepas ná fase 1, niet veroorzaakt door fase 1 -- deze 19 stonden
-- al zo. Voor elke tabel is nagegaan wie hem daadwerkelijk leest (grep op de component- en
-- routelaag) voordat er een policy op kwam; zie de toelichting per groep hieronder.
--
-- ── GROEP 1: de acht legacy-brontabellen ──────────────────────────────────────
-- Zelfde policy-vorm als de 99 andere client_id-gescoped tabellen (bijv.
-- ads_search_terms_monthly_zichtbaar). Alleen server-side gelezen, maar het patroon volgen is
-- goedkoop en consistent.

drop policy if exists ads_account_monthly_legacy_zichtbaar on ads_account_monthly_legacy;
create policy ads_account_monthly_legacy_zichtbaar on ads_account_monthly_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table ads_account_monthly_legacy enable row level security;

drop policy if exists ads_campaign_monthly_legacy_zichtbaar on ads_campaign_monthly_legacy;
create policy ads_campaign_monthly_legacy_zichtbaar on ads_campaign_monthly_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table ads_campaign_monthly_legacy enable row level security;

drop policy if exists linkedin_account_daily_legacy_zichtbaar on linkedin_account_daily_legacy;
create policy linkedin_account_daily_legacy_zichtbaar on linkedin_account_daily_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table linkedin_account_daily_legacy enable row level security;

drop policy if exists linkedin_campaign_daily_legacy_zichtbaar on linkedin_campaign_daily_legacy;
create policy linkedin_campaign_daily_legacy_zichtbaar on linkedin_campaign_daily_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table linkedin_campaign_daily_legacy enable row level security;

drop policy if exists linkedin_creative_daily_legacy_zichtbaar on linkedin_creative_daily_legacy;
create policy linkedin_creative_daily_legacy_zichtbaar on linkedin_creative_daily_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table linkedin_creative_daily_legacy enable row level security;

drop policy if exists meta_account_daily_legacy_zichtbaar on meta_account_daily_legacy;
create policy meta_account_daily_legacy_zichtbaar on meta_account_daily_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table meta_account_daily_legacy enable row level security;

drop policy if exists meta_ad_daily_legacy_zichtbaar on meta_ad_daily_legacy;
create policy meta_ad_daily_legacy_zichtbaar on meta_ad_daily_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table meta_ad_daily_legacy enable row level security;

drop policy if exists meta_campaign_daily_legacy_zichtbaar on meta_campaign_daily_legacy;
create policy meta_campaign_daily_legacy_zichtbaar on meta_campaign_daily_legacy for select
  using (client_id in (select app_zichtbare_klanten()));
alter table meta_campaign_daily_legacy enable row level security;

-- ── GROEP 2: vier dode tabellen, nul rijen, geen enkele lezer gevonden ────────
-- RLS aan zonder policy: op slot voor anon en authenticated, alleen service_role (die RLS
-- omzeilt) kan er nog bij. Zelfde vorm als de private-contributielaag uit het masterplan.

alter table alerts_log enable row level security;
alter table analysis_hypotheses enable row level security;
alter table analysis_tasks enable row level security;
alter table backup_restore_log enable row level security;

-- ── GROEP 3: operationele tabellen, alleen server-side gelezen (service_role) ────
-- generation_jobs en sync_runs: de voortgangs-UI gaat via /api/generation-jobs/[jobId] en
-- /api/sync, allebei met de service-role-sleutel -- geen browsercomponent bevraagt deze tabellen
-- rechtstreeks (nagegaan, geen match). Zelfde client_id-scoped SELECT-policy als
-- client_sync_status, zodat een toekomstige rechtstreekse lezer meteen goed staat.

drop policy if exists generation_jobs_zichtbaar on generation_jobs;
create policy generation_jobs_zichtbaar on generation_jobs for select
  using (client_id in (select app_zichtbare_klanten()));
alter table generation_jobs enable row level security;

drop policy if exists sync_runs_zichtbaar on sync_runs;
create policy sync_runs_zichtbaar on sync_runs for select
  using (client_id in (select app_zichtbare_klanten()));
alter table sync_runs enable row level security;

-- generation_job_events heeft geen eigen client_id, alleen job_id -- via generation_jobs.
drop policy if exists generation_job_events_zichtbaar on generation_job_events;
create policy generation_job_events_zichtbaar on generation_job_events for select
  using (job_id in (
    select job_id from generation_jobs where client_id in (select app_zichtbare_klanten())
  ));
alter table generation_job_events enable row level security;

-- ── GROEP 4: platformtabellen zonder tenant-begrip, geen enkele lezer gevonden ────
-- app_settings: platformbrede configuratie. schema_migrations: interne boekhouding van
-- backup/restore-scripts (niet de genummerde migraties in scripts/migrations/, zie
-- docs/MASTERPLAN.md). Beide op slot, zelfde reden als groep 2.

alter table app_settings enable row level security;
alter table schema_migrations enable row level security;

-- ── GROEP 5: bestaande features zonder tenant-scheiding, met opzet zo ─────────────
--
-- linkedin_urn_labels: gedeelde URN-naar-label-vertaaltabel zonder client_id, met opzet buiten
-- migratie 067 gelaten (zie het commentaar in components/dashboard/breakdown-donuts.tsx). Geen
-- klantdata om te beschermen -- LinkedIn's eigen publieke taxonomie. Wél de anon-schrijftoegang
-- dichtzetten: een publieke lezer hoort deze tabel niet te kunnen wijzigen of leegmaken.

drop policy if exists linkedin_urn_labels_lezen on linkedin_urn_labels;
create policy linkedin_urn_labels_lezen on linkedin_urn_labels for select using (true);
alter table linkedin_urn_labels enable row level security;

-- scripts: gedeelde scriptbibliotheek zonder client_id/user_id, gelezen en geschreven vanuit
-- app/(app)/scripts -- binnen de ingelogde app-shell, capability system:ops
-- (lib/auth/roles.ts). Geen tenant-scheiding vandaag, en dat verandert deze migratie niet; wel
-- dicht hij de anonieme (niet-ingelogde) toegang die er via de brede standaardgrant nog op zat.

drop policy if exists scripts_ingelogd on scripts;
create policy scripts_ingelogd on scripts for all
  to authenticated using (true) with check (true);
alter table scripts enable row level security;

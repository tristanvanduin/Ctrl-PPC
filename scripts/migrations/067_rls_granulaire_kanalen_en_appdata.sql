-- 067: het 059/065-patroon doorgetrokken naar de granulaire Google Ads-, Meta/LinkedIn- en
-- klant-gebonden appdata-tabellen.
--
-- NIET UITGEVOERD TEGEN DE DATABASE. Dit bestand is geschreven en klaargezet op verzoek, maar
-- bewust niet toegepast -- zie de sectie "WAAROM DIT NOG NIET DRAAIT" hieronder. Draai hem pas na
-- die afweging, met scripts/supabase-sql.mjs --file scripts/migrations/067_rls_granulaire_kanalen_en_appdata.sql.
-- Terugdraaien: `alter table <naam> disable row level security` per tabel in deze migratie.
--
-- ── WAT ER ONTBRAK ───────────────────────────────────────────────────────────
--
-- Gemeten na migratie 065: 45 van de 122 tabellen in public hebben RLS, 77 niet. Van die 77 zijn
-- er 58 een echte lacune: de granulaire per-kanaal feitentabellen die de decompositie-, creative-
-- en pmax-analyses voeden (Google Ads: 30 tabellen, Meta/LinkedIn: 21 tabellen), plus 7
-- klant-gebonden appdata-tabellen (bestanden, notities, syncstatus, geo-cloneinstellingen).
--
-- Buiten scope, met reden:
--   - ads_account_monthly_legacy, ads_campaign_monthly_legacy, meta_account_daily_legacy,
--     meta_ad_daily_legacy, meta_campaign_daily_legacy, linkedin_account_daily_legacy,
--     linkedin_campaign_daily_legacy, linkedin_creative_daily_legacy: fysieke tabellen achter
--     migratie 054's view-laag (dezelfde naam zonder _legacy-suffix leest via fact_core). De app
--     leest deze acht nooit rechtstreeks, dus lager risico dan de 58 hieronder.
--   - linkedin_urn_labels: gedeelde opzoektabel zonder client_id-kolom, hoort niet bij een klant.
--   - alerts_log, analysis_hypotheses, analysis_tasks, app_settings, backup_restore_log,
--     generation_job_events, generation_jobs, schema_migrations, scripts, sync_runs: geen
--     kanaal- of klantdata in de zin van deze migratie, apart te beoordelen.
--
-- ── DEZELFDE FOUT NIET HERHALEN: HET 059-PATROON ─────────────────────────────
--
-- app_zichtbare_klanten() bestaat al sinds migratie 065 en rekent de zichtbare klanten eenmalig
-- per statement uit (geen per-rij functieaanroep, geen statement timeout zoals migratie 058 die
-- had). Deze migratie hergebruikt hem ongewijzigd.
--
-- ── WAAROM DIT NOG NIET DRAAIT ───────────────────────────────────────────────
--
-- Net als bij migratie 065 geldt: de browser leest een deel van deze tabellen RECHTSTREEKS met de
-- anon-sleutel, en O1_AUTH_ENFORCED staat uit. Een policy die op auth.uid() controleert geeft dan
-- NUL rijen terug in plaats van een foutmelding -- geen crash, gewoon een leeg scherm.
--
-- Gemeten welke schermen dat raakt (grep op rechtstreekse `.from(...)`-aanroepen vanuit
-- "use client"-bestanden die de browser-supabase importeren, 10 augustus 2026):
--
--   geo_clone_settings                  components/branding/brand-theme-provider.tsx,
--                                        components/dashboard/geo-clone-settings.tsx
--   meta_breakdown_daily                components/dashboard/breakdown-donuts.tsx,
--                                        components/dashboard/channel-structure-analysis.tsx
--   linkedin_demographic_daily          components/dashboard/breakdown-donuts.tsx,
--                                        components/dashboard/channel-structure-analysis.tsx
--   meta_campaigns                      components/dashboard/campaigns-per-channel.tsx,
--                                        components/dashboard/channel-structure-analysis.tsx
--   linkedin_campaigns                  components/dashboard/campaigns-per-channel.tsx,
--                                        components/dashboard/channel-structure-analysis.tsx
--   meta_hourly_performance             components/dashboard/channel-structure-analysis.tsx
--   meta_ads                            components/dashboard/creative-deep-dive.tsx,
--                                        components/dashboard/creative-performance.tsx
--   meta_creatives                      components/dashboard/creative-performance.tsx
--   linkedin_creatives                  components/dashboard/creative-deep-dive.tsx,
--                                        components/dashboard/creative-performance.tsx
--   ads_creative_performance            components/dashboard/creative-deep-dive.tsx,
--                                        components/dashboard/creative-performance.tsx
--   ads_pmax_asset_performance          components/dashboard/pmax-asset-coverage.tsx
--   ads_asset_group_performance_monthly components/dashboard/pmax-asset-coverage.tsx
--   ads_pmax_network_breakdown          components/dashboard/pmax-network-split.tsx
--   client_files                        components/dashboard/client-files.tsx
--   client_folders                      components/dashboard/client-files.tsx
--   client_notes                        components/dashboard/client-notes.tsx
--   client_sync_status                  components/dashboard/sync-status-badge.tsx
--
-- Dat is 17 van de 58 tabellen, verspreid over Doelgroepbreakdown, Campagnes per kanaal,
-- Kanaalstructuur, Creative-analyse, PMax-dekking, Bestanden, Notities en de syncstatusbadge.
--
-- De overige 41 tabellen in deze migratie hebben GEEN rechtstreekse browser-lezer gevonden (elke
-- consument onder lib/ die deze tabellen aanraakt -- compute-targets.ts, dimension-availability.ts,
-- dimensional-queries.ts, expert-layers.ts, pmax-expert-layer.ts, lib/linkedin/*, lib/memory/
-- client-memory.ts, lib/second-opinion/evaluator.ts, lib/sync/* -- wordt uitsluitend aangeroepen
-- vanuit app/api/*-routes met een service-role-client; nagemeten via de importketen, niet
-- aangenomen). Voor die 41 is er vandaag al geen risico.
--
-- Toepassen kan op twee eerlijke manieren, net als bij migratie 065:
--   1. eerst O1_AUTH_ENFORCED aanzetten met een echte inlogstroom, zodat auth.uid() iets teruggeeft;
--   2. of eerst de 17 bovenste schermen ombouwen naar een service-role route (het Fase 3A-patroon
--      dat eerder al voor andere schermen is toegepast), zodat de browser niet meer rechtstreeks
--      met de anon-sleutel bij deze tabellen komt.
--
-- ── GEEN OUDERE POLICY OM REKENING MEE TE HOUDEN ─────────────────────────────
--
-- Nagemeten op pg_policies: geen van de 58 tabellen in deze migratie heeft vandaag een bestaande
-- policy (in tegenstelling tot sop_client_context/sop_hypothesis_tracking in migratie 065). Elke
-- `drop policy if exists` hieronder is dus zuiver defensief, niet omdat er iets gevonden is.
--
-- ── WAT WEL AL VEILIG IS: SCHRIJVEN ─────────────────────────────────────────
--
-- Alle 58 tabellen hebben een client_id-kolom van het type text, dezelfde vorm als in migratie
-- 065. Deze migratie zet alleen SELECT-policies neer. Schrijfacties op deze tabellen lopen via de
-- syncroutes (app/api/sync/*) en analyseroutes, allemaal met de service-role-client -- service_role
-- heeft bypassrls, dus RLS aanzetten raakt geen enkel schrijfpad.

-- ── Google Ads: 30 granulaire tabellen ───────────────────────────────────────

alter table ads_account_weekly              enable row level security;
alter table ads_account_yoy                 enable row level security;
alter table ads_ad_schedule_performance     enable row level security;
alter table ads_adgroup_monthly             enable row level security;
alter table ads_asset_group_performance_monthly enable row level security;
alter table ads_audience_performance_monthly enable row level security;
alter table ads_campaign_country_monthly    enable row level security;
alter table ads_campaign_impression_share   enable row level security;
alter table ads_campaign_metadata           enable row level security;
alter table ads_campaign_yoy                enable row level security;
alter table ads_change_history              enable row level security;
alter table ads_country_impression_share    enable row level security;
alter table ads_country_monthly             enable row level security;
alter table ads_country_weekly              enable row level security;
alter table ads_country_yoy                 enable row level security;
alter table ads_creative_performance        enable row level security;
alter table ads_device_performance_monthly  enable row level security;
alter table ads_dimension_availability      enable row level security;
alter table ads_geo_performance_monthly     enable row level security;
alter table ads_keyword_performance_monthly enable row level security;
alter table ads_network_performance_monthly enable row level security;
alter table ads_pmax_asset_performance      enable row level security;
alter table ads_pmax_network_breakdown      enable row level security;
alter table ads_pmax_placements             enable row level security;
alter table ads_pmax_search_categories      enable row level security;
alter table ads_product_performance_monthly enable row level security;
alter table ads_search_terms_monthly        enable row level security;
alter table ads_search_terms_wasteful       enable row level security;
alter table google_ads_checkout_funnel      enable row level security;
alter table google_ads_product_performance  enable row level security;

drop policy if exists ads_account_weekly_zichtbaar on ads_account_weekly;
create policy ads_account_weekly_zichtbaar on ads_account_weekly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_account_yoy_zichtbaar on ads_account_yoy;
create policy ads_account_yoy_zichtbaar on ads_account_yoy for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_ad_schedule_performance_zichtbaar on ads_ad_schedule_performance;
create policy ads_ad_schedule_performance_zichtbaar on ads_ad_schedule_performance for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_adgroup_monthly_zichtbaar on ads_adgroup_monthly;
create policy ads_adgroup_monthly_zichtbaar on ads_adgroup_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_asset_group_performance_monthly_zichtbaar on ads_asset_group_performance_monthly;
create policy ads_asset_group_performance_monthly_zichtbaar on ads_asset_group_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_audience_performance_monthly_zichtbaar on ads_audience_performance_monthly;
create policy ads_audience_performance_monthly_zichtbaar on ads_audience_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_campaign_country_monthly_zichtbaar on ads_campaign_country_monthly;
create policy ads_campaign_country_monthly_zichtbaar on ads_campaign_country_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_campaign_impression_share_zichtbaar on ads_campaign_impression_share;
create policy ads_campaign_impression_share_zichtbaar on ads_campaign_impression_share for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_campaign_metadata_zichtbaar on ads_campaign_metadata;
create policy ads_campaign_metadata_zichtbaar on ads_campaign_metadata for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_campaign_yoy_zichtbaar on ads_campaign_yoy;
create policy ads_campaign_yoy_zichtbaar on ads_campaign_yoy for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_change_history_zichtbaar on ads_change_history;
create policy ads_change_history_zichtbaar on ads_change_history for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_country_impression_share_zichtbaar on ads_country_impression_share;
create policy ads_country_impression_share_zichtbaar on ads_country_impression_share for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_country_monthly_zichtbaar on ads_country_monthly;
create policy ads_country_monthly_zichtbaar on ads_country_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_country_weekly_zichtbaar on ads_country_weekly;
create policy ads_country_weekly_zichtbaar on ads_country_weekly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_country_yoy_zichtbaar on ads_country_yoy;
create policy ads_country_yoy_zichtbaar on ads_country_yoy for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_creative_performance_zichtbaar on ads_creative_performance;
create policy ads_creative_performance_zichtbaar on ads_creative_performance for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_device_performance_monthly_zichtbaar on ads_device_performance_monthly;
create policy ads_device_performance_monthly_zichtbaar on ads_device_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_dimension_availability_zichtbaar on ads_dimension_availability;
create policy ads_dimension_availability_zichtbaar on ads_dimension_availability for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_geo_performance_monthly_zichtbaar on ads_geo_performance_monthly;
create policy ads_geo_performance_monthly_zichtbaar on ads_geo_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_keyword_performance_monthly_zichtbaar on ads_keyword_performance_monthly;
create policy ads_keyword_performance_monthly_zichtbaar on ads_keyword_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_network_performance_monthly_zichtbaar on ads_network_performance_monthly;
create policy ads_network_performance_monthly_zichtbaar on ads_network_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_pmax_asset_performance_zichtbaar on ads_pmax_asset_performance;
create policy ads_pmax_asset_performance_zichtbaar on ads_pmax_asset_performance for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_pmax_network_breakdown_zichtbaar on ads_pmax_network_breakdown;
create policy ads_pmax_network_breakdown_zichtbaar on ads_pmax_network_breakdown for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_pmax_placements_zichtbaar on ads_pmax_placements;
create policy ads_pmax_placements_zichtbaar on ads_pmax_placements for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_pmax_search_categories_zichtbaar on ads_pmax_search_categories;
create policy ads_pmax_search_categories_zichtbaar on ads_pmax_search_categories for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_product_performance_monthly_zichtbaar on ads_product_performance_monthly;
create policy ads_product_performance_monthly_zichtbaar on ads_product_performance_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_search_terms_monthly_zichtbaar on ads_search_terms_monthly;
create policy ads_search_terms_monthly_zichtbaar on ads_search_terms_monthly for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists ads_search_terms_wasteful_zichtbaar on ads_search_terms_wasteful;
create policy ads_search_terms_wasteful_zichtbaar on ads_search_terms_wasteful for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists google_ads_checkout_funnel_zichtbaar on google_ads_checkout_funnel;
create policy google_ads_checkout_funnel_zichtbaar on google_ads_checkout_funnel for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists google_ads_product_performance_zichtbaar on google_ads_product_performance;
create policy google_ads_product_performance_zichtbaar on google_ads_product_performance for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── Meta, LinkedIn en Merchant: 21 granulaire tabellen ───────────────────────

alter table meta_ads                        enable row level security;
alter table meta_adset_daily                enable row level security;
alter table meta_adsets                     enable row level security;
alter table meta_breakdown_daily            enable row level security;
alter table meta_campaigns                  enable row level security;
alter table meta_change_log                 enable row level security;
alter table meta_connections                enable row level security;
alter table meta_creative_patterns          enable row level security;
alter table meta_creative_visual_features   enable row level security;
alter table meta_creatives                  enable row level security;
alter table meta_hourly_performance         enable row level security;
alter table meta_sync_runs                  enable row level security;
alter table linkedin_campaign_groups        enable row level security;
alter table linkedin_campaigns              enable row level security;
alter table linkedin_connections            enable row level security;
alter table linkedin_creatives              enable row level security;
alter table linkedin_demographic_daily      enable row level security;
alter table linkedin_lead_form_daily        enable row level security;
alter table linkedin_lead_forms             enable row level security;
alter table linkedin_sync_runs              enable row level security;
alter table merchant_product_snapshots      enable row level security;

drop policy if exists meta_ads_zichtbaar on meta_ads;
create policy meta_ads_zichtbaar on meta_ads for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_adset_daily_zichtbaar on meta_adset_daily;
create policy meta_adset_daily_zichtbaar on meta_adset_daily for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_adsets_zichtbaar on meta_adsets;
create policy meta_adsets_zichtbaar on meta_adsets for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_breakdown_daily_zichtbaar on meta_breakdown_daily;
create policy meta_breakdown_daily_zichtbaar on meta_breakdown_daily for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_campaigns_zichtbaar on meta_campaigns;
create policy meta_campaigns_zichtbaar on meta_campaigns for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_change_log_zichtbaar on meta_change_log;
create policy meta_change_log_zichtbaar on meta_change_log for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_connections_zichtbaar on meta_connections;
create policy meta_connections_zichtbaar on meta_connections for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_creative_patterns_zichtbaar on meta_creative_patterns;
create policy meta_creative_patterns_zichtbaar on meta_creative_patterns for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_creative_visual_features_zichtbaar on meta_creative_visual_features;
create policy meta_creative_visual_features_zichtbaar on meta_creative_visual_features for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_creatives_zichtbaar on meta_creatives;
create policy meta_creatives_zichtbaar on meta_creatives for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_hourly_performance_zichtbaar on meta_hourly_performance;
create policy meta_hourly_performance_zichtbaar on meta_hourly_performance for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists meta_sync_runs_zichtbaar on meta_sync_runs;
create policy meta_sync_runs_zichtbaar on meta_sync_runs for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_campaign_groups_zichtbaar on linkedin_campaign_groups;
create policy linkedin_campaign_groups_zichtbaar on linkedin_campaign_groups for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_campaigns_zichtbaar on linkedin_campaigns;
create policy linkedin_campaigns_zichtbaar on linkedin_campaigns for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_connections_zichtbaar on linkedin_connections;
create policy linkedin_connections_zichtbaar on linkedin_connections for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_creatives_zichtbaar on linkedin_creatives;
create policy linkedin_creatives_zichtbaar on linkedin_creatives for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_demographic_daily_zichtbaar on linkedin_demographic_daily;
create policy linkedin_demographic_daily_zichtbaar on linkedin_demographic_daily for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_lead_form_daily_zichtbaar on linkedin_lead_form_daily;
create policy linkedin_lead_form_daily_zichtbaar on linkedin_lead_form_daily for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_lead_forms_zichtbaar on linkedin_lead_forms;
create policy linkedin_lead_forms_zichtbaar on linkedin_lead_forms for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists linkedin_sync_runs_zichtbaar on linkedin_sync_runs;
create policy linkedin_sync_runs_zichtbaar on linkedin_sync_runs for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists merchant_product_snapshots_zichtbaar on merchant_product_snapshots;
create policy merchant_product_snapshots_zichtbaar on merchant_product_snapshots for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── Klant-gebonden appdata: 7 tabellen ────────────────────────────────────────

alter table client_files       enable row level security;
alter table client_folders     enable row level security;
alter table client_notes       enable row level security;
alter table client_reports     enable row level security;
alter table client_sync_status enable row level security;
alter table feed_item_state    enable row level security;
alter table geo_clone_settings enable row level security;

drop policy if exists client_files_zichtbaar on client_files;
create policy client_files_zichtbaar on client_files for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists client_folders_zichtbaar on client_folders;
create policy client_folders_zichtbaar on client_folders for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists client_notes_zichtbaar on client_notes;
create policy client_notes_zichtbaar on client_notes for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists client_reports_zichtbaar on client_reports;
create policy client_reports_zichtbaar on client_reports for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists client_sync_status_zichtbaar on client_sync_status;
create policy client_sync_status_zichtbaar on client_sync_status for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists feed_item_state_zichtbaar on feed_item_state;
create policy feed_item_state_zichtbaar on feed_item_state for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists geo_clone_settings_zichtbaar on geo_clone_settings;
create policy geo_clone_settings_zichtbaar on geo_clone_settings for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── Controle ──────────────────────────────────────────────────────────────
-- Hoeveel tabellen staan er nu onder RLS. Was 45 vóór deze migratie (058/059/065). Deze migratie
-- noemt 58 tabellen, geen enkele had al RLS aan (geverifieerd via pg_policies, zie hierboven).
-- Hoort na deze migratie 45 + 58 = 103 te zijn, van de 122. Geverifieerd met een dry run in een
-- rolled-back transactie op 10 augustus 2026: exact 103.

select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as tabellen_met_rls,
  (select count(*) from pg_policies where schemaname = 'public') as policies;

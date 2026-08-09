-- 065: het 059-patroon doorgetrokken naar de SOP- en intelligence-tabellen.
--
-- NIET UITGEVOERD TEGEN DE DATABASE. Dit bestand is geschreven en klaargezet op verzoek, maar
-- bewust niet toegepast -- zie de sectie "WAAROM DIT NOG NIET DRAAIT" hieronder. Draai hem pas na
-- die afweging, met scripts/supabase-sql.mjs --file scripts/migrations/065_rls_sop_intelligence.sql.
-- Terugdraaien: `alter table <naam> disable row level security` per tabel in deze migratie.
--
-- ── WAT ER ONTBRAK ───────────────────────────────────────────────────────────
--
-- Gemeten op 9 augustus 2026: 92 van de 122 tabellen in public hebben geen RLS. Migratie 058/059
-- dekten de vijf feitentabellen (fact_core, fact_dimension, google/meta/linkedin_metrics) en de
-- structuurtabellen (agencies, accounts, user_agencies, client_groups). Alles wat SOP-uitvoer,
-- hypotheses en sprintplanning heet stond daarbuiten -- exact de tabellen waar "geen data mag
-- lekken tussen agencies" het hardst geldt, want dat is de content die een specialist elke dag
-- leest.
--
-- ── DEZELFDE FOUT NIET HERHALEN: HET 059-PATROON, NIET HET 058-PATROON ──────
--
-- Migratie 058 riep app_can_read_account(account_id) PER RIJ aan in een policy en liep vast op een
-- statement timeout (twee van de vier pogingen faalden op 6.586 rijen). 059 loste dat op met een
-- functie ZONDER argumenten -- app_zichtbare_accounts() -- die Postgres eenmalig per statement
-- uitrekent. Deze migratie gebruikt vanaf het begin de snelle vorm: app_zichtbare_klanten(), het
-- client_id-equivalent van app_zichtbare_accounts().
--
-- app_can_read_client(target text) bestaat al sinds migratie 057 en kent exact de juiste regel
-- (platformbeheer, dan de bureaugrens, dan binnen het bureau: hele-bureau-rol OF een expliciete
-- user_clients-koppeling). app_zichtbare_klanten() is diezelfde regel als verzameling, zodat een
-- policy er middels `client_id in (select app_zichtbare_klanten())` maar één keer per statement
-- gebruik van hoeft te maken in plaats van per rij.
--
-- ── WAAROM DIT NOG NIET DRAAIT ───────────────────────────────────────────────
--
-- fact_core/fact_dimension werden bij 058 veilig aangezet omdat de app ze via VIEWS leest
-- (ads_campaign_monthly etc.), en een view draait zonder security_invoker als zijn EIGENAAR --
-- RLS op de onderliggende tabel verandert dan niets aan wat de browser ziet. Voor de tabellen
-- hieronder bestaat die view-laag niet: de browser leest ze RECHTSTREEKS met de anon-sleutel, en
-- O1_AUTH_ENFORCED staat uit (geen waarde in .env). Een policy die op auth.uid() controleert geeft
-- bij een anonieme sessie NUL rijen terug -- geen foutmelding, gewoon een leeg scherm.
--
-- Gemeten welke schermen dat raakt (grep op rechtstreekse `.from(...)`-aanroepen vanuit
-- "use client"-bestanden of imports van de browser-supabase, 9 augustus 2026):
--
--   sop_insights            components/dashboard/dgm-view.tsx, components/insights/insights-block.tsx,
--                           lib/feed/use-today-feed.ts (Vandaag-feed)
--   sop_analysis_output     components/dashboard/analysis-overview.tsx, components/insights/sop-trigger-buttons.tsx
--   sop_recommendations     components/dashboard/dgm-view.tsx, components/insights/tasks-block.tsx,
--                           components/insights/recommendations-block.tsx, lib/feed/use-today-feed.ts
--   sop_tasks               components/dashboard/dgm-view.tsx, components/insights/tasks-block.tsx,
--                           lib/feed/use-today-feed.ts
--   sprint_hypotheses       components/dashboard/dgm-view.tsx, components/insights/proposal-queue.tsx,
--                           components/insights/sprint-planning.tsx, lib/feed/use-today-feed.ts
--   sprint_items            components/dashboard/dgm-view.tsx, components/insights/sprint-planning.tsx
--   client_settings         components/branding/brand-theme-provider.tsx, components/dashboard/event-settings.tsx,
--                           components/dashboard/branding-view.tsx, components/dashboard/geo-clone-settings.tsx,
--                           components/dashboard/channel-performance.tsx, components/dashboard/channel-forecast.tsx,
--                           components/dashboard/forecast-table.tsx, components/dashboard/channel-conversion-settings.tsx,
--                           lib/rai/use-upcoming-edition.ts, lib/client-settings.ts (loadClientSettings)
--   task_completions        components/insights/task-impact-reminder.tsx
--
-- Dat is Vandaag, Analyses, Bevindingen, Sprintplanning, BMS en een groot deel van Instellingen.
-- De acht overige tabellen in deze migratie (sop_hypothesis_tracking, sop_client_context,
-- sop_client_config, client_targets, client_onboarding, analysis_prepared_context,
-- search_term_analysis, second_opinion_runs) hebben GEEN rechtstreekse browser-lezer -- voor die
-- acht is er vandaag al geen risico.
--
-- Toepassen kan dus op twee eerlijke manieren, en geen van beide is "gewoon uitvoeren":
--   1. eerst O1_AUTH_ENFORCED aanzetten met een echte inlogstroom, zodat auth.uid() iets teruggeeft;
--   2. of eerst de acht bovenste schermen ombouwen naar een service-role route, zoals
--      client_settings al gedeeltelijk gebeurt via app/api/data/[table] voor de SCHRIJFKANT --
--      alleen de LEESKANT loopt daar nog niet doorheen.
--
-- ── EEN TWEEDE VONDST: EEN OUDERE, TENANT-BLINDE POLICY OP TWEE VAN DEZE TABELLEN ──
--
-- sop_client_context en sop_hypothesis_tracking hadden AL rijbeveiliging aan -- niet uit 058/059,
-- maar uit migratie 012 (van vóór het bureaumodel van 035/057). Die zette twee policies neer:
--
--   service_role_all   auth.role() = 'service_role'   (onschadelijk, service_role mag toch alles)
--   auth_read          auth.role() = 'authenticated'   (leest ALLES, van elk bureau)
--
-- RLS-policies voor SELECT worden met OR gecombineerd: een rij is zichtbaar zodra ÉÉN policy hem
-- toelaat. Was dit bestand begonnen met alleen een nieuwe policy TOEVOEGEN, dan had de oude
-- auth_read-policy hem overstemd -- elke ingelogde gebruiker, van welk bureau dan ook, zou nog
-- steeds alle rijen zien. Precies het "formeel dicht, feitelijk lek" patroon dat migratie 057 al
-- eerder blootlegde bij de rolgebonden functies. Deze migratie laat daarom expliciet
-- `auth_read` vallen op deze twee tabellen voordat hij zijn eigen policy neerzet.
--
-- Diezelfde `auth_read`/`Allow all for authenticated`-familie uit migratie 012 staat OOK nog op
-- ads_leading_indicators, ads_portfolio_analysis, ads_region_monthly, ads_video_placements,
-- benchmark_sectors en channel_geo_monthly. Die vallen buiten de scope van deze migratie (geen
-- SOP- of intelligence-tabellen) en blijven dus openstaan -- met opzet niet stilzwijgend
-- meegenomen, wel hier genoemd zodat dit niet als "toevallig niet gezien" verdwijnt.
--
-- ── WAT WEL AL VEILIG IS: SCHRIJVEN ─────────────────────────────────────────
--
-- Deze migratie zet alleen SELECT-policies neer, net als 058/059. Nagemeten: elke insert/update/
-- delete op deze zestien tabellen loopt al server-side via een SupabaseClient met de service role
-- (lib/analysis/helpers.ts:getSupabase(), of een client die als parameter binnenkomt vanuit zo'n
-- route) -- geen enkele rechtstreekse browser-schrijfactie gevonden. service_role heeft bypassrls,
-- dus RLS aanzetten raakt geen enkel schrijfpad.

-- ── De verzameling, eenmalig per statement ──────────────────────────────────

create or replace function app_zichtbare_klanten()
returns setof text
language sql stable security definer set search_path = public
as $$
  select a.client_id
  from accounts a
  where app_is_platform()
     or (
       a.agency_id in (select app_bureaus())
       and (
         app_ziet_hele_bureau()
         or exists (
           select 1 from user_clients uc
           where uc.user_id = auth.uid() and uc.client_id = a.client_id
         )
       )
     )
$$;

grant execute on function app_zichtbare_klanten() to anon, authenticated, service_role;

-- ── De SOP-uitvoer die een specialist dagelijks leest ───────────────────────

alter table sop_insights         enable row level security;
alter table sop_analysis_output  enable row level security;
alter table sop_recommendations  enable row level security;
alter table sop_tasks            enable row level security;
alter table sop_hypothesis_tracking enable row level security;
alter table sop_client_context   enable row level security;
alter table sop_client_config    enable row level security;

drop policy if exists sop_insights_zichtbaar on sop_insights;
create policy sop_insights_zichtbaar on sop_insights for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists sop_analysis_output_zichtbaar on sop_analysis_output;
create policy sop_analysis_output_zichtbaar on sop_analysis_output for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists sop_recommendations_zichtbaar on sop_recommendations;
create policy sop_recommendations_zichtbaar on sop_recommendations for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists sop_tasks_zichtbaar on sop_tasks;
create policy sop_tasks_zichtbaar on sop_tasks for select
  using (client_id in (select app_zichtbare_klanten()));

-- auth_read (migratie 012) eerst weg -- zie de toelichting hierboven. Zonder deze twee regels
-- blijft elke ingelogde gebruiker, van elk bureau, alle rijen zien.
drop policy if exists auth_read on sop_hypothesis_tracking;
drop policy if exists sop_hypothesis_tracking_zichtbaar on sop_hypothesis_tracking;
create policy sop_hypothesis_tracking_zichtbaar on sop_hypothesis_tracking for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists auth_read on sop_client_context;
drop policy if exists sop_client_context_zichtbaar on sop_client_context;
create policy sop_client_context_zichtbaar on sop_client_context for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists sop_client_config_zichtbaar on sop_client_config;
create policy sop_client_config_zichtbaar on sop_client_config for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── Sprint, hypotheses en opvolging ──────────────────────────────────────────

alter table sprint_hypotheses enable row level security;
alter table sprint_items      enable row level security;
alter table task_completions  enable row level security;

drop policy if exists sprint_hypotheses_zichtbaar on sprint_hypotheses;
create policy sprint_hypotheses_zichtbaar on sprint_hypotheses for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists sprint_items_zichtbaar on sprint_items;
create policy sprint_items_zichtbaar on sprint_items for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists task_completions_zichtbaar on task_completions;
create policy task_completions_zichtbaar on task_completions for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── Klantinstellingen en -context ────────────────────────────────────────────

alter table client_settings   enable row level security;
alter table client_targets    enable row level security;
alter table client_onboarding enable row level security;

drop policy if exists client_settings_zichtbaar on client_settings;
create policy client_settings_zichtbaar on client_settings for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists client_targets_zichtbaar on client_targets;
create policy client_targets_zichtbaar on client_targets for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists client_onboarding_zichtbaar on client_onboarding;
create policy client_onboarding_zichtbaar on client_onboarding for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── Analyse-ondersteuning ────────────────────────────────────────────────────

alter table analysis_prepared_context enable row level security;
alter table search_term_analysis      enable row level security;
alter table second_opinion_runs       enable row level security;

drop policy if exists analysis_prepared_context_zichtbaar on analysis_prepared_context;
create policy analysis_prepared_context_zichtbaar on analysis_prepared_context for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists search_term_analysis_zichtbaar on search_term_analysis;
create policy search_term_analysis_zichtbaar on search_term_analysis for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists second_opinion_runs_zichtbaar on second_opinion_runs;
create policy second_opinion_runs_zichtbaar on second_opinion_runs for select
  using (client_id in (select app_zichtbare_klanten()));

-- ── llm_usage: heeft al een eigen agency_id (migratie 061), geen omweg via client_id nodig ──

alter table llm_usage enable row level security;

drop policy if exists llm_usage_zichtbaar on llm_usage;
create policy llm_usage_zichtbaar on llm_usage for select
  using (app_is_platform() or agency_id in (select app_bureaus()));

-- ── Controle ──────────────────────────────────────────────────────────────
-- Hoeveel tabellen staan er nu onder RLS. Was 30 vóór deze migratie (058/059 + chat uit 060).
-- Deze migratie noemt 17 tabellen, maar sop_client_context en sop_hypothesis_tracking hadden al
-- RLS aan (migratie 012, met de tenant-blinde policy die hierboven vervangen wordt) -- dus 15
-- tabellen gaan van uit naar aan. Hoort na deze migratie 30 + 15 = 45 te zijn. Geverifieerd met
-- een dry run in een rolled-back transactie op 9 augustus 2026: exact 45.

select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as tabellen_met_rls,
  (select count(*) from pg_policies where schemaname = 'public') as policies;

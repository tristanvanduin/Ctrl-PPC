-- 096: het 065/067/081-patroon doorgetrokken naar de laatste zes tabellen met een oude,
-- tenant-blinde policy (auth.role() = 'authenticated', of de gelijkwaardige
-- "Allow all for authenticated" USING (true)) -- gevonden bij de EXECUTION_PLAN.md-vergelijking
-- (masterplan sectie 15.1), buiten het bereik van migraties 065/067/081 gelaten met opzet, hier
-- alsnog gedicht.
--
-- NIET UITGEVOERD TEGEN DE DATABASE. Zelfde reden als bij 094/095: deze sandbox heeft geen
-- SUPABASE_ACCESS_TOKEN. Klaargezet, niet toegepast. Draaien met
-- node scripts/supabase-sql.mjs --file scripts/migrations/096_rls_auth_read_opruiming.sql
-- Terugdraaien: de oorspronkelijke policy staat er per tabel als commentaar bij.
--
-- ── WAT ER MIS WAS, PER TABEL ────────────────────────────────────────────────
--
-- Drie tabellen droegen letterlijk `auth_read`/`auth.role() = 'authenticated'` uit migratie 012
-- (vóór het bureaumodel van 035/057):
--   ads_leading_indicators   client_id text NOT NULL (migratie 012)
--   ads_portfolio_analysis   client_id text NOT NULL (migratie 012)
--   benchmark_sectors        GEEN client_id -- sector/account_type/metric, generieke
--                            branchebenchmarks, geen klantdata. Geen tenant-lek: dit is dezelfde
--                            situatie als linkedin_urn_labels in migratie 081 groep 5 (gedeelde
--                            opzoektabel, met opzet niet klantgescoped). Krijgt hieronder alleen
--                            een opgeschoonde policy-naam, geen client_id-filter -- er is niets om
--                            op te filteren.
--
-- Twee tabellen droegen "Allow all for authenticated" (functioneel identiek, andere naam) uit een
-- NIET-GENUMMERD ad-hoc bestand, `scripts/geo-layer2-tables.sql` ("Run in de Supabase SQL
-- Editor" -- nooit in scripts/migrations/ getrackt):
--   ads_region_monthly    client_id text NOT NULL
--   channel_geo_monthly   client_id text NOT NULL
--
-- Eén tabel droeg dezelfde policy uit een tweede, eveneens niet-genummerd bestand,
-- `scripts/video-placements.sql`:
--   ads_video_placements  client_id text NOT NULL
--
-- ── LEESKANT AL VEILIG GEMAAKT VOORDAT DEZE MIGRATIE GESCHREVEN IS ───────────
--
-- ads_video_placements had een rechtstreekse browser-lezer (components/dashboard/
-- video-placements.tsx). Die is, in dezelfde wijziging als dit bestand, omgezet naar
-- lib/data-access/client-read.ts (dbSelect) -> GET /api/data/[table] -> service role, en
-- toegevoegd aan lib/data-access/read-policy.ts's READABLE_TABLES. Exact het 065/067-patroon:
-- eerst de leeskant om, dan pas de policy vervangen, anders valt het scherm leeg zolang
-- O1_AUTH_ENFORCED uit staat (zie de kop van migratie 065 voor de volledige uitleg van dat
-- mechanisme). De overige vier tabellen (ads_leading_indicators, ads_portfolio_analysis,
-- ads_region_monthly, channel_geo_monthly, benchmark_sectors) hebben GEEN rechtstreekse
-- browser-lezer -- nagemeten (grep op `.from("<tabel>"` in "use client"-bestanden en bestanden
-- die lib/supabase importeren) -- dus voor die vijf is toepassen zonder dat risico.
--
-- ── HET 059-PATROON ───────────────────────────────────────────────────────────
--
-- app_zichtbare_klanten() bestaat sinds migratie 065, rekent de zichtbare klanten eenmalig per
-- statement uit. Deze migratie hergebruikt hem ongewijzigd, zoals 067 en 081 al deden.

-- ads_leading_indicators: was `auth_read` (auth.role() = 'authenticated')
drop policy if exists "auth_read" on ads_leading_indicators;
drop policy if exists ads_leading_indicators_zichtbaar on ads_leading_indicators;
create policy ads_leading_indicators_zichtbaar on ads_leading_indicators for select
  using (client_id in (select app_zichtbare_klanten()));
alter table ads_leading_indicators enable row level security;

-- ads_portfolio_analysis: was `auth_read` (auth.role() = 'authenticated')
drop policy if exists "auth_read" on ads_portfolio_analysis;
drop policy if exists ads_portfolio_analysis_zichtbaar on ads_portfolio_analysis;
create policy ads_portfolio_analysis_zichtbaar on ads_portfolio_analysis for select
  using (client_id in (select app_zichtbare_klanten()));
alter table ads_portfolio_analysis enable row level security;

-- benchmark_sectors: was `auth_read` (auth.role() = 'authenticated'). Geen client_id -- geen
-- tenant-filter mogelijk of nodig. Vervangen door een met-naam-herkenbare policy die hetzelfde
-- toestaat, zodat een toekomstige audit "auth_read"/"authenticated" niet meer als onopgemerkt
-- restant van migratie 012 aanmerkt.
drop policy if exists "auth_read" on benchmark_sectors;
drop policy if exists benchmark_sectors_authenticated_leesbaar on benchmark_sectors;
create policy benchmark_sectors_authenticated_leesbaar on benchmark_sectors for select
  to authenticated using (true);
alter table benchmark_sectors enable row level security;

-- ads_region_monthly: was "Allow all for authenticated" (USING (true) WITH CHECK (true), FOR ALL)
-- uit scripts/geo-layer2-tables.sql. FOR ALL dekte ook insert/update/delete; die lopen in de
-- praktijk al server-side met de service role (nagemeten, geen rechtstreekse browser-schrijver),
-- dus de vervangpolicy is bewust FOR SELECT only, net als bij de andere tabellen hier.
drop policy if exists "Allow all for authenticated" on ads_region_monthly;
drop policy if exists ads_region_monthly_zichtbaar on ads_region_monthly;
create policy ads_region_monthly_zichtbaar on ads_region_monthly for select
  using (client_id in (select app_zichtbare_klanten()));
alter table ads_region_monthly enable row level security;

-- channel_geo_monthly: was "Allow all for authenticated" uit scripts/geo-layer2-tables.sql.
-- Zelfde FOR ALL -> FOR SELECT-inperking als ads_region_monthly hierboven, zelfde reden.
drop policy if exists "Allow all for authenticated" on channel_geo_monthly;
drop policy if exists channel_geo_monthly_zichtbaar on channel_geo_monthly;
create policy channel_geo_monthly_zichtbaar on channel_geo_monthly for select
  using (client_id in (select app_zichtbare_klanten()));
alter table channel_geo_monthly enable row level security;

-- ads_video_placements: was "Allow all for authenticated" uit scripts/video-placements.sql.
-- Leeskant al omgezet (zie hierboven) voordat deze policy live mag; schrijfkant nagemeten als
-- server-side/service-role only.
drop policy if exists "Allow all for authenticated" on ads_video_placements;
drop policy if exists ads_video_placements_zichtbaar on ads_video_placements;
create policy ads_video_placements_zichtbaar on ads_video_placements for select
  using (client_id in (select app_zichtbare_klanten()));
alter table ads_video_placements enable row level security;

-- ── CONTROLEQUERY, ná toepassing te draaien ──────────────────────────────────
-- select tablename, count(*) from pg_policies
--   where tablename in ('ads_leading_indicators','ads_portfolio_analysis','benchmark_sectors',
--                        'ads_region_monthly','channel_geo_monthly','ads_video_placements')
--   group by tablename;
-- Verwacht: precies één policy per tabel (de nieuwe), niet twee (oude niet gedropt) en niet nul
-- (RLS aan zonder policy -- dezelfde bugvorm als migratie 057 elders al blootlegde).

-- 084: ontbrekende SELECT-policy op platform_beheerders.
--
-- ── DE BUG, LIVE GEVONDEN 15 AUGUSTUS ──────────────────────────────────────────
--
-- RLS stond al aan op platform_beheerders, maar zonder ENKELE policy -- geen using(true), geen
-- zelf-lezen, niets. Onder Postgres RLS betekent geen policy: niemand behalve service_role komt
-- erbij, ook niet bij zijn eigen rij.
--
-- lib/auth/scope.ts (bepaalScope, gedeeld door middleware.ts en lib/auth/server.ts) leest deze
-- tabel RECHTSTREEKS als de ingelogde gebruiker:
--   supabase.from("platform_beheerders").select("user_id").eq("user_id", userId).maybeSingle()
-- Die lezing liep dus altijd stil vast op RLS, ook voor de echte platformbeheerder. Resultaat:
-- isPlatform staat altijd op false voor iedereen, en een organisatiebrede rol (admin,
-- performance_marketeer, it) valt terug op "alleen de klanten van je eigen, direct-toegewezen
-- bureau" in plaats van het hele platform -- precies "KLANTEN (0)" en "Onvoldoende rechten" op
-- een verder correct geconfigureerd account.
--
-- app_is_platform() (de SQL-functie die andere RLS-policies gebruiken, bijv. op accounts) bleef
-- wel werken: die is SECURITY DEFINER en omzeilt RLS op de tabellen die hij zelf bevraagt. Dat
-- verschil -- een SECURITY DEFINER-functie versus een rechtstreekse tabellezing vanuit
-- applicatiecode -- is precies waarom dit tot nu toe onopgemerkt bleef: elke databasekant-
-- verificatie deze sessie liep via de Management API (service_role, ziet alles), nooit via een
-- echte ingelogde sessie. lib/auth/server.ts zegt dit letterlijk in zijn eigen kop:
-- "LIVE-ONGETEST: sessie-cookies en de rol-lookup zijn pas tegen een echte Supabase-omgeving te
-- verifieren." Dit was de eerste keer dat een echte sessie dit pad echt liep.
--
-- ── DE FIX ──────────────────────────────────────────────────────────────────
--
-- Zelfde patroon als de al werkende policies op user_roles en user_clients: zelf lezen, of alles
-- lezen als je al (via user_roles) een admin bent. Geen using(true) -- wie platformbeheerder is,
-- is geen publieke informatie.

drop policy if exists platform_beheerders_zelf_lezen on platform_beheerders;
create policy platform_beheerders_zelf_lezen on platform_beheerders for select
  using (user_id = auth.uid() or app_role() = 'admin');

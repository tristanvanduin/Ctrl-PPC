-- 099: security_invoker aan voor de negen legacy views die tot nu toe met de rechten van hun
-- eigenaar draaiden en daarmee RLS op de onderliggende tabellen omzeilden -- masterplan sectie
-- 15.6, gevonden bij het (alsnog) leveren van het functionele RLS-bewijs uit 15.1.
--
-- NIET UITGEVOERD TEGEN DE DATABASE. En dat is hier geen kwestie van ontbrekende
-- SUPABASE_ACCESS_TOKEN zoals bij 094/095/096 -- de sleutel is deze keer wel beschikbaar. De
-- reden is dwingender: deze migratie mag pas draaien NADAT O1_AUTH_ENFORCED=true in productie
-- staat en bevestigd werkt. Draai je hem eerder, dan krijgt elke lezing die vandaag zonder
-- sessie via deze negen views gaat (de anon-sleutel, geen ingelogde gebruiker -- de huidige,
-- overheersende staat, zie middleware.ts) onmiddellijk NUL rijen terug in plaats van de echte
-- data. Geen foutmelding, geen crash -- gewoon een leeg dashboard, live, voor iedereen die nog
-- zonder sessie zit. Dat is precies het scenario waar het scriptcommentaar in
-- scripts/check-rls-scheiding.mjs al voor waarschuwde ("zou anders leeglopen").
--
-- ── VOLGORDE (uit scripts/migrations/README_MIGRATIES.md, "De volgorde bij de O1-deploy") ──
--
--   1. Client-side writes naar server-routes.  GEDAAN.
--   2. 001/032 draaien, eerste admin geseed, rollen/bureaus toegewezen.  GEDAAN (1 admin,
--      1 bureau, bevestigd 20 augustus 2026 -- zie masterplan 15.6).
--   3. O1_AUTH_ENFORCED=true in Vercel, redeployen, ZELF opnieuw inloggen op de live site en
--      bevestigen dat dat werkt.  NOG NIET GEDAAN -- dit is een Vercel-environment-variabele,
--      geen databasewijziging, en dus geen stap die via deze migratie of vanuit deze sandbox
--      gezet kan worden.
--   4. PAS DAN: deze migratie (099) draaien.
--
-- De middleware zelf is inmiddels wel geverifieerd (masterplan 15.6-vervolg, 20 augustus 2026):
-- een echte tijdelijke testgebruiker, een echte wachtwoord-login tegen de productie-Supabase,
-- de sessie-cookie in het exacte @supabase/ssr-formaat (sb-<project-ref>-auth-token,
-- base64url, "base64-"-prefix) rechtstreeks naar de lokale server gestuurd: publieke paden
-- blijven publiek zonder sessie, beveiligde paden redirecten naar /login zonder sessie, API's
-- geven 401 zonder sessie, en MET een echte sessie wordt de eigen-bureau-klant toegelaten (200)
-- en de klant van een ANDER bureau geweigerd (307 naar /vandaag) -- exact het gedrag dat
-- app_can_read_client()/canAccessClient() beloven. "LIVE-ONGETEST" in middleware.ts en
-- app/(marketing)/login/page.tsx's kopcommentaar kan dus vervallen zodra dit draait, niet
-- eerder.
--
-- ── WAAROM security_invoker EN GEEN NIEUWE POLICIES ──────────────────────────
--
-- Dit zijn views, geen tabellen. De onderliggende tabellen (fact_core, accounts,
-- google_metrics, linkedin_*, meta_*) hebben al werkende RLS-policies -- functioneel bewezen
-- (masterplan 15.6): twee echte bureaus, twee echte logins, tabellen scheiden correct. Een view
-- zonder security_invoker draait met de rechten van de EIGENAAR van de view (meestal de
-- migratie-uitvoerder, een superuser-achtige rol) en negeert daarmee de RLS van de
-- aanroepende gebruiker volledig -- vandaar dat anoniem via ads_campaign_monthly alle 4.797
-- rijen kreeg terwijl de tabellen zelf keurig scheiden. Met security_invoker = true draait de
-- view MET de rechten van de aanroeper, en gelden de al bewezen tabelpolicies vanzelf ook voor
-- de view. Geen aparte view-policy nodig of mogelijk.
--
-- Draaien (na stap 3 hierboven, en pas na bevestiging):
--   node scripts/supabase-sql.mjs --file scripts/migrations/099_views_security_invoker.sql
-- Terugdraaien: `alter view <naam> set (security_invoker = false);` per view (of de kolom
-- resetten naar de PostgreSQL-default, die al `false` is).

alter view ads_account_monthly set (security_invoker = true);
alter view ads_campaign_monthly set (security_invoker = true);
alter view blended_account_monthly set (security_invoker = true);
alter view linkedin_account_daily set (security_invoker = true);
alter view linkedin_campaign_daily set (security_invoker = true);
alter view linkedin_creative_daily set (security_invoker = true);
alter view meta_account_daily set (security_invoker = true);
alter view meta_ad_daily set (security_invoker = true);
alter view meta_campaign_daily set (security_invoker = true);

-- ── CONTROLEQUERY, ná toepassing te draaien ──────────────────────────────────
-- select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'v'
--   and c.relname in ('ads_account_monthly','ads_campaign_monthly','blended_account_monthly',
--                      'linkedin_account_daily','linkedin_campaign_daily','linkedin_creative_daily',
--                      'meta_account_daily','meta_ad_daily','meta_campaign_daily');
-- Verwacht: reloptions = {security_invoker=true} voor alle negen, geen null meer.
--
-- Daarna scripts/check-rls-scheiding.mjs opnieuw draaien: de "LET OP de views lezen nog om RLS
-- heen"-melding uit masterplan 15.6 hoort dan te verdwijnen, vervangen door "de views doen mee
-- aan RLS" met een aantal dat overeenkomt met wat de ingelogde testgebruiker daadwerkelijk mag
-- zien -- niet meer het volledige tabeltotaal voor een sessie zonder rechten.

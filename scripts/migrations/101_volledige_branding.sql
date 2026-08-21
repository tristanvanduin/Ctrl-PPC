-- 101: bureau-brede huisstijlkleuren + een expliciete, per-klant "volledige branding"-vlag.
--
-- Idempotent, puur additief. Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/101_volledige_branding.sql
-- Terugdraaien: `alter table agencies drop column brand_guide`,
-- `alter table client_settings drop column full_branding_enabled`.
--
-- ── WAAROM ────────────────────────────────────────────────────────────────
--
-- BrandThemeProvider (components/branding/brand-theme-provider.tsx) zet vandaag onvoorwaardelijk
-- CSS-variabelen voor ELKE klant, waardoor het hele dashboard-chrome (zijbalk, knoppen, accenten)
-- meekleurt met de klant-brand_guide. Besluit van de eigenaar (21 augustus 2026): dat mag alleen
-- voor (a) klanten waarvoor een platformbeheerder dit expliciet aanzet, en (b) bureaus met
-- whitelabel_actief. Voor iedereen anders blijft het dashboard de standaard Ctrl PPC-huisstijl.
--
-- Er bestaat geen bestaand veld dat een specifieke klant uniek identificeert voor (a) -- en dat is
-- met opzet zo: een eerdere sessie heeft alle referenties naar een specifieke echte klantnaam uit
-- de codebase verwijderd (IP-risico, zie docs/MASTERPLAN.md 17.9-17.11). Vandaar een generieke,
-- naamloze vlag i.p.v. een hardgecodeerde check: een platformbeheerder zet 'm handmatig aan voor
-- welke klant dan ook, nooit een klantnaam in de code.
--
-- `agencies.brand_guide` is het bureau-brede equivalent van client_settings.brand_guide (migratie
-- 019) -- zelfde jsonb-vorm ({ visual: { primaryColor, accentColor, secondaryColor, headingFont,
-- logoUrl } }), zodat resolveEventTheme() ongewijzigd hergebruikt kan worden. Alleen zichtbaar/
-- bewerkbaar voor het eigen bureau als whitelabel_actief staat -- zelfde voorwaarde als het
-- logo-uploadpad uit migratie 068, nu via een eigen API-route (agencies staat niet in de
-- generieke /api/data/[table]-tabellenlijst, met opzet: bureau-brede kleuren zijn geen tabel die
-- elke ingelogde gebruiker via die route zou moeten kunnen lezen/schrijven).

alter table agencies add column if not exists brand_guide jsonb not null default '{}'::jsonb;

comment on column agencies.brand_guide is
  'Bureau-brede huisstijl (visual.primaryColor/accentColor/secondaryColor/headingFont/logoUrl), zelfde vorm als client_settings.brand_guide. Alleen te bewerken door leden van het eigen bureau, en alleen als whitelabel_actief staat (zie app/api/agency/branding/route.ts).';

alter table client_settings add column if not exists full_branding_enabled boolean not null default false;

comment on column client_settings.full_branding_enabled is
  'Mag het hele dashboard-chrome (niet alleen de hero) meekleuren met de brand_guide van deze klant? Alleen door een platformbeheerder te zetten (zie app/api/admin/full-branding/route.ts) -- geen zelfbedieningsvlag, en met opzet geen klantnaam-check in de code.';

-- ── Controle ──────────────────────────────────────────────────────────────
-- select id, name, whitelabel_actief, brand_guide from agencies order by name;
-- select client_id, full_branding_enabled from client_settings where full_branding_enabled;

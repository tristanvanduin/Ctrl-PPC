-- 109: klant_bezoeken, het ijkpunt "sinds je vorige bezoek" per gebruiker en per klant.
--
-- STATUS: KLAARGEZET, NIET TOEGEPAST EN NERGENS OP AANGESLOTEN (bouwplan fase 4, 12 november 2026).
-- Geen route, hook of cron leest of schrijft deze tabel. Het ijkpunt woont nu in localStorage
-- (lib/overzicht/bezoek.ts, sleutel `vorig-bezoek:<client_id>`): per browser, en dus kwijt op een
-- ander apparaat of na het wissen van de browsergegevens. Deze tabel maakt er later een ijkpunt
-- per gebruiker van, over apparaten heen. Tot die aansluiting er is, verandert het toepassen van
-- deze migratie niets aan wat een gebruiker ziet.
-- Terugdraaien: `drop table if exists klant_bezoeken;`
--
-- ── WAT ER IN STAAT ──────────────────────────────────────────────────────────
--
-- Dezelfde twee tijdstippen als in de browser, met dezelfde betekenis (zie bezoek.ts):
--   laatst_gezien_op   het laatste moment dat deze klant bij deze gebruiker in beeld was
--   vorig_bezoek_op    het einde van het VORIGE bezoek; wat daarna gebeurde is "nieuw"
-- Het ijkpunt schuift pas op als een bezoek voorbij is (langer dan dertig minuten niet gekeken),
-- niet bij elke paginalaad: anders wist een herlaad de markering voordat iemand hem gelezen heeft.
-- Die regel hoort in de code te blijven (openBezoek), niet in een trigger: één plek, getoetst.
--
-- Eén rij per gebruiker per klant. Geen geschiedenis: het logboek heeft alleen het laatste
-- ijkpunt nodig, en een bezoekenlog per gebruiker is persoonsgegevens verzamelen zonder doel.
--
-- ── RLS, NAAR HET PATROON VAN 065/067 ────────────────────────────────────────
--
-- Twee voorwaarden, allebei nodig:
--   1. de rij is van JOU (user_id = auth.uid()): een collega hoort niet te zien wanneer jij een
--      klant bekeek, ook niet binnen hetzelfde bureau;
--   2. de klant is voor jou ZICHTBAAR (client_id in (select app_zichtbare_klanten())): de
--      verzamelingsvorm uit 065, eenmalig per statement uitgerekend, niet per rij (de
--      statement-timeout van 058). Wie de toegang tot een klant verliest, leest en schrijft ook
--      zijn eigen oude rij daarvoor niet meer.
-- Anders dan de leestabellen uit 067 SCHRIJFT de browser deze tabel straks zelf (een upsert bij
-- het openen en het verlaten van de klant), dus er is naast select ook een insert- en een
-- update-policy, elk met dezelfde twee voorwaarden. Geen delete-policy: een rij verdwijnt met de
-- gebruiker (on delete cascade), niet via de browser.
--
-- Net als bij 065/067 geldt: zolang O1_AUTH_ENFORCED uit staat is auth.uid() leeg en geeft deze
-- tabel voor de browser nul rijen. Dat is hier geen leeg scherm: de aansluiting hoort dan terug te
-- vallen op localStorage, zoals nu.

create table if not exists klant_bezoeken (
  user_id           uuid        not null references auth.users (id) on delete cascade,
  client_id         text        not null,
  vorig_bezoek_op   timestamptz,
  laatst_gezien_op  timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, client_id)
);

comment on table klant_bezoeken is 'Het ijkpunt "sinds je vorige bezoek" per gebruiker per klant (bouwplan fase 4). Eén rij, geen geschiedenis.';
comment on column klant_bezoeken.vorig_bezoek_op is 'Einde van het vorige bezoek; logboekregels van daarna zijn nieuw. Null bij het eerste bezoek.';
comment on column klant_bezoeken.laatst_gezien_op is 'Laatste moment dat de klant bij deze gebruiker in beeld was.';

alter table klant_bezoeken enable row level security;

drop policy if exists klant_bezoeken_eigen_lezen on klant_bezoeken;
create policy klant_bezoeken_eigen_lezen on klant_bezoeken for select
  using (user_id = auth.uid() and client_id in (select app_zichtbare_klanten()));

drop policy if exists klant_bezoeken_eigen_toevoegen on klant_bezoeken;
create policy klant_bezoeken_eigen_toevoegen on klant_bezoeken for insert
  with check (user_id = auth.uid() and client_id in (select app_zichtbare_klanten()));

drop policy if exists klant_bezoeken_eigen_bijwerken on klant_bezoeken;
create policy klant_bezoeken_eigen_bijwerken on klant_bezoeken for update
  using (user_id = auth.uid() and client_id in (select app_zichtbare_klanten()))
  with check (user_id = auth.uid() and client_id in (select app_zichtbare_klanten()));

-- Controle na toepassen (verwacht: rowsecurity = true, drie policies):
--   select relrowsecurity from pg_class where relname = 'klant_bezoeken';
--   select policyname, cmd from pg_policies where tablename = 'klant_bezoeken' order by policyname;

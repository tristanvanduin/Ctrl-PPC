-- 068: white-label logo per bureau.
--
-- Idempotent, puur additief. Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/068_agency_whitelabel.sql
-- Terugdraaien: de vier policies droppen, `delete from storage.buckets where id = 'agency-logos'`
-- (alleen als er nooit een bestand in geplaatst is; anders eerst de bestanden verwijderen), en
-- `alter table agencies drop column whitelabel_actief`.
--
-- ── WAAROM ────────────────────────────────────────────────────────────────
--
-- De app-shell (zijbalk) toont vandaag altijd de Ctrl PPC-merknaam, ongeacht welk bureau
-- ingelogd is. Voor bureaus die het platform onder hun eigen naam willen draaien is dat niet
-- gewenst, maar het mag ook geen standaardrecht zijn: dit is een aan/uit-schakelbare feature per
-- bureau, gezet door een platformbeheerder (zie app_is_platform(), migratie 057), niet iets wat
-- een bureau zelf voor zichzelf aanzet.
--
-- Het logo zelf staat niet in de database: net als het bestaande klant-logo-patroon
-- (client-files/${clientId}/logo.png, zie components/dashboard/client-settings.tsx) is de
-- opslagconventie de sleutel. Hier: bucket agency-logos, pad ${agencyId}/logo.png.
--
-- Publieke lees-bucket, met opzet: dit logo moet renderen in de zijbalk bij elke paginalaad,
-- zonder een signed-URL die na 300s verloopt en zonder ververslogica in een component die de
-- hele sessie gemonteerd blijft. Een logo is geen vertrouwelijk gegeven. Schrijven blijft wel
-- degelijk afgeschermd: alleen leden van het eigen bureau, en alleen als whitelabel_actief staat.

alter table agencies add column if not exists whitelabel_actief boolean not null default false;

comment on column agencies.whitelabel_actief is
  'Mag dit bureau een eigen logo uploaden voor de app-shell? Alleen door een platformbeheerder te zetten.';

insert into storage.buckets (id, name, public)
values ('agency-logos', 'agency-logos', true)
on conflict (id) do nothing;

drop policy if exists agency_logos_lezen on storage.objects;
create policy agency_logos_lezen on storage.objects for select
  using (bucket_id = 'agency-logos');

drop policy if exists agency_logos_plaatsen on storage.objects;
create policy agency_logos_plaatsen on storage.objects for insert to authenticated
  with check (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1]::uuid in (select app_bureaus())
    and (storage.foldername(name))[1]::uuid in (select id from agencies where whitelabel_actief)
  );

drop policy if exists agency_logos_bijwerken on storage.objects;
create policy agency_logos_bijwerken on storage.objects for update to authenticated
  using (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1]::uuid in (select app_bureaus())
  )
  with check (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1]::uuid in (select app_bureaus())
    and (storage.foldername(name))[1]::uuid in (select id from agencies where whitelabel_actief)
  );

drop policy if exists agency_logos_verwijderen on storage.objects;
create policy agency_logos_verwijderen on storage.objects for delete to authenticated
  using (
    bucket_id = 'agency-logos'
    and (storage.foldername(name))[1]::uuid in (select app_bureaus())
  );

-- ── Controle ──────────────────────────────────────────────────────────────
-- select id, name, whitelabel_actief from agencies order by name;
-- select id, name, public from storage.buckets where id = 'agency-logos';

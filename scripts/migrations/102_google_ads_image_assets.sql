-- 102: google_ads_image_assets -- de ontbrekende databron voor Google Display-afbeeldingen.
--
-- Feedback (21 augustus, tweede ronde): "Display heeft visuals, geen tekst ads" -- Creative
-- Performance (components/dashboard/creative-performance.tsx) toont bij een Display-advertentie
-- zonder RSA-tekst een "niet gesynct"-icoon, alsof het een tijdelijk sync-gat is. Het is geen
-- gat: er bestond tot nu toe GEEN ENKELE Google-databron voor afbeeldingen, alleen
-- google_ads_rsa_assets (migratie 020), en die is tekst-only (HEADLINE/DESCRIPTION).
--
-- Zelfde vorm als google_ads_rsa_assets, met opzet: image_url komt uit de Google Ads API's
-- asset.image_asset.full_size.url (een door Google gehoste, publiek bereikbare preview-URL,
-- geen losse Supabase Storage-upload nodig -- zelfde patroon als thumbnail_url bij Meta en
-- image_storage_path bij LinkedIn qua ROL in de creative-kaart, andere bron).
--
-- LIVE-ONGETEST: het GAQL-veld field_type voor beeld-assets (MARKETING_IMAGE,
-- SQUARE_MARKETING_IMAGE, LOGO, ...) en asset.image_asset.full_size.url zijn niet tegen een
-- echte Google Ads-omgeving geverifieerd in deze sandbox (geen live credentials beschikbaar).
-- De sync-functie (lib/api/google-ads.ts, getDisplayImageAssets) vangt daarom elke fout zelf op
-- en geeft [] terug -- een verkeerd veldnaam breekt zo hoogstens deze ene dataset, nooit de rest
-- van de sync. Eerste keer draaien tegen een echt account is de eigenlijke verificatie.

create table if not exists google_ads_image_assets (
  client_id      text not null,
  ad_id          text not null,
  asset_id       text not null,
  campaign_name  text,
  ad_group_name  text,
  field_type     text not null,
  image_url      text not null,
  synced_at      timestamptz not null default now(),
  primary key (client_id, ad_id, asset_id)
);
create index if not exists idx_image_assets_client on google_ads_image_assets (client_id);

alter table google_ads_image_assets enable row level security;

-- Zelfde policy-vorm als google_ads_rsa_assets/google_ads_ad_meta (migratie 085) -- dezelfde
-- fout (RLS aan, geen policy, dus een stille lege lezing voor iedereen) niet nog een keer maken.
drop policy if exists google_ads_image_assets_zichtbaar on google_ads_image_assets;
create policy google_ads_image_assets_zichtbaar on google_ads_image_assets for select
  using (client_id in (select app_zichtbare_klanten()));

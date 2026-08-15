-- 085: ontbrekende SELECT-policy op google_ads_rsa_assets en google_ads_ad_meta.
--
-- Gevonden in dezelfde sweep als migratie 084 (platform_beheerders): RLS stond aan, zonder
-- enige policy. components/dashboard/creative-performance.tsx en creative-deep-dive.tsx lezen
-- deze twee tabellen rechtstreeks met de anon-key browserclient (lib/supabase.ts) om RSA-
-- advertentietekst en de landingspagina-URL te verrijken -- die lezingen liepen dus altijd
-- stil leeg voor elke gebruiker, echt of anoniem. Zelfde policy-vorm als de ~99 andere
-- client_id-gescoped tabellen (bijv. ads_search_terms_monthly_zichtbaar).

drop policy if exists google_ads_rsa_assets_zichtbaar on google_ads_rsa_assets;
create policy google_ads_rsa_assets_zichtbaar on google_ads_rsa_assets for select
  using (client_id in (select app_zichtbare_klanten()));

drop policy if exists google_ads_ad_meta_zichtbaar on google_ads_ad_meta;
create policy google_ads_ad_meta_zichtbaar on google_ads_ad_meta for select
  using (client_id in (select app_zichtbare_klanten()));

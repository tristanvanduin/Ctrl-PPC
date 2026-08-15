-- 087: ontbrekende policy op app_settings -- zelfde bugvorm als platform_beheerders (084/086),
-- deze keer met de grants al wel op orde (authenticated/anon hadden al SELECT/INSERT/UPDATE/
-- DELETE), maar zonder één RLS-policy. Resultaat: elke browserlezing (niet service-role) kreeg
-- altijd niets terug.
--
-- app_settings is de opslag achter lib/clients.ts (sleutel api_clients) en
-- lib/visible-clients.ts (sleutel visible_client_ids) -- de zijbalk-klantenlijst en de "welke
-- klanten toon ik"-selectie. Zonder deze policy zag elke browser "KLANTEN (0)" / "0 van 0
-- zichtbaar", ook al stonden de 71 echte klanten gewoon in de tabel (bevestigd via een
-- service-role-leesactie, die RLS omzeilt en dus niets van dit gat liet zien).
--
-- ── BEWUST BEPERKT TOT authenticated, NIET using(true) ─────────────────────────
--
-- Dit is een noodgreep, geen einddoel: app_settings is één platte, ongescoped tabel (geen
-- agency_id). api_clients/visible_client_ids zijn daardoor letterlijk een gedeelde lijst voor
-- ALLE gebruikers, ongeacht bureau -- veilig zolang er één echt bureau is, een lek zodra er een
-- tweede bijkomt (klantnamen van bureau A zichtbaar bij bureau B, ook al blijft de data zelf
-- afgeschermd via de RLS op accounts). Zie docs/MASTERPLAN.md: voor er een tweede bureau
-- aansluit, hoort deze cache te worden uitgefaseerd ten gunste van een zijbalk die rechtstreeks
-- uit accounts leest via app_zichtbare_klanten(), net als de rest van de app al doet.

drop policy if exists app_settings_ingelogd on app_settings;
create policy app_settings_ingelogd on app_settings for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- 040: de functies uit 037 en 039 waren publiek aanroepbaar. Dichtzetten.
--
-- DRAAIEN: METEEN. Idempotent, veilig te herhalen. Raakt geen data.
--
-- ── WAT ER MIS WAS ──────────────────────────────────────────────────────────
--
-- PostgREST publiceert elke functie in het public-schema als RPC-endpoint, en Postgres geeft
-- nieuwe functies standaard EXECUTE aan PUBLIC. Alles wat 039 aanmaakte was daardoor aanroepbaar
-- met de anon-sleutel — dezelfde sleutel die in elke browser zit die de app laadt.
--
-- Getest met de anon-sleutel, vóór deze migratie:
--
--   POST /rest/v1/rpc/klant_data_inventaris  {"p_client_id":"demo-greentech"}
--   → 200, volledige inventarisatie van alle tabellen met rijaantallen
--
--   POST /rest/v1/rpc/verwijder_klant_data   {"p_client_id":"...","p_bevestig":false}
--   → 200, met de foutmelding van de bevestigingscontrole
--
-- Die tweede is de ernstige. Hij kwam tot aan de vangrail, wat betekent dat de functie zélf
-- bereikbaar was: met p_bevestig := true had iedere bezoeker alle data van elke klant kunnen
-- wissen. De bevestigingsparameter is een bescherming tegen een ongeluk, niet tegen een
-- aanvaller — die vult gewoon true in.
--
-- Dit is dus een fout die ik met 039 zelf heb geïntroduceerd, en hij is ernstiger dan het
-- leesprobleem uit §1.2 van het ontwerp: dat lekt gegevens, dit vernietigt ze.
--
-- ── DE MAATREGEL ────────────────────────────────────────────────────────────
--
-- Intrekken bij public, anon en authenticated; alleen service_role houdt het recht. De app roept
-- deze functies aan via een server-route die zelf autoriseert (requireCapability), en die route
-- gebruikt de service-sleutel. Er is geen enkele reden waarom een browser hier rechtstreeks bij
-- zou moeten.
--
-- `authenticated` krijgt het bewust ook NIET. Ingelogd zijn zegt niets over welk bureau je bent;
-- zolang er geen controle op agency_id in de functie zit, zou elke ingelogde gebruiker de data
-- van elk ander bureau kunnen wissen. Die controle hoort in de route, waar de rol en de scope al
-- bekend zijn.

revoke execute on function klant_data_inventaris(text) from public, anon, authenticated;
revoke execute on function verwijder_klant_data(text, boolean) from public, anon, authenticated;
revoke execute on function refresh_rollups(uuid, date) from public, anon, authenticated;

grant execute on function klant_data_inventaris(text) to service_role;
grant execute on function verwijder_klant_data(text, boolean) to service_role;
grant execute on function refresh_rollups(uuid, date) to service_role;

-- ── En voor alles wat hierna komt ───────────────────────────────────────────
--
-- Zonder deze regel herhaalt de fout zich bij de volgende functie die iemand toevoegt. Nieuwe
-- functies in public krijgen dan niet meer standaard EXECUTE aan PUBLIC.
--
-- Let op: dit geldt alleen voor functies die worden aangemaakt door de rol waarvoor de default
-- is gezet. Het is een vangnet, geen garantie — de controle hieronder blijft nodig.

alter default privileges in schema public revoke execute on functions from public;

-- ── Controle ────────────────────────────────────────────────────────────────
--
-- Welke functies in public zijn nog aanroepbaar door anon of authenticated? Deze lijst hoort
-- leeg te zijn voor alles wat data muteert.

select p.proname as functie,
       array_to_string(array(
         select r.rolname from pg_roles r
         where has_function_privilege(r.rolname, p.oid, 'EXECUTE')
           and r.rolname in ('anon','authenticated','service_role')
         order by r.rolname), ', ') as mag_uitvoeren
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in ('klant_data_inventaris','verwijder_klant_data','refresh_rollups')
order by p.proname;

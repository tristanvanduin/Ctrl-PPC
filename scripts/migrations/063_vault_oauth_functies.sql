-- 063: drie smalle deuren naar de vault, voor de OAuth-tokens.
--
-- ── WAAROM FUNCTIES EN GEEN DIRECTE QUERY ──────────────────────────────────
--
-- PostgREST bedient standaard alleen het public-schema, en vault.secrets ligt daarbuiten. De
-- applicatie kan er dus niet rechtstreeks bij, en dat is maar goed ook: dan zou "haal het token
-- van dit bureau op" en "lees de hele kluis" dezelfde soort aanroep zijn.
--
-- Deze drie functies zijn de enige deur, en elke deur is zo smal mogelijk:
--
--   bewaar_oauth_geheim(naam, waarde)  → zet of vervang ÉÉN geheim, geeft de id terug
--   lees_oauth_geheim(naam)            → geeft ÉÉN waarde terug, op naam
--   wis_oauth_geheim(naam)             → verwijdert ÉÉN geheim
--
-- Er is geen "lijst alle geheimen" en geen zoekopdracht. Wie een token wil, moet weten van welk
-- bureau en welk platform -- en die naam wordt in lib/tenancy/koppelingen.ts opgebouwd uit het
-- bureau-id, niet uit invoer van buiten.
--
-- ── DE NAAMBEGRENZING IS GEEN NETHEID ──────────────────────────────────────
--
-- Alle drie eisen een naam die begint met `oauth_`. Zonder die eis zou een fout in de aanroepende
-- code -- of een injectie via een parameter die ooit uit een verzoek komt -- ook bij geheimen
-- kunnen die hier niets mee te maken hebben. Een functie met SECURITY DEFINER draait met de
-- rechten van de eigenaar; dan is beperken wat hij mag aanraken het hele punt.
--
-- ── RECHTEN ────────────────────────────────────────────────────────────────
--
-- EXECUTE alleen voor service_role. Niet voor authenticated en niet voor anon: dit zijn
-- serverfuncties, en de browser hoort nooit een refresh token te zien. Zie ook
-- scripts/check-rpc-rechten.mjs, die daarop controleert.

CREATE OR REPLACE FUNCTION public.bewaar_oauth_geheim(p_naam text, p_waarde text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_naam IS NULL OR p_naam !~ '^oauth_[a-z_]+_[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'ongeldige geheimnaam';
  END IF;
  IF p_waarde IS NULL OR btrim(p_waarde) = '' THEN
    RAISE EXCEPTION 'leeg geheim';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = p_naam;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_waarde, p_naam, 'OAuth refresh token per bureau (agency_connections.token_ref)');
  ELSE
    -- Vervangen en niet een tweede rij: de naam is de sleutel, en twee geheimen met dezelfde
    -- naam maakt "welke is de echte" een vraag zonder antwoord.
    PERFORM vault.update_secret(v_id, p_waarde);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lees_oauth_geheim(p_naam text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_waarde text;
BEGIN
  IF p_naam IS NULL OR p_naam !~ '^oauth_[a-z_]+_[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'ongeldige geheimnaam';
  END IF;
  SELECT decrypted_secret INTO v_waarde FROM vault.decrypted_secrets WHERE name = p_naam;
  RETURN v_waarde;
END;
$$;

CREATE OR REPLACE FUNCTION public.wis_oauth_geheim(p_naam text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_aantal integer;
BEGIN
  IF p_naam IS NULL OR p_naam !~ '^oauth_[a-z_]+_[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'ongeldige geheimnaam';
  END IF;
  DELETE FROM vault.secrets WHERE name = p_naam;
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal > 0;
END;
$$;

-- ── REVOKE FROM PUBLIC IS NIET GENOEG ──────────────────────────────────────
--
-- Nagemeten direct na de eerste versie van deze migratie: met alleen `REVOKE ... FROM PUBLIC`
-- mochten anon én authenticated de functies nog steeds uitvoeren. Supabase heeft default
-- privileges staan die EXECUTE op nieuwe functies in public aan die twee rollen geven, en die
-- staan los van PUBLIC.
--
-- Dat is geen schoonheidsfoutje. De anon-sleutel staat in de browser, PostgREST publiceert elke
-- public-functie op /rest/v1/rpc/<naam>, en de naam van een geheim is af te leiden uit een
-- bureau-UUID -- die niet geheim is. Met die ene ontbrekende regel was elk refresh token van elk
-- bureau opvraagbaar door iedereen die de pagina opent.
--
-- Daarom bij naam intrekken, en daarna pas toekennen. scripts/check-rpc-rechten.mjs controleert
-- dit; die had hem ook gevangen, maar dan pas bij de volgende poortenrun.
REVOKE ALL ON FUNCTION public.bewaar_oauth_geheim(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lees_oauth_geheim(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wis_oauth_geheim(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bewaar_oauth_geheim(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lees_oauth_geheim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wis_oauth_geheim(text) TO service_role;

COMMENT ON FUNCTION public.lees_oauth_geheim(text) IS
  'Geeft één OAuth-refresh-token uit vault.secrets, op naam. Alleen service_role; de browser hoort dit nooit te kunnen aanroepen.';

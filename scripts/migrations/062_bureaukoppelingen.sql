-- 062: de platformkoppelingen per bureau.
--
-- ── HET MODEL ──────────────────────────────────────────────────────────────
--
-- Voor Google Ads bestaan er DRIE dingen die vaak op één hoop gaan, en het verschil bepaalt waar
-- ze horen te staan:
--
--   developer token          van het PRODUCT, één stuk, draagt de API-quota   → omgeving
--   OAuth client id/secret   van het PRODUCT, één stuk                        → omgeving
--   refresh token            van het BUREAU, uit zijn eigen toestemming       → hier
--   manager customer id      van het BUREAU, zijn eigen MCC                   → hier
--
-- Dat is het verschil tussen "één sleutel van mij" (die blijft) en "koppelen via OAuth" (dat komt
-- erbij). Geen bring-your-own-key: dan moet elk bureau zélf een developer token aanvragen bij
-- Google, en dat is geen invulveld maar een aanvraagprocedure van dagen tot weken met kans op
-- afwijzing -- precies tussen "ik wil dit proberen" en "het werkt" in.
--
-- Meta en LinkedIn hebben dezelfde vorm: een app van het product, een toestemming per bureau.
--
-- ── WAAROM PER BUREAU EN NIET PER KLANT ────────────────────────────────────
--
-- meta_connections en linkedin_connections staan per klant. Voor die twee kan dat kloppen (een
-- adverteerder geeft toegang tot één ad-account), maar voor Google Ads is het verkeerd: een bureau
-- heeft één MCC waar al zijn klanten onder hangen. Per klant opslaan betekent hetzelfde refresh
-- token zeventig keer bewaren, en bij intrekking zeventig rijen bijwerken -- met zeventig kansen
-- om er één te missen.
--
-- Deze tabel staat daarom per (bureau, platform). Het account-id ONDER de koppeling blijft waar
-- het hoort: accounts.external_id. Dat zijn twee verschillende dingen en die moeten niet in
-- dezelfde kolom.
--
-- ── HET TOKEN STAAT IN DE VAULT, NIET HIER ─────────────────────────────────
--
-- token_ref wijst naar vault.secrets.id. Supabase Vault zit in dit project al geïnstalleerd
-- (supabase_vault 0.3.1) en kost niets extra. Nagemeten op deze database voordat dit gebouwd
-- werd: op schijf staat er versleutelde tekst, en vault.decrypted_secrets geeft de waarde terug.
--
-- Dit is ook waar de bestaande token_ref-kolommen in meta_connections en linkedin_connections
-- altijd al voor bedoeld waren; daar is alleen nooit ingevuld waar ze heen wezen.
--
-- Een refresh token in een gewone kolom zou betekenen dat elke backup-dump, elk foutrapport en
-- elke ontwikkelaar met leesrechten de sleutels van andermans advertentieaccount in handen heeft.

CREATE TABLE IF NOT EXISTS agency_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,

  -- google_ads | meta | linkedin. Tekst en geen enum: een enum uitbreiden is een migratie, en
  -- er komen platforms bij (Microsoft Ads staat in de productvisie).
  provider text NOT NULL,

  -- Het account waar de toestemming over gaat: MCC-id bij Google, business-id bij Meta,
  -- organisatie-URN bij LinkedIn. Niet het klantaccount -- dat staat in accounts.external_id.
  external_id text,

  -- → vault.secrets.id. Geen FK: de vault is een ander schema en een ontbrekend geheim moet
  -- leesbaar zijn als "koppeling stuk", niet als een constraint-fout diep in een sync.
  token_ref uuid,

  -- Wat er is toegekend. Bij een uitbreiding van de functionaliteit moet je kunnen zien welke
  -- bureaus opnieuw toestemming moeten geven, zonder het te proberen en te falen.
  scopes text[] NOT NULL DEFAULT '{}',

  -- actief | verlopen | ingetrokken | fout
  status text NOT NULL DEFAULT 'actief',

  -- Wanneer het token verloopt. Google's refresh token verloopt niet maar kan ingetrokken worden;
  -- Meta's long-lived token na ~60 dagen, LinkedIn's refresh token na ~365. Zonder deze kolom
  -- merk je dat pas als de sync 's nachts stilvalt.
  expires_at timestamptz,

  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Eén koppeling per bureau per platform. Een tweede koppeling betekent dat er twee
  -- waarheden zijn over wie namens dit bureau mag praten.
  UNIQUE (agency_id, provider)
);

COMMENT ON TABLE agency_connections IS
  'De OAuth-koppeling per bureau per platform. Developer token en OAuth-client blijven van het product (omgeving); het refresh token en het MCC/business-id zijn van het bureau. Het token zelf staat in vault.secrets; token_ref wijst ernaar.';

CREATE INDEX IF NOT EXISTS idx_agency_connections_bureau
  ON agency_connections (agency_id, provider);

-- Koppelingen die aandacht nodig hebben: verlopen, bijna verlopen, of in fout. De
-- verloopbewaking bevraagt dit dagelijks.
CREATE INDEX IF NOT EXISTS idx_agency_connections_verloop
  ON agency_connections (expires_at) WHERE status = 'actief';

ALTER TABLE agency_connections ENABLE ROW LEVEL SECURITY;

-- ALLEEN service_role. Bewust GEEN leespolicy voor ingelogde gebruikers, ook niet voor het eigen
-- bureau: er staat weliswaar geen token in deze tabel, maar wel het MCC-id en de scopes, en die
-- horen niet in een browser. De UI vraagt de status via een route die zelf bepaalt wat hij
-- prijsgeeft.
DROP POLICY IF EXISTS "service_role_all" ON agency_connections;
CREATE POLICY "service_role_all" ON agency_connections
  FOR ALL USING (auth.role() = 'service_role');

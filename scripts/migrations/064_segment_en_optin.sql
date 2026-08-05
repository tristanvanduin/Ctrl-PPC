-- 064: bedrijfsmodel en niche apart, plus de opt-in op bureauniveau.
--
-- ── WAAROM sector GESPLITST WORDT ──────────────────────────────────────────
--
-- client_settings.sector had zeventien keuzes en gooide drie dingen op één hoop:
--
--   b2b_saas               bedrijfsmodel (b2b) én niche (software)
--   fysiotherapie          alleen een niche
--   ecommerce_laag_ticket  bedrijfsmodel (b2c) én een ticketgrootte die AL in aov_segment staat
--
-- Voor een benchmark is dat onbruikbaar: "hoe doen b2b-accounts het" is niet te beantwoorden als
-- het antwoord verspreid zit over b2b_saas, b2b_leadgen en de helft van legal en finance.
--
-- Twee velden dus. bedrijfsmodel is grofmazig en vult zich snel; niche is fijnmazig en duurt --
-- en dat is precies de fasering: eerst alleen model óf alleen niche, nooit de combinatie, tot de
-- dekking het toelaat. Die regel staat in lib/benchmark/cel.ts.
--
-- sector BLIJFT staan en wordt niet verwijderd. Hij zit in opgeslagen analyses, in
-- benchmark_sectors en in de prompts; hem nu weghalen zou die stilzwijgend leeg maken. De
-- migratie hieronder vult de twee nieuwe velden uit de oude waarde (zie uitOudeSector in
-- lib/benchmark/segment.ts, waar dezelfde afbeelding staat en getest is).
--
-- ── DE OPT-IN IS EEN APARTE HANDELING ──────────────────────────────────────
--
-- Overwogen en verworpen: de niche invullen laten gelden als toestemming, met een pop-up bij
-- opslaan. Twee bezwaren.
--
-- Ten eerste zegt iemand dan ja zonder het te merken, want hij was een productiviteitsveld aan
-- het invullen. Toestemming die je per ongeluk geeft is geen toestemming, en dát is het verhaal
-- dat je later tegenkomt -- niet het veld.
--
-- Ten tweede geeft het bureau toestemming over data van ZIJN KLANT. Dat kan alleen als het in
-- hun verwerkersovereenkomst staat, en dan wil je kunnen aanwijzen wanneer wie waarvoor tekende.
-- Dat kan niet als het een bijwerking van een opslagknop was.
--
-- Vandaar: één schakelaar per bureau, met datum, gebruiker en de versie van de tekst waarmee is
-- ingestemd. Die versie is geen formaliteit -- verandert de tekst, dan is de oude instemming
-- gegeven op andere voorwaarden, en dat moet je kunnen zien.

-- ── Klantniveau: waar valt deze klant in ───────────────────────────────────

ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS bedrijfsmodel text,
  ADD COLUMN IF NOT EXISTS niche text;

COMMENT ON COLUMN client_settings.bedrijfsmodel IS
  'b2b of b2c. Leeg = onbekend; bewust geen derde waarde "beide", want die trekt elke twijfelaar aan en levert drie dunne segmenten op in plaats van twee dikke.';
COMMENT ON COLUMN client_settings.niche IS
  'De niche, genormaliseerd (kleine letters, streepjes). Vaste lijst in lib/benchmark/segment.ts plus vrije invoer; wat drie keer vrij ingevuld wordt, hoort naar de vaste lijst.';

-- Beide velden worden gefilterd bij het opbouwen van benchmarkcellen.
CREATE INDEX IF NOT EXISTS idx_client_settings_segment
  ON client_settings (bedrijfsmodel, niche);

-- De vijf bestaande sector-waarden overzetten. Idempotent: alleen waar het nieuwe veld nog leeg
-- is, zodat een tweede run niets overschrijft wat iemand intussen met de hand heeft gezet.
UPDATE client_settings SET bedrijfsmodel = m.model, niche = COALESCE(client_settings.niche, m.niche)
FROM (VALUES
  ('ecommerce_laag_ticket', 'b2c', NULL),
  ('ecommerce_mid_ticket',  'b2c', NULL),
  ('ecommerce_hoog_ticket', 'b2c', NULL),
  ('ecommerce_general',     'b2c', NULL),
  ('ecommerce_fashion',     'b2c', 'mode'),
  ('ecommerce_electronics', 'b2c', 'elektronica'),
  ('ecommerce_huisdieren',  'b2c', 'huisdieren'),
  ('fysiotherapie',         'b2c', 'fysiotherapie'),
  ('zorg_generiek',         'b2c', 'zorg_overig'),
  ('b2b_saas',              'b2b', 'software'),
  ('b2b_software',          'b2b', 'software'),
  ('b2b_leadgen',           'b2b', 'zakelijke_diensten'),
  ('leadgen_generiek',      'b2c', 'diensten_lokaal'),
  ('automotive',            NULL,  'automotive'),
  ('legal',                 NULL,  'juridisch'),
  ('finance',               NULL,  'financieel'),
  ('horeca',                'b2c', 'horeca'),
  ('retail_local',          'b2c', 'retail_lokaal')
) AS m(sector, model, niche)
WHERE client_settings.sector = m.sector
  AND client_settings.bedrijfsmodel IS NULL;

-- ── Bureauniveau: doet dit bureau mee aan de benchmarkpool ─────────────────

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS benchmark_optin_at timestamptz,
  ADD COLUMN IF NOT EXISTS benchmark_optin_by uuid,
  ADD COLUMN IF NOT EXISTS benchmark_optin_versie text;

COMMENT ON COLUMN agencies.benchmark_optin_at IS
  'Wanneer dit bureau instemde met deelname aan de geanonimiseerde benchmarkpool. NULL = geen toestemming; dan levert dit bureau geen enkele rij aan de pool. Intrekken zet dit terug op NULL en verwijdert de bijdrage.';
COMMENT ON COLUMN agencies.benchmark_optin_versie IS
  'De versie van de tekst waarmee is ingestemd. Verandert die tekst, dan is de oude instemming gegeven op andere voorwaarden en moet er opnieuw gevraagd worden.';

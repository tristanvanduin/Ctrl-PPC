-- 061: het bureau bij het LLM-verbruik.
--
-- ── WAAROM ─────────────────────────────────────────────────────────────────
--
-- llm_usage legt per call vast wat hij kostte, met client_id erbij. Wat er niet bij staat is het
-- BUREAU. Zolang er één bureau is valt dat niet op; zodra er twee zijn is verbruik per bureau niet
-- te bepalen, en dus ook niet te factureren of te begrenzen. Een creditmodel ("50 analyses") is
-- per definitie een saldo per bureau, niet per klant.
--
-- De kolom kost nu niets en is later een migratie over honderden miljoenen rijen. Daarom nu.
--
-- ── WAAROM NULLABLE, EN GEEN FOREIGN KEY ───────────────────────────────────
--
-- Nullable, want er zijn calls zonder klant (een platformbrede analyse) en calls van een klant die
-- later bij geen enkel bureau meer hoort. Een NOT NULL zou recordUsage laten falen, en die insert
-- is bewust fire-and-forget met een stille catch: een mislukte insert zet dan geruisloos ALLE
-- kostenregistratie uit. Dat is precies het soort stille schade dat deze tabel moet voorkomen.
--
-- Geen foreign key naar agencies om dezelfde reden: een verwijderd bureau mag zijn verbruiks-
-- geschiedenis niet meenemen -- die heb je juist nodig voor de eindafrekening.
--
-- ── DE BACKFILL ────────────────────────────────────────────────────────────
--
-- Alle 38 bestaande rijen zijn te herleiden via accounts.client_id (nagemeten voor deze migratie:
-- 38 van 38). De backfill is idempotent en raakt alleen rijen waar agency_id nog leeg is, zodat
-- een tweede run niets overschrijft wat de applicatie intussen zelf heeft gezet.

ALTER TABLE llm_usage
  ADD COLUMN IF NOT EXISTS agency_id uuid;

COMMENT ON COLUMN llm_usage.agency_id IS
  'Het bureau waaraan deze call toegerekend wordt. Nullable: platformbrede calls en calls van een klant zonder bureau hebben er geen. Geen FK, zodat verbruiksgeschiedenis een verwijderd bureau overleeft.';

UPDATE llm_usage l
   SET agency_id = a.agency_id
  FROM accounts a
 WHERE a.client_id = l.client_id
   AND l.agency_id IS NULL;

-- De index die het maandplafond nodig heeft: "wat heeft dit bureau deze maand verbruikt".
-- Zonder deze index wordt dat een seq scan over de hele tabel, en die vraag staat vóór élke
-- LLM-call in het pad van de gebruiker.
CREATE INDEX IF NOT EXISTS idx_llm_usage_bureau_maand
  ON llm_usage (agency_id, created_at);

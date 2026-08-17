-- ============================================================================
-- Eigenaarswaarde in sprint_items.owner normaliseren naar de rol ("Bureau"), niet een naam
-- ============================================================================
--
-- WAAROM
--
-- lib/branding/brand.ts's LEGACY_OWNER_TEAM hield tot nu toe elke historische schrijfwijze aan
-- ("RAI Amsterdam", "RAI", "Ranking Masters", "RM") zodat bestaande rijen bij het LEZEN correct
-- als team-taak blijven tellen, zonder dat de database zelf ooit hoefde te veranderen. Die lijst
-- is inmiddels verwijderd uit de broncode: geen van die namen mag daar nog in staan. Dit script
-- is het gevolg daarvan -- de kolom zelf moet nu de rol dragen, niet meer een oude naam, anders
-- vallen bestaande rijen bij het lezen terug op "Klant" (OWNER_CLIENT) en tellen ze stilzwijgend
-- als klanttaak in plaats van teamtaak.
--
-- Idempotent en veilig om meerdere keren te draaien.
--
-- ── Kijk eerst wat er staat ──────────────────────────────────────────────────

SELECT owner, count(*) FROM sprint_items GROUP BY owner ORDER BY 2 DESC;

-- ── De wijziging ────────────────────────────────────────────────────────────

UPDATE sprint_items SET owner = 'Bureau'
WHERE owner IN ('RAI Amsterdam', 'RAI', 'Ranking Masters', 'RM');

-- De standaardwaarde voor nieuwe rijen (was ooit een eerdere productnaam, via een eerder,
-- inmiddels vervangen script).
ALTER TABLE sprint_items ALTER COLUMN owner SET DEFAULT 'Bureau';

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hierna hoort er geen enkele rij meer met een van de oude waarden te staan.

SELECT owner, count(*) FROM sprint_items GROUP BY owner ORDER BY 2 DESC;

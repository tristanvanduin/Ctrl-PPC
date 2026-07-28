-- ============================================================================
-- Eigenaar hernoemen: "Ranking Masters" -> "RAI Amsterdam"
--
-- STATUS: UITGEVOERD op 2026-07-28 tegen de productiedatabase. 38 rijen in sprint_items
-- gewijzigd; "Minismus" (7 rijen) en vier rijen met hypothesetekst bleven ongemoeid.
-- Dit bestand blijft staan als verslag en voor een verse installatie.
--
-- WAAROM DIT EEN APART SCRIPT IS
--
-- De eigenaar van een taak is geen weergavetekst maar een OPGESLAGEN waarde. De code accepteert
-- sinds de naamswijziging beide (zie lib/branding/brand.ts: LEGACY_OWNER_TEAM) en normaliseert
-- bij het lezen, zodat bestaande rijen blijven werken zonder dat dit script gedraaid is.
--
-- WAT ER MIS WAS MET DE VORIGE VERSIE
--
-- Hij richtte zich op `sprint_planning` en `sop_tasks.owner`. Nagekeken tegen de echte database:
--
--   sprint_planning     bestaat niet
--   sop_tasks.owner     kolom bestaat niet
--
-- De eigenaar staat in `sprint_items.owner`. Dit script zou dus zijn afgebroken op de eerste
-- UPDATE — en omdat niemand bij de database kon, is dat nooit gebleken. Een migratie die
-- klaarstaat is niet hetzelfde als een migratie die werkt.
--
-- WAT ER VERDER IN DIE KOLOM STAAT
--
-- Behalve namen staan er vier volledige hypotheseteksten van 200+ tekens in. De WHERE-clausule
-- raakt die niet, maar het is wel een teken dat sprint_items.owner ergens verkeerd wordt
-- gevuld. Apart op te lossen; geen reden om de hernoeming uit te stellen.
--
-- Veilig om meerdere keren te draaien.
-- ============================================================================

-- Kijk eerst wat er staat.
SELECT owner, count(*) FROM sprint_items GROUP BY owner ORDER BY 2 DESC;

-- ── De wijziging ────────────────────────────────────────────────────────────

UPDATE sprint_items SET owner = 'RAI Amsterdam'
WHERE owner IN ('Ranking Masters', 'RM');

-- De standaardwaarde voor nieuwe rijen.
ALTER TABLE sprint_items ALTER COLUMN owner SET DEFAULT 'RAI Amsterdam';

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hierna hoort er geen enkele rij meer met de oude waarde te staan.

SELECT owner, count(*) FROM sprint_items GROUP BY owner ORDER BY 2 DESC;

-- ── Daarna ──────────────────────────────────────────────────────────────────
--
-- LEGACY_OWNER_TEAM in lib/branding/brand.ts kan hierna weg, en de oude waarde uit OwnerEnum in
-- lib/schema/analysis-schema.ts. Dat gebeurt bewust nog NIET: `isTeamOwner` herkent de oude
-- waarde nog, en zolang er een back-up of een niet-gemigreerde omgeving kan bestaan is die
-- tolerantie goedkoop.

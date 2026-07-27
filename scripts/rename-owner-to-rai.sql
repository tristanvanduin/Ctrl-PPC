-- ============================================================================
-- Eigenaar hernoemen: "Ranking Masters" -> "RAI Amsterdam"
--
-- WAAROM DIT EEN APART SCRIPT IS
--
-- De eigenaar van een taak is geen weergavetekst maar een OPGESLAGEN waarde. De code accepteert
-- sinds de naamswijziging beide (zie lib/branding/brand.ts: LEGACY_OWNER_TEAM) en normaliseert
-- bij het lezen, zodat bestaande rijen blijven werken zonder dat dit script gedraaid is.
--
-- Dit script haalt die tussenoplossing weg door de rijen zelf bij te werken. Draai het wanneer
-- het uitkomt; er zit geen tijdsdruk op.
--
-- NA HET DRAAIEN kan LEGACY_OWNER_TEAM uit lib/branding/brand.ts, en mag de oude waarde uit
-- OwnerEnum in lib/schema/analysis-schema.ts. Doe dat niet eerder: dan worden rijen die dit
-- script gemist heeft ineens ongeldig.
--
-- Veilig om meerdere keren te draaien.
-- ============================================================================

-- Kijk eerst wat er staat.
SELECT 'sprint_planning' AS tabel, owner, count(*) FROM sprint_planning GROUP BY owner
UNION ALL
SELECT 'sop_tasks', owner, count(*) FROM sop_tasks GROUP BY owner
ORDER BY 1, 2;

-- ── De wijziging ────────────────────────────────────────────────────────────

UPDATE sprint_planning SET owner = 'RAI Amsterdam'
WHERE owner IN ('Ranking Masters', 'RM');

UPDATE sop_tasks SET owner = 'RAI Amsterdam'
WHERE owner IN ('Ranking Masters', 'RM');

-- De standaardwaarde voor nieuwe rijen. scripts/sprint-planning.sql draagt hem al voor een
-- verse installatie; deze regel is voor databases die al bestonden.
ALTER TABLE sprint_planning ALTER COLUMN owner SET DEFAULT 'RAI Amsterdam';

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hierna hoort er geen enkele rij meer met de oude waarde te staan.

SELECT 'sprint_planning' AS tabel, owner, count(*) FROM sprint_planning GROUP BY owner
UNION ALL
SELECT 'sop_tasks', owner, count(*) FROM sop_tasks GROUP BY owner
ORDER BY 1, 2;

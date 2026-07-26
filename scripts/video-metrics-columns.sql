-- ============================================================================
-- VIDEO- EN CPM-METRICS OP CAMPAGNENIVEAU (YouTube / Demand Gen)
--
-- Waarom: de Google-sync haalde alleen search/conversie-metrics op. Draai je
-- YouTube, dan wordt een TrueView-campagne beoordeeld op klikken en CPA — cijfers
-- die bij awareness structureel laag zijn. Zo'n campagne ziet er dan mislukt uit
-- terwijl hij prima kan presteren. Deze kolommen geven die campagnes de juiste maat.
--
-- Grain blijft gelijk (client_id / campaign_id / month) — dit zijn extra kolommen
-- op ads_campaign_monthly, geen nieuwe tabel.
--
-- Bij Search-campagnes leveren deze velden 0 (Google geeft 0, niet NULL). De UI
-- beslist op campaign_type of ze getoond worden — zie isVideoCampaignType().
--
-- Run in de Supabase SQL Editor. Idempotent.
-- ============================================================================

ALTER TABLE ads_campaign_monthly
  -- Kosten per 1000 vertoningen. Cross-channel vergelijkbaar met Meta/LinkedIn:
  -- het enige cijfer dat alle drie de kanalen op dezelfde manier meet.
  ADD COLUMN IF NOT EXISTS avg_cpm numeric DEFAULT 0,
  -- Campagnetype bepaalt welke lens past (SEARCH vs VIDEO/DEMAND_GEN).
  ADD COLUMN IF NOT EXISTS campaign_type text,
  -- TrueView: aantal views en wat een view kost.
  ADD COLUMN IF NOT EXISTS video_views integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_cpv numeric DEFAULT 0,
  -- Welk deel van de vertoningen tot een view leidde (0-1).
  ADD COLUMN IF NOT EXISTS video_view_rate numeric DEFAULT 0,
  -- Kijkdiepte (0-1): waar haken ze af. p25 laag = hook stuk; p75 hoog = boodschap landt.
  ADD COLUMN IF NOT EXISTS video_quartile_p25 numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_quartile_p50 numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_quartile_p75 numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_quartile_p100 numeric DEFAULT 0;

-- Snel de videocampagnes vinden zonder over alle campagnes te scannen.
CREATE INDEX IF NOT EXISTS idx_campaign_monthly_video
  ON ads_campaign_monthly (client_id, month)
  WHERE video_views > 0;


-- ─── Registreer de dimensie zodra er echt video-data is ─────────────────────
-- Alleen registreren als er daadwerkelijk views zijn: een account zonder YouTube
-- hoort niet als "video beschikbaar" te boek te staan.

INSERT INTO ads_dimension_availability (client_id, dimension, is_available, data_source, notes)
SELECT DISTINCT client_id, 'video_metrics', true, 'google_ads',
  'TrueView views, view rate, CPV en kijkdiepte per campagne per maand'
FROM ads_campaign_monthly
WHERE video_views > 0
ON CONFLICT (client_id, dimension) DO UPDATE SET
  is_available = true,
  row_count = (SELECT COUNT(*) FROM ads_campaign_monthly
               WHERE client_id = EXCLUDED.client_id AND video_views > 0),
  synced_at = NOW();


-- ============================================================================
-- NOTES
--
-- Historie: Google levert deze cijfers alleen vanaf het moment dat je ze
-- opvraagt in de query. Na deze migratie vult de eerstvolgende sync het venster
-- dat de sync zelf ophaalt — er is geen backfill van vóór die tijd.
--
-- Quartiles worden door de API als percentage (0-100) geleverd; de app schrijft
-- ze als fractie (0-1) weg, zodat ze net als ctr/conversion_rate te formatteren zijn.
-- ============================================================================

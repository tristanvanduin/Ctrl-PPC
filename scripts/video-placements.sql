-- ============================================================================
-- YOUTUBE-PLACEMENTS (video / Demand Gen)
--
-- Waarom: bij YouTube bepaalt Google waar je advertentie landt, en daar lekt
-- budget weg — kinder-apps waar per ongeluk geklikt wordt, auto-play-kanalen die
-- niemand actief kijkt, content die niets met de doelgroep te maken heeft. Op
-- campagneniveau verdwijnt dat in het gemiddelde; alleen per placement zie je het.
--
-- De bestaande ads_pmax_placements is hard gefilterd op Performance Max en dekt
-- video niet. Deze tabel is de video-tegenhanger.
--
-- Grain: client_id / campaign_id / placement / month
--
-- Run in de Supabase SQL Editor. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_video_placements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text,
  month date NOT NULL,
  -- De uitsluitbare identifier: kanaal-ID, video-ID, app-ID of domein.
  placement text NOT NULL,
  -- Leesbare naam (kanaalnaam, videotitel, appnaam); Google levert die niet altijd.
  display_name text,
  -- YOUTUBE_CHANNEL | YOUTUBE_VIDEO | MOBILE_APPLICATION | WEBSITE | ...
  placement_type text,
  target_url text,
  -- metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  video_views integer DEFAULT 0,
  -- Of kosten/klikken/conversies betekenisvol zijn. Bij Performance Max levert Google alleen
  -- vertoningen per placement; dan staat dit op false en mag er geen kosten- of CPA-oordeel op.
  -- Zonder deze vlag zou een PMax-placement er in de analyse uitzien als "gratis".
  metrics_complete boolean DEFAULT true,
  -- 'video' (VIDEO/DEMAND_GEN/DISCOVERY) of 'pmax'. Bepaalt ook hoe je uitsluit: bij PMax kan dat
  -- alleen via de uitsluitingslijst op accountniveau, niet per campagne.
  source text DEFAULT 'video',
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, campaign_id, placement, month)
);

ALTER TABLE ads_video_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_video_placements
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_video_placements_client
  ON ads_video_placements (client_id, month);
-- Snel de kandidaten vinden: kost geld, levert niets op.
CREATE INDEX IF NOT EXISTS idx_video_placements_waste
  ON ads_video_placements (client_id, month)
  WHERE conversions = 0 AND cost > 0;


-- ─── Registreer de dimensie zodra er echt placementdata is ──────────────────

INSERT INTO ads_dimension_availability (client_id, dimension, is_available, data_source, notes)
SELECT DISTINCT client_id, 'video_placements', true, 'google_ads',
  'YouTube-kanalen, video''s, apps en sites waar videoadvertenties zijn vertoond'
FROM ads_video_placements
ON CONFLICT (client_id, dimension) DO UPDATE SET
  is_available = true,
  row_count = (SELECT COUNT(*) FROM ads_video_placements WHERE client_id = EXCLUDED.client_id),
  synced_at = NOW();


-- ============================================================================
-- NOTES
--
-- Twee bronnen, want alles wat met video adverteert hoort in hetzelfde beeld:
--   detail_placement_view            -> VIDEO / DEMAND_GEN / DISCOVERY, volledige metrics
--   performance_max_placement_view   -> Performance Max, UITSLUITEND vertoningen
-- Search heeft geen placements en valt buiten beide.
--
-- Die tweede beperking is wezenlijk: Google publiceert voor PMax geen kosten,
-- klikken of conversies per placement. De analyse markeert die rijen daarom met
-- metrics_complete = false en velt er geen kosten- of CPA-oordeel over.
--
-- Uitsluiten gebeurt niet vanuit dit dashboard: het levert een VOORSTEL met de
-- onderbouwing erbij. Een uitsluiting is in zijn effect moeilijk terug te draaien
-- (je verliest de leerdata van die placement), dus de beslissing blijft menselijk.
-- ============================================================================

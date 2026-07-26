-- ============================================================================
-- GEO LAAG 2 — REGIO/STAAT + PER-KANAAL GEO-OPSLAG
--
-- Laag 1 (al live) is de visualisatie: de interactieve wereld-/staten-kaart met
-- demo-mock voor alles behalve Google-landdata. Laag 2 (dit bestand) is de
-- opslag + read-doelen waar de echte connectors straks in schrijven, zodat de
-- kaarten vanzelf op echte data overschakelen zodra de sync er is.
--
-- Twee doelen:
--   1. ads_region_monthly   — Google region/staat per maand (VS-staten-drilldown)
--   2. channel_geo_monthly  — geüniformeerde geo voor Meta/LinkedIn (land + regio)
--
-- Google-landdata blijft ongewijzigd in ads_country_monthly (Laag 1).
--
-- Run in de Supabase SQL Editor.
-- ============================================================================


-- ============================================================================
-- 1. ADS_REGION_MONTHLY — Google region/staat per maand
--
-- Grain: client_id / country_code / region_name / month
-- Bron: ads_geo_performance_monthly (heeft al region_name + geo_target_id)
-- Gebruik: VS-staten-drilldown op de geo-kaart (region_name -> USPS in de app),
--          en later elke land-regio (NL-provincies, DE-Bundesländer, ...).
--
-- region_code is optioneel — voor de VS vult de app 'm af uit region_name
-- (Engelse staatsnaam -> USPS). We slaan region_name canoniek op.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ads_region_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  country_code text NOT NULL,                  -- ISO land: US, NL, DE
  region_name text NOT NULL,                   -- Google region_name (bv. "California")
  region_code text,                            -- optioneel canoniek (bv. USPS "CA")
  month date NOT NULL,                         -- eerste dag van de maand
  -- volume
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- afgeleide metrics (uit de venstertotalen, niet uit dag-gemiddelden)
  ctr numeric DEFAULT 0,
  avg_cpc numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  roas numeric DEFAULT 0,
  -- context
  campaign_count integer DEFAULT 0,
  spend_share numeric DEFAULT 0,               -- regio-cost / land-cost die maand
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, country_code, region_name, month)
);

ALTER TABLE ads_region_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON ads_region_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_region_monthly_client
  ON ads_region_monthly (client_id, month);
CREATE INDEX IF NOT EXISTS idx_region_monthly_country
  ON ads_region_monthly (client_id, country_code, month);


-- ─── Vul ads_region_monthly uit de ruwe geo-data ────────────────────────────
-- Draai na elke sync (na ads_geo_performance_monthly). Aggregatie per
-- (land, regio, maand); ratio's uit de gesommeerde totalen.

INSERT INTO ads_region_monthly (
  client_id, country_code, region_name, month,
  impressions, clicks, cost, conversions, conversions_value,
  ctr, avg_cpc, cost_per_conversion, conversion_rate, roas,
  campaign_count, spend_share, synced_at
)
SELECT
  g.client_id,
  g.country_code,
  g.region_name,
  g.month,
  SUM(g.impressions)::integer,
  SUM(g.clicks)::integer,
  SUM(g.cost),
  SUM(g.conversions),
  SUM(g.conversions_value),
  CASE WHEN SUM(g.impressions) > 0 THEN ROUND(SUM(g.clicks)::numeric / SUM(g.impressions), 6) ELSE 0 END,
  CASE WHEN SUM(g.clicks) > 0 THEN ROUND(SUM(g.cost) / SUM(g.clicks), 4) ELSE 0 END,
  CASE WHEN SUM(g.conversions) > 0 THEN ROUND(SUM(g.cost) / SUM(g.conversions), 4) ELSE 0 END,
  CASE WHEN SUM(g.clicks) > 0 THEN ROUND(SUM(g.conversions) / SUM(g.clicks), 6) ELSE 0 END,
  CASE WHEN SUM(g.cost) > 0 THEN ROUND(SUM(g.conversions_value) / SUM(g.cost), 4) ELSE 0 END,
  COUNT(DISTINCT g.campaign_id)::integer,
  CASE WHEN SUM(SUM(g.cost)) OVER (PARTITION BY g.client_id, g.country_code, g.month) > 0
    THEN ROUND(SUM(g.cost) / SUM(SUM(g.cost)) OVER (PARTITION BY g.client_id, g.country_code, g.month), 4)
    ELSE 0 END,
  NOW()
FROM ads_geo_performance_monthly g
WHERE g.country_code IS NOT NULL
  AND g.region_name IS NOT NULL
GROUP BY g.client_id, g.country_code, g.region_name, g.month
ON CONFLICT (client_id, country_code, region_name, month)
DO UPDATE SET
  impressions = EXCLUDED.impressions,
  clicks = EXCLUDED.clicks,
  cost = EXCLUDED.cost,
  conversions = EXCLUDED.conversions,
  conversions_value = EXCLUDED.conversions_value,
  ctr = EXCLUDED.ctr,
  avg_cpc = EXCLUDED.avg_cpc,
  cost_per_conversion = EXCLUDED.cost_per_conversion,
  conversion_rate = EXCLUDED.conversion_rate,
  roas = EXCLUDED.roas,
  campaign_count = EXCLUDED.campaign_count,
  spend_share = EXCLUDED.spend_share,
  synced_at = NOW();


-- ============================================================================
-- 2. CHANNEL_GEO_MONTHLY — geüniformeerde geo voor Meta/LinkedIn (en breder)
--
-- Grain: client_id / channel / level / geo_code / month
-- level = 'country' (geo_code = ISO alpha-2) of 'region' (geo_code = USPS/regio).
-- Bron: de kanaal-connectors schrijven hier direct in vanuit hun eigen
--       geo-breakdown-endpoints (Meta: Insights breakdown=country/region;
--       LinkedIn: analytics pivot=MEMBER_COUNTRY_V2/MEMBER_REGION_V2).
--
-- Waarom apart van Google: Meta/LinkedIn hebben eigen attributie, valuta en
-- geo-granulariteit. Eén tabel met een channel-kolom houdt de read-laag simpel
-- en is uitbreidbaar naar toekomstige kanalen zonder nieuwe tabellen.
-- ============================================================================

CREATE TABLE IF NOT EXISTS channel_geo_monthly (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  channel text NOT NULL,                       -- 'meta' | 'linkedin' | ...
  level text NOT NULL,                         -- 'country' | 'region'
  geo_code text NOT NULL,                      -- alpha-2 land óf USPS/regio-code
  geo_name text,                               -- leesbare naam (optioneel)
  country_code text,                           -- bij level=region: het land (US)
  month date NOT NULL,
  -- volume
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions numeric DEFAULT 0,
  conversions_value numeric DEFAULT 0,
  -- afgeleide metrics
  ctr numeric DEFAULT 0,
  avg_cpc numeric DEFAULT 0,
  cost_per_conversion numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  roas numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now(),
  UNIQUE (client_id, channel, level, geo_code, month)
);

ALTER TABLE channel_geo_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON channel_geo_monthly
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_channel_geo_client
  ON channel_geo_monthly (client_id, channel, level, month);


-- ============================================================================
-- 3. DIMENSION AVAILABILITY — registreer wat er beschikbaar is
-- ============================================================================

INSERT INTO ads_dimension_availability (client_id, dimension, is_available, data_source, notes)
SELECT DISTINCT client_id, 'region_monthly', true, 'google_ads',
  'Aggregated from geo_performance_monthly by country_code + region_name'
FROM ads_region_monthly
ON CONFLICT (client_id, dimension) DO UPDATE SET
  is_available = true,
  row_count = (SELECT COUNT(*) FROM ads_region_monthly WHERE client_id = EXCLUDED.client_id),
  synced_at = NOW();


-- ============================================================================
-- NOTES — wat de connectors moeten leveren (Laag 2 "aanzetten")
--
-- Google (region/staat):
--   Voeg segments.geo_target_region + een region_name-resolutie toe aan de geo-
--   sync (geographic_view), zodat ads_geo_performance_monthly.region_name vult.
--   Draai daarna de INSERT hierboven. De app mapt region_name -> USPS
--   (lib/geo/us-fips.ts regionNameToUsps) voor de VS-staten-kaart.
--
-- Meta (geo):
--   Insights API met breakdowns=['country'] en (apart) ['region'], time_increment
--   maandelijks. Schrijf naar channel_geo_monthly met channel='meta',
--   level='country'|'region', geo_code = ISO/USPS.
--
-- LinkedIn (geo):
--   adAnalytics met pivot=MEMBER_COUNTRY_V2 (land) en MEMBER_REGION_V2 (regio),
--   timeGranularity=MONTHLY. Schrijf naar channel_geo_monthly met
--   channel='linkedin'. LinkedIn levert URN's; resolve naar ISO/USPS bij de sync.
--
-- Tot de connectors er zijn blijven deze tabellen leeg; de geo-kaart toont dan
-- in demo-modus de mock en buiten demo niets (geen neppe cijfers).
-- ============================================================================

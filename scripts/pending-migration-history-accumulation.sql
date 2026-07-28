-- Historie laten aangroeien in plaats van hem elke sync weg te gooien.
--
-- Het probleem: zeventien tabellen worden gesynct met replaceBatch, dat eerst alle rijen van de
-- klant verwijdert en daarna opnieuw invoegt. Die tabellen kunnen daardoor nooit meer bevatten
-- dan wat de laatste sync ophaalde — veertien maanden. De zestien tabellen die met upsertBatch
-- werken groeien al wel mee: die voegen de nieuwe maand toe en verversen de rest, dus daar staat
-- na een jaar syncen zesentwintig maanden.
--
-- replaceBatch bestaat niet voor niets: zonder unieke sleutel op de natuurlijke kolommen kan
-- Postgres geen ON CONFLICT doen. Deze migratie legt die sleutels aan. Daarna schakelt
-- lib/sync/orchestrator.ts vanzelf over (appendBatch probeert upsert en valt terug op replace
-- zolang de sleutel er niet is).
--
-- Waarom dit de moeite waard is: Google Ads bewaart zoektermdata niet onbeperkt. Wat daar uit
-- het venster loopt is definitief weg. Elke sync die ads_search_terms_wasteful leeggooit, gooit
-- historie weg die niet meer op te halen is.
--
-- NULLS NOT DISTINCT is nodig omdat campaign_id, geo_target_id en soortgelijke kolommen leeg
-- mogen zijn. Standaard beschouwt Postgres twee NULL's als verschillend, waardoor er alsnog
-- dubbele rijen zouden ontstaan en de upsert niets zou ontdubbelen. Vereist Postgres 15+.

-- ── Eerst opruimen ─────────────────────────────────────────────────────────
-- Er kunnen al dubbelen in staan uit de tijd dat er geen sleutel was. De unieke index komt er
-- anders niet op. Per groep blijft de nieuwste rij staan.

DELETE FROM ads_search_terms_wasteful a USING ads_search_terms_wasteful b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id
    AND a.week_start = b.week_start AND a.search_term = b.search_term;

DELETE FROM ads_device_performance_monthly a USING ads_device_performance_monthly b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id AND a.month = b.month
    AND a.device = b.device AND a.level = b.level
    AND a.campaign_id IS NOT DISTINCT FROM b.campaign_id;

DELETE FROM ads_network_performance_monthly a USING ads_network_performance_monthly b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id AND a.month = b.month
    AND a.network_type = b.network_type
    AND a.campaign_id IS NOT DISTINCT FROM b.campaign_id;

DELETE FROM ads_audience_performance_monthly a USING ads_audience_performance_monthly b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id AND a.month = b.month
    AND a.campaign_id IS NOT DISTINCT FROM b.campaign_id
    AND a.ad_group_id IS NOT DISTINCT FROM b.ad_group_id
    AND a.audience_id IS NOT DISTINCT FROM b.audience_id;

DELETE FROM ads_country_monthly a USING ads_country_monthly b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id
    AND a.month = b.month AND a.country_code = b.country_code;

DELETE FROM ads_geo_performance_monthly a USING ads_geo_performance_monthly b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id AND a.month = b.month
    AND a.campaign_id IS NOT DISTINCT FROM b.campaign_id
    AND a.geo_target_id IS NOT DISTINCT FROM b.geo_target_id
    AND a.country_code IS NOT DISTINCT FROM b.country_code;

DELETE FROM ads_change_history a USING ads_change_history b
  WHERE a.ctid < b.ctid AND a.client_id = b.client_id
    AND a.change_datetime = b.change_datetime
    AND a.change_resource_name IS NOT DISTINCT FROM b.change_resource_name
    AND a.change_type IS NOT DISTINCT FROM b.change_type;

-- ── Dan de sleutels ────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ads_search_terms_wasteful_key
  ON ads_search_terms_wasteful (client_id, week_start, search_term);

CREATE UNIQUE INDEX IF NOT EXISTS ads_device_performance_monthly_key
  ON ads_device_performance_monthly (client_id, month, device, level, campaign_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS ads_network_performance_monthly_key
  ON ads_network_performance_monthly (client_id, month, network_type, campaign_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS ads_audience_performance_monthly_key
  ON ads_audience_performance_monthly (client_id, month, campaign_id, ad_group_id, audience_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS ads_country_monthly_key
  ON ads_country_monthly (client_id, month, country_code);

CREATE UNIQUE INDEX IF NOT EXISTS ads_geo_performance_monthly_key
  ON ads_geo_performance_monthly (client_id, month, campaign_id, geo_target_id, country_code) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS ads_change_history_key
  ON ads_change_history (client_id, change_datetime, change_resource_name, change_type) NULLS NOT DISTINCT;

-- ── Bewust NIET aangeraakt ─────────────────────────────────────────────────
--
-- Deze blijven met replaceBatch werken, en dat is geen omissie:
--
--   ads_negative_keywords        huidige toestand, geen tijdreeks. Je wilt de lijst zoals hij nu
--                                is, niet elke versie die hij ooit had. Een uitsluiting die is
--                                weggehaald hoort te verdwijnen, en met upsert zou hij blijven.
--   ads_ad_schedule_performance  rollende momentopname met period_start/period_end over de
--                                laatste dertig dagen; opeenvolgende periodes overlappen, dus
--                                stapelen levert dubbeltelling op.
--   ads_country_yoy              afgeleide tabel, wordt elke sync opnieuw berekend.
--   ads_country_impression_share idem.
--   de PMax- en videotabellen     eerst het venster en de sleutels vaststellen; die staan nog
--                                in scripts/pending-migrations-geo-video.sql.

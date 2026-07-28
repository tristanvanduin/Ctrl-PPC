-- Bewaarbeleid voor zoektermen.
--
-- Zoekwoorden en zoektermen zijn niet hetzelfde, en dat verschil bepaalt het hele beleid.
-- Zoekwoorden beheer je zelf: een begrensde lijst die langzaam groeit. Zoektermen zijn wat mensen
-- werkelijk intypen, en dat is open-eind — een account krijgt er elke maand duizenden bij die het
-- nooit meer terugziet. Alleen die laatste hebben een bewaarbeleid nodig.
--
-- WORDT HIER NOOIT AANGERAAKT, en dat is expres:
--   ads_campaign_monthly, ads_adgroup_monthly, ads_keyword_performance_monthly,
--   ads_creative_performance, google_ads_ad_meta, google_ads_rsa_assets, ads_account_monthly
-- Begrensde verzamelingen waarvan de tijdreeks juist waardevoller wordt naarmate hij langer
-- loopt. Die groeien onbeperkt door.
--
-- ── Twee tabellen, twee regimes ────────────────────────────────────────────
--
--   ads_search_terms_monthly    ALLE zoektermen. Eén rij per term PER ADVERTENTIEGROEP per
--                               maand, dus dezelfde term telt meerdere keren mee. Dit is de
--                               tabel die hard groeit. Heeft conversions en conversions_value,
--                               dus hier valt onderscheid te maken tussen ruis en signaal.
--   ads_search_terms_wasteful   Alleen termen zonder conversies, met minder kolommen. Kleiner,
--                               en de conversiebescherming hieronder is er per definitie niet
--                               van toepassing.
--
-- ── Over de drempel ────────────────────────────────────────────────────────
--
-- Er staat bewust geen vast bedrag in dit script. De demo-data kon de vraag niet beantwoorden:
-- die bevat tien synthetische termen tussen 50 en 203 euro en heeft geen staart, terwijl echte
-- zoektermdata juist vooral staart is. En een grens van 5 euro betekent iets heel anders voor een
-- account van 500 euro per maand dan voor een van 500.000.
--
-- Daarom werkt de regel RELATIEF (aandeel van het maandtotaal) en staat er een rapportagestap
-- vóór de opruimstap. Stel de parameters af op je eigen cijfers voordat je iets verwijdert.

-- ══════════════════════════════════════════════════════════════════════════
-- STAP 1 — Kijken wat er zou gebeuren. Verandert niets.
-- ══════════════════════════════════════════════════════════════════════════

WITH parameters AS (
  SELECT
    INTERVAL '18 months' AS bewaar_alles_tot,  -- hieronder blijft alles staan
    0.001::numeric       AS kostenaandeel,     -- daarboven: weg onder 0,1% van de maand
    100                  AS altijd_top_n       -- maar altijd de duurste N per maand houden
),
oud AS (
  SELECT s.ctid, s.cost, s.conversions,
         SUM(s.cost) OVER (PARTITION BY s.client_id, s.month) AS maand_totaal,
         ROW_NUMBER() OVER (PARTITION BY s.client_id, s.month ORDER BY s.cost DESC) AS rang
  FROM ads_search_terms_monthly s, parameters p
  WHERE s.month < (CURRENT_DATE - p.bewaar_alles_tot)
),
te_verwijderen AS (
  SELECT o.* FROM oud o, parameters p
  WHERE o.rang > p.altijd_top_n
    AND o.cost < (o.maand_totaal * p.kostenaandeel)
    AND COALESCE(o.conversions, 0) = 0   -- iets dat ooit converteerde gooien we nooit weg
)
SELECT
  (SELECT COUNT(*) FROM ads_search_terms_monthly)                AS rijen_nu,
  (SELECT COUNT(*) FROM oud)                                     AS rijen_buiten_venster,
  (SELECT COUNT(*) FROM te_verwijderen)                          AS zou_verdwijnen,
  ROUND((SELECT COALESCE(SUM(cost), 0) FROM te_verwijderen), 2)  AS kosten_die_verdwijnen,
  ROUND((SELECT COALESCE(SUM(cost), 0) FROM ads_search_terms_monthly), 2) AS kosten_totaal;

-- Lees dit als volgt: 'zou_verdwijnen' mag gerust een groot deel van de RIJEN zijn — dat is de
-- staart en dat is de bedoeling. Maar 'kosten_die_verdwijnen' hoort een paar procent van
-- 'kosten_totaal' te zijn. Is dat meer, dan staat de drempel te hoog en snijd je in de inhoud.

-- ══════════════════════════════════════════════════════════════════════════
-- STAP 2 — Snoeien. Pas draaien als stap 1 er redelijk uitziet.
-- ══════════════════════════════════════════════════════════════════════════
--
-- Drie beschermingen, en die zijn het hele punt:
--   1. Alles binnen het bewaarvenster blijft staan.
--   2. De duurste N van elke maand blijven staan, wat de drempel ook zegt. Zo houd je van elke
--      periode de vorm, ook bij een agressieve drempel.
--   3. Een term die ooit converteerde wordt nooit verwijderd. Dat is bewijs dat iets werkte, en
--      precies het soort ding waarvan je over drie jaar wilt kunnen terugkijken.

-- BEGIN;  -- zodat je met ROLLBACK terug kunt

WITH parameters AS (
  SELECT INTERVAL '18 months' AS bewaar_alles_tot, 0.001::numeric AS kostenaandeel, 100 AS altijd_top_n
),
oud AS (
  SELECT s.ctid, s.cost, s.conversions,
         SUM(s.cost) OVER (PARTITION BY s.client_id, s.month) AS maand_totaal,
         ROW_NUMBER() OVER (PARTITION BY s.client_id, s.month ORDER BY s.cost DESC) AS rang
  FROM ads_search_terms_monthly s, parameters p
  WHERE s.month < (CURRENT_DATE - p.bewaar_alles_tot)
)
DELETE FROM ads_search_terms_monthly t
USING oud o, parameters p
WHERE t.ctid = o.ctid
  AND o.rang > p.altijd_top_n
  AND o.cost < (o.maand_totaal * p.kostenaandeel)
  AND COALESCE(o.conversions, 0) = 0;

-- Dezelfde behandeling voor de wasteful-tabel, maar zonder de conversiebescherming: die tabel
-- bevat per definitie alleen termen zonder conversies en heeft de kolom niet eens.
WITH parameters AS (
  SELECT INTERVAL '18 months' AS bewaar_alles_tot, 0.001::numeric AS kostenaandeel, 100 AS altijd_top_n
),
oud AS (
  SELECT s.ctid, s.cost,
         SUM(s.cost) OVER (PARTITION BY s.client_id, s.week_start) AS maand_totaal,
         ROW_NUMBER() OVER (PARTITION BY s.client_id, s.week_start ORDER BY s.cost DESC) AS rang
  FROM ads_search_terms_wasteful s, parameters p
  WHERE s.week_start < (CURRENT_DATE - p.bewaar_alles_tot)
)
DELETE FROM ads_search_terms_wasteful t
USING oud o, parameters p
WHERE t.ctid = o.ctid
  AND o.rang > p.altijd_top_n
  AND o.cost < (o.maand_totaal * p.kostenaandeel);

-- COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- STAP 3 — Consolideren. Levert meer op dan snoeien, en is onomkeerbaar.
-- ══════════════════════════════════════════════════════════════════════════
--
-- ads_search_terms_monthly heeft als grein (client_id, search_term, campaign_name,
-- ad_group_name, month). Dezelfde zoekterm die in vijf advertentiegroepen voorkomt, staat er dus
-- vijf keer in — elke maand opnieuw. In de demo komt elke term in acht perioden terug: tien
-- unieke termen over tachtig rijen.
--
-- Voor oude data is die opsplitsing naar advertentiegroep zelden nog interessant. Wat je over
-- drie jaar wilt weten is "wat kostte deze term ons in die periode", niet "in welke van de vijf
-- advertentiegroepen precies". Deze stap telt daarom op tot één rij per term per maand.
--
-- LET OP: dit is een eenrichtingsstraat, en de UNIQUE-sleutel bevat campaign_name en
-- ad_group_name — die worden hier op een verzamelnaam gezet. Draai eerst de telquery eronder.

-- Hoeveel scheelt het? (verandert niets)
SELECT COUNT(*) AS rijen_nu,
       COUNT(DISTINCT (client_id, search_term, month)) AS na_consolidatie
FROM ads_search_terms_monthly
WHERE month < (CURRENT_DATE - INTERVAL '3 years');

-- BEGIN;
--
-- WITH samengevat AS (
--   SELECT client_id, search_term, month,
--          SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(cost) AS cost,
--          SUM(COALESCE(conversions, 0)) AS conversions,
--          SUM(COALESCE(conversions_value, 0)) AS conversions_value
--   FROM ads_search_terms_monthly
--   WHERE month < (CURRENT_DATE - INTERVAL '3 years')
--   GROUP BY client_id, search_term, month
-- ),
-- gewist AS (
--   DELETE FROM ads_search_terms_monthly
--   WHERE month < (CURRENT_DATE - INTERVAL '3 years')
--   RETURNING 1
-- )
-- INSERT INTO ads_search_terms_monthly
--   (client_id, month, campaign_name, ad_group_name, search_term,
--    impressions, clicks, cost, conversions, conversions_value)
-- SELECT client_id, month, '(geconsolideerd)', '(geconsolideerd)', search_term,
--        impressions, clicks, cost, conversions, conversions_value
-- FROM samengevat;
--
-- COMMIT;
--
-- De verzamelnaam '(geconsolideerd)' is expres leesbaar: wie later een analyse over die periode
-- draait, ziet meteen dat de campagne- en advertentiegroepverdeling daar is samengevat en niet
-- dat alles in één campagne zat.

-- ══════════════════════════════════════════════════════════════════════════
-- Inplannen
-- ══════════════════════════════════════════════════════════════════════════
--
-- Stap 2 mag maandelijks draaien zodra je de parameters op je eigen data hebt afgesteld. Ik heb
-- hem bewust NIET aan de sync gehangen: dit verwijdert rijen, en een verwijdering die automatisch
-- gebeurt op een moment dat niemand het resultaat kan nakijken is niet iets om ongezien aan te
-- zetten. Eerst een keer met de hand, kijken wat stap 1 zegt, dan pas plannen.

-- 103: acht view-dekking-afwijkingen hersteld -- geen viewdefinitie was fout, fact_core droeg
-- weeskindrijen die nooit uit een *_legacy-tabel zijn geprojecteerd.
--
-- ── DIAGNOSE ─────────────────────────────────────────────────────────────────
--
-- scripts/check-view-dekking.mjs meldde op alle acht fase-3-paren dezelfde vorm: "0 rij(en) alleen
-- in de tabel, N alleen in de view" -- de view (over fact_core) had MEER rijen dan de *_legacy-
-- tabel eronder. Migratie 054 zelf mat gelijke aantallen (775/775, 4707/4707, ...); dit is dus
-- sindsdien gegroeid, niet een fout in de views van meet af aan.
--
-- refresh_fact_from_legacy (migratie 054) is de enige schrijfweg naar fact_core en projecteert
-- uitsluitend UIT de *_legacy-tabellen -- fact_core kan dus alleen méér rijen krijgen dan zijn
-- bron als een eerdere directe seed/reset buiten die functie om in fact_core heeft geschreven, of
-- als *_legacy-rijen zijn opgeschoond zonder de bijbehorende fact_core-rij mee te nemen. Elke
-- weesrij bleek, uitgesplitst op client_id, van precies één klant: `demo-greentech`
-- (synced_at 14-15 augustus 2026 -- voor deze sessie, uit een eerdere demo-vulling). Geen
-- productieklant raakt deze migratie.
--
--   google/account/month      1 weesrij   (2024-08-01)
--   google/campaign/month     6 weesrijen (2024-08-01 .. 2025-12-01)
--   meta/account/day         31 weesrijen (2026-02-10 .. 2026-03-12)
--   meta/campaign/day        64 weesrijen (2026-05-17 .. 2026-06-16)
--   meta/creative/day       124 weesrijen (2026-05-17 .. 2026-06-16)
--   linkedin/account/day     31 weesrijen (2026-02-10 .. 2026-03-12)
--   linkedin/campaign/day    64 weesrijen (2026-05-17 .. 2026-06-16)
--   linkedin/creative/day    62 weesrijen (2026-06-04 .. 2026-07-04)
--
-- ── DE FIX ───────────────────────────────────────────────────────────────────
--
-- fact_core is een projectie, geen bron: het hoort nooit meer te bevatten dan wat er in de
-- *_legacy-tabellen staat. Weesrijen dus verwijderen, niet de *_legacy-tabellen aanvullen -- die
-- ZIJN de brontabellen en zijn zelf niet fout. Zelfde voor de kanaalmetrieken-tabellen
-- (google_metrics/meta_metrics/linkedin_metrics): geen foreign key naar fact_core (alleen naar
-- accounts), maar wel dezelfde natuurlijke sleutel, dus dezelfde weescontrole erop toegepast voor
-- consistentie -- een rij die er zonder fact_core-rij bij hangt wordt door geen enkele lezer meer
-- bereikt, maar hoort niet stil te blijven liggen als deze migratie toch al aan het opruimen is.

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join ads_account_monthly_legacy l
    on l.client_id = a.client_id and l.month = f.period_start
  where f.channel = 'google' and f.level = 'account' and f.grain = 'month' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join ads_campaign_monthly_legacy l
    on l.client_id = a.client_id and l.campaign_id = f.entity_id and l.month = f.period_start
  where f.channel = 'google' and f.level = 'campaign' and f.grain = 'month' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join meta_account_daily_legacy l
    on l.client_id = a.client_id and l.date = f.period_start
  where f.channel = 'meta' and f.level = 'account' and f.grain = 'day' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join meta_campaign_daily_legacy l
    on l.client_id = a.client_id and l.entity_id = f.entity_id and l.date = f.period_start
  where f.channel = 'meta' and f.level = 'campaign' and f.grain = 'day' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join meta_ad_daily_legacy l
    on l.client_id = a.client_id and l.entity_id = f.entity_id and l.date = f.period_start
  where f.channel = 'meta' and f.level = 'creative' and f.grain = 'day' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join linkedin_account_daily_legacy l
    on l.client_id = a.client_id and l.date = f.period_start
  where f.channel = 'linkedin' and f.level = 'account' and f.grain = 'day' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join linkedin_campaign_daily_legacy l
    on l.client_id = a.client_id and l.entity_urn = f.entity_id and l.date = f.period_start
  where f.channel = 'linkedin' and f.level = 'campaign' and f.grain = 'day' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

with wees as (
  select f.account_id, f.channel, f.level, f.grain, f.entity_id, f.period_start
  from fact_core f
  join accounts a on a.id = f.account_id
  left join linkedin_creative_daily_legacy l
    on l.client_id = a.client_id and l.entity_urn = f.entity_id and l.date = f.period_start
  where f.channel = 'linkedin' and f.level = 'creative' and f.grain = 'day' and l.client_id is null
)
delete from fact_core f using wees w
  where f.account_id = w.account_id and f.channel = w.channel and f.level = w.level
    and f.grain = w.grain and f.entity_id = w.entity_id and f.period_start = w.period_start;

-- ── kanaalmetrieken: dezelfde opruiming, nu op wat er ná bovenstaande NIET meer in fact_core zit
-- (google_metrics/meta_metrics/linkedin_metrics dragen zelf geen channel-kolom; dat volgt uit de
-- tabelnaam, precies zoals refresh_fact_from_legacy ze schrijft).

delete from google_metrics gm
  using accounts a
  where a.id = gm.account_id
    and not exists (
      select 1 from fact_core f
      where f.account_id = gm.account_id and f.channel = 'google' and f.level = gm.level
        and f.grain = gm.grain and f.entity_id = gm.entity_id and f.period_start = gm.period_start
    );

delete from meta_metrics mm
  using accounts a
  where a.id = mm.account_id
    and not exists (
      select 1 from fact_core f
      where f.account_id = mm.account_id and f.channel = 'meta' and f.level = mm.level
        and f.grain = mm.grain and f.entity_id = mm.entity_id and f.period_start = mm.period_start
    );

delete from linkedin_metrics lm
  using accounts a
  where a.id = lm.account_id
    and not exists (
      select 1 from fact_core f
      where f.account_id = lm.account_id and f.channel = 'linkedin' and f.level = lm.level
        and f.grain = lm.grain and f.entity_id = lm.entity_id and f.period_start = lm.period_start
    );

-- ── Controle ────────────────────────────────────────────────────────────────
-- Draai hierna scripts/check-view-dekking.mjs opnieuw voor de volledige, gezaghebbende vergelijking.

select 'ads_account_monthly' as naam,
       (select count(*) from ads_account_monthly) as via_view,
       (select count(*) from ads_account_monthly_legacy) as in_tabel
union all
select 'ads_campaign_monthly',
       (select count(*) from ads_campaign_monthly),
       (select count(*) from ads_campaign_monthly_legacy)
union all
select 'meta_account_daily',
       (select count(*) from meta_account_daily),
       (select count(*) from meta_account_daily_legacy)
union all
select 'meta_campaign_daily',
       (select count(*) from meta_campaign_daily),
       (select count(*) from meta_campaign_daily_legacy)
union all
select 'meta_ad_daily',
       (select count(*) from meta_ad_daily),
       (select count(*) from meta_ad_daily_legacy)
union all
select 'linkedin_account_daily',
       (select count(*) from linkedin_account_daily),
       (select count(*) from linkedin_account_daily_legacy)
union all
select 'linkedin_campaign_daily',
       (select count(*) from linkedin_campaign_daily),
       (select count(*) from linkedin_campaign_daily_legacy)
union all
select 'linkedin_creative_daily',
       (select count(*) from linkedin_creative_daily),
       (select count(*) from linkedin_creative_daily_legacy);

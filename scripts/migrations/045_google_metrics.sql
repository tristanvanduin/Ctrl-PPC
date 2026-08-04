-- 045: de kanaaleigen metrieken voor Google. Migratie 041 bouwde ze voor Meta en LinkedIn en
-- sloeg Google over.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief: één nieuwe tabel, gevuld uit de
-- bestaande. Geen bestaande tabel of rij wordt aangeraakt en geen regel code leest hem nog.
-- Terugdraaien is `drop table google_metrics`.
--
-- ── WAAROM DIT ER MOET ZIJN VOOR FASE 3 ─────────────────────────────────────
--
-- Fase 3 hernoemt ads_campaign_monthly naar _legacy en zet er een view overheen. Die view moet
-- ELKE kolom teruggeven die de app vandaag opvraagt, anders breekt een lezer. Geteld welke
-- kolommen fact_core niet kan leveren:
--
--   ads_account_monthly   14 kolommen, alle 14 gedekt (5 grootheden + 5 afgeleide + sleutels)
--   ads_campaign_monthly  26 kolommen, 9 NIET gedekt
--
-- Die negen: campaign_status, campaign_type, video_views, avg_cpv, video_view_rate en de vier
-- videokwartielen. Drie ervan (avg_cpv, video_view_rate, avg_cpm) zijn afgeleid en horen dus
-- nergens opgeslagen — de view rekent ze uit. Blijven over: zes echte kolommen zonder huis.
--
-- ── WAAROM DAT NIET "DODE KOLOMMEN" ZIJN ────────────────────────────────────
--
-- Gemeten op de 4707 rijen die er nu staan:
--
--   campaign_status   4707 van 4707 gevuld
--   campaign_type        0 van 4707
--   video_views          0 van 4707 (idem avg_cpv, view_rate en alle vier de kwartielen)
--
-- Dat leest als "leeg, dus weg te laten". Dat is de verkeerde conclusie, en het scheelde weinig
-- of ik had hem getrokken. De reden dat ze leeg zijn is niet dat Google ze niet levert, maar dat
-- deze 4707 rijen door scripts/backfill-google-ads.ts zijn geschreven en dat script vult ze
-- niet — kijk maar naar de kolomlijst rond regel 330. De LIVE sync in lib/sync/orchestrator.ts
-- (regel 522) schrijft ze wél, alle zeven.
--
-- Er is dus nog geen echte sync gedraaid met de huidige code. Zodra dat gebeurt lopen deze
-- kolommen vol. Een view die ze op 0 vastzet zou het videoscherm permanent leeg houden, en dat
-- scherm filtert op `.gt("video_views", 0)` — het zou geen fout geven, alleen niets tonen. Precies
-- de vorm die hier eerder is langsgekomen: afwezigheid die zich voordoet als een gemeten uitkomst.
--
-- ── WAT ER NIET IN ZIT, EN WAAROM ───────────────────────────────────────────
--
-- avg_cpm, avg_cpv en video_view_rate zijn quotiënten van kolommen die we al hebben:
--
--   avg_cpm         = cost / impressions * 1000
--   avg_cpv         = cost / video_views
--   video_view_rate = video_views / impressions
--
-- Zelfde regel als in 041, en om dezelfde reden: §1.4 van het ontwerp telt 552 rijen waar de
-- opgeslagen conversion_rate niet klopt met zijn eigen invoer. Een verhouding naast zijn
-- componenten bewaren is een tweede waarheid die gaat afdrijven. De view rekent ze uit.
--
-- ── EEN TEKSTKOLOM IN EEN METRIEKTABEL ──────────────────────────────────────
--
-- campaign_status en campaign_type zijn geen metrieken maar eigenschappen. Ze staan hier toch,
-- op dezelfde grond als quality_ranking in meta_metrics (zie 041): de bron levert ze op de
-- fact-korrel, ze zijn met zijn tweeën, en een aparte entiteitstabel voor twee tekstvelden kost
-- meer dan hij oplevert. Komt er ooit een derde en een vierde, dan is dat het moment.

create table if not exists google_metrics (
  account_id     uuid not null references accounts(id) on delete cascade,
  level          text not null check (level in ('account','campaign','adgroup','creative')),
  entity_id      text not null default '',
  grain          text not null check (grain in ('day','week','month')),
  period_start   date not null,

  -- eigenschappen die de bron op deze korrel meelevert
  campaign_status text,
  campaign_type   text,

  -- video: de tellingen zelf, niet de verhoudingen ertussen
  video_views        bigint,
  video_quartile_p25 bigint,
  video_quartile_p50 bigint,
  video_quartile_p75 bigint,
  video_quartile_p100 bigint,

  primary key (account_id, level, entity_id, grain, period_start)
);

create index if not exists idx_google_metrics_periode
  on google_metrics (account_id, grain, period_start desc);

-- ── Vullen ──────────────────────────────────────────────────────────────────
--
-- Alleen campagneniveau: ads_account_monthly draagt geen van deze kolommen. De sleutel is gelijk
-- aan die van fact_core voor google/campaign/month (migratie 036), zodat een join altijd één op
-- één is: entity_id = coalesce(campaign_id,''), period_start = month.

insert into google_metrics (account_id, level, entity_id, grain, period_start,
  campaign_status, campaign_type,
  video_views, video_quartile_p25, video_quartile_p50, video_quartile_p75, video_quartile_p100)
select a.id, 'campaign', coalesce(s.campaign_id,''), 'month', s.month,
  s.campaign_status, s.campaign_type,
  s.video_views, s.video_quartile_p25, s.video_quartile_p50, s.video_quartile_p75,
  s.video_quartile_p100
from ads_campaign_monthly s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do update
  set campaign_status = excluded.campaign_status,
      campaign_type = excluded.campaign_type,
      video_views = excluded.video_views,
      video_quartile_p25 = excluded.video_quartile_p25,
      video_quartile_p50 = excluded.video_quartile_p50,
      video_quartile_p75 = excluded.video_quartile_p75,
      video_quartile_p100 = excluded.video_quartile_p100;

-- ── Controle ────────────────────────────────────────────────────────────────
--
-- Het rijaantal hoort gelijk te zijn aan het aantal onderscheiden (klant, campagne, maand) in de
-- bron. Wijkt het af, dan botsen er rijen op de sleutel en verdwijnt er stil data — dezelfde fout
-- die bij fact_dimension drie rondes kostte om te vinden.

select
  (select count(*) from google_metrics) as in_google_metrics,
  (select count(distinct (s.client_id, coalesce(s.campaign_id,''), s.month))
     from ads_campaign_monthly s join accounts a on a.client_id = s.client_id) as verwacht,
  (select count(*) from google_metrics g
     where not exists (select 1 from fact_core f
       where f.account_id = g.account_id and f.channel = 'google' and f.level = 'campaign'
         and f.entity_id = g.entity_id and f.grain = 'month' and f.period_start = g.period_start)
  ) as wezen_zonder_fact_core;

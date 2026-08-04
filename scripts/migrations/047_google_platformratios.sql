-- 047: de door Google berekende verhoudingen gaan mee in google_metrics, en de kandidaat-views
-- dragen ze door in plaats van ze zelf uit te rekenen.
--
-- DRAAIEN: idempotent, veilig te herhalen. Additief (kolommen erbij) plus een herdefinitie van de
-- twee kandidaat-views uit 046, die door niets gelezen worden.
--
-- ── EEN CORRECTIE OP MIJN EIGEN REDENERING ──────────────────────────────────
--
-- Migratie 046 rekende ctr, avg_cpc, cost_per_conversion, conversion_rate en roas uit in de view,
-- met als grond: een verhouding naast zijn componenten bewaren is een tweede waarheid die gaat
-- afdrijven, en §1.4 van het ontwerp telt 552 rijen waar de opgeslagen conversion_rate niet klopt
-- met zijn eigen invoer.
--
-- Die 552 rijen bestaan. De gevolgtrekking eruit was verkeerd.
--
-- Toen ik de kandidaat-view naast de tabel legde weken er 682 rijen af. Gesplitst naar
-- campagnesoort:
--
--   smalle campagnes (search, shopping)          262 van 3725    7,0 %
--   brede campagnes (PMax, video, display)       420 van  865   48,6 %
--
-- En in de tien grootste afwijkingen stond zeven keer "Performance Max". De impliciete noemer
-- verraadt waarom: bij "NL-MPC - Performance Max - Catch.All" horen 350 klikken bij een opgeslagen
-- ratio van 3,32 %, wat neerkomt op 1379 noemer-eenheden. Dat is geen klikken.
--
-- Het is de definitie van Google. `Conv. rate` = conversies / INTERACTIES, en bij Performance Max,
-- video en display tellen engagements en videoweergaven als interactie. Wij slaan interacties niet
-- op. De opgeslagen ratio is dus niet afgedreven — hij heeft een noemer die wij niet hebben.
--
-- Was ik met 046 doorgegaan naar de hernoeming, dan had de conversieratio van elke PMax-campagne
-- er twee tot tien keer te hoog in gestaan. Geen foutmelding, geen lege grafiek: gewoon een beter
-- ogend getal. Dat is de gevaarlijkste soort.
--
-- ── DE REGEL DIE ER AL WAS, OP DE JUISTE MANIER TOEGEPAST ───────────────────
--
-- Migratie 041 schreef het al op: verhoudingen die het platform zelf berekent op een manier die
-- wij niet kunnen reproduceren, blijven bewaard — hook_rate, hold_rate, form_completion_rate. Ik
-- had conversion_rate aan de verkeerde kant van die regel gezet.
--
-- Het onderscheid is niet "afgeleid of niet". Het is: kunnen wij het uit onze eigen kolommen
-- terugrekenen? Zo ja, dan is opslaan een tweede waarheid. Zo nee, dan is opslaan de enige manier
-- om het te hebben, en dan hoort erbij te staan dat het van het platform komt.
--
-- Wat aan die kant valt, gemeten buiten de afrondingsmarge (de bron rondt op vier decimalen):
--
--   avg_cpc              0 afwijkingen van 4590   — kosten/klikken, exact reproduceerbaar
--   ctr                104 van 4590               — klein, maar niet nul
--   conversion_rate    827 van 3299                — de interactie-noemer
--   cost_per_conversion 606 van 3299
--
-- avg_cpc is dus wél te berekenen. Hij gaat hier tóch mee, want een kolom die soms uit de bron komt
-- en soms uit een som is later niet meer uit elkaar te houden. Eén regel per tabel is te
-- onderhouden; een regel per kolom is dat niet.
--
-- roas is de uitzondering aan de andere kant: die berekent de sync zelf al (zie orchestrator.ts,
-- `roas: roas(c.conversionsValue, c.cost)`), dus daar is de opgeslagen waarde per definitie onze
-- eigen som. Die blijft berekend in de view.

alter table google_metrics add column if not exists ctr                 numeric;
alter table google_metrics add column if not exists avg_cpc             numeric;
alter table google_metrics add column if not exists cost_per_conversion numeric;
alter table google_metrics add column if not exists conversion_rate     numeric;
alter table google_metrics add column if not exists avg_cpm             numeric;
alter table google_metrics add column if not exists avg_cpv             numeric;
alter table google_metrics add column if not exists video_view_rate     numeric;

comment on column google_metrics.conversion_rate is
  'Zoals Google hem levert: conversies / interacties. Niet conversies / klikken — bij PMax, video '
  'en display tellen engagements mee als interactie en die noemer slaan wij niet op.';

-- ── Vullen: campagneniveau ──────────────────────────────────────────────────

update google_metrics g set
  ctr = s.ctr, avg_cpc = s.avg_cpc, cost_per_conversion = s.cost_per_conversion,
  conversion_rate = s.conversion_rate, avg_cpm = s.avg_cpm, avg_cpv = s.avg_cpv,
  video_view_rate = s.video_view_rate
from ads_campaign_monthly s join accounts a on a.client_id = s.client_id
where g.account_id = a.id and g.level = 'campaign' and g.grain = 'month'
  and g.entity_id = coalesce(s.campaign_id, '') and g.period_start = s.month;

-- ── Vullen: accountniveau ───────────────────────────────────────────────────
--
-- ads_account_monthly draagt geen videokolommen maar wel dezelfde vijf verhoudingen, en die
-- hebben hetzelfde probleem. Zonder deze rijen zou de accountview ze moeten berekenen en precies
-- dezelfde fout maken, één niveau hoger.

insert into google_metrics (account_id, level, entity_id, grain, period_start,
       ctr, avg_cpc, cost_per_conversion, conversion_rate)
select a.id, 'account', '', 'month', s.month,
       s.ctr, s.avg_cpc, s.cost_per_conversion, s.conversion_rate
from ads_account_monthly s join accounts a on a.client_id = s.client_id
on conflict (account_id, level, entity_id, grain, period_start) do update
  set ctr = excluded.ctr, avg_cpc = excluded.avg_cpc,
      cost_per_conversion = excluded.cost_per_conversion,
      conversion_rate = excluded.conversion_rate;

-- ── De views opnieuw, nu dragend in plaats van rekenend ─────────────────────

drop view if exists kandidaat_ads_account_monthly;
create view kandidaat_ads_account_monthly as
select
  null::uuid                                as id,
  a.client_id,
  f.period_start                            as month,
  f.impressions,
  f.clicks,
  f.cost,
  f.conversions,
  f.conv_value                              as conversions_value,
  g.ctr,
  g.avg_cpc,
  g.cost_per_conversion,
  g.conversion_rate,
  f.conv_value / nullif(f.cost, 0)          as roas,   -- onze eigen som, zie boven
  f.synced_at                               as created_at
from fact_core f
join accounts a on a.id = f.account_id
left join google_metrics g
  on g.account_id = f.account_id and g.level = 'account' and g.entity_id = ''
 and g.grain = 'month' and g.period_start = f.period_start
where f.channel = 'google' and f.level = 'account' and f.grain = 'month';

drop view if exists kandidaat_ads_campaign_monthly;
create view kandidaat_ads_campaign_monthly as
select
  null::uuid                                as id,
  a.client_id,
  f.entity_id                               as campaign_id,
  f.entity_name                             as campaign_name,
  g.campaign_status,
  f.period_start                            as month,
  f.impressions,
  f.clicks,
  f.cost,
  f.conversions,
  f.conv_value                              as conversions_value,
  g.ctr,
  g.avg_cpc,
  g.cost_per_conversion,
  g.conversion_rate,
  f.conv_value / nullif(f.cost, 0)          as roas,
  f.synced_at                               as created_at,
  g.avg_cpm,
  g.campaign_type,
  g.video_views,
  g.avg_cpv,
  g.video_view_rate,
  g.video_quartile_p25,
  g.video_quartile_p50,
  g.video_quartile_p75,
  g.video_quartile_p100
from fact_core f
join accounts a on a.id = f.account_id
left join google_metrics g
  on g.account_id = f.account_id and g.level = 'campaign'
 and g.entity_id = f.entity_id and g.grain = 'month' and g.period_start = f.period_start
where f.channel = 'google' and f.level = 'campaign' and f.grain = 'month';

-- ── Controle ────────────────────────────────────────────────────────────────
--
-- Nu hoort ELKE kolom gelijk te zijn, ook de verhoudingen. Wat hier overblijft is geen
-- verklaarbaar verschil meer maar een fout.

select
  (select count(*) from ads_campaign_monthly)           as rijen_tabel,
  (select count(*) from kandidaat_ads_campaign_monthly) as rijen_view,
  (select count(*) from ads_campaign_monthly t
     join kandidaat_ads_campaign_monthly v
       on v.client_id = t.client_id and v.campaign_id = coalesce(t.campaign_id,'') and v.month = t.month
     where coalesce(t.conversion_rate,-1) <> coalesce(v.conversion_rate,-1)
        or coalesce(t.ctr,-1)             <> coalesce(v.ctr,-1)
        or coalesce(t.avg_cpc,-1)         <> coalesce(v.avg_cpc,-1)
        or coalesce(t.cost_per_conversion,-1) <> coalesce(v.cost_per_conversion,-1)
        or coalesce(t.campaign_status,'') <> coalesce(v.campaign_status,'')
  ) as afwijkende_rijen;

-- 046: kandidaat-views voor de twee Google-maandtabellen. NOG GEEN hernoeming.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief: twee views onder een NIEUWE naam
-- (`kandidaat_*`). Geen bestaande tabel wordt hernoemd, geen regel code leest ze.
-- Terugdraaien is `drop view kandidaat_ads_account_monthly, kandidaat_ads_campaign_monthly`.
--
-- ── WAAROM EERST EEN KANDIDAAT ──────────────────────────────────────────────
--
-- Fase 3 uit docs/ONTWERP_multitenant_schema.md hernoemt `ads_campaign_monthly` naar `_legacy` en
-- zet er een view met de oude naam overheen. Vanaf dat moment lezen 24 aanroepen in de app door
-- die view. Als de view één kolom mist of één som anders telt, merk je dat aan een grafiek die
-- iets anders zegt — niet aan een foutmelding.
--
-- Daarom eerst dezelfde view onder een andere naam, naast de tabel. Dan is de vergelijking te
-- MAKEN in plaats van te beloven: scripts/check-view-dekking.mjs zet de kolomlijsten en de sommen
-- van `kandidaat_X` en `X` naast elkaar. Pas als dat schoon is, is de hernoeming een
-- administratieve handeling in plaats van een gok.
--
-- ── WAT ER BEWUST ANDERS UITKOMT ────────────────────────────────────────────
--
-- De afgeleide kolommen (ctr, avg_cpc, cost_per_conversion, conversion_rate, roas, avg_cpm)
-- worden hier BEREKEND, terwijl de tabel ze OPGESLAGEN heeft. Die twee zijn het niet overal met
-- elkaar eens, en dat is precies de reden dat het ontwerp ze niet meeneemt: §1.4 telt 552 rijen
-- waar de opgeslagen conversion_rate niet klopt met zijn eigen clicks en conversions.
--
-- De view is daar dus niet minder trouw, maar meer. Het verschil hoort wel geteld te worden
-- voordat het op een scherm verschijnt, en dat doet de controle onderaan.
--
-- Delen door nul geeft NULL, geen 0. Een campagne zonder klikken HEEFT geen CPC; daar 0 van maken
-- is een gemeten nul verzinnen waar een leegte hoort te staan.
--
-- ── DE KOLOMMEN DIE UIT google_metrics KOMEN ────────────────────────────────
--
-- campaign_status, campaign_type en de videokolommen staan sinds migratie 045 in `google_metrics`.
-- De join daarop is LEFT: een campagnemaand zonder metriekrij hoort een rij te blijven met lege
-- videovelden, niet te verdwijnen.

drop view if exists kandidaat_ads_account_monthly;
create view kandidaat_ads_account_monthly as
select
  null::uuid                                          as id,
  a.client_id,
  f.period_start                                      as month,
  f.impressions,
  f.clicks,
  f.cost,
  f.conversions,
  f.conv_value                                        as conversions_value,
  f.clicks::numeric     / nullif(f.impressions, 0)    as ctr,
  f.cost                / nullif(f.clicks, 0)         as avg_cpc,
  f.cost                / nullif(f.conversions, 0)    as cost_per_conversion,
  f.conversions         / nullif(f.clicks, 0)         as conversion_rate,
  f.conv_value          / nullif(f.cost, 0)           as roas,
  f.synced_at                                         as created_at
from fact_core f
join accounts a on a.id = f.account_id
where f.channel = 'google' and f.level = 'account' and f.grain = 'month';

drop view if exists kandidaat_ads_campaign_monthly;
create view kandidaat_ads_campaign_monthly as
select
  null::uuid                                          as id,
  a.client_id,
  f.entity_id                                         as campaign_id,
  f.entity_name                                       as campaign_name,
  g.campaign_status,
  f.period_start                                      as month,
  f.impressions,
  f.clicks,
  f.cost,
  f.conversions,
  f.conv_value                                        as conversions_value,
  f.clicks::numeric     / nullif(f.impressions, 0)    as ctr,
  f.cost                / nullif(f.clicks, 0)         as avg_cpc,
  f.cost                / nullif(f.conversions, 0)    as cost_per_conversion,
  f.conversions         / nullif(f.clicks, 0)         as conversion_rate,
  f.conv_value          / nullif(f.cost, 0)           as roas,
  f.synced_at                                         as created_at,
  f.cost * 1000         / nullif(f.impressions, 0)    as avg_cpm,
  g.campaign_type,
  g.video_views,
  f.cost                / nullif(g.video_views, 0)    as avg_cpv,
  g.video_views::numeric / nullif(f.impressions, 0)   as video_view_rate,
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
-- Rijaantallen en de vijf grootheden moeten exact gelijk zijn. De afgeleide kolommen mogen
-- afwijken; hoeveel, dat is wat de laatste kolom telt. Die telling hoort niet nul te zijn — hij
-- hoort BEKEND te zijn.

select 'ads_campaign_monthly' as tabel,
  (select count(*) from ads_campaign_monthly)           as rijen_tabel,
  (select count(*) from kandidaat_ads_campaign_monthly) as rijen_view,
  (select round(sum(cost), 2) from ads_campaign_monthly)           as kosten_tabel,
  (select round(sum(cost), 2) from kandidaat_ads_campaign_monthly) as kosten_view,
  (select count(*) from ads_campaign_monthly t
     join accounts a on a.client_id = t.client_id
     join kandidaat_ads_campaign_monthly v
       on v.client_id = t.client_id and v.campaign_id = coalesce(t.campaign_id,'')
      and v.month = t.month
     where abs(coalesce(t.conversion_rate,0) - coalesce(v.conversion_rate,0)) > 0.0001
  ) as afgeleide_afwijkingen;

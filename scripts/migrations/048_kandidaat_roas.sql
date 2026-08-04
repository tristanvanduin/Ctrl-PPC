-- 048: de roas-kolom in de kandidaat-views precies zoals de sync hem schrijft.
--
-- DRAAIEN: idempotent, veilig te herhalen. Herdefinieert twee views die door niets gelezen worden.
--
-- ── WAT DE VOLLEDIGE RIJVERGELIJKING VOND ───────────────────────────────────
--
-- Migratie 047 eindigde op nul afwijkingen, maar die controle keek naar vijf kolommen die ik zelf
-- had uitgekozen. scripts/check-view-dekking.mjs vergelijkt HELE RIJEN met `except all`, en dat gaf
-- meteen 590 van 775 en 3142 van 4707. Per kolom uitgesplitst bleef er precies één over:
--
--   roas   590 van 775 (account), 3142 van 4707 (campagne)
--
-- Dat is het verschil tussen een controle die bevestigt wat je al dacht en een controle die zoekt.
-- Mijn eigen lijstje kon roas niet vinden omdat roas er niet op stond.
--
-- ── DE TWEE VERSCHILLEN ─────────────────────────────────────────────────────
--
-- De sync schrijft roas met deze regel (lib/sync/orchestrator.ts:122, en identiek in
-- scripts/backfill-google-ads.ts:294):
--
--     cost > 0 ? parseFloat((value / cost).toFixed(4)) : 0
--
-- Daar zitten twee dingen in die de view niet deed. De uitkomst wordt AFGEROND op vier decimalen,
-- en bij nul kosten komt er 0 uit en niet NULL.
--
-- ── DAT TWEEDE IS EEN FOUT, EN HIJ BLIJFT STAAN ─────────────────────────────
--
-- Een campagne zonder kosten HEEFT geen ROAS. Daar 0 van maken is een leegte die zich voordoet als
-- een gemeten uitkomst — dezelfde vorm die eerder in dit project is langsgekomen bij safeDiv, waar
-- vier van de vijf varianten 0 teruggaven bij een oneindige noemer.
--
-- Toch staat hij hier gewoon in. De opdracht van fase 3 is dat de view teruggeeft wat de tabel nu
-- teruggeeft, niets anders. Een view die stilletjes iets beters doet is precies wat er bij
-- conversion_rate bijna misging: dat leek ook een verbetering en was het niet. Zolang de app door
-- deze view leest hoort ze exact hetzelfde te zien.
--
-- Repareren mag, maar dan als eigen wijziging, met de schermen die het raken erbij en zichtbaar
-- voor de gebruiker — fase 4, per scherm, niet verstopt in een migratie.

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
  case when f.cost > 0 then round((f.conv_value / f.cost)::numeric, 4) else 0 end as roas,
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
  case when f.cost > 0 then round((f.conv_value / f.cost)::numeric, 4) else 0 end as roas,
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

select 'draai nu scripts/check-view-dekking.mjs' as volgende_stap;

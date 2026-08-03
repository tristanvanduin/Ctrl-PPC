-- 042: het creative-niveau ontbrak in fact_core.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief.
--
-- ── DE FOUT ─────────────────────────────────────────────────────────────────
--
-- Migratie 036 vulde fact_core op account- en campagneniveau en sloeg creative over. Migratie 041
-- vulde meta_metrics en linkedin_metrics wél op alle drie de niveaus. Netto stonden er 256
-- Meta-creatives en 92 LinkedIn-creatives in de metriektabellen zonder rij in fact_core.
--
-- Dat is precies het soort gat dat het ontwerp moet voorkomen, want de metriektabel is per
-- definitie een aanvulling: hij draagt geen impressies, klikken of kosten. Zonder de kern-rij is
-- een creative-metriek onbruikbaar — je weet dan wel de hook_rate maar niet waarvan.
--
-- Gevonden door de join uit te voeren die creative fatigue straks doet:
--
--   select ... from fact_core c join meta_metrics m using (...)
--   where c.channel='meta' and c.level='creative'
--   → 0 rijen
--
-- Rijaantallen klopten, sommen klopten, en toch was het stuk. Alleen de join liet het zien.
-- Vandaar dat verify-fact-core.mjs er nu een wezencontrole bij heeft.

insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'meta', 'creative', coalesce(s.entity_id,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks_all,0), coalesce(s.spend,0),
       coalesce(s.conversions,0) + coalesce(s.leads,0), coalesce(s.conversion_value,0)
from meta_ad_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

insert into fact_core (account_id, channel, level, entity_id, grain, period_start,
                       impressions, clicks, cost, conversions, conv_value)
select a.id, 'linkedin', 'creative', coalesce(s.entity_urn,''), 'day', s.date,
       coalesce(s.impressions,0), coalesce(s.clicks,0), coalesce(s.spend,0),
       coalesce(s.one_click_leads,0) + coalesce(s.external_website_conversions,0),
       coalesce(s.conversion_value,0)
from linkedin_creative_daily s join accounts a on a.client_id = s.client_id
on conflict (account_id, channel, level, entity_id, grain, period_start) do update
  set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now();

-- De rollups opnieuw, want er zijn dagen bijgekomen op een niveau dat er nog niet was.
select * from refresh_rollups();

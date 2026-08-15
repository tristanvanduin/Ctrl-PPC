-- 079: refresh_rollups() meeneemt de vijf kolommen uit migratie 075/076.
--
-- DRAAIEN: idempotent. Vervangt de functie; verandert geen bestaande rij totdat hij draait.
--
-- ── WAT ER STUK GING ─────────────────────────────────────────────────────────
--
-- refresh_rollups() rolt dag-rijen in fact_core op naar week en maand (migratie 037/038), los
-- van refresh_fact_from_legacy() -- de laatste roept de eerste alleen aan het eind aan. Migratie
-- 078 breidde refresh_fact_from_legacy() uit met de vijf kolommen uit 075/076, maar
-- refresh_rollups() bleef bij zijn oorspronkelijke INSERT staan, zonder die kolommen. Zodra
-- fact_core.agency_id NOT NULL werd (migratie 076), brak dat deze functie meteen: de eerste
-- aanroep op een klant met Meta- of LinkedIn-dagdata (die wél week/maand-oprolling nodig hebben)
-- gaf `null value in column "agency_id" violates not-null constraint`. Gevangen tijdens het
-- testen van migratie 078 op de demo-klant, vóór dit ooit op een echte klant kon raken.
--
-- ── DE KEUZES PER KOLOM ───────────────────────────────────────────────────────
--
-- agency_id, client_id   Identiek voor elke dag-rij van hetzelfde account. Eerste poging was
--                        `max(agency_id)` binnen de aggregatie -- Postgres heeft geen ingebouwde
--                        max()-aggregatie voor het type uuid, dus dat brak meteen
--                        (`function max(uuid) does not exist`). Rechtstreeks joinen naar accounts
--                        is bovendien correcter dan aggregeren over dagrijen: geen aanname dat de
--                        dagrijen het onderling eens zijn, gewoon de bron erbij.
-- leads                  Optelbaar, net als conversions en conv_value: sum().
-- data_quality_score     Niet optelbaar. min(): een week is niet beter dan zijn zwakste dag.
--                        Vandaag overal 1.0, dus dit heeft nu geen zichtbaar effect -- het is de
--                        juiste regel te hebben zodra een lagere score ooit geschreven wordt.
-- source_table           Identiek binnen een groep (channel+level bepaalt de brontabel), dus
--                        max() geeft een representatieve waarde zonder verzonnen precisie (text
--                        heeft wel een ingebouwde max()-aggregatie, in tegenstelling tot uuid).

create or replace function refresh_rollups(p_account uuid default null::uuid, p_vanaf date default null::date)
returns table(korrel text, rijen bigint)
language plpgsql
as $$
begin
  delete from fact_core f
  where f.grain in ('week','month')
    and (p_account is null or f.account_id = p_account)
    and (p_vanaf is null or f.period_start >= date_trunc('month', p_vanaf)::date)
    and exists (
      select 1 from fact_core d
      where d.account_id = f.account_id
        and d.channel = f.channel
        and d.level = f.level
        and d.entity_id = f.entity_id
        and d.grain = 'day'
        and d.period_start >= f.period_start
        and d.period_start < case f.grain
              when 'week'  then f.period_start + interval '7 days'
              else              f.period_start + interval '1 month'
            end
    );

  return query
  with dagen as (
    select * from fact_core d
    where d.grain = 'day'
      and (p_account is null or d.account_id = p_account)
      and (p_vanaf is null or d.period_start >= date_trunc('month', p_vanaf)::date)
  ),
  ingevoegd as (
    insert into fact_core (account_id, channel, level, entity_id, entity_name, grain, period_start,
                           impressions, clicks, cost, conversions, conv_value,
                           agency_id, client_id, source_table, leads, data_quality_score)
    select d.account_id, d.channel, d.level, d.entity_id, max(d.entity_name), 'week',
           date_trunc('week', d.period_start)::date,
           sum(d.impressions), sum(d.clicks), sum(d.cost), sum(d.conversions), sum(d.conv_value),
           a.agency_id, a.client_id, max(d.source_table), sum(d.leads), min(d.data_quality_score)
    from dagen d join accounts a on a.id = d.account_id
    group by d.account_id, d.channel, d.level, d.entity_id, date_trunc('week', d.period_start),
             a.agency_id, a.client_id
    union all
    select d.account_id, d.channel, d.level, d.entity_id, max(d.entity_name), 'month',
           date_trunc('month', d.period_start)::date,
           sum(d.impressions), sum(d.clicks), sum(d.cost), sum(d.conversions), sum(d.conv_value),
           a.agency_id, a.client_id, max(d.source_table), sum(d.leads), min(d.data_quality_score)
    from dagen d join accounts a on a.id = d.account_id
    group by d.account_id, d.channel, d.level, d.entity_id, date_trunc('month', d.period_start),
             a.agency_id, a.client_id
    on conflict (account_id, channel, level, entity_id, grain, period_start) do update
      set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
          conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now(),
          agency_id = excluded.agency_id, client_id = excluded.client_id,
          source_table = excluded.source_table, leads = excluded.leads,
          data_quality_score = excluded.data_quality_score
    returning fact_core.grain
  )
  select i.grain::text, count(*) from ingevoegd i group by i.grain;
end;
$$;

revoke execute on function refresh_rollups(uuid, date) from public, anon, authenticated;
grant execute on function refresh_rollups(uuid, date) to service_role;

-- 038: refresh_rollups mag geen historie kunnen wissen.
--
-- DRAAIEN: idempotent, veilig te herhalen. Vervangt alleen de functie uit 037; er wordt geen
-- tabel of rij aangeraakt.
--
-- ── DE FOUT IN 037 ──────────────────────────────────────────────────────────
--
-- De delete daarin luidde, versimpeld:
--
--   delete from fact_core f
--   where f.grain in ('week','month')
--     and exists (select 1 from fact_core d
--                 where d.account_id = f.account_id and d.channel = f.channel
--                   and d.level = f.level and d.grain = 'day');
--
-- Die `exists` kijkt of er ÉRGENS dagrijen zijn voor dat account, kanaal en niveau — niet of er
-- dagrijen zijn in de periode van de rij die verwijderd wordt.
--
-- Zolang alle dagen bewaard blijven maakt dat niets uit. Maar dagdetail is precies wat je op
-- termijn gaat opruimen: op dagkorrel loopt fact_dimension richting 39 miljoen rijen per jaar bij
-- 400 accounts (zie §1.7 van het ontwerp). Zodra iemand de dagen van 2024 weggooit en daarna deze
-- functie draait, gebeurt er dit:
--
--   1. de week- en maandrijen van 2024 worden verwijderd, want het account heeft nog dagrijen
--      (van 2026) en de exists slaat aan;
--   2. ze worden niet opnieuw aangemaakt, want er zijn geen dagen van 2024 meer om uit op te
--      tellen.
--
-- Netto: de samengevatte historie is weg, en niets meldt dat. Dat is het tegenovergestelde van
-- wat deze tabel moet doen — de waarde van dit product zit juist in de opgebouwde reeks, en die
-- reeks moet lánger worden, niet korter.
--
-- Dezelfde afweging die de sync al maakt met upsertBatch tegenover replaceBatch: bijwerken wat in
-- het venster valt en laten staan wat erbuiten ligt. Zie de toelichting bij upsertBatch in
-- lib/sync/orchestrator.ts.
--
-- ── DE CORRECTIE ────────────────────────────────────────────────────────────
--
-- Een afgeleide rij wordt alleen verwijderd als er dagrijen bestaan BINNEN ZIJN EIGEN PERIODE.
-- Geen dagen in die periode betekent: er valt niets te herberekenen, dus laat staan wat er is.
--
-- Gevolg dat je moet kennen: een week- of maandrij waarvan de dagen zijn opgeruimd, bevriest op
-- zijn laatst berekende waarde. Dat is juist — hij is dan een archiefwaarde en geen afgeleide
-- meer — maar hij wordt daarmee ook niet meer gecorrigeerd als er iets aan die oude periode zou
-- veranderen. Dat kan niet meer zodra de dagen weg zijn, dus dat is geen verlies.

create or replace function refresh_rollups(p_account uuid default null, p_vanaf date default null)
returns table (korrel text, rijen bigint)
language plpgsql
as $$
begin
  delete from fact_core f
  where f.grain in ('week','month')
    and (p_account is null or f.account_id = p_account)
    and (p_vanaf is null or f.period_start >= date_trunc('month', p_vanaf)::date)
    -- Alleen als er dagen zijn in DEZE periode. Dat is het verschil met 037.
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
                           impressions, clicks, cost, conversions, conv_value)
    select account_id, channel, level, entity_id, max(entity_name), 'week',
           date_trunc('week', period_start)::date,
           sum(impressions), sum(clicks), sum(cost), sum(conversions), sum(conv_value)
    from dagen
    group by account_id, channel, level, entity_id, date_trunc('week', period_start)
    union all
    select account_id, channel, level, entity_id, max(entity_name), 'month',
           date_trunc('month', period_start)::date,
           sum(impressions), sum(clicks), sum(cost), sum(conversions), sum(conv_value)
    from dagen
    group by account_id, channel, level, entity_id, date_trunc('month', period_start)
    on conflict (account_id, channel, level, entity_id, grain, period_start) do update
      set impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
          conversions = excluded.conversions, conv_value = excluded.conv_value, synced_at = now()
    returning fact_core.grain
  )
  select i.grain::text, count(*) from ingevoegd i group by i.grain;
end;
$$;

-- ── Controle ────────────────────────────────────────────────────────────────
-- Opnieuw draaien hoort dezelfde aantallen op te leveren als 037, en het totaal per kanaal
-- moet gelijk blijven aan de dagen.

select * from refresh_rollups();

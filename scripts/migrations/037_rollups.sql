-- 037: week- en maandrijen afgeleid uit de dagrijen van fact_core.
--
-- DRAAIEN: idempotent, veilig te herhalen. Additief: er komen alleen rijen bij in fact_core met
-- grain 'week' of 'month', afgeleid uit grain 'day'. Bestaande rijen worden niet aangeraakt
-- behalve de afgeleide zelf, die bij elke run opnieuw berekend wordt.
--
-- ── WAAROM AFLEIDEN EN NIET APART OPHALEN ───────────────────────────────────
--
-- Week en maand zijn optelsommen van dagen. Ze apart bij de API ophalen kost vier keer zoveel
-- calls voor data die je al hebt, en levert vier reeksen op die uit de pas kunnen lopen. Dat is
-- precies het probleem uit §1.4 van het ontwerp: 552 rijen in ads_campaign_monthly dragen een
-- conversieratio die niet klopt met hun eigen invoer, omdat de ratio los is opgeslagen naast de
-- componenten. Afgeleide rijen die berekend worden kunnen per definitie niet afwijken.
--
-- UITZONDERING voor later: niet elke metriek is optelbaar. Meta's `reach` telt niet op over dagen
-- (dezelfde persoon wordt ontdubbeld) en `frequency` volgt daaruit. Die moeten per korrel bij de
-- API vandaan komen zodra ze gesynct worden. Nu is dat geen probleem: geteld op 160 rijen in
-- meta_account_daily staat `reach` bij nul rijen gevuld. De vijf grootheden in fact_core zijn
-- allemaal wel optelbaar.
--
-- ── WAAROM DIT EEN FUNCTIE IS EN GEEN EENMALIGE INSERT ──────────────────────
--
-- Google schrijft een conversie terug naar de KLIKDATUM, niet de conversiedatum. Klikt iemand op
-- 1 juli en converteert hij op 29 juli, dan verandert de rij van 1 juli met terugwerkende kracht.
-- De sync haalt daarom elke nacht een venster opnieuw op en overschrijft.
--
-- Dat betekent dat een afgeleide week- of maandrij OOK moet worden herberekend zodra een dag in
-- die periode verandert. Een rollup die één keer is berekend en daarna blijft staan, drift weg
-- van zijn eigen bron — en dan hebben we het probleem dat we net hebben opgelost opnieuw, alleen
-- een laag hoger.
--
-- Vandaar een functie met een startdatum: de sync roept hem aan voor het venster dat hij zojuist
-- heeft ververst, en alleen de periodes die dat venster raken worden opnieuw uitgerekend.

create or replace function refresh_rollups(p_account uuid default null, p_vanaf date default null)
returns table (korrel text, rijen bigint)
language plpgsql
as $$
begin
  -- Eerst weg wat we gaan herberekenen. Verwijderen en opnieuw invoegen, en niet upserten:
  -- verdwijnt er een dag uit de bron (een campagne die niet meer draait), dan hoort de
  -- afgeleide week ook te verdwijnen. Een upsert zou die oude som laten staan.
  delete from fact_core f
  where f.grain in ('week','month')
    and (p_account is null or f.account_id = p_account)
    and (p_vanaf is null or f.period_start >= date_trunc('month', p_vanaf)::date)
    -- alleen afgeleide rijen weghalen: er zijn ook maandrijen die RECHTSTREEKS uit de bron komen
    -- (Google levert maand, geen dag). Die mogen hier niet sneuvelen.
    and exists (
      select 1 from fact_core d
      where d.account_id = f.account_id and d.channel = f.channel
        and d.level = f.level and d.grain = 'day'
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
    -- week: date_trunc geeft maandag als eerste dag
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

-- ── Eerste vulling ──────────────────────────────────────────────────────────

select * from refresh_rollups();

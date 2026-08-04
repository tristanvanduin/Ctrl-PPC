-- 056: een bureau zonder gekoppelde gebruikers meldde er één als "nooit actief".
--
-- DRAAIEN: idempotent. Vervangt één functie.
--
-- ── DE FOUT ─────────────────────────────────────────────────────────────────
--
-- De eerste uitvoer van bureau_adoptie(30) gaf dit:
--
--   Demo   gekoppeld 0   actief 0   adoptie -   nooit_actief 1
--
-- Nul gekoppelde gebruikers en toch iemand die nooit actief was. Dat kan niet allebei waar zijn.
-- (Het bureau dat wél gebruikers heeft stond goed; de fout raakt alleen de lege.)
--
-- De oorzaak is de left join: een bureau zonder rijen in user_agencies levert één rij op waarin
-- ua.user_id en act.laatst_actief allebei NULL zijn. `count(ua.user_id)` telt die terecht niet mee
-- -- count over een kolom slaat NULL over -- maar `count(*) filter (where act.laatst_actief is
-- null)` telt hem wél, want count(*) telt rijen en de voorwaarde klopt toevallig.
--
-- Dat is dezelfde vorm die in dit project vaker terugkwam: een leegte die zich voordoet als een
-- gemeten uitkomst. Hier zou het een leeg bureau er slechter uit laten zien dan het is, en juist
-- bij deze functie is dat schadelijk -- het getal is bedoeld om een gesprek met een klant te
-- starten.
--
-- De reparatie is één voorwaarde erbij: alleen tellen waar er ook echt een gekoppelde gebruiker
-- staat.
--
-- Waarom dit een NIEUWE migratie is en geen aanpassing van 055: die is gedraaid. De reeks is een
-- logboek van wat er met de database is gebeurd, en een fout die stilzwijgend uit dat logboek
-- verdwijnt is een fout die iemand over een jaar opnieuw maakt.

create or replace function bureau_adoptie(p_dagen int default 30)
returns table (
  agency_id     uuid,
  bureau        text,
  gekoppeld     int,
  actief        int,
  adoptie       numeric,
  laatst_gezien timestamptz,
  nooit_actief  int
)
language sql
security definer
set search_path = public, auth
as $$
  with actief as (select * from laatst_actief_per_gebruiker())
  select a.id, a.name,
         count(ua.user_id)::int,
         count(*) filter (
           where ua.user_id is not null
             and act.laatst_actief > now() - make_interval(days => p_dagen))::int,
         -- Delen door nul geeft NULL, geen 0: een bureau zonder gekoppelde gebruikers HEEFT geen
         -- adoptiegraad. Daar 0 % van maken leest als "niemand gebruikt het" terwijl er niemand is.
         round(100.0 * count(*) filter (
                 where ua.user_id is not null
                   and act.laatst_actief > now() - make_interval(days => p_dagen))
               / nullif(count(ua.user_id), 0), 0),
         max(act.laatst_actief),
         -- `ua.user_id is not null` is hier de hele reparatie: zonder die voorwaarde telt de lege
         -- rij van de left join mee als een gebruiker die nooit actief was.
         count(*) filter (where ua.user_id is not null and act.laatst_actief is null)::int
  from agencies a
  left join user_agencies ua on ua.agency_id = a.id
  left join actief act on act.user_id = ua.user_id
  group by a.id, a.name
  order by a.name
$$;

revoke execute on function bureau_adoptie(int) from public, anon, authenticated;
grant  execute on function bureau_adoptie(int) to service_role;

-- ── Controle ────────────────────────────────────────────────────────────────
-- Demo hoort nu overal op nul te staan, met een lege adoptiegraad.

select * from bureau_adoptie(30);

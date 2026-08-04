-- 055: adoptie per bureau — het stoplicht voor "wordt dit eigenlijk gebruikt".
--
-- DRAAIEN: idempotent, veilig te herhalen. Twee leesfuncties, geen tabelwijziging.
-- Terugdraaien is `drop function bureau_adoptie(int), gebruiker_activiteit(int)`.
--
-- ── WAT DIT MEET, EN WAAROM DAT VANDAAG AL KAN ──────────────────────────────
--
-- Een bureau dat opzegt doet dat zelden plotseling. Er gaat maanden aan onbenutte licentie aan
-- vooraf: één iemand logt nog in, de rest niet meer. Dat is te zien lang voordat het gesprek komt,
-- en het staat al in de database — Supabase houdt zelf sessies bij.
--
-- Dus: geen nieuwe logging nodig voor het eerste licht. Gekoppelde gebruikers komen uit
-- user_agencies, activiteit uit auth.sessions.
--
-- ── NIET last_sign_in_at, EN DAT IS HET BELANGRIJKSTE HIER ──────────────────
--
-- De voor de hand liggende kolom is auth.users.last_sign_in_at. Die is fout voor dit doel.
--
-- Dat veld beweegt alleen bij een VERSE login. Supabase-sessies leven lang en verversen hun token
-- op de achtergrond, dus iemand die het dashboard elke dag openhoudt kan een last_sign_in_at van
-- drie weken oud hebben. Een stoplicht daarop springt op rood bij je meest actieve gebruiker.
--
-- auth.sessions.refreshed_at beweegt wél mee: die wordt bijgewerkt bij elke tokenvernieuwing, dus
-- tijdens gebruik. updated_at doet hetzelfde en is gevuld vanaf het moment dat de sessie bestaat.
-- We nemen de LAATSTE van die drie: refreshed_at als hij er is, anders updated_at, en
-- last_sign_in_at als ondergrens. Zo telt elke vorm van aanwezigheid mee en geen enkele dubbel.
--
-- Dit is precies het onderscheid dat in dit project vaker terugkwam: een veld dat de goede NAAM
-- draagt maar iets anders meet. "Laatste login" is niet "laatst gebruikt".
--
-- ── SECURITY DEFINER, EN WAAROM DAT HIER MOET ───────────────────────────────
--
-- auth.users en auth.sessions zijn niet leesbaar voor gewone rollen, en dat hoort zo: daar staan
-- e-mailadressen, IP's en user-agents in. De functie draait daarom als eigenaar, geeft alleen
-- GETELDE uitkomsten terug, en het EXECUTE-recht gaat meteen weg bij anon en authenticated.
--
-- De app roept dit aan via een serverroute achter requireCapability("user:manage"). Niet vanuit de
-- browser: dan zou de anon-sleutel het recht moeten hebben, en die zit in elke pagina.
-- scripts/check-rpc-rechten.mjs controleert dat bij elke poortenrun.
--
-- ── OP BUREAUNIVEAU, NIET OP PERSOONSNIVEAU ─────────────────────────────────
--
-- bureau_adoptie geeft aantallen per bureau. Dat is met opzet de eerste functie: "3 van de 12
-- gebruikers actief" stuurt een gesprek met de klant. Een lijst met "Edwin logde 41 dagen niet in"
-- stuurt een beoordelingsgesprek, en dat is een ander gereedschap dan dit.
--
-- gebruiker_activiteit bestaat wel, want een beheerder moet kunnen zien wie hij moet aanspreken en
-- de admin-pagina toont die mensen toch al bij naam. Hij geeft alleen wat daar al staat plus een
-- datum — geen IP, geen user-agent, geen paginageschiedenis.
--
-- Het blijven persoonsgegevens over medewerkers van een klant. Doel: vaststellen of de dienst
-- gebruikt wordt. Er hoort een bewaartermijn bij zodra er echte logging bijkomt; deze twee
-- functies bewaren zelf niets — ze lezen wat Supabase toch al vasthoudt.

-- ── Laatste teken van leven per gebruiker ───────────────────────────────────
-- Als los hulpje, zodat beide functies dezelfde definitie gebruiken. Twee kopieën van "laatst
-- actief" zouden onvermijdelijk uit elkaar lopen.

create or replace function laatst_actief_per_gebruiker()
returns table (user_id uuid, laatst_actief timestamptz)
language sql
security definer
set search_path = public, auth
as $$
  select u.id,
         greatest(
           u.last_sign_in_at,
           (select max(greatest(s.refreshed_at, s.updated_at)) from auth.sessions s where s.user_id = u.id)
         )
  from auth.users u
$$;

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
         count(*) filter (where act.laatst_actief > now() - make_interval(days => p_dagen))::int,
         -- Delen door nul geeft NULL, geen 0: een bureau zonder gekoppelde gebruikers HEEFT geen
         -- adoptiegraad. Daar 0 % van maken leest als "niemand gebruikt het" terwijl er niemand is.
         round(100.0 * count(*) filter (where act.laatst_actief > now() - make_interval(days => p_dagen))
               / nullif(count(ua.user_id), 0), 0),
         max(act.laatst_actief),
         count(*) filter (where act.laatst_actief is null)::int
  from agencies a
  left join user_agencies ua on ua.agency_id = a.id
  left join actief act on act.user_id = ua.user_id
  group by a.id, a.name
  order by a.name
$$;

create or replace function gebruiker_activiteit(p_dagen int default 30)
returns table (
  user_id       uuid,
  email         text,
  bureau        text,
  laatst_actief timestamptz,
  dagen_geleden int,
  actief        boolean
)
language sql
security definer
set search_path = public, auth
as $$
  with act as (select * from laatst_actief_per_gebruiker())
  select u.id, u.email::text, a.name,
         act.laatst_actief,
         case when act.laatst_actief is not null
              then extract(day from now() - act.laatst_actief)::int end,
         act.laatst_actief > now() - make_interval(days => p_dagen)
  from auth.users u
  join act on act.user_id = u.id
  left join user_agencies ua on ua.user_id = u.id
  left join agencies a on a.id = ua.agency_id
  order by act.laatst_actief nulls first
$$;

-- ── Afschermen ──────────────────────────────────────────────────────────────
-- Zelfde patroon als migratie 040. Zonder dit publiceert PostgREST ze als endpoint en geeft
-- Postgres standaard EXECUTE aan PUBLIC — twee defaults die samen betekenen dat een functie die
-- auth.users leest vanuit elke browser aanroepbaar is.

revoke execute on function laatst_actief_per_gebruiker()  from public, anon, authenticated;
revoke execute on function bureau_adoptie(int)            from public, anon, authenticated;
revoke execute on function gebruiker_activiteit(int)      from public, anon, authenticated;
grant  execute on function laatst_actief_per_gebruiker()  to service_role;
grant  execute on function bureau_adoptie(int)            to service_role;
grant  execute on function gebruiker_activiteit(int)      to service_role;

-- ── Controle ────────────────────────────────────────────────────────────────

select * from bureau_adoptie(30);

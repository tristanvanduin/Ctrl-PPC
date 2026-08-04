-- 057: toegang wordt bureau-gebonden. Voorwaarde voor fase 5 en voor meerdere bureaus.
--
-- DRAAIEN: idempotent. Eén nieuwe tabel en vier functies; geen bestaande rij verandert en geen
-- policy wordt aangezet. Terugdraaien is de functies terugzetten uit migratie 001 en 017.
--
-- ── HET LEK, AANGETOOND OP ECHTE DATA ───────────────────────────────────────
--
-- De toegangscontrole was tot nu toe ROLGEBONDEN en bureau-blind:
--
--   app_sees_all_clients() = role in ('admin','performance_marketeer','it')
--   app_can_read_client(t) = app_sees_all_clients() or exists(user_clients ... client_id = t)
--
-- Nergens komt het bureau erin voor. Met één bureau valt dat niet op. Met twintig betekent het dat
-- elke performance marketeer bij bureau A de data van bureau B leest.
--
-- Niet beredeneerd maar geproefd. Een wegwerpgebruiker aangemaakt bij bureau Demo, rol
-- performance_marketeer, en daarna zijn JWT nagebootst:
--
--   rol                    performance_marketeer
--   ziet_alles             true
--   mag_bij_ander_bureau   true      <- account van het ANDERE bureau
--   mag_bij_eigen_bureau   true
--
-- Dat is precies het lek dat het bureaumodel uit migratie 035 moest uitsluiten, en het zat in de
-- functie die elke toekomstige RLS-policy aanroept. Was fase 5 aangezet met deze functies, dan was
-- de scheiding er formeel wel en feitelijk niet -- de gevaarlijkste van de twee, want dan denkt
-- iedereen dat het geregeld is.
--
-- ── DE NIEUWE REGEL ─────────────────────────────────────────────────────────
--
-- Toegang tot een klant vereist vanaf nu TWEE dingen:
--
--   1. de klant hoort bij een bureau waar ik lid van ben          (de grens)
--   2. binnen dat bureau mag ik hem zien: door mijn rol, of       (de scope)
--      omdat ik expliciet aan die klant gekoppeld ben
--
-- De eerste voorwaarde is niet met een rol te omzeilen. Dat is het hele punt: een rol zegt wat
-- iemand mag doen, niet bij wie.
--
-- ── DE PLATFORMBEHEERDER IS EXPLICIET, GEEN BIJWERKING ──────────────────────
--
-- Jij moet over alle bureaus heen kunnen kijken. Dat mag geen gevolg zijn van 'admin' zijn, want
-- elk bureau heeft straks zijn eigen admin en die hoort juist NIET over de grens te kunnen kijken.
--
-- Vandaar een aparte tabel met één rij per persoon en een verplichte reden. Een reden is hier geen
-- formaliteit: dit is het enige recht in het systeem dat de tenantscheiding opheft, en over een
-- jaar moet te zien zijn waarom iemand hem had.
--
-- ── WAT ER NOG NIET GEBEURT ─────────────────────────────────────────────────
--
-- Deze migratie zet GEEN policy aan en ontneemt de anon-sleutel niets. Ze verandert alleen wat de
-- functies antwoorden. Daardoor is ze veilig te draaien terwijl de app doorloopt, en is de
-- volgende stap -- policies aanzetten -- een stap waarvan de uitkomst vooraf te testen is.

create table if not exists platform_beheerders (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reden      text not null check (length(trim(reden)) > 5),
  created_at timestamptz not null default now()
);

comment on table platform_beheerders is
  'Ziet over ALLE bureaus heen. Het enige recht dat de tenantscheiding opheft; daarom expliciet en '
  'met een verplichte reden, en niet afgeleid uit een rol.';

-- ── De bouwstenen ───────────────────────────────────────────────────────────

/** De bureaus waar de huidige gebruiker lid van is. */
create or replace function app_bureaus()
returns setof uuid
language sql stable security definer set search_path = public
as $$ select agency_id from user_agencies where user_id = auth.uid() $$;

/** Mag deze gebruiker over de bureaugrens heen kijken? */
create or replace function app_is_platform()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from platform_beheerders where user_id = auth.uid()) $$;

/**
 * Ziet deze gebruiker ALLE klanten BINNEN ZIJN EIGEN BUREAU?
 *
 * De oude naam `app_sees_all_clients` betekende letterlijk alle klanten, van iedereen. Die naam
 * bleef kloppen zolang er één bureau was en werd onwaar op het moment dat er een tweede bijkwam,
 * zonder dat er iets veranderde. Vandaar een naam die zegt wat hij doet.
 */
create or replace function app_ziet_hele_bureau()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(app_role() in ('admin', 'performance_marketeer', 'it'), false) $$;

-- ── De grens ────────────────────────────────────────────────────────────────

create or replace function app_can_read_client(target text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    -- Platformbeheer eerst: die kijkt overal, en dan hoeft de rest niet gedraaid te worden.
    when app_is_platform() then true
    -- De grens. Een klant zonder account-rij hoort bij geen enkel bureau en is dus voor niemand
    -- zichtbaar behalve platformbeheer. Dat is streng en met opzet: een klant die buiten het model
    -- valt hoort op te vallen, niet stilzwijgend voor iedereen open te staan.
    when not exists (
      select 1 from accounts a
      where a.client_id = target and a.agency_id in (select app_bureaus())
    ) then false
    -- Binnen het eigen bureau: de rol, of een uitdrukkelijke koppeling aan deze klant.
    else app_ziet_hele_bureau()
      or exists (select 1 from user_clients uc where uc.user_id = auth.uid() and uc.client_id = target)
  end
$$;

/**
 * De oude naam, met de nieuwe betekenis: alle klanten die IK mag zien.
 *
 * Blijft bestaan omdat migratie 017 en een enkel reparatiescript hem aanroepen. Hij betekent nu
 * "binnen mijn bureau", niet "van iedereen" -- en dat is de hele reparatie. Wie hem in nieuwe code
 * gebruikt, hoort app_ziet_hele_bureau() of app_can_read_client() te nemen.
 */
create or replace function app_sees_all_clients()
returns boolean
language sql stable security definer set search_path = public
as $$ select app_is_platform() or app_ziet_hele_bureau() $$;

-- ── Rechten ─────────────────────────────────────────────────────────────────
-- Deze functies worden door RLS-policies aangeroepen ALS DE AANVRAGENDE ROL. Zonder EXECUTE zou
-- elke policy die ze gebruikt de toegang weigeren. Ze geven alleen een boolean of een lijst
-- bureau-ids terug van de aanroeper zelf -- nooit gegevens van een ander.

grant execute on function app_bureaus()            to anon, authenticated, service_role;
grant execute on function app_is_platform()        to anon, authenticated, service_role;
grant execute on function app_ziet_hele_bureau()   to anon, authenticated, service_role;
grant execute on function app_can_read_client(text) to anon, authenticated, service_role;
grant execute on function app_sees_all_clients()   to anon, authenticated, service_role;

-- platform_beheerders is geen leesvoer voor de browser: wie erin staat is bedrijfsinformatie.
revoke all on table platform_beheerders from anon, authenticated;
grant  select, insert, update, delete on table platform_beheerders to service_role;
alter table platform_beheerders enable row level security;

select 'draai nu de proef in scripts/check-bureaugrens.mjs' as volgende_stap;

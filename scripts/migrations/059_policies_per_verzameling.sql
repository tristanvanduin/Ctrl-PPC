-- 059: de policies uit 058 riepen een functie aan PER RIJ. Dat liep vast op een statement timeout.
--
-- DRAAIEN: idempotent. Vervangt vijf policies en voegt één functie toe; geen data verandert.
--
-- ── DE FOUT ─────────────────────────────────────────────────────────────────
--
-- Migratie 058 schreef dit:
--
--   create policy fact_core_zichtbaar on fact_core for select
--     using (app_can_read_account(account_id));
--
-- Dat leest goed en is fout. `app_can_read_account` krijgt een waarde UIT DE RIJ mee, dus Postgres
-- moet hem voor elke rij opnieuw uitvoeren -- en elke aanroep doet zelf een subquery op accounts en
-- user_agencies. Bij een count over fact_core betekende dat duizenden functieaanroepen met elk hun
-- eigen lookup.
--
-- Gemeten, met de anon-sleutel op `select=account_id&limit=1` met count=exact:
--
--   poging 1   500  canceling statement due to statement timeout (57014)
--   poging 2   200
--   poging 3   200
--   poging 4   500  canceling statement due to statement timeout
--
-- Twee van de vier. Precies het gedrag waar de poortenrun over struikelde, en het is geen
-- meetfout: de query háált het soms net.
--
-- En dat is bij 6.586 rijen. Bij twintig bureaus met achthonderd accounts en jaren historie loopt
-- dit niet soms vast maar altijd -- en dan op elk scherm tegelijk.
--
-- ── DE OPLOSSING: ÉÉN KEER DE VERZAMELING ───────────────────────────────────
--
-- Een functie ZONDER argumenten die de toegestane account-ids teruggeeft. Omdat er niets uit de rij
-- in gaat, kan Postgres hem één keer uitvoeren en het resultaat als hash gebruiken; per rij blijft
-- er een opzoeking over in plaats van een subquery.
--
-- `stable` is daarvoor de voorwaarde: het zegt dat het antwoord binnen één statement niet
-- verandert, en dat is precies wat de planner nodig heeft om hem uit de lus te tillen.
--
-- Dezelfde vorm blijft gelden voor de andere kant: app_can_read_account() blijft bestaan voor code
-- die één account nakijkt. Alleen in een POLICY hoort hij niet, want daar staat hij per rij.

create or replace function app_zichtbare_accounts()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select a.id
  from accounts a
  where app_is_platform()
     or a.agency_id in (select agency_id from user_agencies where user_id = auth.uid())
$$;

grant execute on function app_zichtbare_accounts() to anon, authenticated, service_role;

-- ── De vijf feitentabellen opnieuw ──────────────────────────────────────────

drop policy if exists fact_core_zichtbaar on fact_core;
create policy fact_core_zichtbaar on fact_core for select
  using (account_id in (select app_zichtbare_accounts()));

drop policy if exists fact_dimension_zichtbaar on fact_dimension;
create policy fact_dimension_zichtbaar on fact_dimension for select
  using (account_id in (select app_zichtbare_accounts()));

drop policy if exists google_metrics_zichtbaar on google_metrics;
create policy google_metrics_zichtbaar on google_metrics for select
  using (account_id in (select app_zichtbare_accounts()));

drop policy if exists meta_metrics_zichtbaar on meta_metrics;
create policy meta_metrics_zichtbaar on meta_metrics for select
  using (account_id in (select app_zichtbare_accounts()));

drop policy if exists linkedin_metrics_zichtbaar on linkedin_metrics;
create policy linkedin_metrics_zichtbaar on linkedin_metrics for select
  using (account_id in (select app_zichtbare_accounts()));

-- ── Ook de structuurtabellen, om dezelfde reden ─────────────────────────────
-- `agency_id in (select app_bureaus())` heeft hetzelfde bezwaar niet -- app_bureaus() krijgt niets
-- uit de rij mee -- maar accounts wordt door de policies hierboven per rij bevraagd, dus die kan
-- net zo goed dezelfde verzameling gebruiken.

drop policy if exists account_zichtbaar on accounts;
create policy account_zichtbaar on accounts for select
  using (app_is_platform() or agency_id in (select app_bureaus()));

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hoort nu snel te zijn, ook zonder sessie (die krijgt nul rijen maar moet wél de hele tabel
-- afwegen -- juist dat geval liep vast).

explain (analyze, timing off, summary on, format text)
select count(*) from fact_core;

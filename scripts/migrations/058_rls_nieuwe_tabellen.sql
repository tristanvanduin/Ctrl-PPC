-- 058: RLS op de nieuwe tabellen. De policies worden geschreven en bewezen; de schakelaar
-- waarmee de app ze gaat vóélen blijft nog uit.
--
-- DRAAIEN: veilig terwijl de app doorloopt. Zie de sectie over views hieronder -- dat is precies
-- waarom het veilig is, en het is ook de reden dat dit nog niet de hele fase 5 is.
-- Terugdraaien: `alter table <naam> disable row level security` per tabel.
--
-- ── DE VOLGORDE WORDT BEPAALD DOOR EEN DETAIL VAN VIEWS ─────────────────────
--
-- Sinds migratie 054 leest de app door views: `ads_campaign_monthly` is een view over fact_core.
-- Een view in Postgres draait standaard met de rechten van zijn EIGENAAR, niet van de aanroeper.
-- Gemeten: `reloptions` is null op alle acht, dus `security_invoker` staat uit.
--
-- Gevolg: RLS op fact_core aanzetten verandert NIETS aan wat de app ziet. De view leest er
-- omheen. Dat maakt deze migratie veilig -- er kan geen scherm leeglopen -- maar het betekent ook
-- dat de scheiding hiermee nog niet AFGEDWONGEN is voor de bestaande lezers.
--
-- Dat is exact het soort halve waarheid waar deze sessie vaker op stuitte: een grens die er
-- formeel staat en feitelijk niet werkt. Daarom staat het hier met zoveel woorden, en daarom is de
-- laatste stap apart:
--
--   NU        policies schrijven en bewijzen op de tabellen zelf (deze migratie)
--   STRAKS    `alter view ... set (security_invoker = true)` + inloggen afdwingen
--
-- Die tweede stap is het moment waarop de app het merkt: klopt er een policy niet, dan is een
-- scherm leeg. Vandaar dat hij wacht tot iemand meekijkt.
--
-- ── service_role EN anon ────────────────────────────────────────────────────
--
-- Gemeten: service_role heeft bypassrls, anon en authenticated niet. De sync en de serverroutes
-- draaien op service_role en merken hier dus niets van -- geen aparte policy nodig, en een policy
-- die suggereert dat hij nodig is zou verwarren.
--
-- anon zonder sessie krijgt straks NUL rijen uit deze tabellen. Dat is de bedoeling: zonder
-- inloggen hoort er geen klantdata te zijn. Zolang de app nog met de anon-sleutel leest en er niet
-- ingelogd wordt, is dat precies waarom stap twee wacht.

-- ── Hulpje voor de nieuwe tabellen ──────────────────────────────────────────
-- Die zijn gesleuteld op account_id (uuid), niet op de tekstsleutel client_id.

create or replace function app_can_read_account(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select app_is_platform()
      or exists (
        select 1 from accounts a
        where a.id = target and a.agency_id in (select app_bureaus())
      )
$$;

grant execute on function app_can_read_account(uuid) to anon, authenticated, service_role;

-- ── De structuurtabellen ────────────────────────────────────────────────────

alter table agencies      enable row level security;
alter table accounts      enable row level security;
alter table user_agencies enable row level security;

drop policy if exists bureau_zichtbaar on agencies;
create policy bureau_zichtbaar on agencies for select
  using (app_is_platform() or id in (select app_bureaus()));

drop policy if exists account_zichtbaar on accounts;
create policy account_zichtbaar on accounts for select
  using (app_is_platform() or agency_id in (select app_bureaus()));

-- Eigen lidmaatschappen zijn zichtbaar, en die van bureaugenoten voor wie het hele bureau ziet.
-- Zonder dat laatste kan een beheerder niet zien wie er in zijn eigen bureau zit.
drop policy if exists lidmaatschap_zichtbaar on user_agencies;
create policy lidmaatschap_zichtbaar on user_agencies for select
  using (
    app_is_platform()
    or user_id = auth.uid()
    or (app_ziet_hele_bureau() and agency_id in (select app_bureaus()))
  );

-- ── De feitentabellen ───────────────────────────────────────────────────────

alter table fact_core        enable row level security;
alter table fact_dimension   enable row level security;
alter table google_metrics   enable row level security;
alter table meta_metrics     enable row level security;
alter table linkedin_metrics enable row level security;

drop policy if exists fact_core_zichtbaar on fact_core;
create policy fact_core_zichtbaar on fact_core for select
  using (app_can_read_account(account_id));

drop policy if exists fact_dimension_zichtbaar on fact_dimension;
create policy fact_dimension_zichtbaar on fact_dimension for select
  using (app_can_read_account(account_id));

drop policy if exists google_metrics_zichtbaar on google_metrics;
create policy google_metrics_zichtbaar on google_metrics for select
  using (app_can_read_account(account_id));

drop policy if exists meta_metrics_zichtbaar on meta_metrics;
create policy meta_metrics_zichtbaar on meta_metrics for select
  using (app_can_read_account(account_id));

drop policy if exists linkedin_metrics_zichtbaar on linkedin_metrics;
create policy linkedin_metrics_zichtbaar on linkedin_metrics for select
  using (app_can_read_account(account_id));

-- ── De groepen ──────────────────────────────────────────────────────────────
-- Deze worden WEL al gelezen door de browser (zijbalk en instellingen), dus hier zit het enige
-- echte risico van deze migratie. Een groep zonder agency_id blijft daarom zichtbaar: dat zijn de
-- groepen van vóór migratie 052, en die onzichtbaar maken zou mappen laten verdwijnen bij iemand
-- die niets verkeerd heeft gedaan.

alter table client_groups        enable row level security;
alter table client_group_members enable row level security;

drop policy if exists groep_zichtbaar on client_groups;
create policy groep_zichtbaar on client_groups for select
  using (app_is_platform() or agency_id is null or agency_id in (select app_bureaus()));

drop policy if exists groeplid_zichtbaar on client_group_members;
create policy groeplid_zichtbaar on client_group_members for select
  using (
    app_is_platform()
    or exists (
      select 1 from client_groups g
      where g.id = group_id and (g.agency_id is null or g.agency_id in (select app_bureaus()))
    )
  );

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hoeveel tabellen staan er nu onder RLS, en hoeveel policies zijn er.

select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as tabellen_met_rls,
  (select count(*) from pg_policies where schemaname = 'public') as policies,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v' and coalesce(array_to_string(c.reloptions, ','), '')
           like '%security_invoker=true%') as views_met_invoker;

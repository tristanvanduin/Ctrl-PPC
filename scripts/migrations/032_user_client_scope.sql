-- 032: de tweede autorisatie-as. Beurs-scope per gebruiker, plus de uitbreiding van het
-- rollenmodel van een rangorde naar rechtensets.
--
-- DRAAIEN: samen met 001 bij de O1-deploy (WL.3). Idempotent, veilig te herhalen.
--
-- WAAROM DIT NAAST 001 STAAT EN NIET IN 001
-- 001 is mogelijk al gedraaid; regel 7 van MASTERPLAN_V2 is dat een schemawijziging een
-- idempotent addendum is en nooit een herschrijving van een bestaand bestand.

-- ── De rollen ───────────────────────────────────────────────────────────────
-- De check uit 001 kende alleen admin, specialist en viewer. De nieuwe rollen zijn
-- zijwaarts, geen extra treden: IT mag bij koppelingen zonder omzet te zien, een
-- brand-strateeg ziet creatie-inzichten zonder budget. Zie lib/auth/roles.ts.

alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles add constraint user_roles_role_check check (role in (
  'admin', 'performance_marketeer', 'beurs_manager', 'brand_strateeg', 'it', 'viewer',
  'specialist'  -- oude waarde, blijft geldig tot de update hieronder is gedraaid
));

-- Bestaande rijen omzetten. De code (normalizeRole) vertaalt ook zonder deze regel, dus er
-- zit geen tijdsdruk op; hierna is de vertaling overbodig.
update user_roles set role = 'performance_marketeer' where role = 'specialist';

-- ── De scope ────────────────────────────────────────────────────────────────
-- Welke beurzen een gebruiker mag zien. Leeg betekent GEEN beurs, niet alle: een rol
-- zonder toewijzing hoort niets te zien in plaats van alles.
--
-- Organisatiebrede rollen (admin, performance_marketeer, it) staan hier bewust NIET in.
-- Die dekken per definitie alle beurzen, ook nieuwe — zie scopeFor in lib/auth/roles.ts.
-- Een rij toevoegen voor zo'n rol heeft geen effect en is geen fout.
--
-- client_id is tekst en geen foreign key: beurzen komen uit de Google Ads MCC en uit
-- app_settings, niet uit een eigen tabel. Een FK zou hier een tabel afdwingen die niet
-- bestaat.

create table if not exists user_clients (
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index if not exists user_clients_user_idx on user_clients (user_id);

-- RLS: eigen scope lezen, admin leest alles. Schrijven alleen via de service role
-- (app/api/admin/users), net als bij user_roles.
alter table user_clients enable row level security;
drop policy if exists user_clients_read on user_clients;
create policy user_clients_read on user_clients for select to authenticated
  using (auth.uid() = user_id or app_role() = 'admin');

-- ── Helpers voor de scope-policies ──────────────────────────────────────────
-- Deze functies zijn de bouwstenen voor de per-tabel policies die bij 017 horen. Ze staan
-- hier zodat 017 ze kan gebruiken zonder dat 017 zelf iets over rollen hoeft te weten.

-- Ziet deze gebruiker alle beurzen?
create or replace function app_sees_all_clients() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(app_role() in ('admin', 'performance_marketeer', 'it'), false) $$;

-- Mag deze gebruiker bij deze beurs? Gebruik in een policy:
--   using (app_can_read_client(client_id))
create or replace function app_can_read_client(target text) returns boolean
language sql stable security definer set search_path = public
as $$
  select app_sees_all_clients()
     or exists (select 1 from user_clients uc
                 where uc.user_id = auth.uid() and uc.client_id = target)
$$;

-- ── Controle ────────────────────────────────────────────────────────────────

select role, count(*) from user_roles group by role order by 1;
select client_id, count(*) as gebruikers from user_clients group by client_id order by 1;

-- 107: sync-administratie voor Microsoft Advertising -- de koppeling per klant en het
-- runverslag, spiegelend aan meta_connections/meta_sync_runs (007) en linkedin_connections/
-- linkedin_sync_runs.
--
-- ── HET CREDENTIALMODEL ──────────────────────────────────────────────────────
--
-- Er staat hier bewust GEEN token_ref-kolom zoals meta_connections die (nog) draagt: tokens
-- lopen sinds het bureaumodel (migratie 062) per bureau via agency_connections plus de kluis,
-- niet per klant. Deze tabel bindt alleen het account-id en customer-id van de klant aan de
-- client_id -- de sleutels zelf wonen in de kluis onder provider 'microsoft_ads'
-- (lib/tenancy/kanaal-credentials.ts, bring your own key).
--
-- Idempotent: alles `if not exists` / `drop policy if exists`.

create table if not exists microsoft_connections (
  client_id        text primary key,
  -- Het Microsoft-accountnummer (AccountId) waarvoor gesynct wordt.
  account_id       text not null,
  -- Het customer-id (de beheerlaag boven accounts); vereist in elke API-header. Kan ook in
  -- de kluis-payload staan; deze kolom wint bij verschil, want hij is per klant.
  customer_id      text,
  currency         text,
  account_timezone text,
  status           text not null default 'active' check (status in ('active','expired','error','disabled')),
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists microsoft_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scope text,
  rows_upserted jsonb,
  status text,
  error text
);
create index if not exists idx_microsoft_sync_runs_client on microsoft_sync_runs (client_id, started_at);

-- ── RLS: het 067-patroon, per tabel een _zichtbaar-SELECT-policy ─────────────
--
-- Alleen SELECT-policies; schrijven loopt via de service role (bypassrls), zoals bij alle
-- kanaaltabellen. app_zichtbare_klanten() komt uit migratie 065.

do $$
declare t text;
begin
  foreach t in array array['microsoft_connections', 'microsoft_sync_runs'] loop
    execute format('drop policy if exists %I_zichtbaar on %I', t, t);
    execute format(
      'create policy %I_zichtbaar on %I for select using (client_id in (select app_zichtbare_klanten()))',
      t, t
    );
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- 069: demo-aanvragen vanaf de marketingsite.
--
-- Idempotent, puur additief. Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/069_demo_requests.sql
-- Terugdraaien: de twee policies droppen, `drop table demo_requests`.
--
-- ── WAAROM ────────────────────────────────────────────────────────────────
--
-- De homepage-CTA is "Demo boeken". Extreem lean om mee te starten: een formulier dat
-- opslaat, geen agenda-koppeling. Schrijven mag door iedereen zonder sessie (het IS het
-- publieke contactformulier); lezen is voorbehouden aan wie de service-role gebruikt
-- (de /api/admin-laag), niet aan anon of authenticated -- een aanvraag met een naam en
-- e-mailadres van een bezoeker is geen gegeven dat een willekeurige ingelogde gebruiker
-- van een ander bureau hoort te kunnen opvragen.

create table if not exists demo_requests (
  id          uuid primary key default gen_random_uuid(),
  naam        text not null check (length(trim(naam)) > 0),
  email       text not null check (length(trim(email)) > 0),
  bedrijf     text,
  bericht     text,
  created_at  timestamptz not null default now()
);

alter table demo_requests enable row level security;

drop policy if exists demo_requests_plaatsen on demo_requests;
create policy demo_requests_plaatsen on demo_requests for insert to anon, authenticated
  with check (true);

-- Bewust GEEN select-policy: zonder policy geeft RLS niets terug aan anon/authenticated,
-- alleen de service-role (die RLS omzeilt) leest de aanvragen. Dat is de poort tot
-- /api/admin/demo-requests, niet een vergeten regel.

-- ── Controle ──────────────────────────────────────────────────────────────
-- select count(*) from demo_requests;

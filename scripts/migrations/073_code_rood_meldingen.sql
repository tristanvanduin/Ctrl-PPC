-- 073: persistentie voor Code Rood/Amber-meldingen per account.
--
-- Idempotent, puur additief. GESCHREVEN, NIET TOEGEPAST -- zelfde status als migratie 065:
-- draai hem samen met de eerste keer dat de detectiejob (lib/adoptie/detecteer-code-rood.ts,
-- aangeroepen vanuit app/api/cron/evaluate-code-rood, geregistreerd in vercel.json) daadwerkelijk
-- moet kunnen schrijven. Een tabel zonder schrijver is een wees; die schrijver bestaat nu wel,
-- alleen de migratie zelf moet nog handmatig gedraaid worden (node scripts/supabase-sql.mjs).
-- Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/073_code_rood_meldingen.sql
-- Terugdraaien: de policies droppen, `drop table code_rood_meldingen`.
--
-- ── WAAROM ────────────────────────────────────────────────────────────────
--
-- lib/adoptie/code-rood.ts oordeelt puur (geen IO, geen state). Dit is de state eromheen: één
-- rij per melding, met een levenscyclus (open -> geaccepteerd/afgewezen). De UI-volgorde die de
-- eigenaar vastlegde (11 aug 2026) hangt hieraan: pas NA "geaccepteerd" mag een account uit zijn
-- normale plek in de sidebar getrokken worden naar de Code Rood-sectie en de C-level-view
-- getriggerd worden -- dus moet er iets bestaan om "geaccepteerd" in te bewaren, en niet alleen
-- het huidige oordeel van het moment.
--
-- Eén open melding per account: een her-evaluatie die hetzelfde account weer rood/amber vindt
-- hoort de bestaande open rij bij te werken (nieuwe redenen, gedetecteerd_op ongewijzigd of niet
-- -- aan de schrijver), niet een tweede naast te zetten. Zonder deze grens verdrinkt Today in
-- duplicaten bij elke nieuwe run van de detectiejob.
--
-- STATUS 'opgelost': de detectiejob (lib/adoptie/detecteer-code-rood.ts, aangeroepen vanuit
-- app/api/cron/evaluate-code-rood) zet een melding hierheen als een latere run géén signaal meer
-- vindt -- maar ALLEEN als hij nog 'open' was. Een 'geaccepteerd'/'afgewezen' rij is mensbezit:
-- een melding die een mens al beoordeelde verandert niet stilzwijgend terug, ook niet als de
-- cijfers herstellen. Alleen een mens die nooit gereageerd heeft, mag de job voor je opruimen.
create table if not exists code_rood_meldingen (
  id              uuid primary key default gen_random_uuid(),
  client_id       text not null,
  licht           text not null check (licht in ('amber', 'rood')),
  redenen         jsonb not null default '[]'::jsonb,
  gedetecteerd_op timestamptz not null default now(),
  status          text not null default 'open' check (status in ('open', 'geaccepteerd', 'afgewezen', 'opgelost')),
  gereageerd_door uuid references auth.users(id),
  gereageerd_op   timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists code_rood_meldingen_client_idx on code_rood_meldingen(client_id);

-- Ten hoogste één actieve melding per account. Een her-evaluatie werkt de bestaande open rij bij
-- (update), begint geen tweede. Reageren (accepteren/afwijzen) maakt de rij niet-open, waarna een
-- latere detectie weer vrij een nieuwe open rij mag zetten voor hetzelfde account.
create unique index if not exists code_rood_meldingen_open_per_client
  on code_rood_meldingen(client_id) where status = 'open';

alter table code_rood_meldingen enable row level security;

-- Lezen: iedereen die het account mag lezen (Today-melding, dashboard-melding, sidebar-badge).
drop policy if exists code_rood_meldingen_lezen on code_rood_meldingen;
create policy code_rood_meldingen_lezen on code_rood_meldingen for select to authenticated
  using (app_can_read_client(client_id));

-- Reageren (accepteren/afwijzen): alleen wie het hele bureau ziet -- de "C-level"-rollen in dit
-- model (admin, performance_marketeer, it; zie app_ziet_hele_bureau() in migratie 057). Een
-- account-gebonden viewer/brand_strateeg mag de melding zien, niet de keuze maken die de klant
-- uit zijn normale plek trekt.
drop policy if exists code_rood_meldingen_reageren on code_rood_meldingen;
create policy code_rood_meldingen_reageren on code_rood_meldingen for update to authenticated
  using (app_can_read_client(client_id) and app_ziet_hele_bureau())
  with check (app_can_read_client(client_id) and app_ziet_hele_bureau());

-- Bewust GEEN insert-policy voor anon/authenticated: de detectiejob schrijft met de service-role
-- (die RLS omzeilt), dezelfde reden als demo_requests.sql -- dit zijn geen gegevens die een
-- ingelogde gebruiker zelf hoort te kunnen aanmaken.

-- ── Controle ──────────────────────────────────────────────────────────────
-- select client_id, licht, status, gedetecteerd_op from code_rood_meldingen order by gedetecteerd_op desc;

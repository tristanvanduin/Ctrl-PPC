-- 060: gespreksgeschiedenis voor de ingebouwde chat, plus het licentieveld dat de toegang bepaalt.
--
-- ── WAT DE SPEC VROEG EN WAT HET GEWORDEN IS ────────────────────────────────
--
-- De opdracht noemde een tabel `api_usage_logs` om het tokenverbruik in weg te schrijven. Die
-- bestaat hier niet; wat er wél is, is `llm_usage` (migratie 003) met exact de goede kolommen:
-- prompt_tokens, completion_tokens, model, cost_eur, client_id. De chat schrijft daarheen, langs
-- dezelfde recordUsage() die alle analyses gebruiken. Een insert naar een niet-bestaande tabel
-- zou geen fout geven maar een 404 in een fire-and-forget-call: alle kostenregistratie geruisloos
-- uit, precies de storing die je pas ontdekt als de rekening komt.
--
-- ── DE SYSTEEMPROMPT WORDT NIET OPGESLAGEN ──────────────────────────────────
--
-- chat_messages kent alleen 'user' en 'assistant'. De systeemprompt wordt bij elk bericht opnieuw
-- opgebouwd uit de actuele campagnedata en het hypothese-logboek, en die data verandert. Hem
-- meebewaren zou een kopie vastleggen die morgen niet meer klopt, en bij het teruglezen van een
-- gesprek zou je cijfers zien die nooit zo op het scherm hebben gestaan. Wat er wél bewaard wordt
-- is hoeveel tokens hij kostte -- dat is het getal dat je later nodig hebt.
--
-- ── HET LICENTIEVELD ────────────────────────────────────────────────────────
--
-- Hoort strikt genomen bij het budgetplafond, maar de chat heeft hem nu al nodig: de toegang zit
-- achter een premium-check. Default 'basis', zodat een bestaand bureau er niet per ongeluk bij kan
-- voordat iemand daar bewust over besloten heeft.

-- ── Licentie op het bureau ──────────────────────────────────────────────────

alter table agencies add column if not exists licentie text not null default 'basis';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agencies_licentie_geldig') then
    alter table agencies add constraint agencies_licentie_geldig
      check (licentie in ('basis', 'premium', 'enterprise'));
  end if;
end $$;

comment on column agencies.licentie is
  'basis | premium | enterprise. De chat en straks het verhoogde API-plafond zitten achter premium. '
  'Default basis: erbij mogen is een besluit, geen bijwerking van een migratie.';

-- Het demo-bureau op premium, anders is de chat in de demo niet te zien en valt er niets te
-- toetsen. Alleen dat bureau, en alleen als het bestaat.
update agencies set licentie = 'premium' where slug = 'demo' and licentie = 'basis';

-- ── De gesprekken ───────────────────────────────────────────────────────────

create table if not exists chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  -- cascade en niet restrict, anders dan bij accounts: een gesprek is geen historie die je moet
  -- verhuizen voordat je een bureau opheft. Verdwijnt het bureau, dan verdwijnt het gesprek mee.
  agency_id   uuid not null references agencies(id) on delete cascade,
  -- Nullable: je kunt over één klant sparren, maar ook over het bureau als geheel. Een verplichte
  -- klant zou het tweede gesprek onmogelijk maken.
  client_id   text,
  titel       text not null default 'Nieuw gesprek',
  -- Wie het gesprek begon. set null en niet cascade: het gesprek blijft van het bureau, ook als de
  -- collega die het voerde weggaat -- dat is meestal juist het moment waarop iemand het terugleest.
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_chat_sessions_bureau on chat_sessions (agency_id, updated_at desc);
create index if not exists idx_chat_sessions_klant on chat_sessions (client_id, updated_at desc);

comment on table chat_sessions is
  'Eén gesprek. Per bureau, optioneel over één klant. De systeemprompt hoort hier niet bij: die '
  'wordt per bericht opnieuw uit actuele data opgebouwd.';

create table if not exists chat_messages (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references chat_sessions(id) on delete cascade,
  rol               text not null check (rol in ('user', 'assistant')),
  inhoud            text not null,
  -- Alleen gevuld op een assistant-rij. Welk model antwoordde en wat het kostte; de router kan
  -- terugvallen op een ander model, dus dit is niet af te leiden uit een instelling.
  model             text,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists idx_chat_messages_sessie on chat_messages (session_id, created_at);

comment on column chat_messages.prompt_tokens is
  'Inclusief de verborgen datacontext. Dat is het punt: die context is het grootste deel van de '
  'rekening en is voor de gebruiker onzichtbaar, dus hij moet hier zichtbaar zijn.';

-- ── De bureaugrens ──────────────────────────────────────────────────────────
--
-- Een verzamelfunctie en geen per-rij-check, om de reden uit migratie 059: een policy die per rij
-- een SECURITY DEFINER-functie aanroept liet fact_core in een statement timeout lopen. Hier is de
-- verzameling klein, maar dezelfde vorm aanhouden scheelt de volgende persoon het uitzoekwerk.

create or replace function app_zichtbare_chatsessies()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select s.id
  from chat_sessions s
  where app_is_platform()
     or s.agency_id in (select agency_id from user_agencies where user_id = auth.uid())
$$;

grant execute on function app_zichtbare_chatsessies() to anon, authenticated, service_role;

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

drop policy if exists chat_sessions_zichtbaar on chat_sessions;
create policy chat_sessions_zichtbaar on chat_sessions for select
  using (app_is_platform() or agency_id in (select app_bureaus()));

-- Schrijven mag alleen binnen het eigen bureau. Zonder deze policy zou een ingelogde gebruiker een
-- gesprek onder een ander bureau kunnen hangen -- en dat gesprek daarna niet meer zien, want de
-- select-policy houdt hem tegen. Data die je wel kunt maken en niet kunt terugvinden is erger dan
-- een weigering.
drop policy if exists chat_sessions_schrijfbaar on chat_sessions;
create policy chat_sessions_schrijfbaar on chat_sessions for insert
  with check (app_is_platform() or agency_id in (select app_bureaus()));

drop policy if exists chat_sessions_bijwerkbaar on chat_sessions;
create policy chat_sessions_bijwerkbaar on chat_sessions for update
  using (app_is_platform() or agency_id in (select app_bureaus()))
  with check (app_is_platform() or agency_id in (select app_bureaus()));

drop policy if exists chat_messages_zichtbaar on chat_messages;
create policy chat_messages_zichtbaar on chat_messages for select
  using (session_id in (select app_zichtbare_chatsessies()));

drop policy if exists chat_messages_schrijfbaar on chat_messages;
create policy chat_messages_schrijfbaar on chat_messages for insert
  with check (session_id in (select app_zichtbare_chatsessies()));

-- ── Controle ────────────────────────────────────────────────────────────────

select
  (select count(*) from information_schema.columns
    where table_name = 'agencies' and column_name = 'licentie') as licentiekolom,
  (select count(*) from information_schema.tables
    where table_name in ('chat_sessions', 'chat_messages')) as tabellen,
  (select count(*) from pg_policies
    where tablename in ('chat_sessions', 'chat_messages')) as policies,
  (select count(*) from agencies where licentie = 'premium') as premiumbureaus;

-- 070: het creditgrootboek per bureau. Fundament voor het tier-model uit de v2.0-blueprint
-- (Compute Credits per tier), nog NIET gewired in de analysepijplijn en nog GEEN wijziging aan
-- agencies.licentie. Idempotent, puur additief.
--
-- Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/070_credit_ledger.sql
-- Terugdraaien: de twee policies droppen, `drop table credit_ledger`.
--
-- ── WAAROM APPEND-ONLY EN GEEN SALDOKOLOM ───────────────────────────────────
--
-- Hetzelfde patroon als llm_usage/uitgavenplafond.ts: geen mutable balans-kolom die twee
-- gelijktijdige verbruiksmomenten kan laten overschrijven, maar een rij per gebeurtenis
-- (toekenning of verbruik), en het saldo is de som ervan, berekend op het moment dat je hem
-- nodig hebt. Dat is ook meteen de audittrail: bij een geschil over "waar zijn onze credits
-- gebleven" staat het antwoord al in de tabel in plaats van in een los logbestand.
--
-- ── WAAROM DIT NOG NIETS AFDWINGT ────────────────────────────────────────────
--
-- Deze migratie zet alleen de tabel neer. lib/analysis/credit-costs.ts heeft de pure
-- saldofuncties en een schrijffunctie (recordCredit), maar niets roept ze aan vanuit de
-- analysepijplijn. Twee dingen ontbreken bewust, en zijn geen oversight:
--
--   1. WAAR een SOP-run credits afschrijft. Een run doet meerdere LLM-calls (recordUsage wordt
--      per call aangeroepen); credits moeten per RUN afgeschreven worden, niet per call, anders
--      betaalt een run met veel stappen naar verhouding te veel. Dat charge-point moet één keer
--      goed gekozen worden, niet losjes ergens ingehangen.
--   2. WAT er gebeurt bij een leeg saldo -- zacht waarschuwen (zoals het uitgavenplafond onder
--      80%) of hard blokkeren. Dat is een productbeslissing, geen technisch detail, en hoort niet
--      als bijeffect van een schema-migratie besloten te worden.
--
-- ── AGENCY_ID: GEEN FOREIGN KEY, ZELFDE REDEN ALS MIGRATIE 061 ─────────────
--
-- Een verwijderd bureau mag zijn credit-geschiedenis niet meenemen; die heb je juist nodig voor
-- de eindafrekening. Niet nullable hier (in tegenstelling tot llm_usage.agency_id): een
-- creditgebeurtenis zonder bureau is per definitie zinloos, er is niemand om het aan toe te
-- rekenen.

create table if not exists credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null,
  event       text not null check (event in ('grant', 'consume')),
  amount      integer not null check (amount > 0),
  reason      text,
  run_key     text,
  created_at  timestamptz not null default now()
);

comment on table credit_ledger is
  'Creditgrootboek per bureau (v2.0-blueprint): een rij per toekenning of verbruik, saldo = som. '
  'Nog niet gewired vanuit de analysepijplijn -- zie de kop van dit bestand voor de twee open '
  'beslissingen (charge-point per run, gedrag bij leeg saldo).';
comment on column credit_ledger.event is
  '''grant'' (tier-toewijzing, bijkoop) of ''consume'' (een SOP- of deep-dive-run). Saldo = som van '
  'grant-amounts min som van consume-amounts.';
comment on column credit_ledger.amount is
  'Altijd positief; het teken zit in `event`, niet in het getal. Voorkomt een saldo dat door een '
  'verkeerd voorteken de verkeerde kant op klopt.';
comment on column credit_ledger.reason is
  'Vrije tekst: ''tier-toewijzing'', ''sop:monthly'', ''deep-dive:kannibalisatie-check'', '
  '''credit-pack-aankoop''. Geen enum: de blueprint noemt een catalogus die nog groeit.';
comment on column credit_ledger.run_key is
  'Optioneel: koppelt een consume-rij aan de run_key in llm_usage, zodat een creditafschrijving '
  'terug te herleiden is naar de calls die hem veroorzaakten.';

create index if not exists idx_credit_ledger_bureau on credit_ledger (agency_id, created_at);

alter table credit_ledger enable row level security;

-- Lezen: een bureau ziet zijn eigen grootboek (voor een toekomstige "credits resterend"-widget),
-- platformbeheer ziet alles. Dezelfde bouwstenen als migratie 057 (app_bureaus, app_is_platform).
drop policy if exists credit_ledger_lezen on credit_ledger;
create policy credit_ledger_lezen on credit_ledger for select
  using (app_is_platform() or agency_id in (select app_bureaus()));

-- Schrijven: uitsluitend de service-role. Een bureau dat zichzelf credits kan toekennen is geen
-- grens meer -- dit blijft dus bewust dicht voor anon en authenticated, ook straks bij het
-- wiren van recordCredit (die draait server-side met de service-role, net als recordUsage).

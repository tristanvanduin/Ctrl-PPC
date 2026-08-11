-- 072: accounts.sops_enabled -- de hendel achter de "SOP's uitzetten"-keuze uit het tier-model.
--
-- Idempotent, puur additief, draait direct. Draaien: node scripts/supabase-sql.mjs --file
-- scripts/migrations/072_accounts_sops_enabled.sql
-- Terugdraaien: `alter table accounts drop column sops_enabled`.
--
-- ── WAAROM ────────────────────────────────────────────────────────────────
--
-- Automatische SOP's (monthly/weekly/biweekly) zijn nooit credit-gated (zie de kop van
-- lib/analysis/credit-costs.ts) -- ze zijn gedekt zolang het bureau binnen zijn SOP-dekking zit:
-- hoeveel accounts tenminste automatische SOP's mogen draaien, per tier. Overschrijdt het aantal
-- gekoppelde accounts die dekking, dan is de aangewezen manier om dat zonder upgrade op te lossen
-- SOP's uitzetten voor de accounts die niet meer passen. Dat vraagt een schakelaar per account.
--
-- Default true: bestaande accounts blijven draaien zoals ze draaiden. Deze migratie schakelt
-- niets uit -- dat gebeurt pas als een bureau bewust kiest voor de "SOP's uitzetten"-optie in de
-- dekkingsmelding (nog te bouwen: lib/tenancy/sop-dekking.ts regelt de rekensom, de UI-keuze en
-- het bijbehorende schrijfpad komen in een volgende stap).
--
-- ── WAT DIT NIET DOET ────────────────────────────────────────────────────
--
-- Geen enforcement hier. De monthly/weekly/biweekly-routes moeten deze kolom nog raadplegen
-- voordat ze een run starten -- dat gebeurt niet automatisch doordat de kolom bestaat.

alter table accounts add column if not exists sops_enabled boolean not null default true;

comment on column accounts.sops_enabled is
  'Mag dit account automatische SOP''s (monthly/weekly/biweekly) draaien? Default true. De hendel '
  'voor de "SOP''s uitzetten"-keuze als een bureau zijn SOP-dekking overschrijdt (zie '
  'lib/tenancy/sop-dekking.ts). Raakt NIET de handmatige deep-dive-routes, die zijn credit-gated.';

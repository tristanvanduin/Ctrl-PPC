-- 066: is_primary op accounts, voor Fase 5 (frontend). De sidebar moet primaire accounts direct
-- uitgeklapt tonen en back-up-accounts in een ingeklapt mapje -- dat onderscheid bestond nergens
-- in het schema (geverifieerd: geen is_primary, geen vergelijkbaar primary/backup-veld op
-- accounts of elders). Puur additief: default true, dus elk bestaand account blijft "primair"
-- en dus zichtbaar zoals nu, geen enkel account verdwijnt achter een klik door deze migratie.
--
-- Geen wijziging aan lib/events/ of lib/rai/: dit raakt alleen het accounts-schema en is voor
-- niets anders dan de sidebar-groepering bedoeld.
--
-- Terugdraaien: `alter table accounts drop column is_primary`.

alter table accounts add column if not exists is_primary boolean not null default true;

comment on column accounts.is_primary is
  'Sidebar-groepering (Fase 5): true = direct uitgeklapt, false = back-up-account in een ingeklapt mapje. Geen inhoudelijke betekenis buiten de UI.';

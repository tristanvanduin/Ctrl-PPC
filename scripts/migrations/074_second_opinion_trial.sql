-- 074: welkomstcadeau van 5 gratis Second Opinion-runs bij de eerste upgrade boven Foundation.
--
-- Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/074_second_opinion_trial.sql
-- Terugdraaien: de trigger + functie droppen (onderaan dit bestand staat het exacte commando),
-- de backfill-rijen laten staan is onschadelijk (het zijn gewone credit_ledger-rijen, saldo blijft
-- kloppen als het grootboek nooit meer op reason='second-opinion-trial' filtert).
--
-- ── WAAROM CREDIT_LEDGER EN GEEN NIEUWE TABEL ────────────────────────────────
--
-- credit_ledger bestaat al (migratie 070): een append-only grootboek van grant/consume-rijen per
-- bureau, met een vrije `reason`-kolom. Dit is precies zo'n gebeurtenis -- een toekenning, later
-- verbruik per run -- alleen met een andere reden dan de algemene compute-credits uit de
-- v2.0-blueprint. Een aparte trial-tabel zou dezelfde audittrail (wie kreeg wat, wanneer verbruikt)
-- nog een keer moeten bouwen. lib/analysis/second-opinion-trial.ts leest/schrijft dit grootboek
-- gefilterd op reason='second-opinion-trial', met de bestaande saldoUit/recordCredit uit
-- lib/analysis/credit-costs.ts -- geen tweede implementatie van dezelfde optelsom.
--
-- Dit staat LOS van CREDIT_COSTS (credit-costs.ts, nog leeg -- geen prijsbeslissing genomen over
-- wat een analyse in compute-credits kost). De trialcredits hier zijn een vast, apart beleid: 5
-- gratis Second Opinion-runs, geen koppeling aan de nog onbesliste algemene creditprijzen.
--
-- ── WANNEER DE TOEKENNING VUURT ──────────────────────────────────────────────
--
-- Precies bij de overgang licentie 'basis' -> iets anders, en precies één keer per bureau (de
-- EXISTS-check hieronder voorkomt een herhaalde toekenning bij elke volgende upgrade, bv.
-- growth -> scale). Er is geen live betaalflow (agencies.licentie wordt vandaag handmatig gezet,
-- zie het gesprek over self-serve signup) -- een database-trigger op de kolom zelf werkt daardoor
-- ongeacht HOE de wijziging gebeurt, vandaag handmatig, later via een eventuele betaal-webhook,
-- zonder dat er ooit een tweede plek moet worden bijgewerkt.
--
-- Backfill: bureaus die vandaag al boven 'basis' zitten (bv. het demo-bureau, migratie 071) hebben
-- deze trigger nooit gezien en krijgen het welkomstcadeau alsnog, eenmalig.

create or replace function toeken_second_opinion_trial() returns trigger as $$
begin
  if OLD.licentie = 'basis' and NEW.licentie != 'basis' then
    if not exists (
      select 1 from credit_ledger
      where agency_id = NEW.id and reason = 'second-opinion-trial' and event = 'grant'
    ) then
      insert into credit_ledger (agency_id, event, amount, reason)
      values (NEW.id, 'grant', 5, 'second-opinion-trial');
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists second_opinion_trial_bij_upgrade on agencies;
create trigger second_opinion_trial_bij_upgrade
  after update of licentie on agencies
  for each row
  execute function toeken_second_opinion_trial();

-- Backfill voor bureaus die nu al boven 'basis' zitten.
insert into credit_ledger (agency_id, event, amount, reason)
select id, 'grant', 5, 'second-opinion-trial'
from agencies
where licentie != 'basis'
  and not exists (
    select 1 from credit_ledger
    where agency_id = agencies.id and reason = 'second-opinion-trial' and event = 'grant'
  );

comment on function toeken_second_opinion_trial() is
  'Kent eenmalig 5 credit_ledger-credits toe (reason=second-opinion-trial) bij de eerste overgang '
  'van licentie basis naar een betaalde tier. Zie lib/analysis/second-opinion-trial.ts voor hoe dit '
  'saldo gelezen en verbruikt wordt.';

-- Terugdraaien:
--   drop trigger if exists second_opinion_trial_bij_upgrade on agencies;
--   drop function if exists toeken_second_opinion_trial();
--   delete from credit_ledger where reason = 'second-opinion-trial';

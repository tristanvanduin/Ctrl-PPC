-- 093: Fase 4, tweede volgfix op dezelfde live-verificatie-vondst als 092.
--
-- ── BUG ───────────────────────────────────────────────────────────────────
--
-- 092 zette hypothesis_id op `on delete set null`, precies om de append-only-trigger niet meer
-- in de weg te laten zitten van het verwijderen van een sprint_hypotheses-rij. Maar `on delete
-- set null` werkt intern via een UPDATE op de kindtabel (hypothesis_id -> null) -- en de
-- trigger uit 091 blokkeert ELKE UPDATE, ook deze. Resultaat: de DELETE op sprint_hypotheses
-- faalt nu op de UPDATE die zijn eigen FK-actie probeert uit te voeren, met dezelfde
-- append-only-foutmelding als voorheen. Geen corruptie (de hele transactie rolt terug, dus de
-- hypothese-rij en het event blijven allebei intact, alleen de delete zelf mislukt), maar het
-- oorspronkelijke probleem (een sprint_hypotheses-rij met gekoppelde memory-events is niet te
-- verwijderen) is dus nog niet opgelost.
--
-- ── FIX ───────────────────────────────────────────────────────────────────
--
-- De trigger moet onderscheid maken: een UPDATE die UITSLUITEND hypothesis_id naar null zet
-- (en verder niets wijzigt) is de FK-machinerie zelf en mag door. Elke andere UPDATE --
-- event_type, reason, metrics, client_id of created_at wijzigen, of hypothesis_id naar iets
-- anders dan null -- blijft verboden. Dat is de eigenlijke garantie die "append-only" hier
-- geeft: de geschiedenis van WAT er gebeurd is staat vast; alleen de koppeling naar een
-- inmiddels verwijderde bronrij mag vervallen.
--
-- Opruiming: de hypothese+event van de vorige verificatiepoging (client_id
-- 'zztest-fk-fix-verify'), die door deze exacte bug bleef hangen (de delete rolde terug).

create or replace function agency_memory_events_geen_mutaties()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if new.hypothesis_id is null
       and new.id = old.id
       and new.client_id is not distinct from old.client_id
       and new.event_type = old.event_type
       and new.reason is not distinct from old.reason
       and new.metrics is not distinct from old.metrics
       and new.created_at = old.created_at then
      return new; -- exact de on-delete-set-null-actie van de FK, niets anders
    end if;
    raise exception 'agency_memory_events is append-only: UPDATE is niet toegestaan (uitgezonderd hypothesis_id -> null via on delete set null)';
  end if;

  raise exception 'agency_memory_events is append-only: % is niet toegestaan', TG_OP;
end;
$$;

-- Met de trigger hierboven al actief slaagt deze delete nu, en de FK zet het gekoppelde event
-- se hypothesis_id op null (de nieuwe trigger staat exact die UPDATE toe) in plaats van te
-- blokkeren. Het overlevende event zelf ruimen we ook op, zelfde eenmalige beheeractie als 092.
delete from sprint_hypotheses where client_id = 'zztest-fk-fix-verify';

alter table agency_memory_events disable trigger agency_memory_events_geen_delete;
delete from agency_memory_events where client_id = 'zztest-fk-fix-verify';
alter table agency_memory_events enable trigger agency_memory_events_geen_delete;

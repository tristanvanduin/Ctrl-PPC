-- 053: de merk-exclusiviteit ook bewaken als de SOORT verandert.
--
-- DRAAIEN: idempotent, veilig te herhalen. Voegt één triggerfunctie en één trigger toe.
--
-- ── HET GAT ─────────────────────────────────────────────────────────────────
--
-- Migratie 052 zette een trigger op client_group_members die weigert dat een account in twee
-- groepen van soort 'merk' terechtkomt. Bij het bouwen van het beheerscherm heb ik hem uitgeprobeerd
-- langs de andere kant, en die was open:
--
--   1. Easy-Ergonomics BE toevoegen aan groep "MPC"   → mag, want MPC had soort NULL
--   2. MPC op soort 'merk' zetten                     → mag, want de trigger kijkt naar LEDEN
--
-- Resultaat: één account in twee merkgroepen, precies wat de trigger moest uitsluiten. Gemeten,
-- niet beredeneerd — het stond er echt in en is daarna teruggedraaid.
--
-- Ik had bij 052 opgeschreven dat de database het niet meer kan. Dat klopte voor de ene weg en
-- niet voor de andere. Een garantie met een omweg eromheen is geen garantie, en het is erger dan
-- geen garantie: er is een knop op gebouwd in het vertrouwen dat het niet kan.
--
-- Een regel geldt over de hele toestand, niet over één van de twee tabellen die hem kunnen
-- veranderen. Vandaar dezelfde controle ook op client_groups.

create or replace function bewaak_merk_soort_wijziging()
returns trigger
language plpgsql
as $$
declare
  botsing text;
  account text;
begin
  -- Alleen als deze groep een merk WORDT of blijft. Van merk af gaan is altijd toegestaan.
  if new.soort is distinct from 'merk' then
    return new;
  end if;

  select m.client_id, g.name into account, botsing
  from client_group_members m
  join client_group_members ander on ander.client_id = m.client_id and ander.group_id <> m.group_id
  join client_groups g on g.id = ander.group_id and g.soort = 'merk'
  where m.group_id = new.id
  limit 1;

  if botsing is not null then
    raise exception 'account % zit al in merkgroep "%"; een account hoort bij hoogstens één merk',
      account, botsing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_merk_soort_wijziging on client_groups;
create trigger trg_merk_soort_wijziging
  before insert or update of soort on client_groups
  for each row execute function bewaak_merk_soort_wijziging();

-- ── Controle ────────────────────────────────────────────────────────────────
-- Staat er nu al een account in twee merkgroepen? Hoort 0 te zijn; anders heeft de fout hierboven
-- iets achtergelaten dat met de hand opgeruimd moet worden voordat de trigger zin heeft.

select coalesce(count(*), 0) as accounts_in_twee_merkgroepen
from (
  select m.client_id
  from client_group_members m join client_groups g on g.id = m.group_id
  where g.soort = 'merk'
  group by m.client_id having count(*) > 1
) x;

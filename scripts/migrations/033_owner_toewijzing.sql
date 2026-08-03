-- 033: de eigenaar van een sprinttaak wordt twee assen in plaats van één waarde.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief — geen bestaande kolom, rij, policy
-- of trigger wordt aangeraakt, en alle bestaande rijen blijven geldig met de nieuwe velden leeg.
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- `sprint_items.owner` deed twee dingen tegelijk: het zei aan WELKE KANT het werk ligt (bureau
-- of klant) en het was tegelijk het label dat je op het scherm zag. Zolang er maar twee
-- mogelijke eigenaren zijn valt dat niet op. Zodra je wilt kunnen toewijzen aan een persoon,
-- een functie of een externe partner, gaat het stuk: elke specifiekere waarde die je invult,
-- vernietigt het antwoord op de vraag "hoeveel werk ligt er bij de klant".
--
-- Dat is geen theoretisch bezwaar. Precies dat is hier al een keer gebeurd: in de kolom staan
-- naast rollen ook zeven klantnamen en vier volledige hypotheseteksten, en die tellen nu
-- allemaal als klant-taak omdat ze nergens anders op lijken.
--
-- Daarom blijft `owner` de KANT — 'Bureau' of 'Klant', en nooit iets anders — en komt de
-- specifieke toewijzing ernaast te staan. Leeg betekent globaal, en dat is exact het gedrag
-- van vandaag. Vandaar dat er geen datamigratie bij hoort: de 49 bestaande rijen zijn met
-- lege nieuwe velden meteen correct.
--
-- ── WAAROM owner_user_id EEN ECHTE VERWIJZING IS ────────────────────────────
--
-- Een persoon is een koppeling naar een gebruiker, geen tekst. Was de UUID in `owner_naam`
-- beland, dan stond er een sleutel in een veld dat "naam" heet — een verwisseling die pas
-- opvalt als iemand hem als naam op een scherm zet.
--
-- `on delete set null` en niet `cascade`: verdwijnt een gebruiker, dan houdt de taak zijn kant
-- en verliest alleen de persoon. Een taak hoort nooit te verdwijnen omdat iemand uit dienst
-- gaat, en hij hoort ook niet stuurloos achter te blijven.
--
-- LET OP bij het inplannen: auth.users is op dit moment leeg (0 rijen). De optie "persoon"
-- bestaat dus wel, maar er valt nog niemand te kiezen tot de eerste gebruikers zijn
-- aangemaakt — zie scripts/seed-first-admin.mjs, die dezelfde blokkade oplost als 017.
--
-- Mensen aan klantzijde loggen niet in en krijgen dus nooit een owner_user_id. Werk aan die
-- kant wordt toegewezen via 'functie' (vrije tekst) of 'bedrijf' (de partnernaam).

-- ── De kolommen ─────────────────────────────────────────────────────────────

alter table sprint_items
  add column if not exists owner_soort   text,
  add column if not exists owner_naam    text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

-- ── De toegestane soorten ───────────────────────────────────────────────────
--
-- null hoort er expliciet bij en is de normale toestand: de taak ligt bij de kant als geheel.
-- Zonder die tak zou elke bestaande rij de constraint breken.

alter table sprint_items drop constraint if exists sprint_items_owner_soort_check;
alter table sprint_items add constraint sprint_items_owner_soort_check
  check (owner_soort is null or owner_soort in ('bedrijf', 'functie', 'persoon'));

-- ── Controle ────────────────────────────────────────────────────────────────
-- Hierna horen de drie kolommen te bestaan en hoort elke bestaande rij ze leeg te hebben.

select
  count(*)                                        as rijen,
  count(owner_soort)                              as met_soort,
  count(owner_naam)                               as met_naam,
  count(owner_user_id)                            as met_persoon
from sprint_items;

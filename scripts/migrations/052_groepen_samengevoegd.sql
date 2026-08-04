-- 052: één groeperingsmechanisme in plaats van twee. `merken` gaat weer weg.
--
-- DRAAIEN: idempotent, veilig te herhalen. Voegt kolommen toe aan client_groups, vult ze, en
-- verwijdert daarna de tabel uit migratie 051 met de drie kolommen die daarbij hoorden. Geen
-- bestaande groep of lidmaatschap gaat verloren.
--
-- ── WAAROM DIT TERUGGEDRAAID WORDT ──────────────────────────────────────────
--
-- Migratie 051 bouwde `merken` als het niveau tussen bureau en account. Dat niveau is nodig, maar
-- het bestond al: `client_groups` + `client_group_members`, met een beheerscherm in
-- app/settings/page.tsx en drie groepen die iemand met de hand heeft gemaakt.
--
-- Het vergelijk was ontnuchterend:
--
--   MPC              6 accounts   mijn voorstel én de handmatige groep, zelfde leden, zelfde naam
--   9altitudes       2 accounts   idem
--   GoedeInnovaties  3 accounts   handmatig "Labels Edwin" -- zelfde leden, ANDERE betekenis
--   Easy-Ergonomics  3 accounts   alleen mijn voorstel; deze had nog niemand gemaakt
--
-- Twee van de vier had een mens al precies zo bedacht. Het algoritme is dus nuttig als AANVULLING
-- en niet als vervanging, en een tweede tabel ernaast levert alleen twee plekken op waar iets
-- "MPC" heet.
--
-- ── DE SOORT IS DE KERN, EN "Labels Edwin" LEGT UIT WAAROM ──────────────────
--
-- Dezelfde drie GoedeInnovaties-accounts staan handmatig gegroepeerd onder de naam van de persoon
-- die ze beheert. Eén verzameling accounts, twee betekenissen: voor de één is het een merk, voor
-- de ander "wie doet dit". Wie dat als merk leest en er een merkvergelijking op bouwt, legt drie
-- losse webshops naast elkaar alsof het regio's van hetzelfde ding zijn.
--
-- Daarom draagt een groep vanaf nu WAT HIJ IS. En daarom staat `soort` op NULL voor de drie
-- bestaande groepen: niemand heeft ooit gezegd wat ze zijn, en dat zelf invullen zou hetzelfde
-- gokken zijn dat deze migratie juist ongedaan maakt. Het beheerscherm vraagt het.
--
-- ── HET BUREAU-GAT ──────────────────────────────────────────────────────────
--
-- client_groups had geen agency_id. Geen enkele. Bij twintig bureaus betekent dat: iedereen ziet
-- en bewerkt elkaars groepen. Dat staat los van deze samenvoeging en is een echt lek.
--
-- Nullable, met opzet: een groep zonder leden heeft geen account om het bureau uit af te leiden.
-- Wel afdwingbaar zodra hij leden heeft -- dat doet de trigger hieronder.

alter table client_groups add column if not exists agency_id  uuid references agencies(id) on delete restrict;
alter table client_groups add column if not exists soort      text;
alter table client_groups add column if not exists bevestigd  boolean not null default true;
alter table client_groups add column if not exists reden      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_groups_soort_geldig') then
    alter table client_groups add constraint client_groups_soort_geldig
      check (soort is null or soort in ('merk', 'specialist', 'vrij'));
  end if;
end $$;

comment on column client_groups.soort is
  'merk = regio- of landvarianten van dezelfde zaak, mag vergeleken worden. specialist = wie het '
  'beheert. vrij = een map zonder verdere betekenis. NULL = nog niet ingedeeld.';
comment on column client_groups.bevestigd is
  'false betekent: door het algoritme voorgesteld, nog niet door een mens beoordeeld. Handmatig '
  'gemaakte groepen staan per definitie op true.';
comment on column client_groups.reden is
  'Waar een voorstel vandaan komt, of dat het algoritme het eens is met een bestaande groep. Leeg '
  'bij een groep die iemand zelf heeft bedacht zonder dat er een regel op past.';

-- ── Het bureau invullen uit de leden ────────────────────────────────────────
-- Gecontroleerd voordat dit draaide: alle drie de groepen hebben leden uit precies één bureau, en
-- er is geen lid zonder account. Zonder die controle zou deze update stilzwijgend één van twee
-- bureaus kiezen.

update client_groups g set agency_id = (
  -- limit 1 en geen min(): min() bestaat niet voor uuid. Vooraf gecontroleerd dat elke groep
  -- leden uit precies één bureau heeft, dus welke rij het wordt maakt niet uit.
  select a.agency_id from client_group_members m
  join accounts a on a.client_id = m.client_id where m.group_id = g.id limit 1
)
where g.agency_id is null;

-- ── Eén merk per account ────────────────────────────────────────────────────
--
-- Dit is wat `merken` wél kon en client_groups niet: daar is de relatie N:M, dus een account kan
-- in twintig groepen zitten. Voor vrije mappen is dat juist de bedoeling, voor merken niet -- een
-- account dat in twee merken zit, wordt in een vergelijking twee keer meegeteld.
--
-- Een unieke index kan dit niet uitdrukken, want de soort staat op de GROEP en de exclusiviteit
-- geldt per LID. Vandaar een trigger. Die controleert alleen bij soort='merk'; alle andere
-- groepen blijven vrij overlappen.
--
-- Triggerfuncties worden door PostgREST niet als endpoint gepubliceerd (hun retourtype laat dat
-- niet toe), dus dit vergroot het aanvalsoppervlak niet. scripts/check-rpc-rechten.mjs zondert ze
-- expliciet uit en noemt ze wel in zijn rapport.

create or replace function bewaak_een_merk_per_account()
returns trigger
language plpgsql
as $$
declare
  botsing text;
begin
  if not exists (select 1 from client_groups where id = new.group_id and soort = 'merk') then
    return new;
  end if;
  select g.name into botsing
  from client_group_members m join client_groups g on g.id = m.group_id
  where m.client_id = new.client_id and g.soort = 'merk' and g.id <> new.group_id
  limit 1;
  if botsing is not null then
    raise exception 'account % zit al in merkgroep "%"; een account hoort bij hoogstens één merk',
      new.client_id, botsing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_een_merk_per_account on client_group_members;
create trigger trg_een_merk_per_account
  before insert or update on client_group_members
  for each row execute function bewaak_een_merk_per_account();

-- ── De voorstellen overzetten ───────────────────────────────────────────────
--
-- MPC en 9altitudes bestaan al als handmatige groep. Daar komt GEEN tweede groep bij; ze krijgen
-- alleen de aantekening dat het algoritme het met ze eens is. Dat is informatie, geen besluit --
-- hun soort blijft leeg tot iemand hem invult.

update client_groups set reden = 'het naamalgoritme komt op dezelfde indeling uit (regiosuffix+scheidingsteken)'
where name = 'MPC' and reden is null;
update client_groups set reden = 'het naamalgoritme komt op dezelfde indeling uit (regiosuffix)'
where name = '9altitudes' and reden is null;

-- Easy-Ergonomics had nog niemand gemaakt. Die komt er als VOORSTEL in: soort 'merk' omdat de
-- regiosuffix-regel per definitie over landvarianten gaat, bevestigd false omdat een mens er nog
-- niet naar heeft gekeken.
insert into client_groups (name, sort_order, agency_id, soort, bevestigd, reden)
select 'Easy-Ergonomics',
       coalesce((select max(sort_order) from client_groups), 0) + 1,
       (select agency_id from accounts where name like 'Easy-Ergonomics%' limit 1),
       'merk', false, 'regiosuffix'
where not exists (select 1 from client_groups where name = 'Easy-Ergonomics');

insert into client_group_members (group_id, client_id)
select (select id from client_groups where name = 'Easy-Ergonomics'), a.client_id
from accounts a where a.name like 'Easy-Ergonomics%'
on conflict do nothing;

-- ── 051 weer weg ────────────────────────────────────────────────────────────
-- De constraint eerst: hij verwijst naar merken en houdt de drop anders tegen.

alter table accounts drop constraint if exists accounts_merk_zelfde_bureau;
alter table accounts drop column if exists merk_id;
alter table accounts drop column if exists merk_bevestigd;
alter table accounts drop column if exists merk_reden;
drop table if exists merken;

-- ── Controle ────────────────────────────────────────────────────────────────

select g.name, g.soort, g.bevestigd, count(m.client_id) as leden,
       (g.agency_id is not null) as heeft_bureau, g.reden
from client_groups g left join client_group_members m on m.group_id = g.id
group by g.id, g.name, g.soort, g.bevestigd, g.agency_id, g.reden
order by g.name;

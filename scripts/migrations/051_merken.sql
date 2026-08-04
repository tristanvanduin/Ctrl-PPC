-- INGEHAALD DOOR MIGRATIE 052 -- NIET MEER DRAAIEN.
--
-- Deze migratie bouwde een aparte `merken`-tabel. Dat niveau was nodig, maar het bestond al als
-- client_groups + client_group_members, met een beheerscherm en drie handmatig gemaakte groepen.
-- Twee daarvan waren identiek aan wat het algoritme voorstelde. 052 voegt beide samen in
-- client_groups en verwijdert wat hier gemaakt is.
--
-- Het bestand blijft staan omdat de migratiereeks een logboek is en niet een wensenlijst: dit is
-- werkelijk gedraaid, en de redenering eronder -- vooral over voorstel-versus-besluit en over een
-- merk dat nooit twee bureaus mag raken -- is met 052 meeverhuisd. Opnieuw draaien maakt alleen
-- een lege tabel aan waar niets naar wijst.

-- 051: het niveau tussen bureau en account — het merk.
--
-- DRAAIEN: idempotent, veilig te herhalen. Puur additief: één nieuwe tabel en drie nullable
-- kolommen op accounts. Geen bestaande rij verandert en geen regel code leest ze nog.
-- Terugdraaien is `alter table accounts drop column merk_id, drop column merk_bevestigd,
-- drop column merk_reden; drop table merken;`.
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- Migratie 035 zette twee niveaus neer: bureau → account. In de praktijk zit daar er nog één
-- tussen. Een klant met meerdere regio's heeft per regio een eigen Ads-account met een eigen id,
-- en dus hier een eigen client_id. Dat is niet hypothetisch — het staat er al in:
--
--   MPC                6 accounts   BE, DE, FR, General, NL, UK
--   Easy-Ergonomics    3 accounts   BE, DE, NL
--   GoedeInnovaties    3 accounts   Confidenceforal, Wobblez, Zeemeerminnenfeest
--   9altitudes         2 accounts   België, Nederland
--
-- 15 van de 71 accounts. Vandaag zijn dat 15 losse klanten in het dashboard, zonder enige plek
-- die zegt dat MPC - BE en MPC - DE hetzelfde merk zijn. Vergelijken kan dus niet, terwijl dat
-- juist de vraag is die de gebruiker stelt.
--
-- ── DRIE KOLOMMEN, EN WAAROM HET ER DRIE ZIJN ───────────────────────────────
--
-- De koppeling komt uit een VOORSTEL dat uit de accountnaam is afgeleid (zie
-- lib/branding/merkgroepen.ts). Een naam is een aanwijzing, geen bewijs: de eerste versie van dat
-- algoritme zette "Easy Living" bij "Easy-Ergonomics" omdat ze allebei met "Easy" beginnen. Twee
-- verschillende klanten, en als die stilzwijgend in één rapport belanden telt het budget van de
-- één bij de omzet van de ander.
--
-- Daarom is een voorstel zichtbaar een voorstel:
--
--   merk_id = null,  bevestigd = false   nog niet bekeken
--   merk_id gevuld,  bevestigd = false   VOORSTEL, wacht op een mens
--   merk_id gevuld,  bevestigd = true    bevestigd lid van dit merk
--   merk_id = null,  bevestigd = true    bewust losstaand; het voorstel is afgewezen
--
-- Die laatste stand is er zodat het voorstelscript weet dat het niet opnieuw moet voorstellen.
-- Zonder die stand zou elke afwijzing bij de volgende run terugkomen, en dan wordt de knop
-- "afwijzen" betekenisloos.
--
-- merk_reden draagt welke REGEL het voorstel opleverde ('regiosuffix', 'scheidingsteken', of
-- allebei). Op het bevestigingsscherm is dan te zien waaróm iets wordt voorgesteld. Een voorstel
-- zonder reden is over drie maanden niet van een besluit te onderscheiden — dezelfde afspraak als
-- bij de uitzonderingslijsten in de poorten.
--
-- ── EEN MERK KAN NOOIT OVER TWEE BUREAUS HEEN ───────────────────────────────
--
-- Als een merk accounts van twee bureaus kon bevatten, zou één vergelijkend rapport data van twee
-- tenants naast elkaar zetten. Dat is precies het lek dat het bureaus-model moet uitsluiten, en
-- het zou hier via een achterdeur terugkomen.
--
-- Vandaar de samengestelde vreemde sleutel op (merk_id, agency_id) in plaats van op merk_id
-- alleen. Daarmee kan de DATABASE het niet meer: een account koppelen aan een merk van een ander
-- bureau geeft een foutmelding, ongeacht welke code het probeert. Een controle in de applicatie
-- zou hetzelfde beweren en te omzeilen zijn.

create table if not exists merken (
  id          uuid primary key default gen_random_uuid(),
  -- restrict, net als bij accounts: een bureau opheffen mag nooit stilzwijgend de merkindeling
  -- van twintig accounts meenemen.
  agency_id   uuid not null references agencies(id) on delete restrict,
  slug        text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (agency_id, slug)
);

-- Nodig als doel van de samengestelde vreemde sleutel hieronder.
create unique index if not exists idx_merken_id_agency on merken (id, agency_id);

alter table accounts add column if not exists merk_id        uuid;
alter table accounts add column if not exists merk_bevestigd boolean not null default false;
alter table accounts add column if not exists merk_reden     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_merk_zelfde_bureau') then
    alter table accounts add constraint accounts_merk_zelfde_bureau
      foreign key (merk_id, agency_id) references merken (id, agency_id) on delete set null;
  end if;
end $$;

create index if not exists idx_accounts_merk on accounts (merk_id);

comment on column accounts.merk_bevestigd is
  'true betekent dat een mens ernaar heeft gekeken. Met merk_id gevuld: bevestigd lid. Met merk_id '
  'leeg: bewust losstaand, het voorstel is afgewezen en hoort niet terug te komen.';
comment on column accounts.merk_reden is
  'Welke regel uit lib/branding/merkgroepen.ts dit voorstel opleverde. Leeg bij een koppeling die '
  'met de hand is gelegd.';

-- ── Controle ────────────────────────────────────────────────────────────────
-- Nog leeg; het vullen doet scripts/stel-merkgroepen-voor.ts, want het algoritme staat in
-- TypeScript en hoort niet in twee talen te bestaan.

select
  (select count(*) from merken) as merken,
  (select count(*) from accounts where merk_id is not null) as gekoppelde_accounts,
  (select count(*) from accounts) as accounts;

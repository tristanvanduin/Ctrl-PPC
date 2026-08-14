-- 075: fact_core en fact_dimension verbreden met tenant- en herkomstkolommen.
--
-- DRAAIEN: idempotent, additief. Zes kolommen op twee tabellen, allemaal nullable. Geen enkele
-- bestaande rij, index of policy verandert. Backfill en NOT NULL komen in 076, apart, want een
-- kolom toevoegen en een kolom dwingend maken zijn twee verschillende risico's en horen niet in
-- dezelfde stap te zitten -- valt 076 om, dan staat 075 nog gewoon overeind.
--
-- ── WAAROM DEZE ZES ──────────────────────────────────────────────────────────
--
-- agency_id, client_id   De feitenlagen zijn vandaag alleen op account_id te bevragen. Elke
--                        aggregatie per bureau (God Mode, macrotrends) of per klant (de
--                        outputlaag) moet daarvoor eerst joinen op accounts. Denormaliseren
--                        scheelt die join op precies de twee plekken waar hij het vaakst gebeurt.
--                        Zie docs/MASTERPLAN.md sectie 1.1 voor de sleutelkeuze.
--
-- currency               Meta en LinkedIn dragen valuta per connectie (meta_connections.currency,
--                        linkedin_connections.currency); Google draagt hem nergens in de
--                        brontabellen. Zonder deze kolom is optellen over kanalen heen stilzwijgend
--                        fout zodra er een niet-euro account bijkomt. Nullable: onbekend is een
--                        eerlijke waarde, een verzonnen "EUR" niet.
--
-- leads                  Meta en LinkedIn kennen leads apart van conversions; de projectiefunctie
--                        telt ze vandaag bij conversions op (channel-conversion-config, de
--                        standaard) en de losse waarde gaat verloren. Met een eigen kolom kan een
--                        analyse ze weer uit elkaar trekken zonder de bestaande som te breken.
--
-- data_quality_score     Voorbereiding op de God View-kwalificatielaag (fase 6): een score per
--                        rij, niet per account, zodat een kwalificatiebeslissing niet grover hoeft
--                        te zijn dan de data die eronder ligt. 1.0 = normale geprojecteerde rij;
--                        de betekenis van lagere waarden wordt vastgelegd zodra er een reden is om
--                        er een te schrijven, niet nu al verzonnen.
--
-- source_table           Traceerbaarheid: welke brontabel deze rij voedde. Vereist door de
--                        vertrouwensdoctrine in het masterplan (regel 1: elk getal is
--                        herleidbaar) en kost hier niets, want de projectiefunctie weet het al
--                        op het moment van schrijven.
--
-- ── WAT HIER BEWUST NIET BIJ KOMT ────────────────────────────────────────────
--
-- Geen ctr/cpc/cpm/cvr/cpa/roas. Dat zijn quotiënten van kolommen die er al staan. Opslaan
-- betekent dat ze bij elke correctie moeten meebewegen, en de bestaande views laten al zien dat
-- dat misgaat: ads_account_monthly's opgeslagen roas wijkt op 1.049 van 4.707 campagnerijen af
-- van zijn eigen cost/conversions_value, want Google kent conversies toe aan de klikdatum en
-- herrekent maanden later. Een view of gegenereerde kolom kan dit niet fout hebben; een
-- opgeslagen kolom kan dat wel, en heeft het hier al bewezen.
--
-- Terugdraaien: de zes ALTER TABLE ... DROP COLUMN-regels hieronder, in omgekeerde volgorde.

alter table fact_core
  add column if not exists agency_id         uuid,
  add column if not exists client_id         text,
  add column if not exists currency          text,
  add column if not exists leads             numeric,
  add column if not exists data_quality_score numeric,
  add column if not exists source_table      text;

alter table fact_dimension
  add column if not exists agency_id         uuid,
  add column if not exists client_id         text,
  add column if not exists currency          text,
  add column if not exists leads             numeric,
  add column if not exists data_quality_score numeric,
  add column if not exists source_table      text;

comment on column fact_core.agency_id is
  'Gedenormaliseerd vanuit accounts.agency_id. Bevolkt in 076, NOT NULL sinds die migratie.';
comment on column fact_core.client_id is
  'Gedenormaliseerd vanuit accounts.client_id -- de bedrijfssleutel die de outputlaag gebruikt. Bevolkt in 076, NOT NULL sinds die migratie.';
comment on column fact_core.currency is
  'ISO-valutacode uit meta_connections/linkedin_connections. NULL voor Google (geen valutakolom in de bron) en voor rijen van voor de connectie bestond.';
comment on column fact_core.leads is
  'Het lead-deel van conversions, apart bewaard. conversions zelf blijft leads + overige conversies, zoals de bestaande projectie al rekent -- deze kolom voegt toe, breekt niets.';
comment on column fact_core.data_quality_score is
  '1.0 = normale geprojecteerde rij. Voorbereiding op de God View-kwalificatielaag (fase 6); geen lagere waarde wordt vandaag geschreven.';
comment on column fact_core.source_table is
  'De brontabel die deze rij voedde, gezet door refresh_fact_from_legacy(). Traceerbaarheid: elk getal moet naar zijn bron te herleiden zijn.';

comment on column fact_dimension.agency_id is
  'Zie fact_core.agency_id -- zelfde herkomst, zelfde reden.';
comment on column fact_dimension.client_id is
  'Zie fact_core.client_id.';
comment on column fact_dimension.currency is
  'Zie fact_core.currency.';
comment on column fact_dimension.leads is
  'Zie fact_core.leads. Alleen gezet waar de brontabel een apart leads-veld draagt (vandaag: geen van de negen dimensiebronnen; klaar voor als dat verandert).';
comment on column fact_dimension.data_quality_score is
  'Zie fact_core.data_quality_score.';
comment on column fact_dimension.source_table is
  'Zie fact_core.source_table.';

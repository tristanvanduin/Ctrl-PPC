-- 098: agency_analysis_output -- opslag voor kanaaloverstijgende analyses op AGENCY-niveau
-- (portfolio-synthese, masterplan 17.15), naast het bestaande client-niveau sop_analysis_output.
--
-- WAAROM EEN NIEUWE TABEL EN NIET client_id HERGEBRUIKEN
--
-- sop_analysis_output.client_id is `not null text`, met een unieke index op
-- (client_id, sop_type, analysis_date, section). Een portfolio-synthese heeft geen client_id --
-- hij gaat over MEERDERE klanten van hetzelfde bureau tegelijk. Een verzonnen client_id (bijv.
-- "agency-<id>") zou werken maar is precies het soort verborgen aanname dat een volgende
-- ontwikkelaar in de val laat lopen (query's die op client_id filteren zouden 'm stilzwijgend
-- meetellen als een echte klant). Een eigen tabel, agency_id als sleutel, is expliciet.
--
-- WAAROM GEEN sop_type-KOLOM (in tegenstelling tot sop_analysis_output)
--
-- sop_analysis_output onderscheidt kanalen via sop_type (monthly/meta_monthly/...) en het
-- cross-channel-mechanisme via sop_type="cross_channel". Op agency-niveau bestaat vandaag maar
-- één soort analyse (portfolio-synthese); een sop_type-kolom voor precies één waarde is
-- premature abstractie. Section is voldoende, net als bij de cross_channel-rijen zelf.
--
-- RLS: bewust NOG NIET aangezet, zelfde status als sop_analysis_output vandaag (zie
-- 065_rls_sop_intelligence.sql's eigen "NIET UITGEVOERD"-notitie -- 92 van de 122 tabellen misten
-- RLS op 9 augustus, en sop_analysis_output staat op die lijst als bewust uitgesteld tot de
-- browser-leespaden via O1_AUTH_ENFORCED omgezet zijn). Deze tabel volgt exact hetzelfde,
-- getrackte gat, niet een nieuw gat -- alle lees-/schrijfpaden lopen vandaag server-side via de
-- service-role-client, precies zoals bij sop_analysis_output.
--
-- Idempotent.

create table if not exists agency_analysis_output (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies(id) on delete cascade,
  section       text not null,
  analysis_date date not null,
  period_start  date not null,
  period_end    date not null,
  output        text not null,
  model_used    text,
  tokens_used   integer,
  step_number   integer,
  step_name     text,
  created_at    timestamptz default now()
);

create unique index if not exists uq_agency_output_agency_section_date
  on agency_analysis_output (agency_id, section, analysis_date);

create index if not exists idx_agency_output_agency_section
  on agency_analysis_output (agency_id, section, analysis_date desc);

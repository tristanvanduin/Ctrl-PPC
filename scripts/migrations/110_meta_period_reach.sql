-- 110: meta_period_reach, vertoningen en bereik van Meta over een HEEL venster in een lezing.
--
-- STATUS: NIET GEDRAAID. Geschreven op 13 november 2026 bij de doorlichting (sectie 1, Meta-
-- frequentie). De code werkt zonder deze tabel: de signaalroute leest hem, en als hij ontbreekt of
-- leeg is meldt de detector "frequentie niet te beoordelen" in plaats van stil "niets gevonden".
-- TOT DEZE MIGRATIE GEDRAAID IS, GAAN FATIGUE EN SATURATIE IN DE APP DUS NOOIT AF: ze melden
-- alleen "niet te beoordelen". Ook in de demo-app (lib/demo/demo-rows.ts kent de tabel niet); de
-- --check van scripts/demo/seed-demo-client.ts zegt dat er bij S1 en S2 bij.
-- De dagelijkse Meta-run (lib/sync/kanaal-runs.ts) roept syncMetaPeriodReach aan. Die kijkt eerst
-- of de tabel er is; zonder tabel vraagt hij niets aan Meta, zet "overgeslagen: tabel ontbreekt"
-- in het sync-verslag (rows_upserted.periodeBereik) en laat de run niet mislukken.
-- Terugdraaien: `drop table if exists meta_period_reach;`
--
-- ── WAAROM EEN APARTE TABEL ──────────────────────────────────────────────────
--
-- De dagtabellen (meta_ad_daily, meta_campaign_daily) worden per dag opgehaald (time_increment 1).
-- Hun `frequency` is dus vertoningen gedeeld door het bereik van DIE DAG. De drempels van de
-- detectors (3 voor fatigue, 4 voor saturatie) zijn periodenormen: hoe vaak dezelfde persoon de
-- uiting in vier weken zag. Bereik is niet optelbaar over dagen (dezelfde persoon telt dan elke
-- dag opnieuw), dus de periodefrequentie is niet uit de dagrijen af te leiden. Meta levert hem
-- alleen als je het venster in een aanroep vraagt, zonder time_increment. Die lezing hoort niet in
-- de dagtabel: ze heeft een begin en een eind in plaats van een datum.
--
-- Een rij per niveau, entiteit en venster. De sync schrijft het trailing venster van 28 dagen; een
-- nieuwe dag geeft een nieuw venster en dus een nieuwe rij. De lezer kiest het venster dat
-- (bijna) samenvalt met zijn eigen recente venster.

create table if not exists meta_period_reach (
  client_id     text    not null,
  level         text    not null check (level in ('account', 'campaign', 'adset', 'ad')),
  entity_id     text    not null,
  period_start  date    not null,
  period_end    date    not null,
  impressions   bigint,
  reach         bigint,
  frequency     numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, level, entity_id, period_start, period_end)
);
create index if not exists idx_meta_period_reach_lookup on meta_period_reach (client_id, level, period_end);

comment on table meta_period_reach is 'Meta-insights over een heel venster in een aanroep (zonder time_increment): het enige ontdubbelde bereik, en dus de enige grondslag voor een periodefrequentie.';
comment on column meta_period_reach.frequency is 'Vertoningen / over de periode ontdubbeld bereik, zoals Meta hem levert. Niet te vergelijken met de dagfrequentie in meta_*_daily.';

-- RLS naar het patroon van 067: lezen alleen voor zichtbare klanten, schrijven alleen via de
-- service-role (de sync).
alter table meta_period_reach enable row level security;

drop policy if exists meta_period_reach_zichtbaar on meta_period_reach;
create policy meta_period_reach_zichtbaar on meta_period_reach for select
  using (client_id in (select app_zichtbare_klanten()));

-- Controle na toepassen (verwacht: rowsecurity = true, een policy):
--   select relrowsecurity from pg_class where relname = 'meta_period_reach';
--   select policyname, cmd from pg_policies where tablename = 'meta_period_reach';

-- 082: eenmalige backfill van client_settings.kpi_targets naar client_targets, voor de drie
-- echte klanten die vandaag een niet-lege kpi_targets hebben (gads-4140363870, gads-7649590091,
-- gads-8375102493 -- nagemeten 15 augustus 2026).
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- Fase 2 (docs/MASTERPLAN.md): client_targets (migratie 002) en de bijbehorende helpers in
-- lib/analysis/o2-targets-cost.ts lagen al bekabeld in app/api/analysis/monthly/route.ts, maar
-- de tabel had nul rijen -- dus was resolveTargets() daar altijd {} en had het pad geen enkel
-- effect. Ondertussen dreef client_settings.kpi_targets de ECHTE analyse voor deze drie klanten,
-- via een aparte, oudere weg (fetchClientContext -> goalsSection). Twee lezingen van in wezen
-- hetzelfde getal, uit twee bronnen die uiteen konden lopen. Deze migratie plus de code-wijziging
-- in dezelfde commit maken client_targets de enige bron; kpi_targets blijft bestaan voor de
-- velden die client_targets niet kent (revenueMode, conversionsMode, revenueAbsolute,
-- revenueGrowthPct, conversionsAbsolute, conversionsGrowthPct -- geen daarvan is een
-- kanaal-scoped numeriek metric-target, dus geen kandidaat voor deze tabel).
--
-- ── WAAROM valid_from VER IN HET VERLEDEN EN valid_to LEEG ───────────────────
--
-- kpi_targets kende geen tijdsdimensie: het was altijd "het" target, ongeacht welke maand
-- geanalyseerd werd. Een valid_from op de huidige maand (zoals het voorbeeld in migratie 002
-- suggereert) zou een tijdsgrens UITVINDEN die er nooit was, en zou bovendien een analyse over
-- een oudere maand (deze klanten syncen niet meer sinds april) buiten de geldigheid zetten.
-- 2000-01-01 dekt elke maand die deze database ooit zal bevatten; valid_to blijft null (open
-- einde), exact het gedrag dat kpi_targets altijd had.
--
-- ── WAAROM ALLEEN CPA EN ROAS ────────────────────────────────────────────────
--
-- client_targets is qua vorm (channel, metric, target_value) alleen geschikt voor de
-- kanaal-scoped numerieke metrics die het al kent: cpa, roas, cpl, conversions, spend,
-- conversion_value. kpi_targets.cpaTarget/roasTarget passen daar direct op; de overige velden
-- (revenueMode/conversionsMode e.a.) beschrijven een ander soort doel (bedrijfsbreed, met een
-- modus-keuze) en horen niet in deze tabel thuis. Migratie 002 zegt het letterlijk: dit vervangt
-- "het platte kpiTargets-object (roasTarget, cpaTarget, DEFAULT 0)" -- niet de rest.
--
-- Nul-targets worden overgeslagen, exact zoals resolveTargets ze ook als "geen target" behandelt.
--
-- Idempotent via de unique-constraint (client_id, channel, metric, valid_from) uit migratie 002.

insert into client_targets (client_id, channel, metric, target_value, valid_from, valid_to, note, created_by)
select client_id, 'google_ads', 'cpa', (kpi_targets->>'cpaTarget')::numeric, '2000-01-01', null,
  'Backfill uit kpi_targets (migratie 082)', 'migratie-082'
from client_settings
where kpi_targets ? 'cpaTarget'
  and (kpi_targets->>'cpaTarget')::numeric > 0
  and client_id in ('gads-4140363870', 'gads-7649590091', 'gads-8375102493')
on conflict (client_id, channel, metric, valid_from) do nothing;

insert into client_targets (client_id, channel, metric, target_value, valid_from, valid_to, note, created_by)
select client_id, 'google_ads', 'roas', (kpi_targets->>'roasTarget')::numeric, '2000-01-01', null,
  'Backfill uit kpi_targets (migratie 082)', 'migratie-082'
from client_settings
where kpi_targets ? 'roasTarget'
  and (kpi_targets->>'roasTarget')::numeric > 0
  and client_id in ('gads-4140363870', 'gads-7649590091', 'gads-8375102493')
on conflict (client_id, channel, metric, valid_from) do nothing;

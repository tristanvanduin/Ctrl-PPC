-- 071: agencies.licentie van drie waarden naar de 5-tier ladder uit de v2.0-blueprint.
--
-- Idempotent, draait direct. Draaien: node scripts/supabase-sql.mjs --file scripts/migrations/071_licentie_vijf_tiers.sql
-- Terugdraaien: de UPDATE hieronder omkeren (`update agencies set licentie = 'premium' where
-- licentie = 'growth'`), dan de constraint terugzetten op de oude drie waarden.
--
-- ── WAT ER VERANDERT ──────────────────────────────────────────────────────
--
-- Was: basis | premium | enterprise (migratie 060). Wordt: basis | core | growth | scale |
-- professional | enterprise. 'basis' blijft de gratis default (geen wijziging: onbeperkt accounts,
-- dashboard en forecast blijven altijd werkbaar, zie het gesprek over het tier-model). 'premium'
-- verdwijnt: het dekte in migratie 060 zowel de chat als "straks het verhoogde API-plafond" --
-- precies de twee dingen die nu de vijf genoemde tiers uit de blueprint zijn, elk met een eigen
-- creditpool en featureset in plaats van één ongedifferentieerd "premium".
--
-- ── DE BESTAANDE 'premium'-RIJ: NAAR 'growth', NIET NAAR 'enterprise' ──────
--
-- Er is precies één bureau met licentie = 'premium': het demo-bureau (slug 'demo', migratie 060,
-- zodat de chat in de demo te zien is). Van de vijf nieuwe tiers is 'growth' de eerste met
-- cross-account inzichten -- de bureaubrede blik naast de per-klant weergave -- en dat is
-- precies de reden waarom het demo-bureau al op de verhoogde licentie stond: het moet tonen
-- wat een betalend bureau boven 'basis' krijgt. 'enterprise' zou meer suggereren dan een
-- demo-account hoort te tonen (maatwerk-SLA's, dedicated servers); 'growth' is de kleinste
-- stap die nog steeds alles laat zien wat vandaag al achter de licentiecheck zit (chat).
--
-- ── WAT DIT NIET DOET ────────────────────────────────────────────────────
--
-- Geen creditpool-toewijzing (dat is credit_ledger, migratie 070, en CREDIT_COSTS staat nog
-- leeg) en geen featuregates voor de nieuwe tier-exclusieve functies uit de blueprint (Custom
-- Playbook Engine, BI Connect, MCP-sandbox) -- die functies bestaan nog niet in de code. Deze
-- migratie verbreedt alleen het toegestane bereik van de kolom en herijkt de ENE bestaande
-- consument (magChatten in lib/chat/toegang.ts) op de nieuwe namen.

update agencies set licentie = 'growth' where licentie = 'premium';

alter table agencies drop constraint if exists agencies_licentie_geldig;
alter table agencies add constraint agencies_licentie_geldig
  check (licentie in ('basis', 'core', 'growth', 'scale', 'professional', 'enterprise'));

comment on column agencies.licentie is
  'basis | core | growth | scale | professional | enterprise (migratie 071, was basis/premium/'
  'enterprise in 060). basis = gratis, geen betaalde tier. De chatgate (magChatten, lib/chat/'
  'toegang.ts) ligt vandaag op growth-en-hoger; welke tier welke blueprint-feature ontgrendelt '
  'is verder nog niet vastgelegd in code.';

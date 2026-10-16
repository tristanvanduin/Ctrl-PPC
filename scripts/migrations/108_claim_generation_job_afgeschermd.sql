-- 108: claim_generation_job alleen nog voor service_role.
--
-- NOG NIET GEDRAAID. Wacht op akkoord van de eigenaar; deze migratie wijzigt rechten in de live
-- database. Terugweg: `grant execute on function claim_generation_job(text[]) to anon,
-- authenticated;` -- seconden werk, geen dataverlies.
--
-- ── WAAROM ───────────────────────────────────────────────────────────────────
--
-- claim_generation_job (migratie 090) zet de oudste queued job op 'running'. De enige aanroeper is
-- de nachtelijke action-queue (app/api/cron/process-action-queue/route.ts), met de service-role-
-- sleutel. Toch hadden anon en authenticated het EXECUTE-recht, zoals elke functie in public die
-- niet expliciet wordt afgeschermd.
--
-- De poort scripts/check-rpc-rechten.mjs had dit moeten vangen en stond groen om de verkeerde
-- reden: zijn mutatieherkenning (`update\s+\w` gevolgd door \b) zag alleen een update op een
-- tabelnaam van één letter. Op 16 oktober 2026 hersteld (scripts/rpc-mutatie.mjs, met test); de
-- poort is daarna terecht rood tot deze migratie gedraaid is.
--
-- ── HET WERKELIJKE RISICO, EERLIJK ───────────────────────────────────────────
--
-- Klein. De functie is security invoker (geen `security definer`), en generation_jobs heeft voor
-- anon en authenticated alleen een SELECT-policy (migratie 081). De `for update` en de `update`
-- in de functie vinden voor die rollen dus geen rij: een aanroep claimt niets. Dit is
-- verdediging in de diepte -- een latere UPDATE-policy op generation_jobs zou het gat anders
-- stilzwijgend openzetten -- en het maakt de poort weer betrouwbaar.

revoke execute on function claim_generation_job(text[]) from public, anon, authenticated;
grant execute on function claim_generation_job(text[]) to service_role;

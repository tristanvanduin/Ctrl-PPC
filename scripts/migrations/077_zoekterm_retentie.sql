-- 077: rollende bewaartermijn van 2 maanden op zoekterm-niveau data.
--
-- DRAAIEN: idempotent, veilig te herhalen. Maakt één functie aan; verwijdert bij het eerste
-- draaien historische rijen (dat is het punt van deze migratie), daarna alleen wat er sinds de
-- vorige aanroep is bijgekomen.
--
-- ── WAAROM ZOEKTERMEN EN NIETS ANDERS ─────────────────────────────────────────
--
-- Zoektermen zijn een notice-and-act laag: een specialist ziet een verspillende term in de
-- eerstvolgende SOP-cyclus, sluit hem uit of niet, en daarna heeft de losse rij geen waarde meer.
-- Geen enkele analyseroute leest zoektermdata verder terug dan drie maanden (grep op monthsAgo in
-- app/api/analysis/ en lib/analysis/monthly-prepared-context.ts, 14 augustus 2026). Andere
-- detailtabellen (keyword, device, netwerk, ad schedule) blijven vooralsnog buiten deze migratie
-- -- productbeslissing, niet vergeten: die krijgen desgewenst een eigen, ruimere termijn in een
-- latere migratie.
--
-- Drie tabellen dragen zoektermdata: ads_search_terms_monthly, ads_search_terms_wasteful (beide
-- bron) en fact_dimension met dimension='search_term' (canoniek, migratie 043/076). Alle drie
-- vallen onder dezelfde regel.
--
-- ── PER KLANT, NIET GLOBAAL ───────────────────────────────────────────────────
--
-- De grens is "de laatste maand die DEZE klant heeft, min één maand" en niet "twee maanden terug
-- vanaf vandaag". Het verschil is groot: op 14 augustus 2026 staat de Google-sync al sinds 17
-- april stil (zie docs/MASTERPLAN.md sectie 2.1), dus "twee maanden vanaf vandaag" had op dat
-- moment de ENIGE data die er is (april) ook weggegooid -- ontdekt tijdens het handmatig narekenen
-- van deze migratie, vóór er iets werd uitgevoerd. Een klant-eigen grens is bovendien nodig zodra
-- er een tweede bureau bijkomt: die synct niet noodzakelijk in dezelfde maand als de eerste, en een
-- globale grens zou dan de ene klant straffen voor de sync-status van de andere.
--
-- ── WANNEER DIT DRAAIT ────────────────────────────────────────────────────────
--
-- Niet via pg_cron (bewust uit tot na de testfase, zie masterplan besluit 1). Aangeroepen vanuit
-- lib/sync/orchestrator.ts, direct na refresh_fact_from_legacy() voor de klant die net gesynct is
-- -- dezelfde plek, dezelfde reden: de bewaartermijn hoeft alleen te bewegen op het moment dat er
-- nieuwe data binnenkomt, niet op een eigen klok.

create or replace function prune_zoekterm_historie(p_client_id text default null)
returns table (onderdeel text, rijen bigint)
language plpgsql
as $$
declare
  n bigint;
begin
  with grenzen as (
    select client_id, date_trunc('month', max(month)) - interval '1 month' as grens
    from ads_search_terms_monthly
    where p_client_id is null or client_id = p_client_id
    group by client_id
  )
  delete from ads_search_terms_monthly s
  using grenzen g
  where s.client_id = g.client_id and s.month < g.grens;
  get diagnostics n = row_count; onderdeel := 'ads_search_terms_monthly'; rijen := n; return next;

  with grenzen as (
    select client_id, date_trunc('month', max(week_start)) - interval '1 month' as grens
    from ads_search_terms_wasteful
    where p_client_id is null or client_id = p_client_id
    group by client_id
  )
  delete from ads_search_terms_wasteful s
  using grenzen g
  where s.client_id = g.client_id and s.week_start < g.grens;
  get diagnostics n = row_count; onderdeel := 'ads_search_terms_wasteful'; rijen := n; return next;

  with grenzen as (
    select client_id, date_trunc('month', max(period_start)) - interval '1 month' as grens
    from fact_dimension
    where dimension = 'search_term' and (p_client_id is null or client_id = p_client_id)
    group by client_id
  )
  delete from fact_dimension f
  using grenzen g
  where f.dimension = 'search_term' and f.client_id = g.client_id and f.period_start < g.grens;
  get diagnostics n = row_count; onderdeel := 'fact_dimension search_term'; rijen := n; return next;
end;
$$;

revoke execute on function prune_zoekterm_historie(text) from public, anon, authenticated;
grant execute on function prune_zoekterm_historie(text) to service_role;

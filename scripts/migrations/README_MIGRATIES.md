# Canonieke migratieset (W0.1, geconsolideerd 2 juli 2026)

Dit is de ENIGE geldige migratieset. De juni-zip (sql_migraties.zip) en de losse
container-bestanden zijn hierin geconsolideerd en daarmee vervallen. Regel 7 van
MASTERPLAN_V2: nooit een tabel in twee bestanden; elke schemawijziging is een
idempotent addendum plus een kolom-diff tegen de code.

## Draaivolgorde

Strikt oplopend, 000 tot en met 017, per fase (niet alles vooraf). De runner (000)
registreert elke toegepaste migratie met checksum in schema_migrations.

- 000 schema_migrations: de runner-administratie. Altijd eerst.
- 001 user_roles: bij fase O1 (W1.2).
- 002 client_targets, 003 llm_usage: bij fase O2-wiring (W1.1).
- 004 analysis_runs_alerts: bij fase O3 (W1.3). PREFLIGHT UITGEVOERD: breidt het
  bestaande generation_jobs uit (geen parallelle tabel), plus alerts_log en de
  analysis_schedule-kolom op client_settings.
- 005 analysis_hypotheses, 010 hypothese_uitkomst, 011 sprint_hypotheses_source: bij de
  H- en E-wiring (W2.3, W2.4).
- 006 analysis_tasks: bij fase H2 (W2.4).
- 007 meta: bij de Meta-live-gang (WL.4). Container-basis (code-aligned, entity_id)
  plus juni-addenda: meta_connections (token_ref, currency, account_timezone),
  meta_creatives, meta_change_log, en campagne-metadata (buying_type, bid_strategy,
  start_time, stop_time).
- 008 linkedin: bij de LinkedIn-live-gang (WL.5). Container-basis (code-aligned,
  entity_urn, conversion_value enkelvoud) plus addendum currency op linkedin_connections.
- 009 linkedin_icp: samen met 008.
- 012 expert_layers: dekt ads_leading_indicators, ads_portfolio_analysis,
  sop_client_context, sop_hypothesis_tracking (de code verwacht ze al).
- 013 meta_vision: bij fase M3 (W3.2).
- 014 blended_view: GUARD, NIET DRAAIEN buiten fase X1 (W3.4). De Google-TODO's en de
  W0.1-aanvulling (entity_id, entity_urn, conversions_value versus conversion_value)
  moeten eerst vervangen zijn.
- 015 client_onboarding: bij fase X2 (W3.5).
- 016 backup_restore_log: bij fase Z2 (W1.5).
- 017 rls_lockdown: GUARD, uitsluitend samen met de O1-deploy (WL.3). Nooit eerder,
  anders sluit de lockdown de huidige open app buiten.
- 032 user_client_scope: samen met 001, bij de O1-deploy (WL.3). Verbreedt de rol-check
  van 001 naar het rechtenmodel (admin, performance_marketeer, beurs_manager,
  brand_strateeg, it, viewer) en voegt user_clients toe: welke beurs iemand mag zien.
  Levert ook app_can_read_client(), de bouwsteen voor de scope-policies bij 017.

## De volgorde bij de O1-deploy

De autorisatie is pas een grens als alle vier de stappen staan; los van elkaar is elke
stap cosmetisch of brekend.

1. ~~De client-side writes verhuizen naar server-routes.~~ GEDAAN. Alle schrijfacties uit
   de browser lopen nu via `/api/data/[table]` met de service role; het beleid staat in
   `lib/data-access/write-policy.ts`. Zolang O1_AUTH_ENFORCED uit staat gedraagt die route
   zich als voorheen (geen rechtencheck), zodat er vandaag niets verandert.
2. ~~001 en 032 draaien, eerste admin seeden, rollen en beurzen toewijzen.~~ GEDAAN. Bevestigd
   20 augustus 2026 (masterplan 15.6): 1 admin, 1 bureau, echte login vandaag.
3. **O1_AUTH_ENFORCED=true.** NOG NIET GEZET. Dit is een Vercel-environment-variabele, geen
   databasewijziging -- alleen te zetten door wie toegang heeft tot het Vercel-project, niet
   vanuit een sandbox-sessie. De middleware die deze vlag activeert is inmiddels wél
   functioneel geverifieerd (masterplan 15.6-vervolg): een echte tijdelijke testgebruiker,
   een echte wachtwoord-login, de sessiecookie in het exacte @supabase/ssr-formaat rechtstreeks
   getest tegen de productie-Supabase -- publieke paden blijven publiek, beveiligde paden
   redirecten correct, eigen-bureau-toegang wordt toegelaten, andere-bureau-toegang geweigerd.
   Zet de vlag, redeploy, en bevestig zelf door in te loggen op de live site voordat stap 5 draait.
4. ~~017 draaien, RLS-policies per tabel.~~ GEDAAN (via de latere, hernummerde migraties --
   o.a. 081, 096 -- RLS-dekking voor alle 127 tabellen bevestigd, masterplan 15.1).
5. **099 draaien** (`security_invoker = true` op de negen legacy views die nu nog om RLS
   heenlezen -- masterplan 15.6). PAS na bevestiging van stap 3, nooit ervoor: zie de kop van
   099 voor waarom eerder draaien een leeg live dashboard oplevert voor elke sessieloze lezing.

Stap 1 was ooit de blokkade: 017 gaf bewust geen write-policies, dus elke schrijfactie die nog
vanuit de browser liep zou op dat moment stil zijn gaan falen. Dat kan nu niet meer gebeuren.
Stap 3 is nu de enige echte blokkade tussen hier en een volledig afgedwongen scheiding.

## Consolidatie-beslissingen (uit ANALYSE_VOOR_MASTERPLAN_V2, sectie 2a)

De code is de waarheid. Voor elke tabel waar gebouwde code tegen schrijft won de
container-definitie (kolommen exact gelijk aan lib/meta/rows.ts en lib/linkedin/rows.ts).
De juni-set bleef leidend voor de nog-niet-gebouwde fases. Drie juni-verrijkingen zijn
als addenda overgenomen: currency op beide connections, meta_campaigns-metadata, en de
rijkere llm_usage (channel, sop_type, step_label; call_label behouden als vrij label).

Mapping oud naar nieuw: juni 009 werd 013, juni 012 werd 014, juni 013 werd 015, juni
014 werd 016, juni 015 werd 017. Vervallen (geconsolideerd): juni 002, 003, 007, 008,
010, 011; container meta-tables.sql, expert-layers.sql, e1-hypothese-uitkomst.sql,
h1-analysis-hypotheses.sql, si2-sprint-hypotheses-source.sql en de ongenummerde
bestanden in scripts/migrations.

## Verificatie-uitslag (2 juli 2026)

41 tabellen in de set, nul dubbel gedefinieerd; kolom-diff tegen rows.ts schoon voor
de daily- en demografietabellen; alle 30 door de code verwachte tabellen die niet in
het productieschema staan zijn door precies een migratie gedekt; geen em-dashes;
suite en tsc groen na de consolidatie.

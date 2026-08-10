# FASE1_IMPLEMENTATIE: Decision Intelligence Core

EXECUTION_PLAN.md Stap 7. Wat de Stappen 1 tot en met 6 daadwerkelijk hebben opgeleverd, tegen
commit `a151982` op branch `claude/review-files-context-wgxzi1`. Met gemeten cijfers, niet met
beweringen: waar een getal uit het originele plan inmiddels achterhaald bleek (Sectie 3 hieronder),
staat de nieuwe meting erbij, niet de oude aanname.

## Nieuwe bestanden, per stap

### Stap 1: Core types
- `lib/decision/types.ts`: `GateStatus`, `QualityGateResult`, `TenantScoped`. Consument: elke
  poort in `quality-gates.ts` (Stap 2). Later per stap uitgebreid, zie hieronder: bewust nooit de
  volledige blueprint-typenlijst in een keer, alleen wat de eerstvolgende consument nodig had.

### Stap 2: Tien poorten in shadow mode
- `lib/decision/quality-gates.ts`: negen poorten (niet tien: de blueprint noemde Rejected Cause,
  Thread Stability en Recommendation Continuity als losse poorten, maar die vergen
  `DecisionThread`/`previousRecommendations`, typen die in deze lean uitvoering nooit gebouwd
  zijn omdat er nog geen consument voor is). Elke poort is een wrapper rond een bestaande module
  (`computeDataReliability`, `metric-cross-checks`, `claim-consistency`, `kpi-chain`,
  `contradiction-resolver`, `step-validator`, `coverage-enforcer`, `action-gating`,
  `monthly-acceptance`). Consument: `app/api/admin/kwaliteitspoorten/route.ts`.
- `lib/decision/__quality_gates_test.ts`: bewijst het vangnet met een gate die gegarandeerd gooit.

### Stap 3: Channel Provider interfaces
- `lib/decision/channel-provider.ts`: `ChannelProvider`-contract, `CHANNEL_TO_ADAPTER`-brug naar
  `lib/analysis/channel-adapter.ts`, registry (`registerProvider`/`getProvider`/
  `availableProviders`). Nul providers geregistreerd: dat was het doel van de stap, geen omissie.
  Consument: `lib/decision/decision-skeleton.ts` (Stap 4).
- `lib/decision/types.ts` uitgebreid met `Channel`, `RunType`, `Signal`, `ChannelAnalysisResult`.

### Stap 4: Route-skeletons naast de legacy-routes
- `app/api/analysis/weekly-decision/route.ts`, `biweekly-decision/route.ts`,
  `monthly-decision/route.ts`: elk vijf regels, roepen `handleDecisionSkeleton` aan met hun eigen
  `runType`.
- `lib/decision/decision-skeleton.ts`: de gedeelde kern. Tenant-context (`agencyId`) komt uit de
  database via `klantVanId`, nooit uit de request-body. Een klant zonder gekoppeld bureau geeft
  een expliciete 409 in plaats van een verzonnen waarde (dit is een afwijking van het plan se
  letterlijke voorbeeldcode, die met `runType`/`channel`/`signals`/`causes`/`threads`/
  `hypotheses`-velden werkte die het echte `GateInput` niet kent).
- Geen schrijfactie: geen `createProgressJob`, geen `saveAnalysisOutputSection`, geen
  OpenRouter-aanroep, geen wijziging aan `analysis-catalog.ts`.

### Stap 5: Context Intelligence als interface
- `lib/context/context-types.ts`: `businessEventsUitRaiEvents()`, een pure vertaling van
  `client_settings.rai_events` naar `BusinessEvent[]`. Nog geen productieconsument (staat in
  `TOEGESTANE_WEZEN`, zie hieronder).
- `lib/context/context-engine.ts`: het `ContextEngine`-contract, zonder implementatie. Zelfde
  status: geen consument, in `TOEGESTANE_WEZEN`.
- `lib/context/__context_types_test.ts`: dekt de mapping en de edge cases (geen id, lege naam,
  editie zonder datum).
- `lib/decision/types.ts` uitgebreid met `BusinessEvent`, `ContextAnalysis`.

### Stap 6: Hypothesis Discovery en Classification gescheiden
- `lib/decision/hypothesis-discovery.ts`: `HypothesisDiscovery`-contract (open, zonder
  implementatie), `HYPOTHESIS_CATEGORIES` (twaalf, gesloten), `classify()` (echte
  trefwoordmatching op `statement`, geen fake-happy-path die altijd hetzelfde teruggeeft).
  `custom_pattern` wordt alleen overgenomen als een hypothese al zo getagd is, nooit als gok bij
  onherkenbare tekst. Nog geen productieconsument (staat in `TOEGESTANE_WEZEN`).
- `lib/decision/__hypothesis_discovery_test.ts`: legt vast dat `classify()` null teruggeeft voor
  een hypothese buiten de lijst, dat de hypothese zelf onaangeroerd blijft, en dat echte
  trefwoorden ook echt matchen.
- `lib/decision/types.ts` uitgebreid met `CandidateCause`, `Hypothesis`.

## Gewijzigde bestanden

Uitsluitend `scripts/check-hygiene.mjs`, met twee soorten wijzigingen:

1. **Nieuwe `TOEGESTANE_WEZEN`-regels**, met reden per stuk: `lib/decision/channel-provider.ts`
   (Stap 3, weer verwijderd zodra Stap 4 een consument gaf), `lib/context/context-types.ts` en
   `lib/context/context-engine.ts` (Stap 5, nog steeds wees), `lib/decision/hypothesis-
   discovery.ts` (Stap 6, nog steeds wees).
2. **Eén verwijdering, gedaan in deze stap**: `lib/analysis/contradiction-resolver.ts` stond in
   `TOEGESTANE_WEZEN` met als reden "wacht op een consument", maar `lib/decision/quality-
   gates.ts` (Stap 2) importeert `resolveContradictions` daadwerkelijk in productiecode, en
   `app/api/admin/kwaliteitspoorten/route.ts` importeert er typen van. De regel was dus stale
   sinds Stap 2, niet meer nodig. Geverifieerd door de regel te verwijderen en de hygienepoort
   opnieuw te draaien: die bleef groen, wat bevestigt dat het bestand organisch wordt
   geconsumeerd en de uitzondering niet langer hoeft.

## Wat er nog wél als wees in `TOEGESTANE_WEZEN` staat na deze fase

| Bestand | Reden | Wacht op |
|---|---|---|
| `lib/context/context-types.ts` | mapping-laag, geen route roept dit aan | een analyse-route met contextinvoer |
| `lib/context/context-engine.ts` | contract zonder implementatie | dezelfde consument als hierboven |
| `lib/decision/hypothesis-discovery.ts` | contract plus classify(), alleen door zijn eigen test geraakt | een discovery-implementatie en een route die hypotheses aanlevert |

Geen van deze drie is met een fake import of een omweg alsnog "aangesloten": ze wachten echt, en
dat staat er zo.

## Poorten: gemeten uitkomst

Volledige `scripts/gates.sh` op commit `a151982` plus de wijzigingen uit deze stap:

- **hygiene**: groen, 751 bestanden gecontroleerd (na de verwijdering van de stale
  contradiction-resolver-regel opnieuw geverifieerd: nog steeds groen).
- **tsc**: groen.
- **test**: 254 testbestanden, 254 geslaagd, 0 gefaald.
- **build**: groen, de drie decision-routes staan in het routemanifest.

## Bewust niet gebouwd, met reden

- **Geen migratie in deze fase.** `analysis_hypotheses` en `analysis_tasks` bestaan (migraties
  005/006), zijn leeg en worden door niets gelezen of geschreven. Ze aansluiten of een
  `client_business_events`-tabel toevoegen is een productbeslissing voor de eigenaar, geen
  bijwerking van deze fase.
- **Geen UI.** Geen van de zes stappen raakt een component uit Fase 5, en geen route uit Stap 4
  staat in `lib/analysis/analysis-catalog.ts` (dus onzichtbaar voor de bestaande analyse-UI).
- **Geen PDF-renderer aangeraakt.**
- **Geen AICRO.** `Channel` bevat het type-lid, maar er is geen synctabel en dus geen provider.
- **Geen providerimplementaties.** `availableProviders()` geeft vandaag `[]` terug voor elke
  aanroep: de registry bestaat, niemand heeft zich geregistreerd.
- **Niets geschreven naar `analysis_hypotheses`.** Geen enkele route in deze fase schrijft; zie
  ook de vier NIET-doen-punten expliciet in `lib/decision/decision-skeleton.ts`.
- **`lib/events/` en `lib/rai/` (Fase 4) onaangeroerd**, op het lezen van het bestaande
  `RaiEventCfg`-type in Stap 5 na, exact zoals het plan zelf voorschrijft.

## De vier openstaande beslissingen voor de eigenaar

Uit Sectie 3 van EXECUTION_PLAN.md, met een verse meting op commit `a151982` waar die afweek van
wat er op 9 augustus 2026 gemeten stond.

1. **RLS-dekking is VERBETERD sinds het plan geschreven werd, maar niet compleet.** Het plan
   noemde 30 van de 122 tabellen met RLS. Gemeten nu: **45 van de 122**. Migratie 065 (buiten
   deze fase, in de RLS-lockdown-fase van hetzelfde traject) heeft de zestien SOP- en
   intelligence-tabellen alsnog afgesloten, precies de tabellen die het plan noemde als het
   hardste gat. Er staan dus nog **77 tabellen zonder RLS**, tegenover de eerder gemeten 92 -
   geen voltooide opgave, wel een gemeten verbetering. Deze fase (Decision Intelligence Core)
   heeft zelf geen migratie gedraaid; de verbetering komt uit een ander deel van het traject.
2. **0 van de 127 hypotheses heeft een `outcome`, ongewijzigd.** Opnieuw gemeten: 91 `pending`,
   27 `accepted`, 5 `rejected`, 4 `completed`, exact dezelfde verdeling als op 9 augustus. De
   Learning-laag rekent nog steeds over een lege verzameling.
3. **God View kan structureel nog niets tonen, ongewijzigd.** Opnieuw gemeten: 2 bureaus (nog
   steeds), 0 daarvan met `benchmark_optin_at` gezet. De drempel (≥50 totaal, ≥5 bureaus, ≥20
   accounts) is met 2 bureaus niet haalbaar.
4. **De Behavioral Funnel Classifier haalt nog steeds hooguit de helft van zijn gewicht.** Niet
   opnieuw gemeten in deze stap: niets in Stap 1 tot en met 6 heeft `ads_campaign_metadata`,
   `ads_audience_performance_monthly` of `client_settings.conversion_actions` aangeraakt, dus de
   dekkingscijfers van 9 augustus (API Intent 54/71, Audience Logic 18/71, Conversion Routing
   8/71 op klantniveau) zijn niet aannemelijk veranderd. `FunnelClassification.coverage` blijft
   de manier om dat zichtbaar te houden zodra dit gebouwd wordt.

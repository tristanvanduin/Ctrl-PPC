# EXECUTION_PLAN — Fase 1: Decision Intelligence Core

Draaiboek voor de executie-agent. Geschreven na codebase discovery op **9 augustus 2026**, tegen
commit `54072fa` op branch `claude/review-files-context-wgxzi1`.

Alles hieronder is gemeten in deze repository en deze database, niet aangenomen. Waar de master
blueprint iets voorschrijft dat hier niet bestaat of anders heet, staat dat expliciet vermeld met
wat er in plaats daarvan geldt. **Een instructie die naar een niet-bestaand gereedschap wijst kost
een hele sessie**; daarom zijn die drie plekken hieronder gecorrigeerd en gemarkeerd met ⚠︎.

---

## SECTIE 0: WAT ER AL IS (lees dit vóór sectie 2)

Fase 1 vraagt om acht dingen. Vijf daarvan bestaan al, in een andere vorm. Ze opnieuw bouwen
levert een tweede definitie op, en dáár heeft `scripts/check-hygiene.mjs` een poort voor die de
build laat falen. De tabel is de kern van dit document:

| Fase 1 vraagt | Bestaat al als | Wat er dus moet gebeuren |
|---|---|---|
| Channel Provider interfaces | `lib/analysis/channel-adapter.ts` — `ChannelAdapter`, `registerAdapter`, `getAdapter`, met `adapters/google-ads.ts`, `meta-ads.ts`, `linkedin-ads.ts` | **Uitbreiden, niet vervangen.** De bestaande adapter is de *prompt*-laag (stapinstructies, purity-regels, aliases). De `ChannelAnalysisResult`-kant is nieuw en komt ernaast. |
| 13-staps audit als Signal Providers | `lib/prompts/monthly-v2.ts` (`MONTHLY_V2_STEP_INSTRUCTIONS`, 13 stappen), `lib/scheduler/pump-plan.ts` (17 units) | Niet aanraken. De nieuwe route leest het resultaat, herschrijft de stappen niet. |
| Quality gates | negen bestaande modules, zie C6 in het rapport | Zes van de tien gates zijn een **wrapper** rond bestaande logica. Alleen vier zijn echt nieuw. |
| Quality gate logging | geen `quality_gate_logs`; wél `llm_usage` (38 rijen, mét `agency_id` sinds migratie 061) | Type + interface definiëren, **geen migratie in Fase 1**. Documenteer de Fase 2-migratie. |
| Business event input | `client_settings.rai_events` (JSONB, migratie 024) — beurzen met cadans en edities. `sop_client_context` bestaat maar heeft **0 rijen**. | Map `RaiEventCfg` → `BusinessEvent`. Geen nieuwe tabel. |
| Hypothesis-tabellen | `sprint_hypotheses` (127 rijen, in gebruik), `sop_hypothesis_tracking` (0 rijen), `analysis_hypotheses` (**0 rijen, dode tabel uit migratie 005, door niets gelezen of geschreven**) | Niets schrijven in Fase 1. Zie de waarschuwing bij Stap 1. |

---

## SECTIE 1: RULES OF ENGAGEMENT VOOR DE EXECUTIE-AGENT

### 1.1 Git workflow

```
git fetch origin claude/review-files-context-wgxzi1
git checkout -b feature/phase1-decision-engine origin/claude/review-files-context-wgxzi1
```

⚠︎ **Afwijking van de opdracht.** De opdracht zegt "vertak van `main`". Doe dat niet: `main` loopt
**165 commits achter** op de huidige werkbranch, en alles waar Fase 1 op leunt
(`lib/tenancy/*`, `lib/benchmark/*`, migraties 057–064, de kanaal-adapters) zit in die 165. Vertak
van de werkbranch. Commit nooit rechtstreeks naar `main`.

### 1.2 Scope-isolatie

- **Raak deze bestanden niet aan.** `app/api/analysis/weekly/route.ts` (224 regels),
  `biweekly/route.ts` (259), `monthly/route.ts` (2877), `monthly/prepare/route.ts` (39),
  en alle twintig losstaande analyse-routes uit `lib/analysis/analysis-catalog.ts`.
- Nieuwe routes komen ernáást, met een eigen padsegment (`*-decision`).
- Raak `lib/analysis/sop-pdf-renderer.ts` en `lib/client-reports/pdf-renderer.ts` niet aan.
- **Voeg niets toe aan `lib/prompts/`.** Fase 1 doet geen LLM-aanroepen.

### 1.3 Databaseprotocol

⚠︎ **Afwijking van de opdracht.** Er is in dit project **geen Supabase CLI en geen `supabase/`
map**. `supabase migration new` bestaat hier niet. Migraties zijn genummerde bestanden in
`scripts/migrations/NNN_naam.sql`, toegepast via `node scripts/supabase-sql.mjs --file <pad>`
(Management API, `SUPABASE_ACCESS_TOKEN`). De laatste is `064_segment_en_optin.sql`.

**In Fase 1 maak je geen migratie.** Niet als bestand, niet toegepast. Elk type dat een tabel
nodig heeft die nog niet bestaat, krijgt een commentaarblok dat zegt welke migratie in Fase 2
nodig is en waarom.

### 1.4 Type safety en validatie

⚠︎ **Afwijking van de opdracht.** Roep **niet** los `npx tsc` aan. Dit project heeft één ingang:

```
scripts/gates.sh tsc      # alleen typecheck (~40s)
scripts/gates.sh test     # alleen de testsuite (246 bestanden, ~32s)
scripts/gates.sh hygiene  # dubbele definities, wezen, stuurtekens (~1s)
scripts/gates.sh          # alles, inclusief de databasepoorten en de build
```

Elke stap staat onder `timeout`, en een `flock` verhindert dat er twee runs naast elkaar in
dezelfde `.next` schrijven. Draai hem in de achtergrond en wacht op de afronding; nooit twee
tegelijk. Bouw nooit onder een draaiende server, en stop een server op **PID** — `pkill -f`
matcht zijn eigen commandoregel en sloopt zijn eigen shell.

Voor iedere sub-stap: `scripts/gates.sh hygiene && scripts/gates.sh tsc` moet groen zijn vóór de
commit. Vóór de laatste push van de fase: één volledige `scripts/gates.sh`.

**De hygienepoort is de strengste.** Hij faalt op:
1. een tweede definitie van een gedeeld hulpje (`median`, `safeDiv`, en de lijst `GEDEELD` in
   `scripts/check-hygiene.mjs`) — voeg nieuwe gedeelde helpers dáár toe;
2. een module die door **geen enkele productiecode** wordt geïmporteerd. Dit raakt Fase 1 direct:
   alles wat je bouwt moet ergens vandaan aangeroepen worden, of met een **reden** in
   `TOEGESTANE_WEZEN`. Een uitzondering zonder reden is over drie maanden niet van een vergissing
   te onderscheiden;
3. stuurtekens in de bron.

### 1.5 Commitstrategie

Eén commit per sub-stap uit sectie 2. Geen monolithische commit. Commitberichten in het Nederlands,
in de stijl van de branch: wat er verandert en waaróm, niet welke bestanden.

Vermeld **geen** modelidentificatie in commitberichten, PR-teksten of codecommentaar.

### 1.6 Twee harde regels uit de blueprint die hier extra gelden

- **De LLM rekent niet.** Alle wiskunde deterministisch in TypeScript. Fase 1 bevat sowieso geen
  LLM-aanroep.
- **Shadow mode betekent shadow mode.** Elke gate afzonderlijk in een `try/catch`. Een exception,
  timeout, null-reference of parse-fout in een gate mag de pipeline nooit stoppen. Bij een fout:
  loggen, `status: "warn"`, `repairAttempted: false`, door naar de volgende gate.

---

## SECTIE 2: HET STAPPENPLAN (FASE 1)

### Stap 1 — Core types

**Nieuw bestand:** `lib/decision/types.ts`

Neem het TypeScript-model uit hoofdstuk 13 van de master blueprint over: `RunType`, `Channel`,
`FunnelRole`, `FunnelStage`, `GateStatus`, `HypothesisLevel`, `HypothesisType`,
`AttributionConfidence`, `ContextImpact`, `AttributionRisk`, `TenantScoped`, `Signal`,
`CandidateCause`, `DecisionThread`, `ContextAnalysis`, `BusinessEvent`, `Hypothesis`,
`HypothesisEvaluation`, `LearningPattern`, `QualityGateResult`, `QualityGateLog`,
`ChannelAnalysisResult`.

Plus, in hetzelfde bestand, de typen die de Playbook Engine-blueprint vraagt:

```ts
/** Behavioral Funnel Classifier — vier signalen, elk met eigen dekking. */
export type ClassifierSignalName =
  | 'api_intent'            // 20% — ads_campaign_metadata.campaign_type + bidding_strategy
  | 'conversion_routing'    // 20% — client_settings.conversion_actions
  | 'audience_logic'        // 30% — ads_audience_performance_monthly
  | 'output_reality';       // 30% — fact_core / ads_campaign_monthly

export interface ClassifierSignalScore {
  signal: ClassifierSignalName;
  weight: number;
  /** Waarschijnlijkheid per FunnelRole, som 1. Leeg als het signaal niet meetbaar is. */
  distribution: Partial<Record<FunnelRole, number>>;
  /** ONTBREKEND is geen nul. Zie de dekkingscijfers in de commentaarkop. */
  available: boolean;
  sourceTable: string;
}

export interface FunnelClassification extends TenantScoped {
  channel: Channel;
  entityId: string;
  entityName: string;
  inferredRole: FunnelRole;
  probability: number;              // 0..1
  signals: ClassifierSignalScore[];
  /** Som van de gewichten van de signalen die WEL meetbaar waren. Onder 0.5 is de uitkomst een gok. */
  coverage: number;
  humanOverride?: { role: FunnelRole; by: string; at: string; reason?: string };
}

/** Portfolio Trend Engine — de macro-cel binnen één bureau. */
export interface MacroTrendCell {
  agencyId: string;
  channel: Channel;
  bedrijfsmodel: 'b2b' | 'b2c' | null;
  niche: string | null;
  periodStart: string;
  grain: 'week' | 'month';
  accounts: number;
  metrics: { impressions: number; clicks: number; cost: number; conversions: number; convValue: number };
}

/** Playbook Engine — het IP van één bureau, nooit gedeeld. */
export interface Playbook extends Pick<TenantScoped, 'agencyId'> {
  id: string;
  name: string;
  criteria: string;
  expectedImpact?: string;
  cooldownDays: number;
}
```

**Vier dingen om goed te doen, met de reden erbij:**

1. **`accountId` is `client_id`, niet `accounts.id`.** Gemeten: `accounts` heeft 71 rijen met
   kolommen `id (uuid)`, `agency_id`, `client_id`, `name`, `source`, `external_id`. Álle
   feiten- en intelligence-tabellen scopen op `client_id` — `sop_analysis_output`,
   `sprint_hypotheses`, `sprint_items`, `fact_core.account_id` (dat is óók de `client_id`),
   `client_settings`, `llm_usage`. `accounts.id` wordt alleen gebruikt door de RLS-functie
   `app_zichtbare_accounts()`. Zet dit als commentaar boven `TenantScoped`, want dit is precies
   de "Legacy Mapping Rule" uit hoofdstuk 3 van de blueprint en het is de val waar een tweede
   lezer in trapt.

2. **`agencyId` is een afleiding, geen kolom.** Gemeten: van 122 tabellen hebben er **zes** een
   `agency_id`: `accounts`, `agency_connections`, `user_agencies`, `client_groups`,
   `chat_sessions`, `llm_usage`. Geen enkele intelligence-tabel heeft er een. De afleiding gaat
   via `accounts.client_id → accounts.agency_id`; het bestaande hulpje daarvoor is
   `bureauVanKlant()` in `lib/analysis/o2-targets-cost.ts` (met module-cache) en
   `klantVanId()` in `lib/tenancy/klanten.ts`. **Gebruik die, schrijf geen derde.**

3. **Schrijf niets naar `analysis_hypotheses` of `analysis_tasks`.** Beide tabellen bestaan
   (migraties 005 en 006), zijn **leeg**, en worden door geen enkele productiecode gelezen of
   geschreven — dat staat al gedocumenteerd in `lib/tasks/prior-tasks.ts`. Ze lijken op de
   `Hypothesis` uit de blueprint (`success_predicates`, `guardrail_predicates`, `window_days`,
   `evaluate_after`, `execution_status`) en dat maakt ze verleidelijk. Ze aansluiten is een
   Fase 2-beslissing van de eigenaar, niet een bijwerking van Fase 1.

4. **`FunnelRole` botst met `CampaignPurpose`.** `lib/campaign-types.ts` heeft al een
   `CampaignPurpose` (brand, generic, category, shopping, pmax, remarketing, awareness,
   competitor) met `detectCampaignPurpose()`. Dat is een **naamgebaseerde** classificatie: puur
   string-matching op de campagnenaam. `FunnelRole` is een andere as (rol in de funnel) en mag
   ernaast bestaan, maar zet in het commentaar wat het verschil is en dat de classifier uit
   Stap 5 de naamregel op termijn vervangt. Anders staan er over een half jaar twee antwoorden
   op dezelfde vraag.

**Poort:** `scripts/gates.sh tsc`.
**Wees, want nog niemand importeert dit:** zet `lib/decision/types.ts` nog niet in
`TOEGESTANE_WEZEN` — na Stap 2 heeft hij een consument. Draai `hygiene` pas na Stap 2.
**Commit:** "Kerntypen voor de Decision Engine, met de tenant-afleiding erbij"

---

### Stap 2 — Tien Quality Gates in shadow mode

**Nieuw bestand:** `lib/decision/quality-gates.ts`
**Nieuw bestand:** `lib/decision/__quality_gates_test.ts`

Publieke vorm:

```ts
export interface GateInput {
  runId: string;
  agencyId: string;
  accountId: string;
  runType: RunType;
  channel: Channel;
  signals: Signal[];
  causes: CandidateCause[];
  threads: DecisionThread[];
  hypotheses: Hypothesis[];
  context?: ContextAnalysis;
  previousThreads?: DecisionThread[];      // voor Thread Stability
  previousRecommendations?: string[];      // voor Recommendation Continuity
}

export type Gate = (input: GateInput) => QualityGateResult;

export const GATES: readonly { name: string; run: Gate }[];

/** Draait alle gates. Vangt per gate af; retourneert altijd tien resultaten. */
export function runGates(input: GateInput): QualityGateResult[];
```

De tien gates, en waar de logica vandaan komt:

| # | Gate | Bouw hem als |
|---|---|---|
| 1 | Data Quality | **wrapper** rond `computeDataReliability` uit `lib/analysis/data-reliability.ts` |
| 2 | Math | **wrapper** rond `lib/analysis/metric-cross-checks.ts` (nu 3 importers) |
| 3 | Evidence | **wrapper** rond `validateFindingClaims` / `buildCanonicalMetricMap` uit `lib/analysis/claim-consistency.ts` |
| 4 | Causal Chain | **wrapper** rond `lib/analysis/kpi-chain.ts` |
| 5 | Contradiction | **wrapper** rond `recommendationConflicts` uit `lib/analysis/contradiction-resolver.ts` — die staat nu in `TOEGESTANE_WEZEN` als wees; dit is zijn eerste consument. **Haal hem dan uit die lijst.** |
| 6 | Rejected Cause | nieuw — controleert dat elke `rejectedCauseIds`-verwijzing een `CandidateCause` heeft met `rejected: true` én een `rejectionReason` |
| 7 | Thread Stability | nieuw — vergelijkt `threads` met `previousThreads` op titel/diagnose-drift |
| 8 | Recommendation Continuity | nieuw — een aanbeveling die vorige run primair was en nu verdwenen is zonder uitkomst |
| 9 | Sprint Readiness | **wrapper** rond `lib/analysis/action-gating.ts` (nu 0 importers) |
| 10 | Publish | nieuw — aggregeert 1–9; `fail` als een blocking gate faalt. In Fase 1 is `blocking` op **elke** gate `false`. |

**De try/catch-grens hoort in `runGates`, niet in elke gate afzonderlijk.** Eén plek waar het
gebeurt:

```ts
export function runGates(input: GateInput): QualityGateResult[] {
  return GATES.map(({ name, run }) => {
    try {
      const r = run(input);
      return { ...r, blocking: false, finalStatus: r.finalStatus ?? r.status };
    } catch (fout) {
      logger.warn("quality-gate faalde", { gate: name, runId: input.runId, fout: String(fout) });
      return { gateName: name, status: "warn", blocking: false,
               reason: `Gate wierp een fout: ${String(fout)}`,
               repairAttempted: false, finalStatus: "warn" };
    }
  });
}
```

`logger` uit `lib/logger.ts` (niveau-logger). Gebruik `lib/log.ts` (`createRunLogger`) alleen als
je velden moet redigeren; dat is hier niet zo.

**De test moet de vangnet-eigenschap bewijzen, niet aannemen.** Registreer in de test een gate die
gegarandeerd gooit, en eis dat `runGates` tien resultaten teruggeeft waarvan die ene `warn` is.
Zonder die test zegt "shadow mode is veilig" niets — deze codebase heeft eerder een controle gehad
die iets anders verifieerde dan hij beweerde, en die stond er maanden groen bij.

**Poort:** `scripts/gates.sh hygiene && scripts/gates.sh tsc && scripts/gates.sh test`.
**Commit:** "Tien poorten in shadow mode, met de vangnet-test die bewijst dat ze niets breken"

---

### Stap 3 — Channel Provider interfaces

**Nieuw bestand:** `lib/decision/channel-provider.ts`

**Bouw geen tweede registry.** `lib/analysis/channel-adapter.ts` heeft er al één
(`registerAdapter` / `getAdapter` / `hasAdapter`, `ChannelId = "google_ads" | "meta_ads" |
"linkedin_ads"`). Hang de nieuwe rol daaraan:

```ts
import { type ChannelId, getAdapter, hasAdapter } from "@/lib/analysis/channel-adapter";
import type { Channel, ChannelAnalysisResult, RunType, Signal } from "./types";

/** De brug tussen de brede Channel uit de blueprint en de ChannelId van de bestaande adapter. */
export const CHANNEL_TO_ADAPTER: Partial<Record<Channel, ChannelId>> = {
  google: "google_ads", meta: "meta_ads", linkedin: "linkedin_ads",
};
// microsoft, tiktok_ads, tiktok_shop, shopify, crm en aicro hebben bewust GEEN adapter:
// er is voor die kanalen geen synctabel en geen rij in de database. Een lege provider die
// nul signalen teruggeeft leest als "gemeten en niets gevonden"; dat is precies het verschil
// dat we niet willen vervagen. Ze staan wel in het Channel-type, zodat de code compileert
// zodra de eerste rij er is.

export interface ChannelProvider {
  channel: Channel;
  /** Kan dit kanaal vandaag iets leveren voor deze klant? Alleen 'ja' als er data is. */
  isAvailable(accountId: string): Promise<boolean>;
  collectSignals(input: { agencyId: string; accountId: string; runType: RunType;
                          periodStart: string; periodEnd: string }): Promise<Signal[]>;
  analyze(input: { agencyId: string; accountId: string; runType: RunType;
                   periodStart: string; periodEnd: string }): Promise<ChannelAnalysisResult>;
}

export function registerProvider(p: ChannelProvider): void;
export function getProvider(c: Channel): ChannelProvider | null;
export function availableProviders(): Channel[];
```

**Registreer in Fase 1 nul providers.** De interface plus de registry is genoeg. `isAvailable`
moet later leunen op `laadBeschikbareKanalen()` uit `lib/kanalen/beschikbaar.ts`, dat al per klant
uitzoekt welke kanalen data hebben — zet dat als `// Fase 2:`-notitie in het bestand.

**Wees:** dit bestand heeft na Stap 4 een consument (de routes importeren
`availableProviders`). Draai `hygiene` na Stap 4.

**Commit:** "Providerlaag naast de bestaande kanaal-adapter, zonder tweede registry"

---

### Stap 4 — Route-skeletons naast de legacy-routes

**Nieuwe bestanden:**

- `app/api/analysis/weekly-decision/route.ts`
- `app/api/analysis/biweekly-decision/route.ts`
- `app/api/analysis/monthly-decision/route.ts`

Alle drie dezelfde vorm; volg het contract van `app/api/analysis/weekly/route.ts`:

```ts
export async function POST(request: NextRequest) {
  const supabase = getSupabase();                        // lib/analysis/helpers.ts
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  // Tenant-context uit de DATABASE, nooit uit de body. Blueprint hfst. 3, regel 6.
  const klant = await klantVanId(supabase, clientId);    // lib/tenancy/klanten.ts
  if (!klant) return Response.json({ error: "Onbekende klant" }, { status: 404 });

  const runId = crypto.randomUUID();
  const input: GateInput = {
    runId, agencyId: klant.agencyId, accountId: clientId,
    runType: "weekly", channel: "google",
    signals: [], causes: [], threads: [], hypotheses: [],
  };

  return Response.json({
    runId,
    agencyId: klant.agencyId,
    accountId: clientId,
    status: "skeleton",
    providers: availableProviders(),      // in Fase 1: []
    gates: runGates(input),               // tien resultaten, allemaal blocking:false
    note: "Fase 1 skeleton. Geen LLM-aanroep, geen schrijfactie, geen legacy-route geraakt.",
  });
}
```

Controleer of `klantVanId` daadwerkelijk `agencyId` teruggeeft; zo niet, gebruik dan
`bureauVanKlant()` uit `lib/analysis/o2-targets-cost.ts`.

**Vier dingen die deze routes NIET doen, en dat moet in het bestand staan:**
1. geen `createProgressJob` — dat schrijft in `generation_jobs` en die tabel voedt de UI;
2. geen `saveAnalysisOutputSection` — geen enkele schrijfactie in Fase 1;
3. geen OpenRouter-aanroep, dus ook geen `controleerPlafond` uit `lib/analysis/uitgavenplafond.ts`;
4. geen wijziging aan `lib/analysis/analysis-catalog.ts` — deze routes horen nog niet in de UI.

**Poort:** volledige `scripts/gates.sh` (inclusief `build`; drie nieuwe routes horen in het
route-manifest te verschijnen).
**Commit:** "Drie decision-routes naast de legacy-routes, skeleton en zonder schrijfacties"

---

### Stap 5 — Context Intelligence en Business Events (alleen interfaces)

**Nieuwe bestanden:** `lib/context/context-types.ts`, `lib/context/context-engine.ts`

`context-types.ts` herexporteert `ContextAnalysis` en `BusinessEvent` uit `lib/decision/types.ts`
(geen tweede definitie) en voegt de mapping toe:

```ts
import type { RaiEventCfg } from "@/lib/rai/fair-weeks";
import type { BusinessEvent } from "@/lib/decision/types";

/**
 * De enige harde bron van account-specifieke events die vandaag bestaat:
 * client_settings.rai_events (JSONB, migratie 024), met cadans annual/biennial/custom en een
 * lijst edities met datum en label. Gelezen door lib/rai/use-upcoming-edition.ts en de
 * geo-clone-route; geschreven door components/dashboard/event-settings.tsx.
 *
 * sop_client_context bestaat óók, met valid_from/valid_until/impact_on_analysis, maar heeft
 * NUL rijen. Leeg is niet hetzelfde als afwezig: hij is bruikbaar, alleen nooit gevuld.
 *
 * Een client_business_events-tabel met eventType, expectedImpact, confidence en createdBy vergt
 * een Fase 2-migratie (volgende nummer: 065). Niet in Fase 1.
 */
export function businessEventsUitRaiEvents(
  events: RaiEventCfg[], agencyId: string, accountId: string
): BusinessEvent[];
```

`context-engine.ts` bevat **alleen functiehandtekeningen met een `throw new Error("Fase 2")`-body
is verboden** — dat is een leeg omhulsel dat als werkend leest. Definieer in plaats daarvan een
`ContextEngine`-interface zonder implementatie, en niets meer. Een interface belooft niets.

**AI mag account-specifieke business events niet verzinnen.** Zet die regel in de kop van
`context-types.ts`, niet alleen in de blueprint.

**Commit:** "Context Intelligence als interface, gevoed uit de beurzen die er al staan"

---

### Stap 6 — Hypothesis Discovery en Classification gescheiden

**Nieuw bestand:** `lib/decision/hypothesis-discovery.ts`

```ts
/** Open. Mag hypotheses opleveren die in geen enkele categorie passen. */
export interface HypothesisDiscovery {
  discover(input: { signals: Signal[]; causes: CandidateCause[];
                    context?: ContextAnalysis }): Hypothesis[];
}

/** Gesloten. Draait NA discovery en mag nooit iets weggooien. */
export const HYPOTHESIS_CATEGORIES = [
  'creative','audience','budget','funnel','search','tracking',
  'commerce','revenue','seasonality','event','opportunity','custom_pattern',
] as const;

/** Geeft null terug als niets past. Dat is een geldige uitkomst, geen fout. */
export function classify(h: Hypothesis): typeof HYPOTHESIS_CATEGORIES[number] | null;
```

**Nieuw bestand:** `lib/decision/__hypothesis_discovery_test.ts` — één test die vastlegt dat
`classify()` `null` teruggeeft voor een hypothese buiten de lijst, en dat de hypothese
onveranderd blijft. Dat is de blueprint-regel "classificatie mag nooit blokkeren", getest in
plaats van beloofd.

**Commit:** "Discovery open, classificatie gesloten, met de test die dat vastlegt"

---

### Stap 7 — Implementatienotitie

**Nieuw bestand:** `docs/FASE1_IMPLEMENTATIE.md`

Bevat, met gemeten cijfers en niet met beweringen:
- de nieuwe bestanden en per stuk hun consument (of hun regel in `TOEGESTANE_WEZEN` met reden);
- de gewijzigde bestanden — dat zou alleen `scripts/check-hygiene.mjs` mogen zijn (nieuwe entries
  in `GEDEELD`, verwijdering van `contradiction-resolver.ts` uit `TOEGESTANE_WEZEN`);
- de uitkomst van de volledige `scripts/gates.sh` (aantal tests, tsc, build);
- **bewust niet gebouwd**, met reden: geen migratie, geen UI, geen PDF, geen AICRO, geen
  provider-implementaties, niets geschreven naar `analysis_hypotheses`;
- de vier openstaande beslissingen voor de eigenaar uit sectie 3 hieronder.

**Commit:** "Implementatienotitie Fase 1"

---

## SECTIE 3: WAT FASE 1 NIET OPLOST, EN DOOR MOET NAAR DE EIGENAAR

Deze vier zijn gemeten en blokkeren de lagen 3 tot en met 5. Ze horen niet in een executie-run
maar in een beslissing.

1. **92 van de 122 tabellen hebben geen RLS.** Daaronder `sprint_hypotheses`, `sprint_items`,
   `sop_analysis_output`, `sop_insights`, `sop_recommendations`, `sop_tasks`, `client_settings`
   en `llm_usage` — precies de tabellen waar de blueprint "geen X zonder agencyId" over zegt. De
   dertig die het wél hebben zijn de feitentabellen (migraties 058/059). Zolang dit staat, is
   "multi-tenancy is verplicht" een codeconventie en geen databasegarantie.

2. **0 van de 127 hypotheses heeft een `outcome`.** 91 `pending`, 27 `accepted`, 5 `rejected`,
   4 `completed`; `evaluated_at` is overal leeg, `sop_hypothesis_tracking` heeft nul rijen. De
   Learning-laag rekent dus over een lege verzameling. `expectedValue` en `confidenceIndex` zijn
   nu geen kleine getallen maar ongedefinieerd, en dat mag de UI niet als `0` tonen.

3. **God View kan structureel niets tonen.** De drempel is `totalCount >= 50` én ≥5 bureaus én
   ≥20 accounts. Er zijn **2 bureaus** (Ranking Masters met 70 accounts, Demo met 1), en **0**
   daarvan heeft `benchmark_optin_at` gezet. Bouw de engine, maar reken erop dat het antwoord
   "Insufficient sample size" is tot er ruim honderd bureaus zijn.

4. **De Behavioral Funnel Classifier haalt vandaag hooguit de helft van zijn gewicht.** Gemeten
   dekking over 71 accounts: API Intent 54/71 (`ads_campaign_metadata`, 430 rijen, allemaal met
   `bidding_strategy`); Audience Logic 18/71 (`ads_audience_performance_monthly`, 922 rijen,
   alleen Google — `meta_adsets` heeft 0 rijen); Conversion Routing 8/71 op klantniveau en 0 op
   campagneniveau (`client_settings.conversion_actions`; `channel_conversion_config` is bij 0
   klanten gevuld); Output Reality volledig. Dat betekent dat 50% van de weging (30 + 20) op data
   rust die bij de meeste accounts ontbreekt. Vandaar het veld `coverage` in
   `FunnelClassification`: onder 0.5 is de uitkomst geen classificatie maar een gok, en dat hoort
   zichtbaar te zijn in plaats van weggerond.

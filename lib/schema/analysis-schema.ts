/**
 * Zod schemas for structured LLM output validation.
 *
 * These schemas match the existing sop_insights / sop_recommendations / sop_tasks
 * table structures. They replace the brittle regex + JSON.parse fallback chains
 * in the monthly analysis route (steps 7-8).
 */

import { z } from "zod";
import { OWNER_TEAM, OWNER_CLIENT, LEGACY_OWNER_TEAM, KANT_LABEL_INTERN, KANT_LABEL_EXTERN, normalizeOwner } from "@/lib/branding/brand";

// ── Shared enums ───────────────────────────────────────────────────────────

export const SeverityEnum = z.enum(["critical", "high", "medium", "low", "positive"]);
export type Severity = z.infer<typeof SeverityEnum>;

// Superset over kanalen, zelfde reden en zelfde patroon als IssueClusterEnum hieronder: dit stond
// tot 19 augustus 2026 als de kale Google-lijst (de eerste 12 waarden), terwijl
// lib/analysis/adapters/meta-ads.ts / linkedin-ads.ts hun eigen ChannelAdapter.entityTypes al
// langer "adset"/"placement"/"job_function" e.d. aan het model voorschreven -- de LLM volgde die
// instructie, en elke finding met zo'n entity_type faalde vervolgens stil op
// FindingSchema.safeParse() en werd door het herstelpad weggegooid. Precies de meest
// kanaal-eigen bevindingen, en precies zichtbaar als "Verwacht 3 findings, kreeg 1" op bijna elke
// Meta/LinkedIn-stap in twee onafhankelijke live demo-greentech-runs. Google-findings gebruiken
// de kanaalspecifieke waarden niet; de prompt per kanaal bepaalt (via ChannelAdapter.entityTypes)
// welke subset het model daadwerkelijk aangeboden krijgt.
export const EntityTypeEnum = z.enum([
  // Google
  "account", "campaign", "adgroup", "keyword", "product", "searchterm", "creative", "audience", "device", "country", "network", "schedule",
  // Meta-specifiek (M2)
  "adset", "ad", "placement", "platform", "age_gender",
  // LinkedIn-specifiek (L2)
  "campaign_group", "format", "job_function", "seniority", "industry", "company_size", "region",
]);
export type EntityType = z.infer<typeof EntityTypeEnum>;

export const InsightTypeEnum = z.enum(["performance", "trend", "anomaly", "opportunity", "risk", "positive"]);
export type InsightType = z.infer<typeof InsightTypeEnum>;

export const ActionTypeEnum = z.enum([
  "budget", "bid", "targeting", "creative", "structure",
  "tracking", "audit", "negative", "website", "content", "feed",
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

export const PriorityEnum = z.enum(["critical", "high", "medium", "low"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const FrequencyEnum = z.enum(["direct", "weekly", "biweekly", "monthly"]);
export type Frequency = z.infer<typeof FrequencyEnum>;

/**
 * Wie pakt de taak op: het eigen team of de klant.
 *
 * Deze waarde wordt OPGESLAGEN (sprint_planning.owner, sop_tasks.owner) en is dus geen loutere
 * weergavetekst. LEGACY_OWNER_TEAM (lib/branding/brand.ts) hield hier ooit elke oude productnaam
 * aan zodat rijen van vóór een naamswijziging niet ongeldig werden of als klant-taken gingen
 * tellen; die lijst is inmiddels leeg (geen naam van een externe partij hoort in de broncode te
 * staan) en wordt na scripts/migrations/097_owner_role_normalize.sql niet meer nodig zijn. De
 * transform normaliseert alles naar de huidige schrijfwijze, zodat de rest van de code maar één
 * waarde kent.
 */
export type Owner = typeof OWNER_TEAM | typeof OWNER_CLIENT;

/**
 * Elke schrijfwijze die ooit is weggeschreven blijft geldig bij het lezen; alles wat geen klant is
 * normaliseert naar de rol. Zo hoeft er geen migratie over bestaande rijen heen voordat het
 * product een andere naam kan dragen — zie de toelichting in lib/branding/brand.ts.
 */
export const OwnerEnum = z
  .enum([OWNER_TEAM, OWNER_CLIENT, KANT_LABEL_INTERN, KANT_LABEL_EXTERN, ...LEGACY_OWNER_TEAM])
  // normalizeOwner en niet `v === OWNER_CLIENT ? ... : OWNER_TEAM`. Die regel stond hier als eigen
  // kopie, en dat werkte alleen zolang "Klant" de enige niet-interne waarde was: alles wat daar
  // niet exact aan gelijk was, werd intern. Met de schermteksten erbij zou "Extern" dus stilzwijgend
  // als intern binnenkomen — precies andersom. Er is één plek waar staat wat intern is.
  .transform((v): Owner => (normalizeOwner(v) === OWNER_CLIENT ? OWNER_CLIENT : OWNER_TEAM));

export const RecommendationSourceEnum = z.enum(["finding", "hypothesis"]);
export type RecommendationSource = z.infer<typeof RecommendationSourceEnum>;

export const EvidenceLevelEnum = z.enum(["deterministic", "inferred", "hypothesis", "unknown"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelEnum>;

// Bewijs-basis van een stapconclusie: rust ze op advertentieplatformdata, op GA4, op een
// combinatie, of op een schatting? Spiegelt lib/ga4/types EvidenceBasis en maakt de GA4-context-
// instructie ("label ELKE conclusie") een gestructureerd, per-stap-conclusie-veld in de pipeline.
export const EvidenceBasisEnum = z.enum(["platform", "ga4", "combined", "estimated"]);
export type EvidenceBasis = z.infer<typeof EvidenceBasisEnum>;

// Deterministische normalisatie: een ontbrekende/ongeldige waarde valt terug op "platform" — de
// veilige basis die NOOIT ongefundeerd GA4 claimt (net als resolveEvidenceBasis in lib/ga4).
export function normalizeEvidenceBasis(value: unknown): EvidenceBasis {
  const parsed = EvidenceBasisEnum.safeParse(value);
  return parsed.success ? parsed.data : "platform";
}

export const ConfidenceEnum = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceEnum>;

export const BenchmarkTypeEnum = z.enum([
  "monthly_target", "pace_target", "annual_goal",
  "sector_benchmark", "account_average", "campaign_average",
  "previous_month", "previous_year",
]);
export type BenchmarkType = z.infer<typeof BenchmarkTypeEnum>;

export const ActionReadinessEnum = z.enum([
  "direct_action",        // voldoende bewijs, direct uitvoerbaar
  "investigate_first",    // signaal sterk genoeg om te onderzoeken
  "monitor",              // te weinig data, observeren
  "strategic_hypothesis",  // langetermijn idee, niet urgent
]);
export type ActionReadiness = z.infer<typeof ActionReadinessEnum>;

export const IssueClusterEnum = z.enum([
  "tracking_cvr_drop",
  "search_budget_cap",
  "desktop_inefficiency",
  "mobile_opportunity",
  "audience_inefficiency",
  "creative_mismatch",
  "schedule_waste",
  "network_quality",
  "search_partner_waste",
  "geo_allocation",
  "search_term_waste",
  "search_bidding_inflation",
  "pmax_cannibalization",
  "product_mix",
  "brand_leakage",
  "performance_winner",
  "efficiency_gain",
  "scaling_opportunity",
  "device_performance_gap",
  "low_cvr_high_ctr",
  "volume_shortfall",
  "uncategorized",
  // Meta-specifieke clusters (M2). De enum is een superset over kanalen; de prompt per kanaal
  // bepaalt welke daadwerkelijk aan de LLM worden aangeboden. Google-findings gebruiken deze niet.
  "creative_fatigue",
  "hook_dropoff",
  "creative_winner",
  "audience_overlap",
  "learning_phase_instability",
  "placement_waste",
  "frequency_saturation",
  "funnel_dropoff",
  "attribution_gap",
  "demo_inefficiency",
  "budget_constraint",
  // LinkedIn-specifieke clusters (L2), ontbraken hier -- gevonden via live verificatie tijdens
  // F5 fase3: elke LinkedIn-finding met een van deze (correcte, uit LINKEDIN_ISSUE_CLUSTERS
  // gekozen) clusters faalde stil op FindingSchema.safeParse en werd door het herstelpad
  // weggegooid, precies de meest kanaal-eigen bevindingen. performance_winner, efficiency_gain,
  // scaling_opportunity, volume_shortfall, uncategorized, creative_fatigue en creative_winner
  // staan al hierboven en worden door Google/Meta/LinkedIn gedeeld.
  "cpl_inflation",
  "lead_quality_mismatch",
  "icp_waste",
  "audience_too_narrow",
  "audience_saturation",
  "form_dropoff",
  "format_gap",
  "budget_pacing_issue",
  "bidding_inefficiency",
  "audience_network_leakage",
]);
export type IssueCluster = z.infer<typeof IssueClusterEnum>;

export const ProblemClassificationSchema = z.enum([
  "real_problem",
  "expected_tradeoff",
  "contextual_shift",
  "measurement_risk",
  "false_positive_alert",
]);
export type ProblemClassification = z.infer<typeof ProblemClassificationSchema>;

export const ActionPhaseSchema = z.enum(["immediate", "short_term", "medium_term"]);
export type ActionPhase = z.infer<typeof ActionPhaseSchema>;

export const AnalysisThreadSchema = z.object({
  id: z.string(),
  priority: z.number().int().min(1).max(4),
  title: z.string(),
  classification: ProblemClassificationSchema,
  root_cause_summary: z.string(),
  business_impact: z.string(),
  supporting_cluster_ids: z.array(z.string()),
  recommended_recommendation_ids: z.array(z.number().int()),
  monitoring_metrics: z.array(z.string()),
  confidence: ConfidenceEnum,
  phase: ActionPhaseSchema,
});
export type AnalysisThread = z.infer<typeof AnalysisThreadSchema>;

// ── Finding schema (step 7 output) ────────────────────────────────────────

export const FindingSchema = z.object({
  step: z.number().int().min(1).max(13),
  issue_cluster: IssueClusterEnum,
  issue_cluster_explanation: z.string().optional(),
  entity_type: EntityTypeEnum,
  entity_name: z.string().min(1),
  entity_scope: z.string().optional(),
  parent_campaign: z.string().nullable().optional(),
  parent_adgroup: z.string().nullable().optional(),
  display_label: z.string().optional(),
  metric: z.string().min(1),
  current_value: z.number().nullable(),
  previous_value: z.number().nullable(),
  change_pct: z.number().nullable(),
  severity: SeverityEnum,
  insight_type: InsightTypeEnum,
  is_seasonal: z.boolean(),
  is_structural: z.boolean(),
  cause: z.string().nullable(),
  action_required: z.boolean(),
  // Evidence model (optional for backward compatibility)
  evidence_level: EvidenceLevelEnum.optional(),
  confidence: ConfidenceEnum.optional(),
  benchmark_type: BenchmarkTypeEnum.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);

export const StepStatusEnum = z.enum(["KRITIEK", "NIET OP SCHEMA", "OP SCHEMA"]);
export type StepStatus = z.infer<typeof StepStatusEnum>;

export const StepActionSchema = z.object({
  actie: z.string().min(5).refine(
    (val) => !/(consolideer|optimaliseer|onderzoek|analyseer)/i.test(val),
    { message: "Actie bevat verboden woord" }
  ),
  campagne: z.string().nullable(),
  deadline: z.enum(["direct", "deze_week", "volgende_week", "deze_maand"]),
  verwachte_impact: z.string().min(5),
});
export type StepAction = z.infer<typeof StepActionSchema>;

export const StepOutputSchema = z.object({
  narrative: z.string().min(50),
  log_entries: z.array(z.string()).min(1),
  top_3_findings: z.array(FindingSchema).min(1).max(3),
  status: StepStatusEnum,
  actions: z.array(StepActionSchema).max(2),
  step_conclusion: z.string().min(10),
  // Bewijs-basis van de stapconclusie (optioneel voor backward-compatibility met bestaande,
  // opgeslagen outputs). Ontbreekt ze → normalizeEvidenceBasis maakt er deterministisch "platform"
  // van bij het parsen, zodat elke conclusie in de pipeline een expliciete basis draagt.
  evidence_basis: EvidenceBasisEnum.optional(),
});
export type StepOutput = z.infer<typeof StepOutputSchema>;

// ── Recommendation schema (step 8 output — recommendations part) ──────────

export const RecommendationSchema = z.object({
  finding_index: z.number().int().nullable(),
  cluster_id: z.string().min(1).default("cluster_unknown"),
  thread_id: z.string().nullable().default(null),
  source: RecommendationSourceEnum,
  hypothesis: z.string().min(1),
  expected_result: z.string().min(1),
  measurement_metric: z.string().min(1),
  timeframe: z.string().min(1),
  rationale: z.string().min(1),
  ice_impact: z.number().min(1).max(10),
  ice_confidence: z.number().min(1).max(10),
  ice_ease: z.number().min(1).max(10),
  // Genormaliseerd in plaats van hard geweigerd: het model levert soms de SOM van de drie
  // ICE-delen (tot 30) in plaats van het gemiddelde, en een harde max(10) gooide daarop een
  // complete, verder valide aanbeveling weg -- live gezien bij de LinkedIn-weekly (1 september
  // 2026: 4 van de 4 aanbevelingen weggevallen op "ice_total: Too big", waarna alle taken hun
  // referent kwijt waren en de run met 0 aanbevelingen opleverde). Een som boven de schaal is
  // een vormfout, geen inhoudsfout: delen door 3 herstelt hem, en de klem [1, 10] vangt de
  // rest. Dit schema wordt alleen voor het PARSEN van modeloutput gebruikt (safeParse), nooit
  // als response_format-JSON-schema, dus de preprocess kan geen strict-schema breken.
  ice_total: z.preprocess((w) => {
    const n = typeof w === "number" ? w : NaN;
    if (!Number.isFinite(n)) return w;
    const genormaliseerd = n > 10 ? n / 3 : n;
    return Math.min(10, Math.max(1, Math.round(genormaliseerd * 10) / 10));
  }, z.number().min(1).max(10)),
  // Action gating (optional for backward compatibility)
  action_readiness: ActionReadinessEnum.optional(),
  evidence_level: EvidenceLevelEnum.optional(),
  confidence: ConfidenceEnum.optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

// ── Task schema (step 8 output — tasks part) ──────────────────────────────

export const TaskSchema = z.object({
  recommendation_index: z.number().int(),
  cluster_id: z.string().min(1).default("cluster_unknown"),
  thread_id: z.string().nullable().default(null),
  title: z.string().min(1).max(80),
  description: z.string().min(1),
  action_type: ActionTypeEnum,
  owner: OwnerEnum,
  affected_campaign: z.string().nullable(),
  affected_adgroup: z.string().nullable(),
  affected_keyword: z.string().nullable(),
  current_value: z.string().nullable(),
  target_value: z.string().nullable(),
  priority: PriorityEnum,
  frequency: FrequencyEnum,
  due_date_days: z.number().int().min(1).max(365),
});

export type Task = z.infer<typeof TaskSchema>;

// ── Combined step 8 output schema ─────────────────────────────────────────

export const RecommendationsOutputSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  tasks: z.array(TaskSchema),
});

export type RecommendationsOutput = z.infer<typeof RecommendationsOutputSchema>;

// ── Parse helpers ──────────────────────────────────────────────────────────

/**
 * Strips markdown code fences and extracts JSON from LLM text output.
 * Returns the cleaned string, or null if no JSON-like content found.
 */
export function extractJson(raw: string): string | null {
  let text = raw.trim();

  // Strip markdown code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // If it looks like JSON, return it
  if (text.startsWith("[") || text.startsWith("{")) {
    return text;
  }

  // Try to find a JSON array or object embedded in the text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];

  return null;
}

/**
 * Het resultaat van het parsen van LLM-uitvoer.
 *
 * `dropped` telt de items die het herstelpad heeft weggegooid omdat ze niet valideerden. Dat
 * veld stond er niet, en daardoor was het verlies onzichtbaar: bij drie voorgestelde taken
 * waarvan er een ongeldig was kwam er `success: true` met twee taken uit, zonder enig spoor
 * van de derde. De foutlogging verderop kijkt naar `success` en sloeg dus ook niet aan. Wie
 * de analyse las zag twee taken en had geen manier om te weten dat er een derde was bedacht
 * en stilletjes verdwenen.
 */
export type ParseResult<T> =
  | { success: true; data: T; dropped?: DroppedItems }
  | { success: false; error: string; raw: string };

export interface DroppedItems {
  /** Aantal weggevallen items per soort, met de reden van de eerste. */
  counts: Record<string, number>;
  reasons: string[];
}

function inferIssueCluster(raw: Record<string, unknown>): IssueCluster {
  const provided = typeof raw.issue_cluster === "string" ? raw.issue_cluster.trim().toLowerCase() : "";
  const entityType = typeof raw.entity_type === "string" ? raw.entity_type.toLowerCase() : "";
  const metric = typeof raw.metric === "string" ? raw.metric.toLowerCase() : "";
  const cause = typeof raw.cause === "string" ? raw.cause.toLowerCase() : "";
  const combined = `${provided} ${entityType} ${metric} ${cause}`.trim();

  if (/tracking|measurement/.test(combined)) return "tracking_cvr_drop";
  if (/lost is|budget/.test(combined)) return "search_budget_cap";
  if (/troas|bid|cpc|inflation/.test(combined)) return "search_bidding_inflation";
  if (/desktop/.test(combined)) return "desktop_inefficiency";
  if (/creative|copy|rsa/.test(combined)) return "creative_mismatch";
  if (/pmax|performance max|cannibal/.test(combined)) return "pmax_cannibalization";
  if (/search.?term|waste|negative|keyword|searchterm/.test(combined) || entityType === "searchterm") return "search_term_waste";
  if (/geo|country|land|region|belg|nederland|germany|duitsland|france|frankrijk/.test(combined) || entityType === "country") return "geo_allocation";
  if (/audience/.test(combined) || entityType === "audience") return "audience_inefficiency";
  if (/schedule|hour|daypart|dag|uur/.test(combined) || entityType === "schedule") return "schedule_waste";
  if (/network|youtube|partner/.test(combined) || entityType === "network") return "network_quality";
  if (/product|shopping|asset group|asset_group/.test(combined) || entityType === "creative") return "product_mix";
  if (/mobile/.test(combined) || (entityType === "device" && /mobile/.test(combined))) return "mobile_opportunity";
  if (/brand/.test(combined)) return "brand_leakage";
  if (/partner/.test(combined)) return "search_partner_waste";
  return "uncategorized";
}

function enrichRawFinding(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = { ...(raw as Record<string, unknown>) };
  if (typeof record.issue_cluster !== "string" || !record.issue_cluster.trim()) {
    const inferred = inferIssueCluster(record);
    record.issue_cluster = inferred;
  if (inferred === "uncategorized" && !record.issue_cluster_explanation) {
    record.issue_cluster_explanation = "Deterministische fallback omdat geen standaardcluster duidelijk toepasbaar was.";
  }
  }
  return record;
}

/**
 * Parse and validate findings from LLM output (step 7).
 * Returns validated findings array or error details.
 */
export function parseFindings(raw: string): ParseResult<Finding[]> {
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: "No JSON found in LLM output", raw };
  }

  try {
    const parsed = JSON.parse(json);
    const arr = (Array.isArray(parsed) ? parsed : (parsed.findings ?? parsed.insights ?? [])).map(enrichRawFinding);
    const result = FindingsArraySchema.safeParse(arr);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Partial recovery: keep items that validate individually
    const validItems: Finding[] = [];
    for (const item of arr) {
      const single = FindingSchema.safeParse(item);
      if (single.success) validItems.push(single.data);
    }

    if (validItems.length > 0) {
      return { success: true, data: validItems };
    }

    return {
      success: false,
      error: `Zod validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}

/**
 * Parse and validate recommendations + tasks from LLM output (step 8).
 * Returns validated output or error details.
 */
export function parseRecommendations(raw: string): ParseResult<RecommendationsOutput> {
  const json = extractJson(raw);
  if (!json) {
    return { success: false, error: "No JSON found in LLM output", raw };
  }

  try {
    const parsed = JSON.parse(json);
    const result = RecommendationsOutputSchema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Partial recovery: validate each array individually
    const validRecs: Recommendation[] = [];
    const validTasks: Task[] = [];

    for (const rec of (parsed.recommendations ?? [])) {
      const single = RecommendationSchema.safeParse(rec);
      if (single.success) validRecs.push(single.data);
    }
    for (const task of (parsed.tasks ?? [])) {
      const single = TaskSchema.safeParse(task);
      if (single.success) validTasks.push(single.data);
    }

    if (validRecs.length > 0 || validTasks.length > 0) {
      // Wat er is weggevallen gaat mee naar buiten. Stil laten vallen is hier het gevaarlijkst:
      // een LLM die systematisch een veld verkeerd invult verliest zo het gros van zijn taken
      // zonder dat iemand het merkt.
      const recsIn = (parsed.recommendations ?? []).length;
      const tasksIn = (parsed.tasks ?? []).length;
      const counts: Record<string, number> = {};
      const reasons: string[] = [];
      if (recsIn > validRecs.length) {
        counts.recommendations = recsIn - validRecs.length;
        const eerste = (parsed.recommendations ?? []).find((r: unknown) => !RecommendationSchema.safeParse(r).success);
        const fout = eerste ? RecommendationSchema.safeParse(eerste) : null;
        if (fout && !fout.success) reasons.push(`aanbeveling: ${fout.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      if (tasksIn > validTasks.length) {
        counts.tasks = tasksIn - validTasks.length;
        const eerste = (parsed.tasks ?? []).find((t: unknown) => !TaskSchema.safeParse(t).success);
        const fout = eerste ? TaskSchema.safeParse(eerste) : null;
        if (fout && !fout.success) reasons.push(`taak: ${fout.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      const dropped = Object.keys(counts).length > 0 ? { counts, reasons } : undefined;
      return { success: true, data: { recommendations: validRecs, tasks: validTasks }, dropped };
    }

    return {
      success: false,
      error: `Zod validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      raw,
    };
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}

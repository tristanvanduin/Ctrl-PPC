import type { SupabaseClient } from "@supabase/supabase-js";

// =====================================================================
// STATUS: GEBOUWD EN GETEST, MAAR NOG NIET GEWIRED (code-review must-fix 3).
// Deze helpers worden nog niet aangeroepen. Activeren vereist de tabellen client_targets en llm_usage plus de wiring in de prepared context en recordUsage. Neem niet aan dat targets of kosten live zijn.
// =====================================================================
// ============================================================
// O2: targets-resolutie, plausibiliteitsguard en LLM-kosten (pure kern)
// ------------------------------------------------------------
// Lost de twee O2-problemen op in deterministische, testbare vorm:
// 1. Verkeerde of nul-targets leidden tot onzin-analyse ("1275 procent boven
//    target"). resolveTargets levert de juiste target per maand en laat nul-
//    targets weg, zodat er nooit meer tegen 0 wordt vergeleken; de plausibiliteits-
//    guard schreeuwt als een target structureel niet klopt.
// 2. LLM-verbruik werd gemeten maar nergens tot kosten opgeteld. computeCallCost
//    en sumRunCost doen dat, met null voor modellen zonder bekende prijs (eerlijk).
//
// No-go's afgedwongen: nooit vergelijken met of delen door target 0; prijzen op
// EEN plek; geen kostenschatting voor modellen zonder prijs.
// ============================================================

// ── 4b. Target-resolutie ────────────────────────────────────────────────────

export interface TargetRow {
  channel: string;
  metric: string;
  targetValue: number;
  validFrom: string; // ISO datum, eerste van de maand
  validTo: string | null;
}

// Parseert een ISO-datum (YYYY-MM of YYYY-MM-DD) naar een UTC-timestamp voor een
// betrouwbare vergelijking. Null bij een ongeldig formaat, zodat een foute datum
// nooit stil tot een verkeerde vergelijking leidt.
function parseISODate(s: string): number | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  let iso: string;
  if (/^\d{4}-\d{2}$/.test(t)) iso = t + "-01";
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) iso = t.slice(0, 10);
  else return null;
  const ms = Date.parse(iso + "T00:00:00Z");
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Kiest per metric de geldige target voor de geanalyseerde maand: channel-match,
 * valid_from kleiner of gelijk aan de maand, valid_to null of groter of gelijk.
 * Bij overlap wint de laatste valid_from. Nul-targets en ongeldige datums worden
 * weggelaten, zodat de consument expliciet "geen target ingesteld" krijgt in plaats
 * van tegen 0 of tegen een verkeerd geparste datum te vergelijken.
 */
export function resolveTargets(rows: TargetRow[], channel: string, month: string): Record<string, number> {
  const monthT = parseISODate(month);
  if (monthT == null) return {}; // ongeldige maand: geen oordeel
  const best = new Map<string, { row: TargetRow; fromT: number }>();
  for (const r of rows) {
    if (r.channel !== channel) continue;
    const fromT = parseISODate(r.validFrom);
    if (fromT == null || fromT > monthT) continue; // ongeldige of nog niet geldige from
    if (r.validTo != null) {
      const toT = parseISODate(r.validTo);
      if (toT != null && toT < monthT) continue; // afgesloten voor deze maand
    }
    const cur = best.get(r.metric);
    if (!cur || fromT > cur.fromT) best.set(r.metric, { row: r, fromT });
  }
  const out: Record<string, number> = {};
  for (const [metric, { row }] of best) {
    if (row.targetValue !== 0 && Number.isFinite(row.targetValue)) out[metric] = row.targetValue;
  }
  return out;
}

// ── 4c. Plausibiliteitsguard ────────────────────────────────────────────────

const IMPLAUSIBLE_FACTOR = 5; // meer dan 5x afwijking, beide richtingen

/**
 * Flagt een target dat in twee opeenvolgende afgesloten maanden meer dan 5x van
 * de realisatie afwijkt (beide richtingen). Een maand is niet genoeg; de afwijking
 * moet in beide maanden bestaan. De analyse gaat door, maar de flag dwingt af dat
 * stap 1 herijking benoemt in plaats van procenten-theater.
 */
export function checkTargetPlausibility(
  metric: string,
  target: number,
  lastTwoMonthsActual: [number, number]
): { implausible: boolean; detail?: string } {
  if (!(target > 0)) return { implausible: false }; // zonder geldig target geen oordeel
  const deviates = (actual: number): boolean => {
    if (!(actual > 0)) return false;
    return actual / target > IMPLAUSIBLE_FACTOR || target / actual > IMPLAUSIBLE_FACTOR;
  };
  const [m1, m2] = lastTwoMonthsActual;
  if (deviates(m1) && deviates(m2)) {
    return {
      implausible: true,
      detail: `target lijkt niet realistisch geconfigureerd voor ${metric}: target ${target}, realisatie ${m1} en ${m2} in de laatste twee maanden; bespreek herijking`,
    };
  }
  return { implausible: false };
}

// ── 4e. LLM-kosten ──────────────────────────────────────────────────────────

// Prijs per 1 miljoen tokens in EURO, per model. Eén plek; nergens anders hardcoden.
//
// ── INGEVULD OP 2026-08-05 ──────────────────────────────────────────────────
//
// Bron: ai.google.dev/gemini-api/docs/pricing, betaalde laag, standaardtarief. Google publiceert
// in DOLLAR; de omrekening staat hieronder als aparte constante, zodat zichtbaar is dat het een
// omrekening is en geen gepubliceerde europrijs.
//
// TWEE DINGEN OM TE WETEN VOORDAT JE HIEROP STUURT:
//
//   1. De naam in de router is niet de naam op de prijspagina. De router vraagt
//      "gemini-3-flash-preview"; de pagina noemt de 3-generatie Flash zonder het woord preview.
//      Ik heb ze op generatie gekoppeld. Wijkt Google's preview-tarief af, dan wijkt deze
//      berekening mee -- controleer dat bij de eerste echte factuur.
//   2. De wisselkoers is een MOMENTOPNAME. Bij een cap die op een tientje nauwkeurig moet zijn is
//      dat ruim genoeg; bij een afrekening naar een klant niet.
//
// Onbekend model: geen entry, en dan blijft cost_eur null. Dat is eerlijker dan een schatting.

/**
 * Dollar naar euro. Eén plek, met de datum erbij, want een koers zonder datum is over een half
 * jaar niet van een vergissing te onderscheiden.
 */
export const USD_PER_EUR = 1.08; // stand 2026-08-05
const eur = (usdPer1M: number) => Math.round((usdPer1M / USD_PER_EUR) * 10000) / 10000;

export const MODEL_PRICES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // Gemini 3 Flash: $1,50 in / $7,50 uit per 1M tokens.
  "gemini-3-flash-preview": { inputPer1M: eur(1.50), outputPer1M: eur(7.50) },
  // Gemini 2.5 Flash-Lite: $0,10 in / $0,40 uit.
  "gemini-flash-lite-latest": { inputPer1M: eur(0.10), outputPer1M: eur(0.40) },
  // Gemini 2.5 Flash: $0,30 in / $2,50 uit.
  "gemini-2.5-flash": { inputPer1M: eur(0.30), outputPer1M: eur(2.50) },
};

/**
 * Deel van de normale invoerprijs dat een gecachte prompttoken kost. Gemini rekent impliciet
 * gecachte invoer af tegen een kwart van het normale tarief. Staat hier als aparte constante
 * zodat hij met de prijstabel mee bijgewerkt kan worden.
 */
export const CACHED_INPUT_FACTOR = 0.25;

/**
 * Berekent de kosten van een call in euro. Null als het model geen bekende prijs
 * heeft; dat is eerlijker dan een schatting. Afgerond op vier decimalen (numeric(10,4)).
 *
 * `cachedPromptTokens` is het deel van `promptTokens` dat de provider uit zijn cache haalde en
 * goedkoper afrekent. Zonder dat onderscheid wordt een run met een goed werkende cache even
 * duur gerapporteerd als een run zonder, en is aan de cijfers niet te zien of het gedeelde
 * promptbegin nog intact is.
 */
export function computeCallCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  prices: Record<string, { inputPer1M: number; outputPer1M: number }> = MODEL_PRICES,
  cachedPromptTokens = 0
): number | null {
  const p = prices[model];
  if (!p) return null;
  // Meer gecacht dan verstuurd kan niet; bij een rare melding van de provider liever de
  // veilige kant op dan een negatief aantal volle tokens.
  const gecacht = Math.max(0, Math.min(cachedPromptTokens, promptTokens));
  const vol = promptTokens - gecacht;
  const cost =
    (vol / 1_000_000) * p.inputPer1M +
    (gecacht / 1_000_000) * p.inputPer1M * CACHED_INPUT_FACTOR +
    (completionTokens / 1_000_000) * p.outputPer1M;
  return Math.round(cost * 10000) / 10000;
}

export interface UsageRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costEur: number | null;
}

/**
 * Telt het verbruik van een run op: totale kosten (alleen van calls met bekende
 * prijs), tokens, aantal calls, en hoeveel calls geen prijs hadden. Het aantal
 * unpriced calls maakt expliciet dat een totaal partieel kan zijn.
 */
export function sumRunCost(records: UsageRecord[]): {
  totalEur: number;
  tokens: number;
  calls: number;
  unpricedCalls: number;
} {
  let totalEur = 0;
  let tokens = 0;
  let unpricedCalls = 0;
  for (const r of records) {
    tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
    if (r.costEur == null) unpricedCalls++;
    else totalEur += r.costEur;
  }
  return { totalEur: Math.round(totalEur * 10000) / 10000, tokens, calls: records.length, unpricedCalls };
}


// ── W1.1-wiring (O2): de adapters die de kern aan de pipeline knopen ──

// Bepaalt de plausibiliteit van de goals-targets (kpi_targets) tegen de laatste twee
// afgesloten maanden uit ads_account_monthly. Google-vorm: CPA = cost/conversions,
// ROAS = conversions_value/cost. Geeft null bij minder dan twee maanden of zonder target,
// zodat de aanroeper niets hoeft te doen. De detail-tekst komt uit checkTargetPlausibility
// en stuurt op herijking in plaats van het als performance te lezen.
export function goalsPlausibilityFromMonthly(
  goals: { cpaTarget?: number; roasTarget?: number },
  rows: Array<{ month?: string; cost?: number; conversions?: number; conversions_value?: number }>
): { target_implausible: boolean; detail?: string } | null {
  const sorted = [...rows]
    .filter((r) => r.month)
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (sorted.length < 2) return null;
  const [prev, last] = sorted.slice(-2);

  const cpaOf = (r: typeof last): number => {
    const conversions = Number(r.conversions ?? 0);
    return conversions > 0 ? Number(r.cost ?? 0) / conversions : 0;
  };
  const roasOf = (r: typeof last): number => {
    const cost = Number(r.cost ?? 0);
    return cost > 0 ? Number(r.conversions_value ?? 0) / cost : 0;
  };

  const details: string[] = [];
  if (goals.cpaTarget && goals.cpaTarget > 0) {
    const check = checkTargetPlausibility("CPA", goals.cpaTarget, [
      Math.round(cpaOf(last) * 100) / 100,
      Math.round(cpaOf(prev) * 100) / 100,
    ]);
    if (check.implausible && check.detail) details.push(check.detail);
  }
  if (goals.roasTarget && goals.roasTarget > 0) {
    const check = checkTargetPlausibility("ROAS", goals.roasTarget, [
      Math.round(roasOf(last) * 100) / 100,
      Math.round(roasOf(prev) * 100) / 100,
    ]);
    if (check.implausible && check.detail) details.push(check.detail);
  }
  if (details.length === 0) return { target_implausible: false };
  return { target_implausible: true, detail: details.join("; ") };
}

// Leidt het kanaal af uit de sopType, voor de channel-kolom in llm_usage.
export function channelFromSopType(sopType: string): string | null {
  if (sopType === "meta_monthly") return "meta_ads";
  if (sopType === "linkedin_monthly") return "linkedin_ads";
  if (sopType === "monthly" || sopType === "weekly" || sopType === "biweekly") return "google_ads";
  return null;
}

// Bouwt de llm_usage-rij exact conform migratie 003. Puur en los testbaar; cost_eur is
// null bij een model zonder bekende prijs, wat een partieel totaal expliciet maakt.
export function buildUsageRow(input: {
  runKey: string;
  clientId?: string | null;
  channel?: string | null;
  sopType?: string | null;
  stepLabel?: string | null;
  callLabel?: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Deel van promptTokens dat uit de providercache kwam; telt mee in de prijs, niet als kolom. */
  cachedPromptTokens?: number;
}): Record<string, unknown> {
  return {
    run_key: input.runKey,
    client_id: input.clientId ?? null,
    channel: input.channel ?? null,
    sop_type: input.sopType ?? null,
    step_label: input.stepLabel ?? null,
    call_label: input.callLabel ?? null,
    model: input.model,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    // Bewust GEEN kolom voor de gecachte tokens: llm_usage heeft die niet en de insert is
    // fire-and-forget met een stille catch, dus een onbekende kolom zou alle kostenregistratie
    // geruisloos uitzetten. De korting zit wel in cost_eur verwerkt. De migratie die de kolom
    // toevoegt staat klaar in scripts/pending-migration-cached-tokens.sql.
    cost_eur: computeCallCost(
      input.model, input.promptTokens, input.completionTokens, MODEL_PRICES, input.cachedPromptTokens ?? 0
    ),
  };
}

// =====================================================================
// LIVE-ONGETEST: de insert is pas tegen de gemigreerde llm_usage-tabel (003) te
// verifieren. Fire-and-forget bij ontwerp: een logging-fout mag nooit een analyse breken.
// =====================================================================
export async function recordUsage(
  supabase: SupabaseClient,
  input: Parameters<typeof buildUsageRow>[0]
): Promise<void> {
  try {
    await supabase.from("llm_usage").insert(buildUsageRow(input));
  } catch {
    // bewust stil: kostenregistratie is nooit een breekpunt voor de analyse
  }
}


// ── W1.1c: ingestelde targets (client_targets) in de stap-1-context ──

// Berekent per metric de actuals van de laatste twee afgesloten maanden uit de
// ads_account_monthly-rijen, als [laatste, voorlaatste]. Null bij minder dan twee maanden.
export function targetActualsFromMonthly(
  rows: Array<{ month?: string; cost?: number; conversions?: number; conversions_value?: number }>
): Record<string, [number, number]> | null {
  const sorted = [...rows]
    .filter((r) => r.month)
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (sorted.length < 2) return null;
  const [prev, last] = sorted.slice(-2);
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const of = (r: typeof last): Record<string, number> => {
    const cost = Number(r.cost ?? 0);
    const conversions = Number(r.conversions ?? 0);
    const value = Number(r.conversions_value ?? 0);
    return {
      cpa: conversions > 0 ? r2(cost / conversions) : 0,
      roas: cost > 0 ? r2(value / cost) : 0,
      conversions,
      spend: r2(cost),
      conversion_value: r2(value),
    };
  };
  const l = of(last);
  const p = of(prev);
  const out: Record<string, [number, number]> = {};
  for (const metric of Object.keys(l)) out[metric] = [l[metric], p[metric]];
  return out;
}

// Bouwt het context-blok voor ingestelde targets, UITSLUITEND uit de resolved set
// (no-go: nooit kpiTargets bijmengen in dit pad). Null zonder targets, zodat een klant
// zonder client_targets geen enkele gedragswijziging krijgt. Per target met bekende
// realisatie een plausibiliteitstoets; anyImplausible stuurt de QA-red-flag.
export function buildConfiguredTargetsBlock(
  resolved: Record<string, number>,
  actuals: Record<string, [number, number]> | null
): { text: string; anyImplausible: boolean } | null {
  const metrics = Object.keys(resolved).filter((m) => resolved[m] > 0);
  if (metrics.length === 0) return null;
  const label: Record<string, string> = {
    cpa: "CPA", roas: "ROAS", cpl: "CPL",
    conversions: "Conversies", spend: "Spend", conversion_value: "Conversiewaarde",
  };
  const lines = ["## Ingestelde targets (client_targets, geldig voor deze maand)"];
  let anyImplausible = false;
  for (const metric of metrics) {
    const naam = label[metric] ?? metric;
    let regel = `- ${naam}-target: ${resolved[metric]}`;
    const act = actuals?.[metric];
    if (act) {
      regel += ` (realisatie laatste twee maanden: ${act[0]} en ${act[1]})`;
      const check = checkTargetPlausibility(naam, resolved[metric], act);
      if (check.implausible && check.detail) {
        anyImplausible = true;
        lines.push(regel);
        lines.push(`  LET OP: ${check.detail}`);
        continue;
      }
    }
    lines.push(regel);
  }
  return { text: lines.join("\n"), anyImplausible };
}

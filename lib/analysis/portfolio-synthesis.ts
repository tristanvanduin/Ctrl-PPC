// Portfolio-synthese (masterplan 17.15): dezelfde soort synthese-stap als cross-channel-
// synthesis.ts, maar tussen KLANTEN van hetzelfde bureau in plaats van tussen kanalen van
// dezelfde klant. Eigenaar, 17 augustus 2026, expliciet gekozen boven "de bestaande Macro-
// portfoliogating verstevigen": een nieuwe LLM-synthese-stap die patronen over meerdere klanten
// heen samenvoegt tot 1 verhaal.
//
// ── WAAROM DIT GEEN EXACTE-DATUM-GATE HEEFT (in tegenstelling tot cross-channel-synthesis.ts) ──
//
// cross-channel-synthesis.ts eist dat ALLE kanalen van ÉÉN klant dezelfde analysis_date dragen,
// want die worden typisch in dezelfde sessie/knop-klik na elkaar getriggerd. Klanten van één
// bureau draaien elk op hun EIGEN cadans (lib/scheduler/sop-cadence.ts) -- een portfolio van 10
// klanten zal vrijwel nooit allemaal exact dezelfde kalenderdag afronden. Deze module gebruikt
// daarom een VERSHEIDSVENSTER (FRESHNESS_DAYS) per klant in plaats van een exacte match: elke
// klant telt mee als zijn nieuwste beschikbare eindverhaal binnen dat venster valt, met de eigen
// analysis_date expliciet in de prompt (zelfde "kan van een eerdere cyclus zijn"-discipline als
// cross-channel-context.ts).
//
// ── WAAROM GEEN K-ANONIMITEIT (in tegenstelling tot lib/benchmark/god-view.ts) ──
//
// God View combineert data van MEERDERE bureaus en moet daarom anonimiseren. Dit hier blijft
// binnen ÉÉN bureau, over zijn EIGEN klanten -- het bureau heeft al volledige inzage in elk van
// die klanten apart, dus er is niets te anonimiseren dat de synthese niet ook los al zou tonen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callLayer } from "./llm-router";
import { callOpenRouter, type OpenRouterRequest, type OpenRouterResponse } from "./openrouter-client";
import { CHANNEL_CONFIG, ALLE_SOP_CHANNELS } from "./sop-channel-config";
import { daysAgo } from "@/lib/reporting-date";
import { nicheLabel, type Bedrijfsmodel } from "@/lib/benchmark/segment";

export const SECTION = "portfolio_synthesis_v1";
const FRESHNESS_DAYS = 35; // ruim boven een maandcadans, zodat een klant die een paar dagen later draait niet uit de boot valt.
const MIN_CLIENTS = 2;

export interface ClientSummary {
  clientId: string;
  clientName: string;
  analysisDate: string;
  primaryThread: string;
  rootCause: string;
  topRecommendations: string[];
  /** Uit client_settings, null als onbekend (voor veel bestaande klanten het geval -- zie
   *  masterplan 17.17). b2b/b2c is een andere as dan ecommerce/lead-gen; wel het dichtstbijzijnde
   *  wat gestructureerd wordt vastgelegd. */
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
  /** true als dit uit de eigen cross-channel-synthese van de klant komt (meerdere kanalen al
   *  samengevoegd); false als het de terugval is naar het enige/beste beschikbare kanaal. */
  fromCrossChannelSynthesis: boolean;
}

interface StructuredMonthlyRow {
  final_sop?: { primary_thread?: string; root_cause?: string; recommendations?: { handeling?: string }[] };
}
interface CrossChannelSynthesisRow {
  headline?: string;
  narrative?: string;
  synthesized_actions?: { action?: string }[];
}

/** Eén klant se beste beschikbare eindverhaal: bij voorkeur de eigen cross-channel-synthese
 *  (meerdere kanalen al samengevoegd), anders het meest recente kanaal se structured_monthly_v2.
 *  Null als er voor deze klant niets binnen het versheidsvenster staat.
 *
 *  `bedrijfsmodel`/`niche` komen apart binnen (uit client_settings, één gebundelde query in
 *  fetchPortfolioSummaries) i.p.v. hier zelf opgezocht -- anders zou elke klant een extra query
 *  kosten voor data die toch al gebundeld beschikbaar is. */
async function fetchClientSummary(
  supabase: SupabaseClient,
  clientId: string,
  clientName: string,
  bedrijfsmodel: Bedrijfsmodel | null,
  niche: string | null
): Promise<ClientSummary | null> {
  const cutoff = daysAgo(FRESHNESS_DAYS);

  const { data: synthRow } = await supabase
    .from("sop_analysis_output")
    .select("output, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", "cross_channel")
    .eq("section", "cross_channel_synthesis_v1")
    .gte("analysis_date", cutoff)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (synthRow?.output) {
    try {
      const parsed = JSON.parse(String(synthRow.output)) as CrossChannelSynthesisRow;
      return {
        clientId, clientName, bedrijfsmodel, niche,
        analysisDate: String(synthRow.analysis_date),
        primaryThread: parsed.headline ?? "",
        rootCause: parsed.narrative ?? "",
        topRecommendations: (parsed.synthesized_actions ?? []).slice(0, 5).map((a) => a.action ?? "").filter(Boolean),
        fromCrossChannelSynthesis: true,
      };
    } catch { /* val terug op los kanaal hieronder */ }
  }

  // Geen (verse) cross-channel-synthese: het meest recente kanaal binnen het venster, over alle
  // kanalen heen -- een klant met maar 1 kanaal heeft nooit een cross-channel-synthese (die vergt
  // 2+), dus dit is voor de meeste klanten het normale pad, niet een noodgreep.
  const perKanaal = await Promise.all(
    ALLE_SOP_CHANNELS.map(async (channel) => {
      const { data } = await supabase
        .from("sop_analysis_output")
        .select("output, analysis_date")
        .eq("client_id", clientId)
        .eq("sop_type", CHANNEL_CONFIG[channel].sopTypeKey.monthly)
        .eq("section", "structured_monthly_v2")
        .gte("analysis_date", cutoff)
        .order("analysis_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? { channel, output: String(data.output), analysisDate: String(data.analysis_date) } : null;
    })
  );
  const beschikbaar = perKanaal.filter((r): r is NonNullable<typeof r> => r !== null);
  if (beschikbaar.length === 0) return null;
  const nieuwste = beschikbaar.sort((a, b) => b.analysisDate.localeCompare(a.analysisDate))[0];

  try {
    const parsed = JSON.parse(nieuwste.output) as StructuredMonthlyRow;
    const finalSop = parsed.final_sop ?? {};
    return {
      clientId, clientName, bedrijfsmodel, niche,
      analysisDate: nieuwste.analysisDate,
      primaryThread: finalSop.primary_thread ?? "",
      rootCause: finalSop.root_cause ?? "",
      topRecommendations: (finalSop.recommendations ?? []).slice(0, 5).map((r) => r.handeling ?? "").filter(Boolean),
      fromCrossChannelSynthesis: false,
    };
  } catch {
    return null;
  }
}

interface ClientSettingsRow {
  client_id: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
}

export async function fetchPortfolioSummaries(
  supabase: SupabaseClient,
  clients: readonly { clientId: string; clientName: string }[]
): Promise<Map<string, ClientSummary | null>> {
  const { data: settingsRows } = await supabase
    .from("client_settings")
    .select("client_id, bedrijfsmodel, niche")
    .in("client_id", clients.map((c) => c.clientId));
  const settingsByClient = new Map(
    ((settingsRows ?? []) as ClientSettingsRow[]).map((r) => [r.client_id, r])
  );

  const entries = await Promise.all(
    clients.map(async (c) => {
      const settings = settingsByClient.get(c.clientId);
      return [
        c.clientId,
        await fetchClientSummary(supabase, c.clientId, c.clientName, settings?.bedrijfsmodel ?? null, settings?.niche ?? null),
      ] as const;
    })
  );
  return new Map(entries);
}

export interface PortfolioSynthesizedAction {
  /** clientId van de klant waar deze actie voor is, of "portfolio" voor iets dat het hele bureau
   *  aangaat (bijv. een checklist die op alle klanten toegepast moet worden). */
  clientId: string;
  /** Leesbare naam voor de UI, gezet tijdens het parsen (niet door het model zelf). "Hele
   *  portfolio" als clientId === "portfolio". */
  clientName?: string;
  action: string;
  rationale: string;
  priority: "hoog" | "midden" | "laag";
}

export interface PortfolioSynthesisResult {
  headline: string;
  narrative: string;
  /** Patronen die bij meerdere klanten terugkomen -- de kern van waarom dit bureau-breed en niet
   *  per klant gelezen moet worden. */
  recurring_patterns: string[];
  /** Klanten die opvallend afwijken van de rest van de portfolio, positief of negatief. */
  outliers: string[];
  synthesized_actions: PortfolioSynthesizedAction[];
  clients_used: string[];
  markdown: string;
}

const MAX_NARRATIVE_CHARS = 1200;

export function buildPortfolioSynthesisPrompt(
  summaries: Map<string, ClientSummary | null>
): { systemPrompt: string; userMessage: string } {
  const clients = [...summaries.values()].filter((s): s is ClientSummary => s !== null);
  const clientIds = clients.map((c) => c.clientId);

  const systemPrompt = [
    "Je bent de portfolio-synthese-laag van een marketingbureau-dashboard.",
    `Je krijgt de meest recente eindconclusie van ${clients.length} klanten van hetzelfde bureau (elk al zelf geanalyseerd), en moet het ene verhaal vinden dat je alleen ziet als je de hele portfolio tegelijk bekijkt.`,
    "",
    "Je taak is GEEN samenvatting per klant — dat bestaat al. Je taak is PATRONEN vinden die bij meerdere klanten terugkomen (bijv. hetzelfde type verspilling, dezelfde structurele fout, dezelfde kans), en klanten die opvallend afwijken van de rest.",
    "",
    "Regels:",
    "- Eén hoofdverhaal (narrative), niet één zin per klant.",
    "- recurring_patterns: alleen patronen die bij MINSTENS TWEE klanten voorkomen. Een observatie over precies één klant hoort in outliers, niet hier.",
    "- outliers: klanten die duidelijk beter of slechter presteren dan de rest van de portfolio, met de reden.",
    `- Elke synthesized_action moet een ECHTE, hierboven aangeleverde klant als 'clientId' hebben (${clientIds.map((c) => `"${c}"`).join(", ")}), OF het letterlijke woord "portfolio" voor iets dat op de hele portfolio van toepassing is (bijv. een checklist of proces, niet gebonden aan één klant). Verzin nooit een clientId die niet is aangeleverd.`,
    "- Een actie hoort hier alleen als hij de vergelijking tussen klanten nodig heeft om te bedenken — iets dat net zo goed uit één klant alleen had kunnen komen hoort niet in deze lijst.",
    "- Verzin geen cijfers die niet in de aangeleverde samenvattingen staan.",
    "- Bij elke klant staat het bedrijfsmodel/de niche erbij (of \"onbekend\" als dat niet is vastgelegd). Vergelijk budget-, CPA- en conversieratio-patronen alleen rechtstreeks tussen klanten met hetzelfde of een vergelijkbaar bedrijfsmodel (bijv. e-commerce met e-commerce, lead-gen met lead-gen) — een e-commerce-klant en een lead-gen-klant hebben structureel andere conversieratio's en KPI-normen, dus een numerieke vergelijking daartussen is misleidend, ook al lijkt de trend hetzelfde. Bij onbekend bedrijfsmodel: benoem dat expliciet als onzekerheid in plaats van stilzwijgend gelijk te behandelen.",
    "- Antwoord uitsluitend als JSON met exact deze velden: headline (string, één zin), narrative (string, 3-6 zinnen), recurring_patterns (string[], leeg als er geen zijn), outliers (string[], leeg als er geen zijn), synthesized_actions (array van {clientId, action, rationale, priority: \"hoog\"|\"midden\"|\"laag\"}), markdown (string: een leesbare, opgemaakte weergave voor in een rapport).",
  ].join("\n");

  const clientBlocks = clients.map((c) => {
    const recs = c.topRecommendations.length > 0 ? c.topRecommendations.map((r) => `  - ${r}`).join("\n") : "  (geen)";
    const rootCause = c.rootCause.length > MAX_NARRATIVE_CHARS ? `${c.rootCause.slice(0, MAX_NARRATIVE_CHARS)}…` : c.rootCause;
    const modelLabel = c.bedrijfsmodel ? c.bedrijfsmodel : "onbekend";
    const nicheLabelText = c.niche ? nicheLabel(c.niche) : null;
    return [
      `### ${c.clientName} (${c.clientId}) — laatst geanalyseerd ${c.analysisDate}${c.fromCrossChannelSynthesis ? ", kanaaloverstijgende synthese" : ""}`,
      `Bedrijfsmodel: ${modelLabel}${nicheLabelText ? ` (${nicheLabelText})` : ""}`,
      `Hoofddraad: ${c.primaryThread || "(niet gerapporteerd)"}`,
      `Toelichting: ${rootCause || "(niet gerapporteerd)"}`,
      `Top-acties:`,
      recs,
    ].join("\n");
  }).join("\n\n");

  const userMessage = ["## Meest recente eindconclusie per klant", "", clientBlocks].join("\n");

  return { systemPrompt, userMessage };
}

function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
}

/** Parseert de LLM-output. Zelfde les als cross-channel-synthesis.ts's parseSynthesisOutput
 *  (live testrun 17 augustus 2026): een model dat een leesbare naam teruggeeft die het zelf net
 *  las, is geen hallucinatie -- normaliseren op naam ÉN id, niet alleen op de kale clientId. */
export function parsePortfolioSynthesisOutput(raw: string, validClients: readonly ClientSummary[]): PortfolioSynthesisResult {
  const idToName = new Map(validClients.map((c) => [c.clientId, c.clientName]));
  const nameToId = new Map(validClients.map((c) => [c.clientName.toLowerCase(), c.clientId]));
  const normalizeClientId = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    if (v === "portfolio") return "portfolio";
    if (idToName.has(v)) return v;
    const viaName = nameToId.get(v.trim().toLowerCase());
    return viaName ?? null;
  };

  try {
    const parsed = JSON.parse(stripCodeFence(raw)) as Partial<PortfolioSynthesisResult>;
    const actions = Array.isArray(parsed.synthesized_actions)
      ? parsed.synthesized_actions
          .map((a): PortfolioSynthesizedAction | null => {
            if (!a || typeof a !== "object" || typeof (a as PortfolioSynthesizedAction).action !== "string") return null;
            const clientId = normalizeClientId((a as PortfolioSynthesizedAction).clientId);
            if (!clientId) return null;
            const clientName = clientId === "portfolio" ? "Hele portfolio" : idToName.get(clientId);
            return { ...(a as PortfolioSynthesizedAction), clientId, clientName };
          })
          .filter((a): a is PortfolioSynthesizedAction => a !== null)
      : [];
    return {
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : raw,
      recurring_patterns: Array.isArray(parsed.recurring_patterns) ? parsed.recurring_patterns.filter((p) => typeof p === "string") : [],
      outliers: Array.isArray(parsed.outliers) ? parsed.outliers.filter((o) => typeof o === "string") : [],
      synthesized_actions: actions,
      clients_used: validClients.map((c) => c.clientId),
      markdown: typeof parsed.markdown === "string" ? parsed.markdown : raw,
    };
  } catch {
    return {
      headline: "", narrative: raw, recurring_patterns: [], outliers: [],
      synthesized_actions: [], clients_used: validClients.map((c) => c.clientId), markdown: raw,
    };
  }
}

export interface RunPortfolioSynthesisResult {
  skipped: false;
  result: PortfolioSynthesisResult;
  tokensUsed: number;
  model: string;
}
export interface SkippedPortfolioSynthesisResult {
  skipped: true;
  reason: string;
}

/** Al gesynthetiseerd voor deze analysis_date? Zelfde idempotentie-afweging als
 *  cross-channel-synthesis.ts's alreadySynthesized. */
export async function alreadyPortfolioSynthesized(supabase: SupabaseClient, agencyId: string, analysisDate: string): Promise<boolean> {
  const { data } = await supabase
    .from("agency_analysis_output")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("section", SECTION)
    .eq("analysis_date", analysisDate)
    .maybeSingle();
  return !!data;
}

export async function runPortfolioSynthesis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  agencyId: string;
  clients: readonly { clientId: string; clientName: string }[];
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  callFn?: (req: OpenRouterRequest) => Promise<OpenRouterResponse>;
}): Promise<RunPortfolioSynthesisResult | SkippedPortfolioSynthesisResult> {
  const { supabase, apiKey, agencyId, clients, analysisDate, periodStart, periodEnd, callFn = callOpenRouter } = opts;

  if (clients.length < MIN_CLIENTS) {
    return { skipped: true, reason: `Portfolio-synthese is pas relevant vanaf ${MIN_CLIENTS} klanten (nu ${clients.length}).` };
  }
  if (await alreadyPortfolioSynthesized(supabase, agencyId, analysisDate)) {
    return { skipped: true, reason: `Portfolio-synthese voor ${analysisDate} bestaat al.` };
  }

  const summariesByClient = await fetchPortfolioSummaries(supabase, clients);
  const validClients = [...summariesByClient.values()].filter((s): s is ClientSummary => s !== null);
  if (validClients.length < MIN_CLIENTS) {
    return {
      skipped: true,
      reason: `Nog niet genoeg klanten met een vers eindverhaal (binnen ${FRESHNESS_DAYS} dagen) — ${validClients.length} van de ${clients.length}.`,
    };
  }

  const { systemPrompt, userMessage } = buildPortfolioSynthesisPrompt(summariesByClient);

  const response = await callLayer("reasoning", {
    apiKey,
    systemPrompt,
    userMessage,
    jsonMode: true,
    maxTokens: 2200,
    label: `portfolio-synthesis-${agencyId}`,
  }, callFn);

  const result = parsePortfolioSynthesisOutput(response.output, validClients);

  const { error: saveError } = await supabase
    .from("agency_analysis_output")
    .upsert(
      {
        agency_id: agencyId,
        section: SECTION,
        analysis_date: analysisDate,
        period_start: periodStart,
        period_end: periodEnd,
        output: JSON.stringify(result),
        model_used: response.model,
        tokens_used: response.tokensUsed,
        step_number: 1,
        step_name: "Portfolio-synthese",
      },
      { onConflict: "agency_id,section,analysis_date" }
    );
  if (saveError) throw new Error(`Opslaan portfolio-synthese mislukt: ${saveError.message}`);

  return { skipped: false, result, tokensUsed: response.tokensUsed, model: response.model };
}

// Kanaaloverstijgende SYNTHESE (masterplan 17.12): de stap die tot nu toe ontbrak.
//
// cross-channel-context.ts injecteert cross-channel-signalen als VERKLARENDE context in de
// hypotheses-stap van elk kanaal apart — Meta's analyse blijft daarbij een Meta-analyse, LinkedIn's
// een LinkedIn-analyse. Dat is met opzet zo (17.3: een kanaal mag nooit een actie voor een ander
// kanaal aanbevelen). Maar het laat precies het stuk liggen waar de eigenaar herhaaldelijk om
// vroeg: "het beste van alle kanaal inzichten omgetoverd naar 1 concrete goede output" — een eigen,
// gesynthetiseerde blik die GEEN kanaal is, en die dus WEL over kanalen heen mag aanbevelen.
//
// Dit bestand bouwt die stap: wacht tot alle beschikbare kanalen hun monthly-analyse voor deze
// cyclus hebben afgerond (structured_monthly_v2 voor dezelfde analysis_date), voedt hun eigen
// eindconclusies (final_sop: primary_thread/root_cause/recommendations) plus de al-bestaande
// deterministische cross-channel-signalen (cross_channel_v1) aan één LLM-call, en laat die ÉÉN
// samenhangend verhaal + een lijst acties opleveren — elke actie expliciet gelabeld met welk kanaal
// hem uitvoert, nooit een verzonnen kanaal.
//
// "reasoning"-laag (Grok 4.6): dit is precies "redeneren over eerder werk, geen los datapunt"
// (lib/analysis/helpers.ts:388's omschrijving van diezelfde laag) — de synthese leest drie al
// afgeronde analyses en weegt ze tegen elkaar, het is geen nieuwe classificatie van ruwe data.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callLayer } from "./llm-router";
import { callOpenRouter, type OpenRouterRequest, type OpenRouterResponse } from "./openrouter-client";
import { saveAnalysisOutputSection } from "./helpers";
import { CHANNEL_CONFIG, type SopChannel } from "./sop-channel-config";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";

export const SOP_TYPE = "cross_channel";
export const SECTION = "cross_channel_synthesis_v1";

const KANAAL_TO_SOP_CHANNEL: Record<Kanaal, SopChannel> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
};

export interface SynthesizedAction {
  channel: SopChannel;
  action: string;
  rationale: string;
  priority: "hoog" | "midden" | "laag";
}

export interface CrossChannelSynthesisResult {
  headline: string;
  narrative: string;
  contradictions: string[];
  synthesized_actions: SynthesizedAction[];
  channels_used: SopChannel[];
  markdown: string;
}

interface ChannelSummary {
  channel: SopChannel;
  primaryThread: string;
  rootCause: string;
  topRecommendations: string[];
  executiveMarkdown: string;
}

/** Eén channel-samenvatting ophalen uit de al opgeslagen structured_monthly_v2, of null als die
 *  er voor deze analysis_date nog niet is. */
async function fetchChannelSummary(
  supabase: SupabaseClient,
  clientId: string,
  channel: SopChannel,
  analysisDate: string
): Promise<ChannelSummary | null> {
  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output")
    .eq("client_id", clientId)
    .eq("sop_type", CHANNEL_CONFIG[channel].sopTypeKey.monthly)
    .eq("section", "structured_monthly_v2")
    .eq("analysis_date", analysisDate)
    .maybeSingle();
  if (!data?.output) return null;

  try {
    const parsed = JSON.parse(String(data.output)) as {
      final_sop?: { primary_thread?: string; root_cause?: string; recommendations?: { handeling?: string }[] };
      executive_markdown?: string;
    };
    const finalSop = parsed.final_sop ?? {};
    return {
      channel,
      primaryThread: finalSop.primary_thread ?? "",
      rootCause: finalSop.root_cause ?? "",
      topRecommendations: (finalSop.recommendations ?? []).slice(0, 5).map((r) => r.handeling ?? "").filter(Boolean),
      executiveMarkdown: parsed.executive_markdown ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Haalt de channel-samenvattingen op voor elk beschikbaar kanaal, voor de gegeven cyclus
 * (analysisDate). Een kanaal dat dit cyclus nog geen monthly-run heeft afgerond levert null.
 * De aanroeper beslist wat "klaar" betekent (zie readyForSynthesis hieronder) — deze functie
 * doet alleen het ophalen, geen oordeel.
 */
export async function fetchChannelSummaries(
  supabase: SupabaseClient,
  clientId: string,
  beschikbareKanalen: readonly Kanaal[],
  analysisDate: string
): Promise<Map<SopChannel, ChannelSummary | null>> {
  const entries = await Promise.all(
    beschikbareKanalen.map(async (k) => {
      const channel = KANAAL_TO_SOP_CHANNEL[k];
      return [channel, await fetchChannelSummary(supabase, clientId, channel, analysisDate)] as const;
    })
  );
  return new Map(entries);
}

/** Klaar voor synthese: minstens 2 kanalen, en ELK beschikbaar kanaal heeft deze cyclus al een
 *  afgeronde monthly-analyse. Eén ontbrekend kanaal betekent wachten, niet gedeeltelijk draaien —
 *  een synthese over 2 van de 3 kanalen zou zichzelf presenteren als compleet terwijl hij dat niet
 *  is, en dat is precies het "stille gokken" dat deze codebase overal elders vermijdt. */
export function readyForSynthesis(summaries: Map<SopChannel, ChannelSummary | null>): boolean {
  if (summaries.size < 2) return false;
  return [...summaries.values()].every((s) => s !== null);
}

/** Al gesynthetiseerd voor deze analysis_date? Voorkomt een dubbele, kostbare reasoning-call als
 *  meerdere kanalen dezelfde dag na elkaar afronden en elk de synthese proberen te triggeren. */
export async function alreadySynthesized(supabase: SupabaseClient, clientId: string, analysisDate: string): Promise<boolean> {
  const { data } = await supabase
    .from("sop_analysis_output")
    .select("id")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .eq("analysis_date", analysisDate)
    .maybeSingle();
  return !!data;
}

const MAX_SIGNAL_CHARS = 3000;

export function buildSynthesisPrompt(
  summaries: Map<SopChannel, ChannelSummary | null>,
  crossChannelSignals: string | null
): { systemPrompt: string; userMessage: string } {
  const channels = [...summaries.entries()].filter((e): e is [SopChannel, ChannelSummary] => e[1] !== null);
  const channelLabels = channels.map(([ch]) => CHANNEL_CONFIG[ch].headerLabel);

  const systemPrompt = [
    "Je bent de kanaaloverstijgende synthese-laag van een performance-marketingdashboard.",
    `Je krijgt de afgeronde maandanalyses van ${channelLabels.join(", ")} voor dezelfde klant en dezelfde maand, plus deterministische cross-channel-signalen.`,
    "",
    "Je taak is GEEN samenvatting per kanaal — dat bestaat al, en herhalen voegt niets toe. Je taak is SYNTHESE: het ene concrete verhaal dat je alleen ziet als je alle kanalen tegelijk bekijkt.",
    "",
    "Regels:",
    "- Eén hoofdverhaal (narrative), niet drie naast elkaar. Kies het meest betekenisvolle patroon over de kanalen heen, ook als dat niet het topfinding van één los kanaal is.",
    "- Spreken de kanalen elkaar tegen (bijv. het ene kanaal ziet verzadiging, het andere groei op hetzelfde publiek)? Benoem dat expliciet in contradictions — verzwijg het niet en doe niet alsof het toeval is.",
    `- Elke synthesized_action moet een ECHT, hierboven genoemd kanaal als 'channel' hebben — gebruik daar de INTERNE sleutel (${channels.map(([ch]) => `"${ch}"`).join(", ")}), niet de leesbare naam uit de koppen hierboven (dus "google_ads", niet "SEA"). Verzin nooit een kanaal dat niet is aangeleverd.`,
    "- Een actie hoort hier alleen als hij de synthese van meerdere kanalen nodig heeft om te bedenken — een actie die net zo goed uit één kanaal alleen had kunnen komen hoort niet in deze lijst.",
    "- Verzin geen cijfers die niet in de aangeleverde samenvattingen of signalen staan.",
    `- Antwoord uitsluitend als JSON met exact deze velden: headline (string, één zin), narrative (string, 3-6 zinnen), contradictions (string[], leeg als er geen zijn), synthesized_actions (array van {channel: een van ${channels.map(([ch]) => `"${ch}"`).join("/")}, action, rationale, priority: "hoog"|"midden"|"laag"}), markdown (string: een leesbare, opgemaakte weergave van headline+narrative+acties voor in een rapport).`,
  ].join("\n");

  const channelBlocks = channels.map(([ch, s]) => {
    const label = CHANNEL_CONFIG[ch].headerLabel;
    const recs = s.topRecommendations.length > 0 ? s.topRecommendations.map((r) => `  - ${r}`).join("\n") : "  (geen)";
    return [
      `### ${label}`,
      `Hoofddraad: ${s.primaryThread || "(niet gerapporteerd)"}`,
      `Root cause: ${s.rootCause || "(niet gerapporteerd)"}`,
      `Top-aanbevelingen:`,
      recs,
    ].join("\n");
  }).join("\n\n");

  const signalsBlock = crossChannelSignals
    ? crossChannelSignals.length > MAX_SIGNAL_CHARS
      ? `${crossChannelSignals.slice(0, MAX_SIGNAL_CHARS)}\n\n[…afgekapt]`
      : crossChannelSignals
    : "(geen deterministische cross-channel-signalen beschikbaar voor deze cyclus)";

  const userMessage = [
    "## Afgeronde kanaalanalyses deze cyclus",
    "",
    channelBlocks,
    "",
    "## Deterministische cross-channel-signalen (dezelfde cyclus)",
    "",
    signalsBlock,
  ].join("\n");

  return { systemPrompt, userMessage };
}

function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
}

// 17 augustus 2026, live testrun (demo-greentech): de structured synthesized_actions kwamen leeg
// terug terwijl de markdown wél drie acties bevatte -- het model schreef er "SEA"/"Meta Ads" in
// (de headerLabel uit de prompt-context), niet de interne sleutel "google_ads". De oude, strikte
// validSet.has(channel)-check zag dat als een verzonnen kanaal en filterde alles weg. Een LLM dat
// de leesbare naam teruggeeft die het zelf net las is geen hallucinatie, dus normaliseren in
// plaats van weggooien: elke headerLabel (case-ongevoelig) wordt teruggemapt naar zijn sleutel.
const LABEL_TO_CHANNEL: Record<string, SopChannel> = Object.fromEntries(
  (Object.entries(CHANNEL_CONFIG) as [SopChannel, typeof CHANNEL_CONFIG[SopChannel]][]).map(([ch, cfg]) => [cfg.headerLabel.toLowerCase(), ch])
);
function normalizeChannel(raw: unknown, validChannels: readonly SopChannel[]): SopChannel | null {
  if (typeof raw !== "string") return null;
  const validSet = new Set(validChannels);
  if (validSet.has(raw as SopChannel)) return raw as SopChannel;
  const viaLabel = LABEL_TO_CHANNEL[raw.trim().toLowerCase()];
  return viaLabel && validSet.has(viaLabel) ? viaLabel : null;
}

/** Parseert de LLM-output. Bij een mislukte parse valt de synthese terug op de ruwe tekst als
 *  narrative met een lege actielijst — een leesbare, gedegradeerde synthese is beter dan geen
 *  synthese, en dit is een verrijkingslaag, geen kwaliteitspoort die een run mag blokkeren. */
export function parseSynthesisOutput(raw: string, validChannels: readonly SopChannel[]): CrossChannelSynthesisResult {
  try {
    const parsed = JSON.parse(stripCodeFence(raw)) as Partial<CrossChannelSynthesisResult>;
    const actions = Array.isArray(parsed.synthesized_actions)
      ? parsed.synthesized_actions
          .map((a): SynthesizedAction | null => {
            if (!a || typeof a !== "object" || typeof (a as SynthesizedAction).action !== "string") return null;
            const channel = normalizeChannel((a as SynthesizedAction).channel, validChannels);
            return channel ? { ...(a as SynthesizedAction), channel } : null;
          })
          .filter((a): a is SynthesizedAction => a !== null)
      : [];
    return {
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : raw,
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.filter((c) => typeof c === "string") : [],
      synthesized_actions: actions,
      channels_used: [...validChannels],
      markdown: typeof parsed.markdown === "string" ? parsed.markdown : raw,
    };
  } catch {
    return {
      headline: "",
      narrative: raw,
      contradictions: [],
      synthesized_actions: [],
      channels_used: [...validChannels],
      markdown: raw,
    };
  }
}

export interface RunSynthesisResult {
  skipped: false;
  result: CrossChannelSynthesisResult;
  tokensUsed: number;
  model: string;
}
export interface SkippedSynthesisResult {
  skipped: true;
  reason: string;
}

/** Orkestreert de volledige synthese: gate-checks, LLM-call, opslaan. Geeft skipped=true terug
 *  (geen fout) als de synthese nog niet relevant of al gedaan is — dezelfde stijl als
 *  /api/analysis/cross-channel's eigen 409-gates, alleen hier als returnwaarde i.p.v. HTTP-status
 *  zodat zowel de route als de cron dezelfde functie kunnen aanroepen. */
export async function runCrossChannelSynthesis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  beschikbareKanalen: readonly Kanaal[];
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  /** Injectiepunt voor tests — zelfde patroon als callRouted/callLayer's eigen callFn-parameter.
   *  Standaard de echte OpenRouter-call. */
  callFn?: (req: OpenRouterRequest) => Promise<OpenRouterResponse>;
}): Promise<RunSynthesisResult | SkippedSynthesisResult> {
  const { supabase, apiKey, clientId, beschikbareKanalen, analysisDate, periodStart, periodEnd, callFn = callOpenRouter } = opts;

  if (beschikbareKanalen.length < 2) {
    return { skipped: true, reason: `Synthese is pas relevant vanaf 2 gekoppelde kanalen (nu ${beschikbareKanalen.length}).` };
  }
  if (await alreadySynthesized(supabase, clientId, analysisDate)) {
    return { skipped: true, reason: `Synthese voor ${analysisDate} bestaat al.` };
  }

  const summaries = await fetchChannelSummaries(supabase, clientId, beschikbareKanalen, analysisDate);
  if (!readyForSynthesis(summaries)) {
    const missing = [...summaries.entries()].filter(([, s]) => s === null).map(([ch]) => CHANNEL_CONFIG[ch].headerLabel);
    return { skipped: true, reason: `Nog niet alle kanalen klaar deze cyclus (wachten op: ${missing.join(", ") || "onbekend"}).` };
  }

  const { data: signalsRow } = await supabase
    .from("sop_analysis_output")
    .select("output")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", "cross_channel_v1")
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { systemPrompt, userMessage } = buildSynthesisPrompt(summaries, signalsRow?.output ? String(signalsRow.output) : null);

  const response = await callLayer("reasoning", {
    apiKey,
    systemPrompt,
    userMessage,
    jsonMode: true,
    maxTokens: 2000,
    label: `cross-channel-synthesis-${clientId}`,
  }, callFn);

  const validChannels = [...summaries.keys()];
  const result = parseSynthesisOutput(response.output, validChannels);

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: periodStart,
      period_end: periodEnd,
      section: SECTION,
      output: JSON.stringify(result),
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: "Cross-channel-synthese",
    },
  });
  if (saveError) throw new Error(`Opslaan cross-channel-synthese mislukt: ${saveError.message}`);

  return { skipped: false, result, tokensUsed: response.tokensUsed, model: response.model };
}

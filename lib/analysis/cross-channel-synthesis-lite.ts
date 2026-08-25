// Kanaaloverstijgende synthese voor weekly en biweekly (masterplan 17.30).
//
// cross-channel-synthesis.ts (17.12) doet dit al voor monthly, maar leunt volledig op
// structured_monthly_v2 -- het rijke final_sop-object (primary_thread/root_cause/recommendations)
// dat ALLEEN monthly's 13-stappenpijplijn produceert. Weekly en biweekly zijn one-shot analyses:
// geen final_sop, wel findings (sop_insights) en recommendations (sop_recommendations) uit
// extract-structured.ts. Dit bestand is dus geen kopie van de monthly-synthese met een andere
// tabelnaam erin geplakt -- het is een eigen, lichtere samenvattingslaag over een structureel
// ander databronformaat, die vervolgens hetzelfde LLM-uitvoerformaat en dezelfde
// parse/opslaglogica hergebruikt (parseSynthesisOutput, readyForSynthesis) zodat er geen tweede
// definitie van diezelfde regels ontstaat.
//
// De aanleiding: "een anomalie kan verklaard worden en in perspectief geplaatst worden" (de
// eigenaar) -- "je account vertoont anomalies" is zwakker dan "je account vertoont anomalies,
// maar dit is een marktbreed signaal, geen reden voor paniek". Dat perspectief vereist dat weekly/
// biweekly hun EIGEN, verse synthese triggeren op basis van wat er die cyclus in de andere
// kanalen gebeurde -- niet de laatste monthly-synthese hergebruiken, die kan weken oud zijn.
//
// Eigen opslagslot, gescheiden van monthly's cross_channel_synthesis_v1: weekly's "afgelopen 14
// dagen, anomalies" en biweekly's "impact/voortgang van een aanpassing" zijn andere vragen over
// andere periodes dan monthly's diepe root-cause-analyse, en horen dus niet in dezelfde
// "1x per dag"-slot te vallen als een eventuele monthly-synthese die dag.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callLayer } from "./llm-router";
import { callOpenRouter, type OpenRouterRequest, type OpenRouterResponse } from "./openrouter-client";
import { saveAnalysisOutputSection } from "./helpers";
import { CHANNEL_CONFIG, type SopChannel } from "./sop-channel-config";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";
import {
  SOP_TYPE,
  readyForSynthesis,
  parseSynthesisOutput,
  type CrossChannelSynthesisResult,
  type RunSynthesisResult,
  type SkippedSynthesisResult,
} from "./cross-channel-synthesis";

export type LiteCadence = "weekly" | "biweekly";

const KANAAL_TO_SOP_CHANNEL: Record<Kanaal, SopChannel> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  microsoft: "microsoft_ads",
};

function sectionFor(cadence: LiteCadence): string {
  return cadence === "weekly" ? "cross_channel_synthesis_weekly_v1" : "cross_channel_synthesis_biweekly_v1";
}

interface LiteFinding { severity: string; description: string }
interface LiteRecommendation { hypothesis: string; expectedResult: string }

export interface LiteChannelSummary {
  channel: SopChannel;
  topFindings: LiteFinding[];
  topRecommendations: LiteRecommendation[];
}

const MAX_FINDINGS = 5;
const MAX_RECOMMENDATIONS = 5;
// Ernstigste eerst -- dezelfde volgorde als de urgentieniveaus in de weekly/biweekly-prompts zelf
// (sop-prompts.ts), zodat de synthese dezelfde prioritering ziet als het kanaal-rapport toont.
const SEVERITY_RANK: Record<string, number> = { kritiek: 0, hoog: 1, medium: 2, laag: 3 };

/** Eén channel-samenvatting ophalen uit sop_insights/sop_recommendations, of null als dit kanaal
 *  deze cyclus (nog) geen afgeronde weekly/biweekly-run heeft. Bewust GEEN afhankelijkheid van
 *  section="full" (de narratieve markdown) -- die bevat geen machineleesbare severity/ice-score,
 *  en extract-structured.ts's findings/recommendations zijn al de gestructureerde vorm daarvan. */
async function fetchLiteChannelSummary(
  supabase: SupabaseClient,
  clientId: string,
  channel: SopChannel,
  cadence: LiteCadence,
  analysisDate: string
): Promise<LiteChannelSummary | null> {
  const sopType = CHANNEL_CONFIG[channel].sopTypeKey[cadence];

  const { data: outputRow } = await supabase
    .from("sop_analysis_output")
    .select("id")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .eq("section", "full")
    .eq("analysis_date", analysisDate)
    .maybeSingle();
  // Geen afgeronde run deze cyclus voor dit kanaal -- ongeacht of er toevallig al oudere
  // findings/recommendations in de tabellen staan van een vorige cyclus.
  if (!outputRow) return null;

  const { data: findings } = await supabase
    .from("sop_insights")
    .select("severity, description")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .eq("analysis_date", analysisDate);

  const { data: recs } = await supabase
    .from("sop_recommendations")
    .select("hypothesis, expected_result, ice_total")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .eq("analysis_date", analysisDate);

  const topFindings = [...(findings ?? [])]
    .sort((a, b) => (SEVERITY_RANK[a.severity as string] ?? 9) - (SEVERITY_RANK[b.severity as string] ?? 9))
    .slice(0, MAX_FINDINGS)
    .map((f) => ({ severity: String(f.severity ?? ""), description: String(f.description ?? "") }));

  const topRecommendations = [...(recs ?? [])]
    .sort((a, b) => (Number(b.ice_total) || 0) - (Number(a.ice_total) || 0))
    .slice(0, MAX_RECOMMENDATIONS)
    .map((r) => ({ hypothesis: String(r.hypothesis ?? ""), expectedResult: String(r.expected_result ?? "") }));

  return { channel, topFindings, topRecommendations };
}

export async function fetchLiteChannelSummaries(
  supabase: SupabaseClient,
  clientId: string,
  beschikbareKanalen: readonly Kanaal[],
  cadence: LiteCadence,
  analysisDate: string
): Promise<Map<SopChannel, LiteChannelSummary | null>> {
  const entries = await Promise.all(
    beschikbareKanalen.map(async (k) => {
      const channel = KANAAL_TO_SOP_CHANNEL[k];
      return [channel, await fetchLiteChannelSummary(supabase, clientId, channel, cadence, analysisDate)] as const;
    })
  );
  return new Map(entries);
}

/** Al gesynthetiseerd voor deze cyclus? Eigen slot per cadence (sectionFor), dus een weekly- en
 *  een biweekly-synthese dezelfde dag botsen nooit met elkaar of met monthly's eigen slot. */
export async function liteAlreadySynthesized(
  supabase: SupabaseClient,
  clientId: string,
  cadence: LiteCadence,
  analysisDate: string
): Promise<boolean> {
  const { data } = await supabase
    .from("sop_analysis_output")
    .select("id")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", sectionFor(cadence))
    .eq("analysis_date", analysisDate)
    .maybeSingle();
  return !!data;
}

const CADENCE_LABEL: Record<LiteCadence, string> = {
  weekly: "wekelijkse health check",
  biweekly: "bi-weekly check-in (impact/voortgang van eerdere aanpassingen)",
};

export function buildLiteSynthesisPrompt(
  summaries: Map<SopChannel, LiteChannelSummary | null>,
  cadence: LiteCadence
): { systemPrompt: string; userMessage: string } {
  const channels = [...summaries.entries()].filter((e): e is [SopChannel, LiteChannelSummary] => e[1] !== null);
  const channelLabels = channels.map(([ch]) => CHANNEL_CONFIG[ch].headerLabel);

  const systemPrompt = [
    "Je bent de kanaaloverstijgende synthese-laag van een performance-marketingdashboard.",
    `Je krijgt de bevindingen en aanbevelingen uit de ${CADENCE_LABEL[cadence]} van ${channelLabels.join(", ")} voor dezelfde klant en dezelfde cyclus.`,
    "",
    "Je taak is GEEN samenvatting per kanaal -- dat bestaat al. Je taak is PERSPECTIEF: is een anomalie in één kanaal een op zichzelf staand probleem, of een patroon dat ook in andere kanalen zichtbaar is (en dus minder reden tot paniek, of juist een breder signaal)?",
    "",
    "Regels:",
    "- Eén hoofdverhaal (narrative), niet drie naast elkaar.",
    "- Zie je dezelfde anomalie (of tegenovergestelde bewegingen op hetzelfde publiek/dezelfde periode) in meerdere kanalen? Benoem dat expliciet -- dat is precies waar dit voor bedoeld is.",
    "- Zie je GEEN patroon over kanalen heen? Zeg dat ook expliciet (bijv. 'kanaal-specifiek, geen bredere trend zichtbaar') -- stilte hierover leest als 'niet gecontroleerd', niet als 'niets gevonden'.",
    `- Elke synthesized_action moet een ECHT, hierboven genoemd kanaal als 'channel' hebben -- gebruik de INTERNE sleutel (${channels.map(([ch]) => `"${ch}"`).join(", ")}), niet de leesbare naam.`,
    "- Een actie hoort hier alleen als hij de synthese van meerdere kanalen nodig heeft om te bedenken.",
    "- Verzin geen cijfers die niet in de aangeleverde bevindingen/aanbevelingen staan.",
    `- Antwoord uitsluitend als JSON met exact deze velden: headline (string, één zin), narrative (string, 3-6 zinnen), contradictions (string[], leeg als er geen zijn), synthesized_actions (array van {channel: een van ${channels.map(([ch]) => `"${ch}"`).join("/")}, action, rationale, priority: "hoog"|"midden"|"laag"}), markdown (string).`,
  ].join("\n");

  const channelBlocks = channels.map(([ch, s]) => {
    const label = CHANNEL_CONFIG[ch].headerLabel;
    const findingsText = s.topFindings.length > 0
      ? s.topFindings.map((f) => `  - [${f.severity}] ${f.description}`).join("\n")
      : "  (geen)";
    const recsText = s.topRecommendations.length > 0
      ? s.topRecommendations.map((r) => `  - ${r.hypothesis} (verwacht: ${r.expectedResult})`).join("\n")
      : "  (geen)";
    return [`### ${label}`, "Bevindingen:", findingsText, "Aanbevelingen:", recsText].join("\n");
  }).join("\n\n");

  const userMessage = ["## Afgeronde kanaalanalyses deze cyclus", "", channelBlocks].join("\n");

  return { systemPrompt, userMessage };
}

/** Orkestreert de lichte synthese: gate-checks, LLM-call, opslaan onder het cadence-eigen slot.
 *  Zelfde vorm als runCrossChannelSynthesis() (monthly), bewust een eigen functie i.p.v. een
 *  cadence-parameter erin geplakt -- de databron (final_sop vs. findings/recommendations) en de
 *  prompt verschillen echt, alleen de buitenkant (gate-checks, LLM-call, opslag) is gelijk. */
export async function runLiteCrossChannelSynthesis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  cadence: LiteCadence;
  beschikbareKanalen: readonly Kanaal[];
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  callFn?: (req: OpenRouterRequest) => Promise<OpenRouterResponse>;
}): Promise<RunSynthesisResult | SkippedSynthesisResult> {
  const { supabase, apiKey, clientId, cadence, beschikbareKanalen, analysisDate, periodStart, periodEnd, callFn = callOpenRouter } = opts;

  if (beschikbareKanalen.length < 2) {
    return { skipped: true, reason: `Synthese is pas relevant vanaf 2 gekoppelde kanalen (nu ${beschikbareKanalen.length}).` };
  }
  if (await liteAlreadySynthesized(supabase, clientId, cadence, analysisDate)) {
    return { skipped: true, reason: `${cadence}-synthese voor ${analysisDate} bestaat al.` };
  }

  const summaries = await fetchLiteChannelSummaries(supabase, clientId, beschikbareKanalen, cadence, analysisDate);
  if (!readyForSynthesis(summaries)) {
    const missing = [...summaries.entries()].filter(([, s]) => s === null).map(([ch]) => CHANNEL_CONFIG[ch].headerLabel);
    return { skipped: true, reason: `Nog niet alle kanalen klaar deze cyclus (wachten op: ${missing.join(", ") || "onbekend"}).` };
  }

  const { systemPrompt, userMessage } = buildLiteSynthesisPrompt(summaries, cadence);

  const response = await callLayer("reasoning", {
    apiKey,
    systemPrompt,
    userMessage,
    jsonMode: true,
    maxTokens: 2000,
    label: `cross-channel-synthesis-${cadence}-${clientId}`,
  }, callFn);

  const validChannels = [...summaries.keys()];
  const result: CrossChannelSynthesisResult = parseSynthesisOutput(response.output, validChannels);

  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId,
      sop_type: SOP_TYPE,
      analysis_date: analysisDate,
      period_start: periodStart,
      period_end: periodEnd,
      section: sectionFor(cadence),
      output: JSON.stringify(result),
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: cadence === "weekly" ? "Cross-channel-synthese (weekly)" : "Cross-channel-synthese (biweekly)",
    },
  });
  if (saveError) throw new Error(`Opslaan ${cadence}-cross-channel-synthese mislukt: ${saveError.message}`);

  return { skipped: false, result, tokensUsed: response.tokensUsed, model: response.model };
}

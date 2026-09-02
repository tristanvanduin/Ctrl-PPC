// Portfolio-synthese (masterplan 17.15): dezelfde soort synthese-stap als cross-channel-
// synthesis.ts, maar tussen KLANTEN van hetzelfde bureau in plaats van tussen kanalen van
// dezelfde klant. Eigenaar, 17 augustus 2026, expliciet gekozen boven "de bestaande Macro-
// portfoliogating verstevigen": een nieuwe LLM-synthese-stap die patronen over meerdere klanten
// heen samenvoegt tot 1 verhaal.
//
// ── WAAROM EEN VERSHEIDSVENSTER EN GEEN EXACTE DATUM ──────────────────────────────────────
//
// Klanten van één bureau draaien elk op hun EIGEN cadans (lib/scheduler/sop-cadence.ts) -- een
// portfolio van 10 klanten zal vrijwel nooit allemaal exact dezelfde kalenderdag afronden. Deze
// module gebruikt daarom een VERSHEIDSVENSTER (FRESHNESS_DAYS) per klant: elke klant telt mee als
// zijn nieuwste beschikbare eindverhaal binnen dat venster valt, met de eigen analysis_date
// expliciet in de prompt (zelfde "kan van een eerdere cyclus zijn"-discipline als
// cross-channel-context.ts).
//
// ── WAAROM GEEN K-ANONIMITEIT (in tegenstelling tot lib/benchmark/god-view.ts) ──
//
// God View combineert data van MEERDERE bureaus en moet daarom anonimiseren. Dit hier blijft
// binnen ÉÉN bureau, over zijn EIGEN klanten -- het bureau heeft al volledige inzage in elk van
// die klanten apart, dus er is niets te anonimiseren dat de synthese niet ook los al zou tonen.
//
// ── HERBOUW 2 SEPTEMBER 2026 ──────────────────────────────────────────────────────────────
//
// De database had nul rijen portfolio_synthesis_v1: deze module heeft aantoonbaar nooit
// geschreven, en niets liet zien waarom niet. De audit vond dat elke query zijn fout slikte (een
// klant met een kapotte query viel stil uit de portfolio, waarna "nog niet genoeg klanten met
// vers eindverhaal" volgde), dat er vijf queries per klant parallel liepen (50 klanten = 250
// gelijktijdige queries), dat de prioriteit uit het model ongevalideerd werd overgenomen, dat
// er geen cijferpoort was en dat een dagslot als idempotentie diende. Nu: twee gebundelde
// queries voor alle klanten samen (één voor de cross-channel-syntheses, één voor de
// maandanalyses van alle kanalen), elk via alleRijen met plafond; eis() overal; prioriteit
// genormaliseerd; dezelfde cijferpoort als de cross-channel-synthese; en "al gedaan" betekent
// "een bestaande portfolio-synthese dekt het nieuwste klantverhaal al".

import type { SupabaseClient } from "@supabase/supabase-js";
import { callLayer } from "./llm-router";
import { callOpenRouter, type OpenRouterRequest, type OpenRouterResponse } from "./openrouter-client";
import { MONTHLY_SOP_TYPES } from "./sop-channel-config";
import { alleRijen, eis } from "./db-veilig";
import { extractGroundedNumbers, gateItemFields, gateUngroundedNumbers } from "./weekly-number-gate";
import {
  leesJson, normaliseerPrioriteit, stripCodeFence, syntheseOnleesbaar,
  SOP_TYPE as CROSS_CHANNEL_SOP_TYPE, SECTION as CROSS_CHANNEL_SECTION,
  type Prioriteit,
} from "./cross-channel-synthesis";
import { addDays } from "@/lib/reporting-date";
import { nicheLabel, type Bedrijfsmodel } from "@/lib/benchmark/segment";

export const SECTION = "portfolio_synthesis_v1";
/** Ruim boven een maandcadans, zodat een klant die een paar dagen later draait niet uit de boot valt. */
export const FRESHNESS_DAYS = 35;
const MIN_CLIENTS = 2;
/** Plafond per gebundelde query. Binnen het venster heeft een klant hooguit een handvol rijen per
 *  kanaal; 5000 dekt honderden klanten. Wordt het toch bereikt, dan zegt de dekking dat. */
const MAX_RIJEN = 5000;

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
   *  samengevoegd); false als het de terugval is naar het nieuwste beschikbare kanaal. */
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
interface OutputRij { client_id: string; output: unknown; analysis_date: string }
interface ClientSettingsRow {
  client_id: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
}

export interface PortfolioSummariesFetch {
  /** Per klant het beste verse eindverhaal, of null als er binnen het venster niets (leesbaars) is. */
  summaries: Map<string, ClientSummary | null>;
  /** Klanten waarvan een rij binnen het venster niet te lezen viel. Zo'n klant valt terug op de
   *  volgende bron of op null -- maar niet stil: de dekking noemt hem. */
  onleesbaar: string[];
  /** True als een van de gebundelde queries het plafond raakte; dan kan een klant ontbreken. */
  rijenAfgekapt: boolean;
  /** De ondergrens van het venster (analysis_date >= cutoff). */
  cutoff: string;
}

/** De nieuwste rij per klant uit een lijst die al aflopend op analysis_date is gesorteerd. Het
 *  venster wordt in het geheugen opnieuw getoetst: de query filtert al met .gte, maar de
 *  demo-mock past bereikfilters niet toe. */
function nieuwstePerKlant(rijen: OutputRij[], cutoff: string): Map<string, OutputRij> {
  const uit = new Map<string, OutputRij>();
  for (const rij of rijen) {
    if (String(rij.analysis_date) < cutoff) continue;
    const id = String(rij.client_id);
    const huidig = uit.get(id);
    if (!huidig || String(rij.analysis_date) > String(huidig.analysis_date)) uit.set(id, rij);
  }
  return uit;
}

/**
 * Het beste verse eindverhaal per klant, voor alle klanten in drie queries totaal: de
 * instellingen, de cross-channel-syntheses en de maandanalyses van alle kanalen -- niet 1 + 4
 * per klant. Bij voorkeur de eigen cross-channel-synthese (meerdere kanalen al samengevoegd),
 * anders de nieuwste structured_monthly_v2 over alle kanalen heen -- een klant met maar 1 kanaal
 * heeft nooit een cross-channel-synthese (die vergt 2+), dus dat is voor de meeste klanten het
 * normale pad, niet een noodgreep. Gooit bij een queryfout (DataLaagFout).
 */
export async function fetchPortfolioSummaries(
  supabase: SupabaseClient,
  clients: readonly { clientId: string; clientName: string }[],
  analysisDate: string
): Promise<PortfolioSummariesFetch> {
  const cutoff = addDays(analysisDate, -FRESHNESS_DAYS);
  const ids = clients.map((c) => c.clientId);
  if (ids.length === 0) return { summaries: new Map(), onleesbaar: [], rijenAfgekapt: false, cutoff };

  const [settingsRes, synthRijen, maandRijen] = await Promise.all([
    supabase
      .from("client_settings")
      .select("client_id, bedrijfsmodel, niche")
      .in("client_id", ids),
    alleRijen<OutputRij>(
      (van, tot) => supabase
        .from("sop_analysis_output")
        .select("client_id, output, analysis_date")
        .in("client_id", ids)
        .eq("sop_type", CROSS_CHANNEL_SOP_TYPE)
        .eq("section", CROSS_CHANNEL_SECTION)
        .gte("analysis_date", cutoff)
        .order("analysis_date", { ascending: false })
        .order("client_id")
        .order("id")
        .range(van, tot),
      `sop_analysis_output (${CROSS_CHANNEL_SECTION}, portfolio)`,
      { max: MAX_RIJEN }
    ),
    alleRijen<OutputRij>(
      (van, tot) => supabase
        .from("sop_analysis_output")
        .select("client_id, output, analysis_date")
        .in("client_id", ids)
        .in("sop_type", [...MONTHLY_SOP_TYPES])
        .eq("section", "structured_monthly_v2")
        .gte("analysis_date", cutoff)
        .order("analysis_date", { ascending: false })
        .order("client_id")
        .order("id")
        .range(van, tot),
      "sop_analysis_output (structured_monthly_v2, portfolio)",
      { max: MAX_RIJEN }
    ),
  ]);
  const settingsByClient = new Map(
    eis<ClientSettingsRow>(settingsRes, "client_settings").map((r) => [String(r.client_id), r])
  );
  const synthPerKlant = nieuwstePerKlant(synthRijen.rijen, cutoff);
  const maandPerKlant = nieuwstePerKlant(maandRijen.rijen, cutoff);

  const onleesbaar = new Set<string>();
  const summaries = new Map<string, ClientSummary | null>();
  for (const c of clients) {
    const settings = settingsByClient.get(c.clientId);
    const basis = { clientId: c.clientId, clientName: c.clientName, bedrijfsmodel: settings?.bedrijfsmodel ?? null, niche: settings?.niche ?? null };

    const synth = synthPerKlant.get(c.clientId);
    if (synth) {
      try {
        const parsed = leesJson(synth.output) as CrossChannelSynthesisRow;
        summaries.set(c.clientId, {
          ...basis,
          analysisDate: String(synth.analysis_date),
          primaryThread: parsed.headline ?? "",
          rootCause: parsed.narrative ?? "",
          topRecommendations: (parsed.synthesized_actions ?? []).slice(0, 5).map((a) => a.action ?? "").filter(Boolean),
          fromCrossChannelSynthesis: true,
        });
        continue;
      } catch {
        onleesbaar.add(c.clientId); // val terug op het losse kanaal hieronder
      }
    }

    const maand = maandPerKlant.get(c.clientId);
    if (!maand) { summaries.set(c.clientId, null); continue; }
    try {
      const parsed = leesJson(maand.output) as StructuredMonthlyRow;
      const finalSop = parsed.final_sop ?? {};
      summaries.set(c.clientId, {
        ...basis,
        analysisDate: String(maand.analysis_date),
        primaryThread: finalSop.primary_thread ?? "",
        rootCause: finalSop.root_cause ?? "",
        topRecommendations: (finalSop.recommendations ?? []).slice(0, 5).map((r) => r.handeling ?? "").filter(Boolean),
        fromCrossChannelSynthesis: false,
      });
    } catch {
      onleesbaar.add(c.clientId);
      summaries.set(c.clientId, null);
    }
  }

  return {
    summaries,
    onleesbaar: [...onleesbaar],
    rijenAfgekapt: synthRijen.afgekapt || maandRijen.afgekapt,
    cutoff,
  };
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
  priority: Prioriteit;
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
  /** Zelfde betekenis als bij CrossChannelSynthesisResult: cijfers uit de modeltekst die nergens
   *  in de aangeleverde klantverhalen staan, in de tekst vervangen door een markering. Optioneel
   *  omdat rijen van vóór de cijferpoort het veld niet hebben. */
  ongegronde_cijfers?: number[];
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
    "- Verzin geen cijfers die niet in de aangeleverde samenvattingen staan. Percentages en bedragen die daar niet letterlijk in voorkomen worden achteraf uit je tekst verwijderd.",
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

export interface ParsedPortfolioSynthesis {
  /** False als de output geen JSON-object met een narrative is; de orkestratie slaat zo'n
   *  uitkomst niet op (syntheseOnleesbaar). */
  parseOk: boolean;
  result: PortfolioSynthesisResult;
}

/** Parseert de LLM-output. Zelfde les als cross-channel-synthesis.ts's parseSynthesisOutput
 *  (live testrun 17 augustus 2026): een model dat een leesbare naam teruggeeft die het zelf net
 *  las, is geen hallucinatie -- normaliseren op naam ÉN id, niet alleen op de kale clientId. Velden
 *  worden stuk voor stuk overgenomen, niet gespreid: priority wordt genormaliseerd en onbekende
 *  velden uit het model komen niet in de opslag. */
export function parsePortfolioSynthesisOutput(raw: string, validClients: readonly ClientSummary[]): ParsedPortfolioSynthesis {
  const idToName = new Map(validClients.map((c) => [c.clientId, c.clientName]));
  const nameToId = new Map(validClients.map((c) => [c.clientName.toLowerCase(), c.clientId]));
  const normalizeClientId = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    if (v === "portfolio") return "portfolio";
    if (idToName.has(v)) return v;
    const viaName = nameToId.get(v.trim().toLowerCase());
    return viaName ?? null;
  };
  const gedegradeerd: PortfolioSynthesisResult = {
    headline: "", narrative: raw, recurring_patterns: [], outliers: [],
    synthesized_actions: [], clients_used: validClients.map((c) => c.clientId), markdown: raw,
  };

  let parsed: Partial<PortfolioSynthesisResult>;
  try {
    const gelezen: unknown = JSON.parse(stripCodeFence(raw));
    if (!gelezen || typeof gelezen !== "object" || Array.isArray(gelezen)) return { parseOk: false, result: gedegradeerd };
    parsed = gelezen as Partial<PortfolioSynthesisResult>;
  } catch {
    return { parseOk: false, result: gedegradeerd };
  }
  if (typeof parsed.narrative !== "string") return { parseOk: false, result: gedegradeerd };

  const actions = Array.isArray(parsed.synthesized_actions)
    ? parsed.synthesized_actions
        .map((a): PortfolioSynthesizedAction | null => {
          if (!a || typeof a !== "object") return null;
          const kandidaat = a as Partial<PortfolioSynthesizedAction>;
          if (typeof kandidaat.action !== "string") return null;
          const clientId = normalizeClientId(kandidaat.clientId);
          if (!clientId) return null;
          return {
            clientId,
            clientName: clientId === "portfolio" ? "Hele portfolio" : idToName.get(clientId),
            action: kandidaat.action,
            rationale: typeof kandidaat.rationale === "string" ? kandidaat.rationale : "",
            priority: normaliseerPrioriteit(kandidaat.priority),
          };
        })
        .filter((a): a is PortfolioSynthesizedAction => a !== null)
    : [];
  const tekstLijst = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    parseOk: true,
    result: {
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      narrative: parsed.narrative,
      recurring_patterns: tekstLijst(parsed.recurring_patterns),
      outliers: tekstLijst(parsed.outliers),
      synthesized_actions: actions,
      clients_used: validClients.map((c) => c.clientId),
      markdown: typeof parsed.markdown === "string" ? parsed.markdown : parsed.narrative,
    },
  };
}

/** De toegestane cijfers: alles wat in de aangeleverde klantverhalen staat. */
export function portfolioGrondcijfers(summaries: Iterable<ClientSummary | null>): number[] {
  const teksten: string[] = [];
  for (const s of summaries) {
    if (!s) continue;
    teksten.push(s.primaryThread, s.rootCause, ...s.topRecommendations);
  }
  return extractGroundedNumbers(teksten.join("\n"));
}

/** De cijferpoort over de portfolio-synthese; zelfde regels als pasCijferpoortToe in
 *  cross-channel-synthesis.ts, over de velden die dit resultaat heeft (inclusief
 *  recurring_patterns en outliers -- vrije tekst waar een verzonnen percentage net zo goed in
 *  kan staan). */
export function pasPortfolioCijferpoortToe(result: PortfolioSynthesisResult, toegestaan: number[]): PortfolioSynthesisResult {
  const ongegrond: number[] = [];
  const poort = (tekst: string): string => {
    const r = gateUngroundedNumbers(tekst, toegestaan);
    ongegrond.push(...r.ungrounded);
    return r.text;
  };
  const acties = result.synthesized_actions.map((a) => {
    const r = gateItemFields(a as unknown as Record<string, unknown>, ["action", "rationale"], toegestaan);
    ongegrond.push(...r.ungrounded);
    return r.item as unknown as PortfolioSynthesizedAction;
  });
  return {
    ...result,
    headline: poort(result.headline),
    narrative: poort(result.narrative),
    markdown: poort(result.markdown),
    recurring_patterns: result.recurring_patterns.map(poort),
    outliers: result.outliers.map(poort),
    synthesized_actions: acties,
    ongegronde_cijfers: [...new Set(ongegrond)].sort((a, b) => a - b),
  };
}

export interface PortfolioDekking {
  /** clientIds met een vers, leesbaar eindverhaal -- de klanten die het model te zien kreeg. */
  klantenMetVersVerhaal: string[];
  /** clientIds zonder eindverhaal binnen het venster (of met alleen een onleesbare rij). */
  klantenZonder: string[];
  versheidDagen: number;
  /** De nieuwste analysis_date onder de meegenomen klantverhalen -- wat deze synthese "dekt". */
  nieuwsteVerhaal: string;
  onleesbaar: string[];
  rijenAfgekapt: boolean;
  ongegrondeCijfers: number[];
}

export interface RunPortfolioSynthesisResult {
  skipped: false;
  result: PortfolioSynthesisResult;
  tokensUsed: number;
  model: string;
  dekking: PortfolioDekking;
}
export interface SkippedPortfolioSynthesisResult {
  skipped: true;
  reason: string;
}

/**
 * Dekt een bestaande portfolio-synthese het nieuwste klantverhaal al? True als er een rij is met
 * analysis_date >= `nieuwsteVerhaal`. Zelfde idempotentie-afweging als cross-channel-synthesis.ts's
 * alreadySynthesized, en om dezelfde reden een datumvergelijking in het geheugen in plaats van
 * .gte in de query.
 */
export async function alreadyPortfolioSynthesized(supabase: SupabaseClient, agencyId: string, nieuwsteVerhaal: string): Promise<boolean> {
  const [rij] = eis<{ analysis_date: string }>(
    await supabase
      .from("agency_analysis_output")
      .select("analysis_date")
      .eq("agency_id", agencyId)
      .eq("section", SECTION)
      .order("analysis_date", { ascending: false })
      .limit(1),
    `agency_analysis_output (${SECTION})`
  );
  return !!rij && String(rij.analysis_date) >= nieuwsteVerhaal;
}

/** Orkestreert de portfolio-synthese: gate-checks, LLM-call, cijferpoort, opslaan. Skipped is
 *  geen fout; een queryfout, een onleesbare modeluitkomst of een mislukte opslag gooit. */
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

  const ophaling = await fetchPortfolioSummaries(supabase, clients, analysisDate);
  const validClients = [...ophaling.summaries.values()].filter((s): s is ClientSummary => s !== null);
  const naamVan = new Map(clients.map((c) => [c.clientId, c.clientName]));
  const klantenZonder = clients.map((c) => c.clientId).filter((id) => !ophaling.summaries.get(id));
  if (validClients.length < MIN_CLIENTS) {
    const zonder = klantenZonder.map((id) => `${naamVan.get(id) ?? id}${ophaling.onleesbaar.includes(id) ? " (onleesbare rij)" : ""}`).join(", ");
    return {
      skipped: true,
      reason: `Nog niet genoeg klanten met een vers eindverhaal (binnen ${FRESHNESS_DAYS} dagen) — ${validClients.length} van de ${clients.length}; zonder: ${zonder || "onbekend"}.`,
    };
  }
  const nieuwsteVerhaal = validClients.reduce((max, c) => (c.analysisDate > max ? c.analysisDate : max), validClients[0].analysisDate);

  if (await alreadyPortfolioSynthesized(supabase, agencyId, nieuwsteVerhaal)) {
    return { skipped: true, reason: `Portfolio-synthese dekt het nieuwste klantverhaal (${nieuwsteVerhaal}) al.` };
  }

  const { systemPrompt, userMessage } = buildPortfolioSynthesisPrompt(ophaling.summaries);

  const response = await callLayer("reasoning", {
    apiKey,
    systemPrompt,
    userMessage,
    jsonMode: true,
    maxTokens: 2200,
    label: `portfolio-synthesis-${agencyId}`,
  }, callFn);

  const parsed = parsePortfolioSynthesisOutput(response.output, validClients);
  if (!parsed.parseOk) throw syntheseOnleesbaar(response.output);
  const result = pasPortfolioCijferpoortToe(parsed.result, portfolioGrondcijfers(validClients));

  // Race-rem: N klanten van één bureau die kort na elkaar hun maandanalyse afronden vuren elk
  // after() en kunnen allemaal de eerste check passeren. De LLM-call is dan al gedaan; een
  // parallelle synthese die intussen is opgeslagen dekt dezelfde verhalen -- niet overschrijven.
  if (await alreadyPortfolioSynthesized(supabase, agencyId, nieuwsteVerhaal)) {
    return { skipped: true, reason: `Portfolio-synthese voor ${nieuwsteVerhaal} is intussen door een parallelle aanroep opgeslagen; deze uitkomst is niet bewaard.` };
  }

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

  return {
    skipped: false,
    result,
    tokensUsed: response.tokensUsed,
    model: response.model,
    dekking: {
      klantenMetVersVerhaal: validClients.map((c) => c.clientId),
      klantenZonder,
      versheidDagen: FRESHNESS_DAYS,
      nieuwsteVerhaal,
      onleesbaar: ophaling.onleesbaar,
      rijenAfgekapt: ophaling.rijenAfgekapt,
      ongegrondeCijfers: result.ongegronde_cijfers ?? [],
    },
  };
}

// Kanaaloverstijgende SYNTHESE (masterplan 17.12): de stap die tot nu toe ontbrak.
//
// cross-channel-context.ts injecteert cross-channel-signalen als VERKLARENDE context in de
// hypotheses-stap van elk kanaal apart — Meta's analyse blijft daarbij een Meta-analyse, LinkedIn's
// een LinkedIn-analyse. Dat is met opzet zo (17.3: een kanaal mag nooit een actie voor een ander
// kanaal aanbevelen). Maar het laat precies het stuk liggen waar de eigenaar herhaaldelijk om
// vroeg: "het beste van alle kanaal inzichten omgetoverd naar 1 concrete goede output" — een eigen,
// gesynthetiseerde blik die GEEN kanaal is, en die dus WEL over kanalen heen mag aanbevelen.
//
// Dit bestand bouwt die stap: wacht tot de kanalen die deze cyclus een maandanalyse hebben
// (structured_monthly_v2) allemaal binnen dezelfde cyclus zitten, voedt hun eigen eindconclusies
// (final_sop: primary_thread/root_cause/recommendations) plus de al-bestaande deterministische
// cross-channel-signalen (cross_channel_v1) aan één LLM-call, en laat die ÉÉN samenhangend verhaal
// + een lijst acties opleveren — elke actie expliciet gelabeld met welk kanaal hem uitvoert, nooit
// een verzonnen kanaal.
//
// "reasoning"-laag: dit is precies "redeneren over eerder werk, geen los datapunt" (lib/analysis/
// helpers.ts's omschrijving van diezelfde laag) — de synthese leest al afgeronde analyses en weegt
// ze tegen elkaar, het is geen nieuwe classificatie van ruwe data.
//
// ── HERBOUW 2 SEPTEMBER 2026: WAAROM DE POORTEN ANDERS ZIJN ────────────────────────────────
//
// De audit vond dat deze synthese sinds 26 augustus niets meer schreef, terwijl alle
// maandanalyses op 1 september wél liepen. Drie poorten hielden hem tegen, alle drie fragiel:
//
// 1. "Beschikbaar kanaal" was "ooit één rij data gehad" (lib/kanalen/beschikbaar.ts, bedoeld
//    voor tabbladen). Een klant met oude Meta-data maar zonder Meta-maandanalyse blokkeerde de
//    synthese van Google+LinkedIn voorgoed, want ELK beschikbaar kanaal moest klaar zijn. Nu telt
//    een kanaal alleen mee als het een maandanalyse binnen CYCLUS_VENSTER_DAGEN heeft; de
//    aanroeper levert nog steeds de buitenste set (welke kanalen de klant überhaupt heeft), de
//    fetch-laag bepaalt welke daarvan deze cyclus een run hebben.
// 2. Exacte datumgelijkheid (analysis_date == vandaag). Google op dag 1 en Meta op dag 2
//    synthetiseerde nooit. Nu: per kanaal de nieuwste run, en alle meetellende kanalen moeten
//    binnen ZELFDE_CYCLUS_TOLERANTIE_DAGEN van de nieuwste liggen — anders wachten we, met de
//    naam en datum van het achterlopende kanaal in de reden.
// 3. Een dagslot als idempotentie ("bestaat er al een synthese met analysis_date == vandaag").
//    Dat sloeg een synthese over die verouderd was ten opzichte van nieuwe kanaaloutput, en
//    bewaarde een onleesbare LLM-uitkomst als "gedaan" zodat een herkansing die dag onmogelijk
//    was. Nu: een synthese is "al gedaan" als hij de NIEUWSTE kanaalrun al dekt (analysis_date
//    van de synthese >= die van de nieuwste run), en een onleesbare uitkomst wordt nooit
//    opgeslagen.
//
// Daarnaast: elke query via eis() (een queryfout is een fout, geen "wachten op Meta"), en een
// cijferpoort op de LLM-tekst — percentages en eurobedragen die nergens in de aangeleverde
// samenvattingen of signalen staan worden vervangen door een neutrale markering en gerapporteerd.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callLayer } from "./llm-router";
import { callOpenRouter, type OpenRouterRequest, type OpenRouterResponse } from "./openrouter-client";
import { saveAnalysisOutputSection } from "./helpers";
import { eis } from "./db-veilig";
import { extractGroundedNumbers, gateItemFields, gateUngroundedNumbers } from "./weekly-number-gate";
import { CHANNEL_CONFIG, type SopChannel } from "./sop-channel-config";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";
import { addDays } from "@/lib/reporting-date";

export const SOP_TYPE = "cross_channel";
export const SECTION = "cross_channel_synthesis_v1";

/**
 * Hoe oud een maandanalyse mag zijn om nog als "deze cyclus" te tellen. Ruim boven een
 * maandcadans (31 dagen) plus wat speling voor een kanaal dat een paar dagen later draait; ver
 * onder twee cycli, zodat een run van twee maanden terug nooit als vers meegaat.
 */
export const CYCLUS_VENSTER_DAGEN = 40;

/**
 * Hoe ver de meetellende kanalen uit elkaar mogen liggen. Kanalen van één klant worden in de
 * praktijk binnen enkele dagen na elkaar gedraaid (dezelfde nightly cron of dezelfde knop); tien
 * dagen vangt een weekend plus een mislukte en herkanste run. Ligt een kanaal verder achter, dan
 * is dat kanaal nog niet aan deze cyclus toe en wachten we, in plaats van een oude Meta-conclusie
 * naast een verse Google-conclusie te leggen alsof ze over dezelfde maand gaan.
 */
export const ZELFDE_CYCLUS_TOLERANTIE_DAGEN = 10;

/** Van de kanaalindeling van het dashboard (lib/kanalen/beschikbaar) naar de SOP-sleutel. Eén
 *  huis; cross-channel-synthesis-lite.ts importeert hem in plaats van een eigen kopie te houden. */
export const KANAAL_TO_SOP_CHANNEL: Record<Kanaal, SopChannel> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  microsoft: "microsoft_ads",
};

export type Prioriteit = "hoog" | "midden" | "laag";

/**
 * De prioriteit uit modeloutput, teruggebracht tot de drie toegestane waarden. Het model krijgt
 * "hoog"|"midden"|"laag" voorgeschreven, maar de oude parser spreidde het object ongevalideerd
 * door ({...a}), zodat "urgent" of "HIGH" ongezien in de opslag en de UI belandde — waar een
 * Record<Prioriteit, string> er dan geen stijl voor had. Onbekend wordt "midden": niet "hoog"
 * (dat zou een verzonnen urgentie zijn) en niet "laag" (dat verbergt de actie onderaan).
 */
export function normaliseerPrioriteit(raw: unknown): Prioriteit {
  if (typeof raw !== "string") return "midden";
  const v = raw.trim().toLowerCase();
  if (v === "hoog" || v === "midden" || v === "laag") return v;
  return "midden";
}

export interface SynthesizedAction {
  channel: SopChannel;
  action: string;
  rationale: string;
  priority: Prioriteit;
}

export interface CrossChannelSynthesisResult {
  headline: string;
  narrative: string;
  contradictions: string[];
  synthesized_actions: SynthesizedAction[];
  /** De kanalen waarvan de maandanalyse aan het model is aangeleverd — dat is de scope van de
   *  synthese, niet welke kanalen het model in zijn tekst toevallig noemde. */
  channels_used: SopChannel[];
  markdown: string;
  /**
   * Percentages en eurobedragen die het model schreef maar die nergens in de aangeleverde
   * samenvattingen of signalen staan. In de opgeslagen tekst zijn ze vervangen door een
   * neutrale markering (lib/analysis/weekly-number-gate.ts). Optioneel: rijen van vóór de
   * cijferpoort hebben dit veld niet, en de PDF-renderer en UI lezen het type ook.
   */
  ongegronde_cijfers?: number[];
}

export interface ChannelSummary {
  channel: SopChannel;
  /** De analysis_date van de maandanalyse waar deze samenvatting uit komt. */
  analysisDate: string;
  primaryThread: string;
  rootCause: string;
  topRecommendations: string[];
  executiveMarkdown: string;
}

export interface OntbrekendKanaal {
  channel: SopChannel;
  /** De laatste maandanalyse die dit kanaal ooit had, of null als er nooit een was. */
  laatsteRun: string | null;
}

export interface AchterlopendKanaal {
  channel: SopChannel;
  /** Wel binnen het venster, maar meer dan ZELFDE_CYCLUS_TOLERANTIE_DAGEN vóór de nieuwste run. */
  laatsteRun: string;
}

export interface ChannelSummariesFetch {
  /**
   * De kanalen met een maandanalyse binnen CYCLUS_VENSTER_DAGEN. Een waarde null betekent: wel
   * een run, maar buiten de cyclustolerantie ten opzichte van de nieuwste — readyForSynthesis
   * leest dat als "nog niet klaar", en `achterlopend` zegt welk kanaal en welke datum.
   */
  summaries: Map<SopChannel, ChannelSummary | null>;
  /** Kanalen zonder maandanalyse binnen het venster; die tellen niet mee. */
  ontbrekend: OntbrekendKanaal[];
  achterlopend: AchterlopendKanaal[];
  /** De analysis_date van de nieuwste meetellende run, of null als geen kanaal er een heeft. */
  nieuwsteRun: string | null;
}

interface StructuredRij { output: unknown; analysis_date: string }

/** De opgeslagen output kan tekst of (bij een jsonb-kolom) al een object zijn; beide lezen.
 *  Gedeeld met portfolio-synthesis.ts, die dezelfde rijen leest. */
export function leesJson(output: unknown): unknown {
  return typeof output === "string" ? JSON.parse(output) : output;
}

/**
 * Eén kanaal: de nieuwste maandanalyse binnen het venster, of — als die er niet is — de datum
 * van de laatste die er ooit was, zodat de skip-reden "laatste run d.d. X" kan zeggen in plaats
 * van alleen "ontbreekt".
 *
 * Een queryfout gooit (DataLaagFout via eis); null is uitsluitend "geen rij". Een rij die er wél
 * is maar niet te lezen valt, gooit ook: stil "wachten op Meta" op een kapotte Meta-rij was
 * precies de onzichtbare blokkade die de audit vond.
 *
 * Het venster wordt in de query gezet (.gte) én in het geheugen opnieuw getoetst: de demo-mock
 * (lib/demo/mock-supabase.ts) past bereikfilters bewust niet toe, en zonder de tweede toets zou
 * de demo-klant een stokoude run als vers zien.
 */
async function fetchChannelSummary(
  supabase: SupabaseClient,
  clientId: string,
  channel: SopChannel,
  cutoff: string
): Promise<{ summary: ChannelSummary | null; laatsteRun: string | null }> {
  const sopType = CHANNEL_CONFIG[channel].sopTypeKey.monthly;
  const context = `sop_analysis_output (${sopType}/structured_monthly_v2)`;

  const [rij] = eis<StructuredRij>(
    await supabase
      .from("sop_analysis_output")
      .select("output, analysis_date")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .eq("section", "structured_monthly_v2")
      .gte("analysis_date", cutoff)
      .order("analysis_date", { ascending: false })
      .limit(1),
    context
  );

  if (!rij || String(rij.analysis_date) < cutoff) {
    if (rij) return { summary: null, laatsteRun: String(rij.analysis_date) };
    const [oud] = eis<{ analysis_date: string }>(
      await supabase
        .from("sop_analysis_output")
        .select("analysis_date")
        .eq("client_id", clientId)
        .eq("sop_type", sopType)
        .eq("section", "structured_monthly_v2")
        .order("analysis_date", { ascending: false })
        .limit(1),
      context
    );
    return { summary: null, laatsteRun: oud ? String(oud.analysis_date) : null };
  }

  const analysisDate = String(rij.analysis_date);
  let parsed: {
    final_sop?: { primary_thread?: string; root_cause?: string; recommendations?: { handeling?: string }[] };
    executive_markdown?: string;
  };
  try {
    const gelezen = leesJson(rij.output);
    if (!gelezen || typeof gelezen !== "object") throw new Error("geen object");
    parsed = gelezen as typeof parsed;
  } catch {
    throw new Error(
      `Maandanalyse van ${CHANNEL_CONFIG[channel].headerLabel} d.d. ${analysisDate} is onleesbaar (structured_monthly_v2 bevat geen geldige JSON); ` +
      `de synthese kan pas draaien als die rij hersteld of opnieuw gegenereerd is.`
    );
  }
  const finalSop = parsed.final_sop ?? {};
  return {
    laatsteRun: analysisDate,
    summary: {
      channel,
      analysisDate,
      primaryThread: finalSop.primary_thread ?? "",
      rootCause: finalSop.root_cause ?? "",
      topRecommendations: (finalSop.recommendations ?? []).slice(0, 5).map((r) => r.handeling ?? "").filter(Boolean),
      executiveMarkdown: parsed.executive_markdown ?? "",
    },
  };
}

/**
 * Haalt per beschikbaar kanaal de nieuwste maandanalyse binnen het cyclusvenster op en deelt de
 * kanalen in: meetellend (in `summaries`), zonder recente run (`ontbrekend`) of wel recent maar te
 * ver achter op de nieuwste (`achterlopend`, en null in de map). De aanroeper beslist wat "klaar"
 * betekent (readyForSynthesis) — deze functie doet het ophalen en de datumindeling, geen oordeel
 * over of er gesynthetiseerd moet worden.
 */
export async function fetchChannelSummaries(
  supabase: SupabaseClient,
  clientId: string,
  beschikbareKanalen: readonly Kanaal[],
  analysisDate: string
): Promise<ChannelSummariesFetch> {
  const cutoff = addDays(analysisDate, -CYCLUS_VENSTER_DAGEN);
  const ophalingen = await Promise.all(
    beschikbareKanalen.map(async (k) => {
      const channel = KANAAL_TO_SOP_CHANNEL[k];
      return [channel, await fetchChannelSummary(supabase, clientId, channel, cutoff)] as const;
    })
  );

  const metRun: [SopChannel, ChannelSummary][] = [];
  const ontbrekend: OntbrekendKanaal[] = [];
  for (const [channel, o] of ophalingen) {
    if (o.summary) metRun.push([channel, o.summary]);
    else ontbrekend.push({ channel, laatsteRun: o.laatsteRun });
  }

  const nieuwsteRun = metRun.reduce<string | null>(
    (max, [, s]) => (max === null || s.analysisDate > max ? s.analysisDate : max),
    null
  );
  const ondergrens = nieuwsteRun ? addDays(nieuwsteRun, -ZELFDE_CYCLUS_TOLERANTIE_DAGEN) : null;

  const summaries = new Map<SopChannel, ChannelSummary | null>();
  const achterlopend: AchterlopendKanaal[] = [];
  for (const [channel, s] of metRun) {
    if (ondergrens && s.analysisDate < ondergrens) {
      summaries.set(channel, null);
      achterlopend.push({ channel, laatsteRun: s.analysisDate });
    } else {
      summaries.set(channel, s);
    }
  }
  return { summaries, ontbrekend, achterlopend, nieuwsteRun };
}

/** Klaar voor synthese: minstens 2 kanalen, en ELK meetellend kanaal zit in dezelfde cyclus. Eén
 *  achterlopend kanaal betekent wachten, niet gedeeltelijk draaien — een synthese over 2 van de 3
 *  kanalen zou zichzelf presenteren als compleet terwijl hij dat niet is, en dat is precies het
 *  "stille gokken" dat deze codebase overal elders vermijdt. De datumtolerantie zelf zit in de
 *  fetch-laag (een kanaal buiten de tolerantie staat als null in de map); deze regel is daardoor
 *  generiek over het samenvattingstype en wordt door cross-channel-synthesis-lite.ts (17.30)
 *  ongewijzigd hergebruikt voor weekly/biweekly's LiteChannelSummary. */
export function readyForSynthesis<T>(summaries: Map<SopChannel, T | null>): boolean {
  if (summaries.size < 2) return false;
  return [...summaries.values()].every((s) => s !== null);
}

/**
 * Dekt een bestaande synthese de nieuwste kanaalrun al? True als er een synthese-rij is met een
 * analysis_date op of na `nieuwsteRun`. Dat vervangt het oude dagslot (analysis_date == vandaag):
 * dat sloeg een synthese over die verouderd was ten opzichte van een kanaal dat later die dag of
 * de dag erna opnieuw draaide. Grens: twee runs op dezelfde kalenderdag zijn met een DATE-kolom
 * niet uit elkaar te houden; een herrun van een kanaal op de dag van de synthese wordt dus pas de
 * volgende cyclus opnieuw gesynthetiseerd.
 *
 * De vergelijking gebeurt in het geheugen (nieuwste rij ophalen, datum vergelijken) en niet met
 * .gte in de query: de demo-mock past bereikfilters niet toe, en dan zou elke ooit gemaakte
 * demo-synthese als "dekt alles" lezen.
 */
export async function alreadySynthesized(supabase: SupabaseClient, clientId: string, nieuwsteRun: string): Promise<boolean> {
  const [rij] = eis<{ analysis_date: string }>(
    await supabase
      .from("sop_analysis_output")
      .select("analysis_date")
      .eq("client_id", clientId)
      .eq("sop_type", SOP_TYPE)
      .eq("section", SECTION)
      .order("analysis_date", { ascending: false })
      .limit(1),
    `sop_analysis_output (${SECTION})`
  );
  return !!rij && String(rij.analysis_date) >= nieuwsteRun;
}

const MAX_SIGNAL_CHARS = 3000;

export function buildSynthesisPrompt(
  summaries: Map<SopChannel, ChannelSummary | null>,
  crossChannelSignals: string | null,
  signalsDate: string | null = null
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
    "- Verzin geen cijfers die niet in de aangeleverde samenvattingen of signalen staan. Percentages en bedragen die daar niet letterlijk in voorkomen worden achteraf uit je tekst verwijderd.",
    `- Antwoord uitsluitend als JSON met exact deze velden: headline (string, één zin), narrative (string, 3-6 zinnen), contradictions (string[], leeg als er geen zijn), synthesized_actions (array van {channel: een van ${channels.map(([ch]) => `"${ch}"`).join("/")}, action, rationale, priority: "hoog"|"midden"|"laag"}), markdown (string: een leesbare, opgemaakte weergave van headline+narrative+acties voor in een rapport).`,
  ].join("\n");

  const channelBlocks = channels.map(([ch, s]) => {
    const label = CHANNEL_CONFIG[ch].headerLabel;
    const recs = s.topRecommendations.length > 0 ? s.topRecommendations.map((r) => `  - ${r}`).join("\n") : "  (geen)";
    return [
      `### ${label} (maandanalyse d.d. ${s.analysisDate})`,
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

  // Geen valse versheid: de opgeslagen cross_channel_v1-rij is de LAATST gedraaide, niet per se
  // van deze cyclus (dezelfde discipline als cross-channel-context.ts voor de per-kanaal
  // hypotheses-stap). Zonder datum erbij leest de kop hieronder als "dezelfde cyclus" terwijl het
  // net zo goed een vorige, inmiddels opgeloste bevinding kan zijn.
  const signalsKop = signalsDate
    ? `## Deterministische cross-channel-signalen (laatst gedraaid: ${signalsDate} — kan van een eerdere cyclus zijn, check de datum voordat je 'm als actueel citeert)`
    : "## Deterministische cross-channel-signalen";

  const userMessage = [
    "## Afgeronde kanaalanalyses deze cyclus",
    "",
    channelBlocks,
    "",
    signalsKop,
    "",
    signalsBlock,
  ].join("\n");

  return { systemPrompt, userMessage };
}

/** Een ```json-omhulsel rond de modeloutput weghalen; gedeeld met portfolio-synthesis.ts. */
export function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
}

/**
 * De fout voor een LLM-uitkomst die geen bruikbare JSON is. Eén tekst voor de drie syntheses
 * (monthly, lite, portfolio), zodat een logregel of 500 overal hetzelfde leest. De oude parser
 * bewaarde zo'n uitkomst als "geldige synthese met de ruwe tekst als narrative", waarna de
 * idempotentiepoort elke herkansing blokkeerde; nu gooit de orkestratie en wordt er niets
 * opgeslagen, zodat de volgende aanroep het opnieuw kan proberen.
 */
export function syntheseOnleesbaar(raw: string): Error {
  const kop = raw.trim().slice(0, 200).replace(/\s+/g, " ");
  return new Error(`Synthese-output onleesbaar: geen geldige JSON met een narrative; niet opgeslagen (begin van de output: "${kop}")`);
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

export interface ParsedSynthesis {
  /** False als de output geen JSON-object met een narrative is. De orkestratie slaat zo'n
   *  uitkomst NIET op (zie syntheseOnleesbaar); `result` is dan de gedegradeerde vorm met de
   *  ruwe tekst als narrative, alleen nog bruikbaar om te tonen of te loggen. */
  parseOk: boolean;
  result: CrossChannelSynthesisResult;
}

/** Parseert de LLM-output. Velden worden stuk voor stuk overgenomen, niet gespreid: alleen wat
 *  in het type staat komt in de opslag, en priority wordt genormaliseerd. */
export function parseSynthesisOutput(raw: string, validChannels: readonly SopChannel[]): ParsedSynthesis {
  const gedegradeerd: CrossChannelSynthesisResult = {
    headline: "",
    narrative: raw,
    contradictions: [],
    synthesized_actions: [],
    channels_used: [...validChannels],
    markdown: raw,
  };
  let parsed: Partial<CrossChannelSynthesisResult>;
  try {
    const gelezen: unknown = JSON.parse(stripCodeFence(raw));
    if (!gelezen || typeof gelezen !== "object" || Array.isArray(gelezen)) return { parseOk: false, result: gedegradeerd };
    parsed = gelezen as Partial<CrossChannelSynthesisResult>;
  } catch {
    return { parseOk: false, result: gedegradeerd };
  }
  if (typeof parsed.narrative !== "string") return { parseOk: false, result: gedegradeerd };

  const actions = Array.isArray(parsed.synthesized_actions)
    ? parsed.synthesized_actions
        .map((a): SynthesizedAction | null => {
          if (!a || typeof a !== "object") return null;
          const kandidaat = a as Partial<SynthesizedAction>;
          if (typeof kandidaat.action !== "string") return null;
          const channel = normalizeChannel(kandidaat.channel, validChannels);
          if (!channel) return null;
          return {
            channel,
            action: kandidaat.action,
            rationale: typeof kandidaat.rationale === "string" ? kandidaat.rationale : "",
            priority: normaliseerPrioriteit(kandidaat.priority),
          };
        })
        .filter((a): a is SynthesizedAction => a !== null)
    : [];
  return {
    parseOk: true,
    result: {
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      narrative: parsed.narrative,
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.filter((c): c is string => typeof c === "string") : [],
      synthesized_actions: actions,
      channels_used: [...validChannels],
      markdown: typeof parsed.markdown === "string" ? parsed.markdown : parsed.narrative,
    },
  };
}

/**
 * De toegestane cijfers: alle percentages en eurobedragen uit wat het model te lezen kreeg. De
 * executive_markdown zit erbij ook al staat hij niet in de prompt — het is gegronde kanaaloutput,
 * en een cijfer dat daar wél in staat is geen verzinsel.
 */
export function grondcijfersUitSamenvattingen(summaries: Iterable<ChannelSummary | null>, extraGrond: string | null = null): number[] {
  const teksten: string[] = [];
  for (const s of summaries) {
    if (!s) continue;
    teksten.push(s.primaryThread, s.rootCause, ...s.topRecommendations, s.executiveMarkdown);
  }
  if (extraGrond) teksten.push(extraGrond);
  return extractGroundedNumbers(teksten.join("\n"));
}

/**
 * De cijferpoort over een geparseerde synthese: headline, narrative, markdown, contradictions en
 * de actie-velden (action, rationale) worden getoetst tegen de toegestane cijfers; wat daar niet
 * in staat wordt een neutrale markering en komt in `ongegronde_cijfers` (uniek, oplopend). Het
 * veld staat er ook als de lijst leeg is: "0 ongegronde cijfers" is een uitspraak, "geen veld"
 * betekent alleen dat de poort er nog niet was.
 */
export function pasCijferpoortToe(result: CrossChannelSynthesisResult, toegestaan: number[]): CrossChannelSynthesisResult {
  const ongegrond: number[] = [];
  const poort = (tekst: string): string => {
    const r = gateUngroundedNumbers(tekst, toegestaan);
    ongegrond.push(...r.ungrounded);
    return r.text;
  };
  const acties = result.synthesized_actions.map((a) => {
    const r = gateItemFields(a as unknown as Record<string, unknown>, ["action", "rationale"], toegestaan);
    ongegrond.push(...r.ungrounded);
    return r.item as unknown as SynthesizedAction;
  });
  return {
    ...result,
    headline: poort(result.headline),
    narrative: poort(result.narrative),
    markdown: poort(result.markdown),
    contradictions: result.contradictions.map(poort),
    synthesized_actions: acties,
    ongegronde_cijfers: [...new Set(ongegrond)].sort((a, b) => a - b),
  };
}

export interface SyntheseDekking {
  /** Welke kanalen zijn aangeleverd, elk met de datum van de gebruikte maandanalyse. */
  kanalen: { channel: SopChannel; analysisDate: string }[];
  /** De nieuwste van die datums — de run die deze synthese "dekt" (zie alreadySynthesized). */
  nieuwsteRun: string;
  /** Cijfers uit de modeltekst die nergens in de grond stonden (en dus zijn gemarkeerd). */
  ongegrondeCijfers: number[];
}

export interface RunSynthesisResult {
  skipped: false;
  result: CrossChannelSynthesisResult;
  tokensUsed: number;
  model: string;
  dekking: SyntheseDekking;
}
export interface SkippedSynthesisResult {
  skipped: true;
  reason: string;
}

function ontbrekendTekst(o: OntbrekendKanaal): string {
  const label = CHANNEL_CONFIG[o.channel].headerLabel;
  return o.laatsteRun
    ? `${label} (geen maandanalyse binnen ${CYCLUS_VENSTER_DAGEN} dagen; laatste run d.d. ${o.laatsteRun})`
    : `${label} (geen maandanalyse binnen ${CYCLUS_VENSTER_DAGEN} dagen; nooit gedraaid)`;
}

/** Orkestreert de volledige synthese: gate-checks, LLM-call, cijferpoort, opslaan. Geeft
 *  skipped=true terug (geen fout) als de synthese nog niet relevant of al gedaan is — dezelfde
 *  stijl als /api/analysis/cross-channel's eigen 409-gates, alleen hier als returnwaarde i.p.v.
 *  HTTP-status zodat zowel de route als de trigger dezelfde functie kunnen aanroepen. Gooit bij
 *  een queryfout (DataLaagFout), een onleesbare kanaalrij, een onleesbare modeluitkomst of een
 *  mislukte opslag: dat zijn fouten, geen redenen om te wachten. */
export async function runCrossChannelSynthesis(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  /** De kanalen die de klant überhaupt heeft (lib/kanalen/beschikbaar); welke daarvan deze cyclus
   *  meetellen bepaalt fetchChannelSummaries. */
  beschikbareKanalen: readonly Kanaal[];
  /** De rundatum (today() in Amsterdam); ook de bovengrens van het cyclusvenster. */
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

  const ophaling = await fetchChannelSummaries(supabase, clientId, beschikbareKanalen, analysisDate);
  if (ophaling.summaries.size < 2) {
    const ontbreekt = ophaling.ontbrekend.map(ontbrekendTekst).join(", ");
    return {
      skipped: true,
      reason: `Synthese is pas relevant vanaf 2 kanalen met een maandanalyse binnen ${CYCLUS_VENSTER_DAGEN} dagen (nu ${ophaling.summaries.size}); ontbreekt: ${ontbreekt || "onbekend"}.`,
    };
  }
  if (!readyForSynthesis(ophaling.summaries)) {
    const wachten = ophaling.achterlopend
      .map((a) => `${CHANNEL_CONFIG[a.channel].headerLabel} (laatste run d.d. ${a.laatsteRun}, nieuwste run d.d. ${ophaling.nieuwsteRun})`)
      .join(", ");
    return { skipped: true, reason: `Nog niet alle kanalen in dezelfde cyclus (wachten op: ${wachten || "onbekend"}).` };
  }
  // Niet null: er zijn minstens twee meetellende kanalen, dus minstens één run.
  const nieuwsteRun = ophaling.nieuwsteRun as string;

  if (await alreadySynthesized(supabase, clientId, nieuwsteRun)) {
    return { skipped: true, reason: `Synthese dekt de nieuwste kanaalrun (${nieuwsteRun}) al.` };
  }

  const [signalsRow] = eis<{ output: unknown; analysis_date: string }>(
    await supabase
      .from("sop_analysis_output")
      .select("output, analysis_date")
      .eq("client_id", clientId)
      .eq("sop_type", SOP_TYPE)
      .eq("section", "cross_channel_v1")
      .order("analysis_date", { ascending: false })
      .limit(1),
    "sop_analysis_output (cross_channel_v1)"
  );
  const signalsText = signalsRow?.output ? String(signalsRow.output) : null;

  const { systemPrompt, userMessage } = buildSynthesisPrompt(
    ophaling.summaries,
    signalsText,
    signalsRow?.analysis_date ? String(signalsRow.analysis_date) : null,
  );

  const response = await callLayer("reasoning", {
    apiKey,
    systemPrompt,
    userMessage,
    jsonMode: true,
    maxTokens: 2000,
    label: `cross-channel-synthesis-${clientId}`,
  }, callFn);

  const validChannels = [...ophaling.summaries.keys()];
  const parsed = parseSynthesisOutput(response.output, validChannels);
  if (!parsed.parseOk) throw syntheseOnleesbaar(response.output);

  const toegestaan = grondcijfersUitSamenvattingen(ophaling.summaries.values(), signalsText);
  const result = pasCijferpoortToe(parsed.result, toegestaan);

  // Race-rem: drie aanroepers (after() in de maandroutes, de UI-knop, de cron) kunnen kort na
  // elkaar vuren en allemaal de eerste check passeren. De LLM-call is dan al gedaan, maar een
  // parallelle synthese die intussen is opgeslagen dekt dezelfde runs — die niet overschrijven.
  if (await alreadySynthesized(supabase, clientId, nieuwsteRun)) {
    return { skipped: true, reason: `Synthese voor run ${nieuwsteRun} is intussen door een parallelle aanroep opgeslagen; deze uitkomst is niet bewaard.` };
  }

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

  const kanalen = [...ophaling.summaries.entries()]
    .filter((e): e is [SopChannel, ChannelSummary] => e[1] !== null)
    .map(([channel, s]) => ({ channel, analysisDate: s.analysisDate }));

  return {
    skipped: false,
    result,
    tokensUsed: response.tokensUsed,
    model: response.model,
    dekking: { kanalen, nieuwsteRun, ongegrondeCijfers: result.ongegronde_cijfers ?? [] },
  };
}

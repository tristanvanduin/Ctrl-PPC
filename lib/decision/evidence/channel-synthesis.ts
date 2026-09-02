// Master Synthesis, Fase A: leest de al-berekende Pijler 1-5-output van elk actief kanaal
// rechtstreeks uit sop_recommendations/sop_tasks. Puur lezend, geen nieuwe detectielogica: dit
// hergebruikt exact de tabellen die persistMonthlyStructuredData() in
// app/api/analysis/monthly/route.ts al vult voor elk kanaal.
//
// periodEnd wordt NIET gebruikt om te filteren: sop_recommendations/sop_tasks dragen alleen
// analysis_date (de rundatum), geen eigen period_end; een monthly-run over de periode t/m
// 28 februari draait doorgaans zelf pas begin/half maart, dus analysis_date <= periodEnd zou
// precies de meest relevante run wegfilteren. Dit haalt daarom altijd de nieuwste run per kanaal
// en geeft de rundatum terug; build-payload.ts maakt daar `dekking` van (spreiding tussen de
// kanaalruns, verouderd t.o.v. de periode), zodat de prompt en de route eerlijk kunnen zeggen
// welke periode elk kanaal eigenlijk vertegenwoordigt.
//
// HERBOUW 2 SEPTEMBER 2026: alle vier de queries lazen alleen `data`. Een kapotte query
// betekende "kanaal heeft geen run", het kanaal viel stil uit de payload en monthly-decision
// antwoordde "geen_data". Nu gooit elke query via eis(). Microsoft ontbrak in de kanaallijst
// terwijl microsoft_monthly-output bestaat en het schema microsoft_ads toestaat: elke
// Microsoft-hypothese werd zo als hallucinatie afgekeurd. Kanaalbeschikbaarheid via dezelfde
// heeftKanaalData() als de providers (nu injecteerbaar), geen lokale kopie meer.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLE_KANALEN, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHANNEL_CONFIG, type SopChannel } from "@/lib/analysis/sop-channel-config";
import { eis } from "@/lib/analysis/db-veilig";
import { heeftKanaalData } from "../providers/beschikbaarheid";

/** Kanaal (tabsnaam) → SOP-kanaalsleutel; de sop_type volgt uit CHANNEL_CONFIG, niet uit een
 *  eigen lijstje dat kan gaan afwijken. */
const SOP_CHANNEL_VAN_KANAAL: Record<Kanaal, SopChannel> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  microsoft: "microsoft_ads",
};

export interface ChannelRecommendation {
  hypothesis: string;
  expected_result: string;
  measurement_metric: string;
  timeframe: string;
  ice_total: number;
  status: string;
}

export interface ChannelTask {
  title: string;
  description: string;
  action_type: string;
  priority: string;
  status: string;
}

export interface ChannelSynthesis {
  channel: string;
  sopType: string;
  analysisDate: string;
  recommendations: ChannelRecommendation[];
  tasks: ChannelTask[];
  /** true als er meer recs/tasks waren dan de compacte cap hieronder toestaat -- nooit stil afkappen. */
  truncated: boolean;
}

// Compact voor de LLM-payload: cap op de sterkste aanbevelingen per kanaal (hoogste ice_total).
const MAX_RECS_PER_CHANNEL = 5;
const MAX_TASKS_PER_CHANNEL = 5;
// Leesplafonds ruim boven wat één run schrijft (een monthly levert hooguit tientallen recs).
const MAX_RECS_LEZEN = 200;
const MAX_TASKS_LEZEN = 500;

interface RecRij { id: string | null; hypothesis: unknown; expected_result: unknown; measurement_metric: unknown; timeframe: unknown; ice_total: unknown; status: unknown }
interface TaakRij { title: unknown; description: unknown; action_type: unknown; priority: unknown; status: unknown }

async function fetchLatestChannelSynthesis(
  supabase: SupabaseClient,
  clientId: string,
  kanaal: Kanaal
): Promise<ChannelSynthesis | null> {
  const sopChannel = SOP_CHANNEL_VAN_KANAAL[kanaal];
  const sopType = CHANNEL_CONFIG[sopChannel].sopTypeKey.monthly;

  const laatste = eis(
    await supabase
      .from("sop_recommendations")
      .select("analysis_date")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .order("analysis_date", { ascending: false })
      .limit(1),
    `sop_recommendations (${sopType}, laatste run)`
  ) as { analysis_date: unknown }[];
  if (laatste.length === 0 || !laatste[0].analysis_date) return null;
  const analysisDate = String(laatste[0].analysis_date);

  const allRecs = eis(
    await supabase
      .from("sop_recommendations")
      .select("id, hypothesis, expected_result, measurement_metric, timeframe, ice_total, status")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .eq("analysis_date", analysisDate)
      .order("ice_total", { ascending: false })
      .limit(MAX_RECS_LEZEN),
    `sop_recommendations (${sopType}, ${analysisDate})`
  ) as RecRij[];
  const recIds = allRecs.map((r) => r.id).filter((id): id is string => Boolean(id));

  // sop_tasks via de recommendation-ids van DIT kanaal: dat is de scope die zeker klopt, ook
  // als twee kanalen dezelfde dag draaien (heel gewoon). Geen .order("priority"): dat is een
  // enum-tekst en alfabetisch sorteren zet low vóór medium.
  const allTasks = recIds.length > 0
    ? (eis(
        await supabase
          .from("sop_tasks")
          .select("title, description, action_type, priority, status")
          .in("recommendation_id", recIds)
          .limit(MAX_TASKS_LEZEN),
        `sop_tasks (${sopType}, ${analysisDate})`
      ) as TaakRij[])
    : [];

  const recommendations: ChannelRecommendation[] = allRecs.slice(0, MAX_RECS_PER_CHANNEL).map((r) => ({
    hypothesis: String(r.hypothesis ?? ""),
    expected_result: String(r.expected_result ?? ""),
    measurement_metric: String(r.measurement_metric ?? ""),
    timeframe: String(r.timeframe ?? ""),
    ice_total: Number(r.ice_total ?? 0),
    status: String(r.status ?? "open"),
  }));
  const tasks: ChannelTask[] = allTasks.slice(0, MAX_TASKS_PER_CHANNEL).map((t) => ({
    title: String(t.title ?? ""),
    description: String(t.description ?? ""),
    action_type: String(t.action_type ?? ""),
    priority: String(t.priority ?? ""),
    status: String(t.status ?? "open"),
  }));

  return {
    channel: sopChannel,
    sopType,
    analysisDate,
    recommendations,
    tasks,
    truncated: allRecs.length > MAX_RECS_PER_CHANNEL || allTasks.length > MAX_TASKS_PER_CHANNEL,
  };
}

/** Eén run per actief kanaal (google/meta/linkedin/microsoft), de nieuwste analysis_date.
 *  Kanalen zonder gesyncte data of zonder monthly-run leveren geen entry (geen lege placeholder --
 *  "niet gemeten" en "gemeten, niets gevonden" moeten onderscheiden blijven). Een queryfout
 *  gooit DataLaagFout; de aanroeper meldt hem als storing, niet als "geen data". */
export async function fetchChannelSynthesis(
  supabase: SupabaseClient,
  clientId: string,
  _periodEnd: string
): Promise<ChannelSynthesis[]> {
  const beschikbaarheid = await Promise.all(
    ALLE_KANALEN.map(async (kanaal) => ({ kanaal, beschikbaar: await heeftKanaalData(supabase, kanaal, clientId) }))
  );
  const actieveKanalen = beschikbaarheid.filter((b) => b.beschikbaar).map((b) => b.kanaal);

  const resultaten = await Promise.all(
    actieveKanalen.map((kanaal) => fetchLatestChannelSynthesis(supabase, clientId, kanaal))
  );
  return resultaten.filter((r): r is ChannelSynthesis => r !== null);
}

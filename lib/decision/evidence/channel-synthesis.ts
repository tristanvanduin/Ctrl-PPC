// Master Synthesis (Pijler 6), Fase A: leest de al-berekende Pijler 1-5-output van elk actief
// kanaal rechtstreeks uit sop_recommendations/sop_tasks -- in plaats van via de
// ChannelProvider-stubs in lib/decision/providers/ (die vandaag alleen voor Google iets
// teruggeven, zie het auditrapport). Puur lezend, geen nieuwe detectielogica: dit hergebruikt
// exact de tabellen die persistMonthlyStructuredData() in app/api/analysis/monthly/route.ts al
// vult voor Google, Meta en LinkedIn.
//
// periodEnd wordt NIET gebruikt om te filteren -- zelfde eerlijke beperking als
// periodStart/periodEnd in providers/google-provider.ts. sop_recommendations/sop_tasks dragen
// alleen analysis_date (de rundatum), geen eigen period_end; een monthly-run over de periode
// t/m 28 februari draait doorgaans zelf pas begin/half maart, dus analysis_date <= periodEnd
// zou precies de meest relevante, meest recente run wegfilteren (ontdekt via de
// integratietest). Dit haalt daarom altijd de nieuwste analysis_date per kanaal, ongeacht
// periodEnd; het parameter blijft staan voor interface-consistentie met de rest van de keten
// en voor wanneer er wel een echte periodkoppeling komt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { KANAAL_BRON, type Kanaal } from "@/lib/kanalen/beschikbaar";

// Zelfde éénregelige check als heeftKanaalData() (lib/decision/providers/beschikbaarheid.ts),
// hier lokaal met de meegegeven supabase-client i.p.v. via die functie, die zijn eigen
// getSupabase() aanroept en zo de client die híer wordt doorgegeven negeert -- dat maakt
// fetchChannelSynthesis onbedoeld niet injecteerbaar/testbaar terwijl de signatuur dat wel
// belooft. heeftKanaalData() zelf blijft ongewijzigd (drie andere aanroepers steunen op die
// signatuur); dit is bewust een kleine, lokale duplicatie in plaats van een gedeelde functie
// met een verborgen afhankelijkheid te wijzigen.
async function isKanaalActief(supabase: SupabaseClient, kanaal: Kanaal, clientId: string): Promise<boolean> {
  const bron = KANAAL_BRON[kanaal];
  const { data } = await supabase.from(bron.tabel).select(bron.kolom).eq("client_id", clientId).limit(1);
  return (data?.length ?? 0) > 0;
}

// De sop_type-sleutel per kanaal, exact zoals de adapters/route ze zetten.
const CHANNEL_SOP_TYPE: Record<Kanaal, string> = {
  google: "monthly",
  meta: "meta_monthly",
  linkedin: "linkedin_monthly",
  microsoft: "microsoft_monthly",
};

const CHANNEL_LABEL: Record<Kanaal, string> = {
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
// Zelfde discipline als "top 3 findings" elders in de pijplijn; 5 omdat pijler 6 juist over
// meerdere kanalen samenvoegt en dus iets meer ruimte per kanaal verdient dan één enkele stap.
const MAX_RECS_PER_CHANNEL = 5;
const MAX_TASKS_PER_CHANNEL = 5;

async function fetchLatestChannelSynthesis(
  supabase: SupabaseClient,
  clientId: string,
  kanaal: Kanaal,
  periodEnd: string
): Promise<ChannelSynthesis | null> {
  const sopType = CHANNEL_SOP_TYPE[kanaal];

  const { data: latest } = await supabase
    .from("sop_recommendations")
    .select("analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.analysis_date) return null;
  const analysisDate = String(latest.analysis_date);

  const { data: recRows } = await supabase
    .from("sop_recommendations")
    .select("id, hypothesis, expected_result, measurement_metric, timeframe, ice_total, status")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .eq("analysis_date", analysisDate)
    .order("ice_total", { ascending: false });

  const allRecs = recRows ?? [];
  const recIds = allRecs.map((r) => r.id).filter((id): id is string => Boolean(id));

  // sop_tasks draagt geen sop_type-kolom (alleen recommendation_id) -- filteren via de
  // recommendation-ids van DIT kanaal is de enige correcte scope, anders lekken taken van een
  // ander kanaal mee zodra twee kanalen toevallig dezelfde analysis_date hebben (heel gewoon,
  // want alle drie de SOP's draaien meestal dezelfde dag).
  // Geen .order("priority") -- dat is een enum-tekst ("critical"/"high"/"medium"/"low"), geen
  // getal, en alfabetisch sorteren geeft een verkeerde volgorde (low voor medium). De taken van
  // dit kanaal zijn toch al beperkt tot de recs met de hoogste ice_total; de cap hieronder pakt
  // gewoon de eerste N in DB-volgorde in plaats van een schijnbare prioriteitsorde te suggereren.
  const { data: taskRows } = recIds.length > 0
    ? await supabase
        .from("sop_tasks")
        .select("title, description, action_type, priority, status")
        .in("recommendation_id", recIds)
    : { data: [] as Array<{ title: unknown; description: unknown; action_type: unknown; priority: unknown; status: unknown }> };
  const allTasks = taskRows ?? [];

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
    channel: CHANNEL_LABEL[kanaal],
    sopType,
    analysisDate,
    recommendations,
    tasks,
    truncated: allRecs.length > MAX_RECS_PER_CHANNEL || allTasks.length > MAX_TASKS_PER_CHANNEL,
  };
}

/** Eén run per actief kanaal (google/meta/linkedin), nieuwste analysis_date t/m periodEnd.
 *  Kanalen zonder gesyncte data of zonder monthly-run leveren geen entry (geen lege placeholder --
 *  "niet gemeten" en "gemeten, niets gevonden" moeten onderscheiden blijven). */
export async function fetchChannelSynthesis(
  supabase: SupabaseClient,
  clientId: string,
  periodEnd: string
): Promise<ChannelSynthesis[]> {
  const kanalen: Kanaal[] = ["google", "meta", "linkedin"];
  const beschikbaarheid = await Promise.all(
    kanalen.map(async (kanaal) => ({ kanaal, beschikbaar: await isKanaalActief(supabase, kanaal, clientId) }))
  );
  const actieveKanalen = beschikbaarheid.filter((b) => b.beschikbaar).map((b) => b.kanaal);

  const resultaten = await Promise.all(
    actieveKanalen.map((kanaal) => fetchLatestChannelSynthesis(supabase, clientId, kanaal, periodEnd))
  );
  return resultaten.filter((r): r is ChannelSynthesis => r !== null);
}

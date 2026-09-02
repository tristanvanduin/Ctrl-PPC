// Master Synthesis, Fase A: leest de deterministische cross-channel-feiten die
// app/api/analysis/cross-channel/route.ts al berekent en opslaat (sop_type "cross_channel",
// section "cross_channel_groups_v1") -- zelfde select als die route's eigen GET-handler, hier
// hergebruikt in plaats van opnieuw uitgevonden. periodEnd is een bovengrens (period_end <=
// periodEnd): geen toekomstige data lekken.
//
// Herbouw 2 september 2026: een queryfout gooit (eis); alleen een onleesbare opgeslagen blob
// levert nog null, en die situatie is geen databankfout maar een oude of kapotte rij.

import type { SupabaseClient } from "@supabase/supabase-js";
import { eis } from "@/lib/analysis/db-veilig";

export interface CrossChannelGroup {
  key: string;
  title: string;
  description: string;
  triggered: number;
  checked: string[];
}

export interface CrossChannelFacts {
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  groups: CrossChannelGroup[];
  degradations: string[];
}

interface StoredGroupsPayload {
  groups?: Array<{ key: string; title: string; description: string; section?: string; triggered: number; checked: string[] }>;
  degradations?: string[];
}

interface FeitenRij { output: unknown; analysis_date: unknown; period_start: unknown; period_end: unknown }

export async function fetchCrossChannelFacts(
  supabase: SupabaseClient,
  clientId: string,
  periodEnd: string
): Promise<CrossChannelFacts | null> {
  const rijen = eis(
    await supabase
      .from("sop_analysis_output")
      .select("output, analysis_date, period_start, period_end")
      .eq("client_id", clientId)
      .eq("sop_type", "cross_channel")
      .eq("section", "cross_channel_groups_v1")
      .lte("period_end", periodEnd)
      .order("analysis_date", { ascending: false })
      .limit(1),
    "sop_analysis_output (cross_channel_groups_v1)"
  ) as FeitenRij[];
  const data = rijen[0];
  if (!data?.output) return null;

  let parsed: StoredGroupsPayload;
  try {
    parsed = JSON.parse(String(data.output)) as StoredGroupsPayload;
  } catch {
    return null;
  }

  const groups = (parsed.groups ?? []).map((g) => ({
    key: g.key, title: g.title, description: g.description, triggered: g.triggered, checked: g.checked,
  }));

  return {
    analysisDate: String(data.analysis_date ?? ""),
    periodStart: String(data.period_start ?? ""),
    periodEnd: String(data.period_end ?? ""),
    groups,
    degradations: parsed.degradations ?? [],
  };
}

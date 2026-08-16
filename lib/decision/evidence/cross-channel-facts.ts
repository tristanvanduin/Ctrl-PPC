// Master Synthesis (Pijler 6), Fase A: leest de deterministische cross-channel-feiten die
// app/api/analysis/cross-channel/route.ts al berekent en opslaat (sop_type "cross_channel",
// section "cross_channel_groups_v1") -- zelfde select als die route's eigen GET-handler, hier
// hergebruikt in plaats van opnieuw uitgevonden. periodEnd is een bovengrens (period_end <=
// periodEnd), zelfde reden als in channel-synthesis.ts: geen toekomstige data lekken.

import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function fetchCrossChannelFacts(
  supabase: SupabaseClient,
  clientId: string,
  periodEnd: string
): Promise<CrossChannelFacts | null> {
  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, analysis_date, period_start, period_end")
    .eq("client_id", clientId)
    .eq("sop_type", "cross_channel")
    .eq("section", "cross_channel_groups_v1")
    .lte("period_end", periodEnd)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.output) return null;

  let parsed: StoredGroupsPayload;
  try {
    parsed = JSON.parse(data.output as string) as StoredGroupsPayload;
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

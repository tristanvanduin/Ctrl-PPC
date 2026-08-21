// Kanaalaanbeveling: welk kanaal scoort goed in het segment van deze klant, terwijl de klant het
// zelf niet gebruikt? Zie lib/benchmark/god-view-channel-gaps.ts voor de kernlogica (puur,
// deterministisch) -- deze route is alleen de IO-laag: eigen actieve kanalen ophalen, de God
// View-pool ophalen, samenvoegen.

import { getSupabase } from "@/lib/analysis/helpers";
import { fetchGodViewInvoerRijen } from "@/lib/benchmark/god-view-data";
import { findChannelGaps, type ChannelGap } from "@/lib/benchmark/god-view-channel-gaps";
import { TEST_DREMPELS } from "@/lib/benchmark/cel";
import type { Bedrijfsmodel } from "@/lib/benchmark/segment";
import { monthsAgo } from "@/lib/reporting-date";

// Zelfde conventie als lib/analysis/god-view-context.ts: demo-clientId's draaien op verlaagde
// testdrempels, een echte clientId raakt dit pad nooit.
function isDemoClientId(clientId: string): boolean {
  return clientId.startsWith("demo-");
}

export async function GET(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId parameter vereist" }, { status: 400 });

  const [{ data: settings }, { data: eigenKanalen }, rijen] = await Promise.all([
    supabase.from("client_settings").select("bedrijfsmodel, niche").eq("client_id", clientId).maybeSingle(),
    // Laatste 3 maanden: een kanaal dat al drie maanden stilligt telt niet meer als "actief" voor
    // deze vraag -- anders zou een gepauzeerd kanaal nooit als aanbeveling terugkomen.
    supabase.from("blended_account_monthly").select("channel").eq("client_id", clientId).gte("month", monthsAgo(3)),
    fetchGodViewInvoerRijen(supabase),
  ]);

  const bedrijfsmodel = (settings?.bedrijfsmodel as Bedrijfsmodel | null) ?? null;
  const niche = settings?.niche ?? null;
  const actieveKanalen = [...new Set((eigenKanalen ?? []).map((r) => String((r as { channel: string }).channel)))];

  const gaps: ChannelGap[] = findChannelGaps(
    rijen,
    actieveKanalen,
    bedrijfsmodel,
    niche,
    isDemoClientId(clientId) ? TEST_DREMPELS : undefined,
  );

  return Response.json({ gaps, testMode: isDemoClientId(clientId) });
}

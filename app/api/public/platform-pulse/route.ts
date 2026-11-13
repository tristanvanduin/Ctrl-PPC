// Fase 5, Task 1: platform-brede totalen voor de publieke marketingpagina ("Global Platform
// Pulse"), dus BEWUST zonder inlog -- iemand die de site voor het eerst bezoekt heeft nog geen
// sessie. Dat is precies waarom deze route alleen SOM/COUNT-aggregaten teruggeeft en nooit een
// rij: geen client_id, geen bureaunaam, geen individueel cijfer. Vergelijk het met een publiek
// jaarverslag-kengetal, niet met een dashboard-export. Service-role, want er is geen sessie om
// tegen te scopen -- de aggregatie zelf is de grens, niet RLS.
//
// 22 augustus 2026: demo-klanten uitgesloten. 13 november 2026: ook dat was niet genoeg. Naast
// "Not simulated" stonden 70 active clients en € 2,26 miljoen terwijl er sinds april geen meting
// binnenkwam: "active" telde elke rij in `accounts`, spend alles wat ooit gesynct was. Wat telt,
// staat nu in lib/marketing/platform-pulse.ts: klanten met een geslaagde sync in de laatste zeven
// dagen, hun spend en analyses, en hypotheses met een vastgelegde getoetste uitkomst.
//
// Een fout in een van de leesacties geeft de lege pulse en geen gedeeltelijke: een teller die stil
// een bron mist is weer een getal dat niet waar is. De homepage verbergt het blok dan.

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ACTIEF_DAGEN, LEGE_PULSE, berekenPulse, type PulseInvoer } from "@/lib/marketing/platform-pulse";

export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const nu = new Date();
  const sinds = new Date(nu.getTime() - ACTIEF_DAGEN * 86_400_000).toISOString();

  const kanaalRuns = (tabel: string) => admin.from(tabel)
    .select("client_id, status, finished_at")
    .eq("status", "completed").gte("finished_at", sinds)
    .not("client_id", "ilike", "demo-%").limit(5000);

  const [googleRes, metaRes, linkedinRes, microsoftRes] = await Promise.all([
    admin.from("client_sync_status").select("client_id, last_successful_sync_at")
      .gte("last_successful_sync_at", sinds).not("client_id", "ilike", "demo-%").limit(5000),
    kanaalRuns("meta_sync_runs"),
    kanaalRuns("linkedin_sync_runs"),
    kanaalRuns("microsoft_sync_runs"),
  ]);
  if (googleRes.error || metaRes.error || linkedinRes.error || microsoftRes.error) return Response.json(LEGE_PULSE);

  const googleStatus = (googleRes.data ?? []) as PulseInvoer["googleStatus"];
  const runs = [...(metaRes.data ?? []), ...(linkedinRes.data ?? []), ...(microsoftRes.data ?? [])] as PulseInvoer["kanaalRuns"];
  const actief = [...new Set([...googleStatus, ...runs].map((r) => r.client_id).filter((id): id is string => !!id))];
  // Zonder actieve klant is er niets te tonen; de rest niet eens lezen.
  if (actief.length === 0) return Response.json(LEGE_PULSE);

  const [spendRes, hypRes, analysesRes] = await Promise.all([
    admin.from("blended_account_monthly").select("client_id, spend").in("client_id", actief).limit(100000),
    admin.from("sprint_hypotheses").select("client_id, outcome, result_met, evaluated_at")
      .not("evaluated_at", "is", null).not("client_id", "ilike", "demo-%").limit(100000),
    admin.from("sop_analysis_output").select("client_id").in("client_id", actief).limit(100000),
  ]);
  if (spendRes.error || hypRes.error || analysesRes.error) return Response.json(LEGE_PULSE);

  return Response.json(berekenPulse({
    googleStatus,
    kanaalRuns: runs,
    spend: (spendRes.data ?? []) as PulseInvoer["spend"],
    hypotheses: (hypRes.data ?? []) as PulseInvoer["hypotheses"],
    analyses: (analysesRes.data ?? []) as PulseInvoer["analyses"],
  }, nu));
}

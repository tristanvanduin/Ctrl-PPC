// Fase 5, Task 1: platform-brede totalen voor de publieke marketingpagina ("Global Platform
// Pulse"), dus BEWUST zonder inlog -- iemand die de site voor het eerst bezoekt heeft nog geen
// sessie. Dat is precies waarom deze route alleen SOM/COUNT-aggregaten teruggeeft en nooit een
// rij: geen client_id, geen bureaunaam, geen individueel cijfer. Vergelijk het met een publiek
// jaarverslag-kengetal, niet met een dashboard-export. Service-role, want er is geen sessie om
// tegen te scopen -- de aggregatie zelf is de grens, niet RLS.

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const [spendRes, hypothesesRes, analysesRes, clientsRes] = await Promise.all([
    admin.from("blended_account_monthly").select("spend"),
    admin.from("sprint_hypotheses").select("id", { count: "exact", head: true }).neq("status", "pending"),
    admin.from("sop_analysis_output").select("id", { count: "exact", head: true }),
    admin.from("accounts").select("client_id", { count: "exact", head: true }),
  ]);

  const adSpend = (spendRes.data ?? []).reduce((sum, r) => sum + (typeof r.spend === "number" ? r.spend : 0), 0);

  return Response.json({
    adSpendOptimized: Math.round(adSpend),
    hypothesesTested: hypothesesRes.count ?? 0,
    analysesRun: analysesRes.count ?? 0,
    activeClients: clientsRes.count ?? 0,
  });
}

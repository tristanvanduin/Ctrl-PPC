// Fase 5, Task 1: platform-brede totalen voor de publieke marketingpagina ("Global Platform
// Pulse"), dus BEWUST zonder inlog -- iemand die de site voor het eerst bezoekt heeft nog geen
// sessie. Dat is precies waarom deze route alleen SOM/COUNT-aggregaten teruggeeft en nooit een
// rij: geen client_id, geen bureaunaam, geen individueel cijfer. Vergelijk het met een publiek
// jaarverslag-kengetal, niet met een dashboard-export. Service-role, want er is geen sessie om
// tegen te scopen -- de aggregatie zelf is de grens, niet RLS.
//
// 22 augustus 2026: geen enkele query hier sloot demo-greentech en zijn drie geo-klonen uit --
// terwijl de pagina zelf pal naast deze cijfers "Live numbers across every connected account.
// Not simulated." beweert. Gemeten: €584.500 van de €2.846.985 getoonde ad spend (20,5%) en 132
// van de 689 analyses (19,2%) waren fictieve demodata. Een publieke pagina die haar eigen
// "niet gesimuleerd"-claim voor een vijfde met gesimuleerde cijfers vulde -- precies het soort
// verschil tussen een migratie en een gok dat deze codebase elders (masterplan, god-view-
// premium.tsx) expliciet weigert te maken. Alle vier tellingen sluiten `demo-%` nu uit.

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const [spendRes, hypothesesRes, analysesRes, clientsRes] = await Promise.all([
    admin.from("blended_account_monthly").select("spend").not("client_id", "ilike", "demo-%"),
    admin.from("sprint_hypotheses").select("id", { count: "exact", head: true }).neq("status", "pending").not("client_id", "ilike", "demo-%"),
    admin.from("sop_analysis_output").select("id", { count: "exact", head: true }).not("client_id", "ilike", "demo-%"),
    admin.from("accounts").select("client_id", { count: "exact", head: true }).not("client_id", "ilike", "demo-%"),
  ]);

  const adSpend = (spendRes.data ?? []).reduce((sum, r) => sum + (typeof r.spend === "number" ? r.spend : 0), 0);

  return Response.json({
    adSpendOptimized: Math.round(adSpend),
    hypothesesTested: hypothesesRes.count ?? 0,
    analysesRun: analysesRes.count ?? 0,
    activeClients: clientsRes.count ?? 0,
  });
}

// De tellers onder "Global Platform Pulse" op de publieke homepage, met de regel wat er mag tellen.
//
// WAAROM. Naast de zin "Live numbers across every connected account. Not simulated." stonden op
// 13 november "70 active clients" en "€ 2,26 miljoen ad spend optimized", terwijl er sinds 17 april
// geen enkele echte meting was binnengekomen en geen klant actief was. "Active clients" telde elke
// rij in `accounts` (ook een koppeling die nooit gesynct heeft), "ad spend optimized" alle spend
// die ooit in de database kwam, en "hypotheses tested" elk voorstel dat niet meer op pending stond,
// ook "niet uitgevoerd" en "verlopen": er is nooit een uitkomst vastgelegd.
//
// DE REGEL. Een klant is actief als er in de laatste zeven dagen een geslaagde sync van een van
// zijn kanalen was. Spend en analyses tellen alleen voor actieve klanten. Een hypothese telt als
// getoetst als er een uitkomst is vastgelegd die een toets is (gehaald of niet gehaald), niet
// "niet meetbaar", "verlopen" of "niet uitgevoerd". Demo-klanten tellen nooit. Is er geen actieve
// klant, dan toont de homepage het blok niet: nul naast "Not simulated" is ook een bewering.
//
// Zuiver, zodat de regel te toetsen is zonder database (lib/__platform_pulse_test.ts).

export interface Pulse {
  adSpendOptimized: number;
  hypothesesTested: number;
  analysesRun: number;
  activeClients: number;
}

export const LEGE_PULSE: Pulse = { adSpendOptimized: 0, hypothesesTested: 0, analysesRun: 0, activeClients: 0 };

/** Hoe lang een geslaagde sync een klant "actief" houdt. */
export const ACTIEF_DAGEN = 7;

/** Uitkomsten die een toets zijn: de hypothese is gemeten en gehaald of niet gehaald. */
const GETOETSTE_UITKOMSTEN = new Set(["accepted", "rejected", "uitgevoerd_en_gehaald", "uitgevoerd_en_niet_gehaald"]);

const isDemo = (clientId: string) => clientId.toLowerCase().startsWith("demo-");

export interface PulseInvoer {
  /** client_sync_status (Google): de laatste geslaagde sync per klant. */
  googleStatus: readonly { client_id: string | null; last_successful_sync_at: string | null }[];
  /** meta/linkedin/microsoft_sync_runs. */
  kanaalRuns: readonly { client_id: string | null; status: string | null; finished_at: string | null }[];
  /** blended_account_monthly. */
  spend: readonly { client_id: string | null; spend: number | null }[];
  /** sprint_hypotheses. */
  hypotheses: readonly { client_id: string | null; outcome: string | null; result_met: boolean | null; evaluated_at: string | null }[];
  /** sop_analysis_output. */
  analyses: readonly { client_id: string | null }[];
}

/** De klanten met een geslaagde sync in de laatste ACTIEF_DAGEN dagen, zonder demo-klanten. */
export function actieveKlanten(inv: Pick<PulseInvoer, "googleStatus" | "kanaalRuns">, nu: Date): Set<string> {
  const grens = nu.getTime() - ACTIEF_DAGEN * 86_400_000;
  const recent = (iso: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= grens && t <= nu.getTime() + 60_000;
  };
  const uit = new Set<string>();
  for (const r of inv.googleStatus) {
    if (r.client_id && !isDemo(r.client_id) && recent(r.last_successful_sync_at)) uit.add(r.client_id);
  }
  for (const r of inv.kanaalRuns) {
    if (r.client_id && !isDemo(r.client_id) && r.status === "completed" && recent(r.finished_at)) uit.add(r.client_id);
  }
  return uit;
}

/** Of een hypothese een vastgelegde, getoetste uitkomst heeft. */
export function isGetoetst(h: PulseInvoer["hypotheses"][number]): boolean {
  if (!h.evaluated_at) return false;
  if (h.result_met === true || h.result_met === false) return true;
  return h.outcome !== null && GETOETSTE_UITKOMSTEN.has(h.outcome);
}

export function berekenPulse(inv: PulseInvoer, nu: Date): Pulse {
  const actief = actieveKlanten(inv, nu);
  if (actief.size === 0) return LEGE_PULSE;
  const telt = (id: string | null): id is string => id !== null && actief.has(id);
  const adSpend = inv.spend.reduce((s, r) => s + (telt(r.client_id) && typeof r.spend === "number" && Number.isFinite(r.spend) ? r.spend : 0), 0);
  return {
    activeClients: actief.size,
    adSpendOptimized: Math.round(adSpend),
    // Een getoetste hypothese telt ook als de klant nu niet meer actief is: de uitkomst is vastgelegd.
    hypothesesTested: inv.hypotheses.filter((h) => h.client_id !== null && !isDemo(h.client_id) && isGetoetst(h)).length,
    analysesRun: inv.analyses.filter((a) => telt(a.client_id)).length,
  };
}

/** Of het blok op de homepage hoort te staan: alleen met minstens één actieve klant. */
export function pulseTonen(p: Pulse | null): boolean {
  return p !== null && p.activeClients > 0;
}

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ALL_CLIENTS } from "@/lib/auth/roles";
import { fetchGodViewInvoerRijen } from "@/lib/benchmark/god-view-data";
import { bouwGodViewCellen } from "@/lib/benchmark/god-view";
import { nicheLabel } from "@/lib/benchmark/segment";
import { MIN_BUREAUS } from "@/lib/benchmark/cel";

// God View-testroute (masterplan 16.7): bewijst dat de mechaniek werkt (IO -> k-anonieme cellen
// -> mediane CPA/ROAS), NIET de klantzijdige, tier-gated route die het gemarkete module
// (lib/marketing/modules.ts, "God View", gebouwd:false) ooit moet worden. Zolang er minder dan
// MIN_BUREAUS opt-in-bureaus zijn kan geen enkele cel ooit `metrics !== null` opleveren -- dat is
// geen bug in deze route, dat is de k-anonimiteitsregel die precies doet waarvoor hij bestaat.
//
// Daarom hetzelfde harde ALL_CLIENTS-gate als /api/platform/god-mode, niet een tier-check: er is
// nog geen klant-tier die dit zou mogen ontsluiten, en met de huidige, kleine bureaupool zou een
// echte agency-gebruiker hier toch nooit iets zien. Zodra er 4+ opt-in-bureaus zijn, is het
// tier-/module-gate op deze route (of een klantzijdige variant ervan) de volgende, aparte stap.

export async function GET() {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  if (auth.scope !== ALL_CLIENTS) {
    return Response.json({ error: "God View is alleen platform-breed toegankelijk (testfase, nog geen klant-tier)" }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const rijen = await fetchGodViewInvoerRijen(admin);
  const cellen = bouwGodViewCellen(rijen);

  return Response.json({
    stand: {
      // Aantal bureaus met minstens één account dat deze maand meetelt (opt-in + afbakening +
      // data) -- geen aparte telling van alle opt-in-bureaus zonder kwalificerende data, om deze
      // testroute niet nog een tweede query te laten doen voor een cijfer dat hier niet de kern is.
      bureausMetKwalificerendeData: new Set(rijen.map((r) => r.agencyId)).size,
      bureausNodigVoorEersteCel: MIN_BUREAUS,
      accountsMetAfbakening: new Set(rijen.map((r) => r.clientId)).size,
      cellenTotaal: cellen.length,
      cellenDeelbaar: cellen.filter((c) => c.metrics !== null).length,
    },
    cellen: cellen.map((c) => ({
      channel: c.sleutel.channel,
      model: c.sleutel.model,
      niche: c.sleutel.niche,
      nicheLabel: nicheLabel(c.sleutel.niche),
      accounts: c.telling.accounts,
      bureaus: c.telling.bureaus,
      metrics: c.metrics,
    })),
  });
}

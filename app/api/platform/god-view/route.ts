import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ALL_CLIENTS } from "@/lib/auth/roles";
import { fetchGodViewInvoerRijen } from "@/lib/benchmark/god-view-data";
import { bouwGodViewCellen } from "@/lib/benchmark/god-view";
import { nicheLabel } from "@/lib/benchmark/segment";
import { MIN_ACCOUNTS, MIN_BUREAUS } from "@/lib/benchmark/cel";

// God View-testroute (masterplan 16.7/16.8): bewijst dat de mechaniek werkt (IO -> k-anonieme
// cellen -> mediane CPA/ROAS), NIET de klantzijdige, tier-gated route die het gemarkete module
// (lib/marketing/modules.ts, "God View", gebouwd:false) ooit moet worden. Zolang er minder dan
// MIN_BUREAUS opt-in-bureaus zijn kan geen enkele cel in de STANDAARD-modus ooit `metrics !==
// null` opleveren -- geen bug, dat is de k-anonimiteitsregel die precies doet waarvoor hij bestaat.
//
// Daarom hetzelfde harde ALL_CLIENTS-gate als /api/platform/god-mode, niet een tier-check: er is
// nog geen klant-tier die dit zou mogen ontsluiten, en met de huidige, kleine bureaupool zou een
// echte agency-gebruiker hier toch nooit iets zien. Zodra er 4+ opt-in-bureaus zijn, is het
// tier-/module-gate op deze route (of een klantzijdige variant ervan) de volgende, aparte stap.
//
// ── TESTMODUS (?testdrempel=true) ────────────────────────────────────────────
//
// De eigenaar, 17 augustus 2026, met klem en expliciet: "anonimiteit in de test fase boeit me
// niet... bij relevantie moet het gewoon getriggerd worden." Met de huidige, kleine bureaupool
// (masterplan 16.6/16.7) is de standaarddrempel nooit haalbaar, en de vraag was niet "verzwak de
// regel" maar "laat me de mechaniek daadwerkelijk zien werken". Vandaar deze query-parameter, die
// de drempel verlaagt naar 1 account/1 bureau (2/1 voor de combinatie) -- ALLEEN op deze route,
// ALLEEN achter dezelfde ALL_CLIENTS-gate hierboven, NOOIT als default. lib/benchmark/cel.ts's
// eigen `beoordeelCel()` blijft voor elke andere aanroeper (waaronder de live SOP-hypotheses-stap
// via god-view-context.ts) op de echte constanten staan -- deze route geeft alleen expliciet een
// ander getal MEE, hij verandert niets aan wat de rest van de codebase als "deelbaar" beschouwt.
// De respons zegt `testMode: true` zodat dit nooit met een echte, k-anonieme uitkomst te verwarren is.

export async function GET(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  if (auth.scope !== ALL_CLIENTS) {
    return Response.json({ error: "God View is alleen platform-breed toegankelijk (testfase, nog geen klant-tier)" }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const testMode = new URL(request.url).searchParams.get("testdrempel") === "true";
  const drempels = testMode
    ? { minAccounts: 1, minBureaus: 1, minAccountsCombinatie: 2, minBureausCombinatie: 1 }
    : undefined;

  const rijen = await fetchGodViewInvoerRijen(admin);
  const cellen = bouwGodViewCellen(rijen, drempels);

  return Response.json({
    testMode,
    testModeWaarschuwing: testMode
      ? "TESTMODUS: drempel verlaagd naar 1 account/1 bureau. Deze cijfers zijn NIET k-anoniem en mogen nooit als echte God View-output getoond worden aan een klant of bureau."
      : null,
    stand: {
      // Aantal bureaus met minstens één account dat deze maand meetelt (opt-in + afbakening +
      // data) -- geen aparte telling van alle opt-in-bureaus zonder kwalificerende data, om deze
      // testroute niet nog een tweede query te laten doen voor een cijfer dat hier niet de kern is.
      bureausMetKwalificerendeData: new Set(rijen.map((r) => r.agencyId)).size,
      bureausNodigVoorEersteCel: testMode ? drempels!.minBureaus : MIN_BUREAUS,
      accountsNodigVoorEersteCel: testMode ? drempels!.minAccounts : MIN_ACCOUNTS,
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

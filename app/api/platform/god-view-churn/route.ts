import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ALL_CLIENTS } from "@/lib/auth/roles";
import { fetchGodViewChurnInvoerRijen } from "@/lib/benchmark/god-view-churn-data";
import { bouwGodViewChurnCellen } from "@/lib/benchmark/god-view-churn";
import { nicheLabel } from "@/lib/benchmark/segment";
import { MIN_ACCOUNTS, MIN_BUREAUS, TEST_DREMPELS } from "@/lib/benchmark/cel";

// Churn-tegenhanger van /api/platform/god-view/route.ts -- zelfde gate, zelfde testdrempel-
// afspraak (eigenaar, 17 augustus 2026), zelfde reden om geen UI te tonen zolang de bureaupool
// klein is. Zie lib/benchmark/god-view-churn.ts voor waarom dit een aparte route is (churn is een
// oordeel per ACCOUNT, niet per kanaal) en lib/benchmark/god-view-churn-data.ts voor waarom dit
// live berekent i.p.v. uit code_rood_meldingen te lezen (werkt al vóór migratie 073 gedraaid is).

export async function GET(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  if (auth.scope !== ALL_CLIENTS) {
    return Response.json({ error: "God View is alleen platform-breed toegankelijk (testfase, nog geen klant-tier)" }, { status: 403 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const testMode = new URL(request.url).searchParams.get("testdrempel") === "true";
  const drempels = testMode ? TEST_DREMPELS : undefined;

  const rijen = await fetchGodViewChurnInvoerRijen(admin);
  const cellen = bouwGodViewChurnCellen(rijen, drempels);

  return Response.json({
    testMode,
    testModeWaarschuwing: testMode
      ? "TESTMODUS: drempel verlaagd naar 1 account/1 bureau. Deze cijfers zijn NIET k-anoniem en mogen nooit als echte God View-output getoond worden aan een klant of bureau."
      : null,
    stand: {
      bureausMetKwalificerendeData: new Set(rijen.map((r) => r.agencyId)).size,
      bureausNodigVoorEersteCel: testMode ? drempels!.minBureaus : MIN_BUREAUS,
      accountsNodigVoorEersteCel: testMode ? drempels!.minAccounts : MIN_ACCOUNTS,
      accountsMetAfbakening: new Set(rijen.map((r) => r.clientId)).size,
      cellenTotaal: cellen.length,
      cellenDeelbaar: cellen.filter((c) => c.churn !== null).length,
    },
    cellen: cellen.map((c) => ({
      model: c.sleutel.model,
      niche: c.sleutel.niche,
      nicheLabel: nicheLabel(c.sleutel.niche),
      accounts: c.telling.accounts,
      bureaus: c.telling.bureaus,
      churn: c.churn,
    })),
  });
}

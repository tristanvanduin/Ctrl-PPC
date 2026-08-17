// De Code Rood/Amber-detectiejob: roept lib/adoptie/detecteer-code-rood.ts per klant aan en
// schrijft het resultaat in code_rood_meldingen (migratie 073). Zelfde vorm als
// app/api/cron/evaluate-hypotheses/route.ts -- fail-closed op CRON_SECRET, ?dry_run=true en
// ?client_id= voor handmatig testen, per-klant try/catch zodat één kapotte klant de run niet
// stopt.
//
// LIVE-ONGETEST: vergt migratie 073 (nu ook status 'opgelost') en een CRON_SECRET/vercel.json-
// registratie. Tot die migratie draait geeft elke poging tot schrijven een foutmelding per klant
// terug in "resultaten", zonder de rest van de run te breken.
//
// NIET IN vercel.json (17 augustus 2026, op verzoek van de eigenaar: "ik wil geen API-kosten
// maken in de nacht en ik wil zelf testen kunnen draaien"). Zie de kop van evaluate-hypotheses/
// route.ts voor de volledige toelichting -- zelfde reden, zelfde moment. Handmatig testen:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://www.ctrlppc.com/api/cron/evaluate-code-rood?dry_run=true"

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { synckandidaten } from "@/lib/tenancy/klanten";
import { beoordeelKlant } from "@/lib/adoptie/detecteer-code-rood";
import type { CodeRoodOordeel } from "@/lib/adoptie/code-rood";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

async function verwerkOordeel(admin: SupabaseClient, clientId: string, oordeel: CodeRoodOordeel): Promise<string> {
  const { data: bestaand } = await admin
    .from("code_rood_meldingen")
    .select("id, licht, redenen")
    .eq("client_id", clientId)
    .eq("status", "open")
    .maybeSingle();

  if (oordeel.licht === "groen") {
    // Alleen een OPEN melding sluiten -- een geaccepteerde/afgewezen rij is mensbezit (zie de
    // toelichting bij status 'opgelost' in migratie 073) en blijft staan tot een mens hem
    // verandert, ook als de cijfers intussen herstellen.
    if (!bestaand) return "geen-melding";
    await admin.from("code_rood_meldingen").update({ status: "opgelost" }).eq("id", (bestaand as { id: string }).id);
    return "opgelost";
  }

  if (bestaand) {
    const b = bestaand as { id: string; licht: string; redenen: string[] };
    const onveranderd = b.licht === oordeel.licht && JSON.stringify(b.redenen) === JSON.stringify(oordeel.redenen);
    if (onveranderd) return "ongewijzigd";
    await admin.from("code_rood_meldingen")
      .update({ licht: oordeel.licht, redenen: oordeel.redenen })
      .eq("id", b.id);
    return "bijgewerkt";
  }

  const { error } = await admin.from("code_rood_meldingen").insert({
    client_id: clientId, licht: oordeel.licht, redenen: oordeel.redenen,
  });
  if (error) throw new Error(error.message);
  return "nieuw";
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET niet geconfigureerd; de detectiejob weigert bewust te draaien" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "niet geautoriseerd" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const clientFilter = url.searchParams.get("client_id");
  const agencyFilter = url.searchParams.get("agency_id");

  const klanten = clientFilter
    ? [{ clientId: clientFilter }]
    : await synckandidaten(admin, { bron: "google-ads", agencyId: agencyFilter });

  const resultaten: { clientId: string; status: string; licht?: string; error?: string }[] = [];

  for (const k of klanten) {
    try {
      const oordeel = await beoordeelKlant(admin, k.clientId);
      if (!oordeel) { resultaten.push({ clientId: k.clientId, status: "geen-data" }); continue; }
      if (dryRun) { resultaten.push({ clientId: k.clientId, status: "dry-run", licht: oordeel.licht }); continue; }
      const uitkomst = await verwerkOordeel(admin, k.clientId, oordeel);
      resultaten.push({ clientId: k.clientId, status: uitkomst, licht: oordeel.licht });
    } catch (err) {
      resultaten.push({ clientId: k.clientId, status: "failed", error: String(err) });
    }
  }

  return Response.json({ dry_run: dryRun, aantal: klanten.length, resultaten });
}

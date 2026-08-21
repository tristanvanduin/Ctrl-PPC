/**
 * Het creditsaldo van het ingelogde bureau (credit_ledger, migratie 070) plus of er al een
 * prijstabel actief is (CREDIT_COSTS in lib/analysis/credit-costs.ts). Credits gelden alleen voor
 * de losse deep-dives (StandaloneAnalyses) -- nooit voor de automatische SOP-cadansen, zie de kop
 * van credit-costs.ts.
 *
 * `saldo: null` is geen fout in de response maar een eerlijke uitkomst: leesSaldo geeft null bij
 * een leesfout, expliciet ONDERSCHEIDEN van een saldo van 0 (zie de toelichting bij leesSaldo). De
 * UI mag dat verschil niet wegmoffelen tot "geen credits".
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { leesSaldo, CREDIT_COSTS } from "@/lib/analysis/credit-costs";

export async function GET() {
  const user = await getAuthUser();
  if (!user || user.agencyIds.length === 0) {
    return NextResponse.json({ saldo: null, prijzenActief: false });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ saldo: null, prijzenActief: false });
  }

  const saldo = await leesSaldo(supabase, user.agencyIds[0]);
  return NextResponse.json({ saldo, prijzenActief: Object.keys(CREDIT_COSTS).length > 0 });
}

// Heeft het eigen bureau God View Premium? Zie lib/benchmark/god-view-tier.ts voor de
// tier-grens. Alleen een boolean naar buiten, geen gevoelige data -- dit voedt de
// upsell-teaser in AgencyGodView, niet een echte toegangscontrole (de echte cross-agency
// cijfers staan sowieso alleen in god-view-premium.tsx, platformbeheerder-only).

import { getAuthUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { magGodViewPremium } from "@/lib/benchmark/god-view-tier";

export async function GET() {
  const user = await getAuthUser();
  if (!user || user.agencyIds.length === 0) return Response.json({ hasPremium: false });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ hasPremium: false });

  const { data } = await admin.from("agencies").select("licentie").eq("id", user.agencyIds[0]).maybeSingle();
  return Response.json({ hasPremium: magGodViewPremium(data?.licentie as string | null | undefined) });
}

// De bureaulijst voor de bureau-kiezer in gebruikersbeheer (app/(app)/admin/page.tsx). Losse,
// kleine route in plaats van /api/admin/whitelabel hergebruiken: die retourneert toevallig ook
// id+name, maar gaat over een heel ander besluit (mag dit bureau een eigen huisstijl tonen), en
// dat moet niet de plek worden waar "welke bureaus bestaan er" vandaan komt.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const { data, error } = await admin.from("agencies").select("id, name").order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ agencies: data ?? [] });
}

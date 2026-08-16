// Trekt een platformkoppeling in: het geheim uit de vault, de rij op 'ingetrokken'. Zie
// trekKoppelingIn (lib/tenancy/koppelingen.ts) voor waarom de rij blijft staan.
import type { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { OAUTH_PROVIDERS } from "@/lib/tenancy/oauth-providers";
import { trekKoppelingIn, type Provider } from "@/lib/tenancy/koppelingen";

export const dynamic = "force-dynamic";

function isProvider(v: string): v is Provider {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, v);
}

export async function POST(_req: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!isProvider(provider)) return Response.json({ error: "Onbekende provider" }, { status: 404 });

  const user = await requireCapability("connection:manage");
  if (user instanceof Response) return user;
  if (user.agencyIds.length === 0) {
    return Response.json({ error: "Geen bureau aan deze gebruiker gekoppeld" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: "Database niet geconfigureerd" }, { status: 500 });

  const result = await trekKoppelingIn(supabase, user.agencyIds[0], provider);
  if (!result.ok) return Response.json({ error: result.fout ?? "Ontkoppelen mislukt" }, { status: 500 });
  return Response.json({ ok: true });
}

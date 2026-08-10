// Het publieke demo-aanvraagformulier op /demo. Extreem lean: opslaan in demo_requests
// (migratie 069), geen agenda-koppeling. Service-role, want er is met opzet geen
// select-policy op de tabel voor anon/authenticated -- schrijven mag door iedereen zonder
// sessie, lezen alleen via deze laag of /api/admin.

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as
    | { naam?: string; email?: string; bedrijf?: string; bericht?: string }
    | null;

  const naam = body?.naam?.trim();
  const email = body?.email?.trim();
  if (!naam || !email) {
    return Response.json({ error: "Naam en e-mail zijn verplicht" }, { status: 400 });
  }
  // Geen zware validatiebibliotheek voor een controle die "staat er een @ in" is.
  if (!email.includes("@")) {
    return Response.json({ error: "Ongeldig e-mailadres" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { error } = await admin.from("demo_requests").insert({
    naam,
    email,
    bedrijf: body?.bedrijf?.trim() || null,
    bericht: body?.bericht?.trim() || null,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

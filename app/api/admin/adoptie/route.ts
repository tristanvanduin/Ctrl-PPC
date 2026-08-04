// Adoptie per bureau: wordt de tool eigenlijk gebruikt?
//
// Achter requireCapability("user:manage"), net als de rest van /api/admin. Dat is hier niet
// formaliteit: de onderliggende functies lezen auth.users en auth.sessions, waar e-mailadressen,
// IP's en user-agents in staan. Ze draaien als SECURITY DEFINER en geven alleen tellingen en een
// datum terug (migratie 055 en 056), maar het EXECUTE-recht ligt bij service_role — dus deze route
// is de enige weg ernaartoe. Vanuit de browser zou de anon-sleutel dat recht moeten hebben, en die
// zit in elke pagina.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** Standaardvenster. 30 dagen: kort genoeg om een terugval te zien, lang genoeg om vakantie te overleven. */
const VENSTER_DAGEN = 30;

export async function GET(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
  }

  const gevraagd = Number(new URL(request.url).searchParams.get("dagen"));
  const dagen = Number.isFinite(gevraagd) && gevraagd >= 1 && gevraagd <= 365
    ? Math.round(gevraagd)
    : VENSTER_DAGEN;

  const [bureaus, gebruikers] = await Promise.all([
    admin.rpc("bureau_adoptie", { p_dagen: dagen }),
    admin.rpc("gebruiker_activiteit", { p_dagen: dagen }),
  ]);

  // Beide fouten melden en niet alleen de eerste: als de migratie half gedraaid is, wil je weten
  // welke van de twee functies ontbreekt.
  const fout = bureaus.error?.message ?? gebruikers.error?.message;
  if (fout) return Response.json({ error: fout }, { status: 500 });

  return Response.json({
    dagen,
    bureaus: bureaus.data ?? [],
    gebruikers: gebruikers.data ?? [],
  });
}

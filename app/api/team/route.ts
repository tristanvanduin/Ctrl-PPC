// Wie er aan een sprinttaak toegewezen kan worden.
//
// WAAROM DIT NAAST /api/admin/users STAAT
//
// Die route levert hetzelfde soort lijst, maar staat achter `user:manage`. Dat is voor
// gebruikersbeheer terecht en hier fout: een performance marketeer die een taak aan een collega
// toewijst, hoort daarvoor geen rechten op het aanmaken en deactiveren van accounts te hebben.
// Zou ik die route hergebruikt hebben, dan was de keuzelijst voor iedereen behalve admins leeg
// gebleven — en een lege lijst ziet eruit als "er is niemand", niet als "jij mag dit niet zien".
//
// Deze levert daarom het minimum om een naam te tonen: id en weergavenaam, meer niet. Geen rol,
// geen scope, geen laatste aanmelding, geen e-mailadres van iemand die je niet mag beheren.
//
// De browser kan auth.users sowieso niet rechtstreeks lezen — dat is admin-API — dus een
// server-route is hier niet optioneel maar de enige weg.

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * De naam die een mens herkent.
 *
 * Supabase bewaart een naam alleen als iemand hem bij de uitnodiging heeft meegegeven; anders is
 * het e-mailadres alles wat er is. Het deel vóór de @ is dan beter leesbaar dan het hele adres
 * in een tabelcel — en het lekt het domein niet naar iedereen die taken mag toewijzen.
 */
function weergavenaam(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string {
  const meta = user.user_metadata ?? {};
  for (const sleutel of ["full_name", "name", "display_name"]) {
    const waarde = meta[sleutel];
    if (typeof waarde === "string" && waarde.trim() !== "") return waarde.trim();
  }
  const email = (user.email ?? "").trim();
  if (email === "") return "Naamloze gebruiker";
  const lokaal = email.split("@")[0];
  return lokaal === "" ? email : lokaal;
}

export async function GET() {
  // sprint:write en niet user:manage — zie de kop. Wie taken mag toewijzen, mag weten aan wie.
  const auth = await requireCapability("sprint:write");
  if (auth instanceof Response) return auth;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
  }

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Gedeactiveerde accounts vallen af: iemand die niet meer kan inloggen kun je geen werk geven.
  // Bestaande toewijzingen blijven staan — die verliezen hun persoon pas als het account echt
  // verdwijnt, en dan zorgt `on delete set null` uit migratie 033 dat de kant behouden blijft.
  const leden = data.users
    .filter((user) => !(user as { banned_until?: string | null }).banned_until)
    .map((user) => ({ id: user.id, naam: weergavenaam(user) }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  return Response.json({ leden });
}

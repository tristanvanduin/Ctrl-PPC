// De eigen identiteit, rol, rechten en beurs-scope, voor de UI-gating (useAccess).
//
// WAAROM DIT GEEN 401 GEEFT ZOLANG DE AUTH UIT STAAT
//
// Eerder viel dit endpoint terug op requireUser, wat zonder sessie een 401 oplevert. Dat is
// correct als de enforcement aan staat, maar zolang O1_AUTH_ENFORCED uit staat is er per
// definitie geen sessie en is er ook niets mis. Het gevolg was een rode fout in de console op
// ELKE pagina — en zulke ruis verbergt de fouten die er wel toe doen. Bij de rondgang langs de
// tabbladen stonden er achttien van deze meldingen tussen de echte vondsten.
//
// Nu is de toestand expliciet in het antwoord in plaats van verstopt in een statuscode. Dat
// leest ook beter: de client hoeft niet uit "401" af te leiden dat de beveiliging uit staat.
//
// BUREAUGRENS-FIX (docs/MASTERPLAN.md sectie 6, "voordat bureau twee aansluit"): `enforced`
// spiegelde tot nu toe altijd de platformbrede O1_AUTH_ENFORCED-vlag, OOK wanneer er wel degelijk
// een echte sessie was. useAccess() leest "enforced: false" als "toon alles, ongefilterd"
// (lib/auth/use-access.ts) -- dus zolang die vlag uit staat, kreeg elke ingelogde gebruiker
// `unrestricted: true` en zag de zijbalk (sidebar.tsx's canAccessClient-filter, die al bestond)
// gewoon alle klanten van elk bureau. Dat is het live incident van 15 augustus: bureau A ziet
// bureau B's klantnamen in het menu.
//
// De vlag hoort alleen te bepalen of INLOGGEN VERPLICHT is (blokkeert de middleware een verzoek
// zonder sessie), niet of een BESTAANDE sessie zijn eigen bureaugrens ziet -- dat tweede moet
// altijd, want scopen naar je eigen bureau is nooit onveilig, ook niet terwijl inloggen nog
// optioneel is. Vandaar: zonder sessie blijft `enforced` de vlag volgen (ongewijzigd gedrag,
// geen sessie is nog steeds normaal); mét sessie is de respons altijd gescopet, want auth.scope
// komt al uit bepaalScope() (lib/auth/scope.ts), dezelfde, al langer bestaande en elders al
// gebruikte afleiding die "alle klanten" reserveert voor platform_beheerders en anders het
// bureau van de gebruiker teruggeeft -- geen nieuwe scopelogica, alleen de eerder genegeerde
// uitkomst ervan nu daadwerkelijk doorgegeven.
//
// LIVE-ONGETEST tegen een echte tweede-bureau-sessie (geen tweede bureau in deze sandbox om
// tegenaan te toetsen) -- wel getypecheckt en getest tegen de bestaande bepaalScope-tests, en
// het gedrag zonder sessie (de vandaag overheersende staat, O1_AUTH_ENFORCED staat uit) is
// bewust ongewijzigd gelaten.

import { getAuthUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function enforced(): boolean {
  return process.env.O1_AUTH_ENFORCED === "true";
}

// Whitelabel_actief staat op agencies, en agencies is geen tabel die de browser met de anon-
// sleutel rechtstreeks leest (geen client_id, dus buiten het gebruikelijke RLS-patroon). Deze
// ene lookup gaat daarom via de service-role, zoals de rest van /api/admin/* al doet -- maar
// hier voor precies één rij, gescopet op de eigen bureaus van de ingelogde gebruiker, niet als
// beheerdersactie.
async function whitelabelActief(agencyIds: string[]): Promise<boolean> {
  if (agencyIds.length === 0) return false;
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { data } = await admin.from("agencies").select("whitelabel_actief").in("id", agencyIds);
  return (data ?? []).some((r) => (r as { whitelabel_actief: boolean }).whitelabel_actief);
}

export async function GET() {
  const auth = await getAuthUser();

  if (!auth) {
    // Zonder enforcement: geen sessie is de normale toestand, geen fout.
    if (!enforced()) {
      return Response.json({
        enforced: false, id: null, email: null, role: null, capabilities: [], scope: [],
        agencyId: null, whitelabelActief: false, isPlatform: false,
      });
    }
    return Response.json({ enforced: true, error: "Niet ingelogd" }, { status: 401 });
  }

  return Response.json({
    // Zie de kop hierboven: mét sessie geldt de eigen bureauscope altijd, ongeacht de
    // platformbrede login-verplichting.
    enforced: true,
    id: auth.id,
    email: auth.email,
    role: auth.role,
    capabilities: auth.capabilities,
    // "all" of een lijst. Dat onderscheid moet bewaard blijven: bij een nieuwe beurs is
    // "alle beurzen" iets anders dan "toevallig deze beurzen".
    scope: auth.scope,
    // Voor de white-label-logoresolutie in de zijbalk. Bij lidmaatschap van meerdere bureaus
    // wint het eerste -- in de praktijk heeft een gebruiker er precies één.
    agencyId: auth.agencyIds[0] ?? null,
    whitelabelActief: await whitelabelActief(auth.agencyIds),
    // Voor de gebruikersbeheer-UI: alleen een platformbeheerder mag iemand tot admin maken
    // (zie app/api/admin/users/route.ts). Geen gevoelige data — alleen of DIT de platformbeheerder
    // zelf is, niet wie er allemaal in platform_beheerders staat.
    isPlatform: auth.isPlatform,
  });
}

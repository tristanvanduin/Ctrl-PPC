// De serverkant van het zaad (lib/overzicht/zaadbak.ts): de lezingen waar het eerste kerncijfer op
// wacht, gestart terwijl de klantpagina haar schil stuurt. Sinds de kerncijfers ook op de server in
// de HTML komen (components/dashboard/band-uit-zaad.tsx) hoort de Google-route erbij: zonder Google
// is er op "Alle kanalen" geen totaal, en 62 van de 71 klanten hebben alleen Google.
//
// ALLEEN OP DE SERVER, aangeroepen uit app/(app)/client/[clientId]/page.tsx. De pagina wacht er
// niet op: ze geeft de beloften als prop aan het dashboard, en het antwoord stroomt in dezelfde
// HTML-respons na.
//
// TOEGANG. De poortwachter (middleware.ts) toetst voor een paginapad of de kijker bij deze klant
// mag, maar het RECHT (capability) toetst hij alleen voor /api/-paden. De routes die dit vervangt
// (/api/blended/client-data en /api/data/client_settings) vragen allebei een leesrecht; hier staat
// daarom dezelfde toets, met het recht uit dezelfde tabellen als de routes. Zonder toegang komt er
// geen zaad, en doet de browser zijn gewone verzoek, dat dan het gewone antwoord (401 of 403) krijgt.
//
// GEEN EIGEN FOUTEN. Elke fout hier (geen Supabase, een kapotte query, geen data) geeft null: de
// browser valt dan terug op de route, die haar eigen statuscode en foutmelding houdt. Zo verandert
// er aan de foutpaden niets.
//
// DOOR JSON HEEN, net als over de lijn: de route stuurt Response.json(data), en de browser leest
// dus wat JSON ervan overlaat (geen undefined-velden, NaN wordt null). Het zaad gaat door dezelfde
// zeef, zodat de browser exact hetzelfde object krijgt als van de route.
//
// DE GOOGLE-ROUTE ZELF. Haar lichaam (live Google Ads, of de geseede demo) staat in de route en
// nergens anders; een tweede kopie hier zou de eerste zijn die ervan afwijkt. De server roept
// daarom haar GET aan met een nagebouwd verzoek, in hetzelfde proces: geen netwerk, wel exact het
// antwoord dat de browser zou krijgen, door Response.json() en .json() heen. Alleen een geslaagd
// antwoord (200, zonder `error`) wordt zaad; elke fout laat de browser zijn eigen verzoek doen.
// De toets op toegang is die van de pagina: het recht van de route EN deze klant binnen de scope.
// Dat is strenger dan de poortwachter bij de route zelf, die het klant-id niet in customerId zoekt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getAuthUser, type AuthUser } from "@/lib/auth/server";
import { can, canAccessClient, capabilityForApi, type Capability } from "@/lib/auth/roles";
import { readPolicyFor } from "@/lib/data-access/read-policy";
import { fetchBlendedHistoricalData, geenBlendedDataFout, type BlendedHistoricalData } from "@/lib/api/blended-historical";
import type { ClientSettingsRow } from "@/lib/client-settings";
import { googleKlantnummer } from "@/lib/api/adapter";
import type { GoogleAntwoord } from "@/lib/use-client-data";
import type { Zaad } from "./zaadbak";

/** De client_settings-rij in een omhulsel: "geen rij" (null) is een geldig antwoord. */
export interface InstellingenZaad { rij: ClientSettingsRow | null }

/**
 * "Geen blended data" als uitkomst, in de vorm van het lichaam dat de route bij haar 404 stuurt.
 * Dat is een ANTWOORD en geen storing: de lezing lukte en vond niets. De browser hoeft de route er
 * dan niet nog eens om te vragen, en het kanalenproefje (client-dashboard.tsx) kan meteen weg.
 * Eerder droeg het zaad hier null, en werd het laden van zo'n klant een waterval: de server las,
 * de browser vroeg de route alsnog (404), en pas daarna vertrokken de proefverzoeken.
 */
export interface GeenBlendedData { error: string }

export interface OverzichtZaad {
  blended: Promise<Zaad<BlendedHistoricalData | GeenBlendedData> | null>;
  instellingen: Promise<Zaad<InstellingenZaad> | null>;
  google: Promise<Zaad<GoogleAntwoord> | null>;
}

/** Het pad van de Google-route, voor het recht (capabilityForApi) en het nagebouwde verzoek. */
const GOOGLE_ROUTE = "/api/google-ads/client-data";

/**
 * De GET van de Google-route, aangeroepen in dit proces. Laat geladen: de route trekt de hele
 * Google Ads-client mee, en een test die zijn eigen route meegeeft hoeft dat niet.
 */
async function vraagGoogleRoute(customerId: string): Promise<Response> {
  const [{ GET }, { NextRequest }] = await Promise.all([
    import("@/app/api/google-ads/client-data/route"),
    import("next/server"),
  ]);
  // Het adres wordt alleen ontleed (de route leest er customerId uit), nooit opgevraagd.
  return GET(new NextRequest(`http://zaad.invalid${GOOGLE_ROUTE}?customerId=${encodeURIComponent(customerId)}`));
}

type Gebruiker = Pick<AuthUser, "role" | "scope"> | null;

/** Dezelfde toets als de route: het recht, en deze klant binnen de scope. Zonder afdwinging
 *  (O1_AUTH_ENFORCED uit) gaat de lezing door, precies zoals de routes dat nu doen. */
function magLezen(gebruiker: Gebruiker, afgedwongen: boolean, recht: Capability | null, clientId: string): boolean {
  if (!afgedwongen) return true;
  return !!gebruiker && recht !== null && can(gebruiker.role, recht) && canAccessClient(gebruiker.scope, clientId);
}

function alsZaad<T>(waarde: T): Zaad<T> {
  return { waarde: JSON.parse(JSON.stringify(waarde)) as T };
}

/**
 * Is dit het verzoek om het DOCUMENT (een eerste bezoek of een herlaad), en niet een navigatie
 * binnen de app?
 *
 * Alleen dan start de pagina de lezingen. Bij een navigatie binnen de app (een beurs in de
 * zijbalk zet ?geo=, of de klant wordt vanuit de klantenlijst geopend) rendert de server deze
 * pagina ook, maar daar is het zaad geen winst en wel een last: het script draait al, dus het
 * verzoek van de browser vertrekt meteen; staat het antwoord nog in de cache van de browser, of
 * blijft het dashboard gemount, dan leest niemand het zaad, en dan liep de volle lezing (alle
 * dagrijen van drie kanalen) voor niets en ging het antwoord ongebruikt mee in de stroom. Bij een
 * documentverzoek is de cache van de browser per definitie leeg en wordt het zaad altijd gelezen.
 *
 * `Sec-Fetch-Dest: document` zet de browser zelf op een documentverzoek; een fetch van de router
 * draagt `empty`. Een browser die de kop niet stuurt krijgt geen zaad en doet zijn gewone
 * verzoeken, zoals het was.
 */
export function isDocumentVerzoek(secFetchDest: string | null | undefined): boolean {
  return secFetchDest === "document";
}

/**
 * Start de lezingen voor deze klant. Geeft meteen terug; de beloften wijzen nooit af.
 *
 * @param deps alleen voor de test: de gebruiker, de vlag en de database.
 */
export function startOverzichtZaad(clientId: string, deps: {
  gebruiker?: () => Promise<Gebruiker>;
  afgedwongen?: boolean;
  database?: SupabaseClient | null;
  googleRoute?: (customerId: string) => Promise<Response>;
} = {}): OverzichtZaad {
  const afgedwongen = deps.afgedwongen ?? process.env.O1_AUTH_ENFORCED === "true";
  // Eén keer de gebruiker voor beide lezingen; zonder afdwinging wordt hij niet eens gelezen.
  const gebruiker: Promise<Gebruiker> = afgedwongen
    ? Promise.resolve().then(deps.gebruiker ?? getAuthUser).catch(() => null)
    : Promise.resolve(null);
  const database = () => (deps.database !== undefined ? deps.database : getSupabaseAdmin());

  const blended = gebruiker.then(async (g) => {
    if (!magLezen(g, afgedwongen, capabilityForApi("/api/blended/client-data", "GET"), clientId)) return null;
    const sb = database();
    if (!sb) return null;
    const data = await fetchBlendedHistoricalData(sb, clientId);
    return alsZaad<BlendedHistoricalData | GeenBlendedData>(data ?? { error: geenBlendedDataFout(clientId) });
  }).catch(() => null);

  const instellingen = gebruiker.then(async (g) => {
    if (!magLezen(g, afgedwongen, readPolicyFor("client_settings")?.capability ?? null, clientId)) return null;
    const sb = database();
    if (!sb) return null;
    // Dezelfde lezing als loadClientSettingsRij via /api/data/client_settings doet: de hele rij.
    const { data, error } = await sb.from("client_settings").select("*").eq("client_id", clientId).maybeSingle();
    if (error) return null;
    return alsZaad<InstellingenZaad>({ rij: (data as ClientSettingsRow | null) ?? null });
  }).catch(() => null);

  const google = gebruiker.then(async (g) => {
    if (!magLezen(g, afgedwongen, capabilityForApi(GOOGLE_ROUTE, "GET"), clientId)) return null;
    // Hetzelfde klantnummer als de browser vraagt (lib/use-client-data.ts).
    const antwoord = await (deps.googleRoute ?? vraagGoogleRoute)(googleKlantnummer(clientId));
    if (!antwoord.ok) return null;
    const lichaam = (await antwoord.json()) as GoogleAntwoord | null;
    if (!lichaam || typeof lichaam !== "object" || lichaam.error) return null;
    return { waarde: lichaam };
  }).catch(() => null);

  return { blended, instellingen, google };
}

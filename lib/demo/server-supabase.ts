// De Supabase-client voor server-routes, met het demo-pad erin.
//
// WAAROM DIT BESTAAT
//
// Vier routes gaven in demo-modus een HTTP 500 met "Supabase niet geconfigureerd": de
// cross-channel-analyse, de maandhypotheses, de second opinion en de rapportages. Vier
// tabbladen dus die in de demo simpelweg stukgingen. Het patroon om er demo-rijen onder te
// schuiven stond al in één route, met de hand gekopieerd — en vier keer hetzelfde afleiden is
// precies hoe deze codebase eerder drie verschillende antwoorden op "welke maand is het"
// kreeg. Daarom hier, één keer.
//
// DE BEURS-GRENS
//
// De demo-rijen worden UITSLUITEND geserveerd voor de demo-klant. Dat is geen detail: een
// eerdere versie van /api/geo serveerde demo-data onder elke klant-id, waardoor een echte
// klant fictieve cijfers te zien kon krijgen. De check op de klant-id staat daarom vóór de
// vlag, niet erna.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDemoSupabase, isDemoClientValue } from "./mock-supabase";
import { demoRows } from "./demo-rows";

/** De service-role client, of null als de omgeving niet geconfigureerd is. */
export function realServerClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

/**
 * De client die deze route hoort te gebruiken.
 *
 * Levert demo-rijen wanneer het om de demo-klant gaat; in alle andere gevallen de echte
 * client (die null kan zijn, en dan hoort de route dat netjes te melden in plaats van te
 * doen alsof er geen data is).
 *
 * @param clientId De klant waar het verzoek over gaat. Zonder id geen demo-data.
 */
export function supabaseForClient(clientId: string | null | undefined): SupabaseClient | null {
  const real = realServerClient();
  if (!isDemoClientValue(clientId)) return real;
  return createDemoSupabase(real, demoRows());
}

/** Of dit verzoek over de demo-klant gaat. Voor routes die hun antwoord willen aanpassen. */
export function isDemoRequest(clientId: string | null | undefined): boolean {
  return isDemoClientValue(clientId);
}

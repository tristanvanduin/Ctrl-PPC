/**
 * Welke klanten een gebruiker mag zien. Eén afleiding, twee aanroepers.
 *
 * ── WAAROM DIT EEN EIGEN BESTAND IS ─────────────────────────────────────────
 *
 * Deze berekening stond twee keer: in lib/auth/server.ts (voor de route-handlers) en in
 * middleware.ts (voor de paginaverzoeken). Toen de bureaugrens erbij kwam is alleen de eerste
 * meegegaan. Het verschil dat daardoor ontstond:
 *
 *   server.ts     organisatiebrede rol → de klanten van ZIJN EIGEN bureaus
 *   middleware.ts organisatiebrede rol → ALL_CLIENTS, dus élke klant van élk bureau
 *
 * De middleware is precies de laag die dat hoort tegen te houden. Met O1_AUTH_ENFORCED aan zou
 * een beheerder van bureau A de URL van een klant van bureau B kunnen openen en langs de
 * poortwachter komen. De database geeft hem dan door RLS niets terug, dus hij ziet een leeg
 * scherm in plaats van andermans cijfers -- maar dat is geluk hebben, niet een controle die
 * werkt. Een tweede kopie van een regel is geen stijlkwestie: hij loopt uit elkaar zodra er
 * één verandert, en dat is hier gebeurd.
 *
 * ── ALL_CLIENTS ─────────────────────────────────────────────────────────────
 *
 * Blijft bestaan, maar alleen voor de platformbeheerder. Dat is de enige rol die over bureaus
 * heen kijkt, en dat staat in platform_beheerders (migratie 057) en niet in een rolnaam.
 */

import { ALL_CLIENTS, normalizeRole, scopeFor, type ClientScope, type Role } from "./roles";

/** Het stukje Supabase-client dat hier gebruikt wordt. Server- en middleware-client delen dit. */
type ScopeClient = {
  from: (tabel: string) => {
    select: (kolommen: string) => {
      eq: (kolom: string, waarde: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown }>;
      } & PromiseLike<{ data: unknown[] | null }>;
      in: (kolom: string, waarden: string[]) => PromiseLike<{ data: unknown[] | null }>;
    };
  };
};

export type ScopeUitkomst = {
  role: Role | null;
  /** Staat de gebruiker in platform_beheerders? Alleen die kijkt over bureaus heen. */
  isPlatform: boolean;
  scope: ClientScope;
  /** De bureaus (agency_id) waar deze gebruiker lid van is. Voor white-label-logoresolutie. */
  agencyIds: string[];
};

/**
 * Leidt rol en klantscope af uit de database, voor één gebruiker.
 *
 * Vier queries naast elkaar; de vijfde (accounts van zijn bureaus) volgt alleen als de rol
 * organisatiebreed is, want anders is de uitkomst er niet van afhankelijk.
 */
export async function bepaalScope(supabase: ScopeClient, userId: string): Promise<ScopeUitkomst> {
  const [roleRow, clientRows, platformRow, bureauRows] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("user_clients").select("client_id").eq("user_id", userId),
    supabase.from("platform_beheerders").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.from("user_agencies").select("agency_id").eq("user_id", userId),
  ]);

  const role = normalizeRole((roleRow.data as { role?: unknown } | null)?.role);
  const isPlatform = Boolean(platformRow.data);
  const bureaus = ((bureauRows.data ?? []) as Array<{ agency_id: unknown }>)
    .map((r) => String(r.agency_id));

  if (isPlatform) return { role, isPlatform, scope: ALL_CLIENTS, agencyIds: bureaus };

  if (scopeFor(role, []) === ALL_CLIENTS) {
    // Organisatiebrede rol: alle klanten van zijn eigen bureaus. Geen bureau betekent geen
    // klanten -- en dat is juist, want dan hoort iemand nog ergens aan gekoppeld te worden.
    // Stilzwijgend terugvallen op "dan maar alles" is hoe de bureaugrens hier verdween.
    if (bureaus.length === 0) return { role, isPlatform, scope: [], agencyIds: bureaus };
    const accountRows = await supabase.from("accounts").select("client_id").in("agency_id", bureaus);
    const scope = ((accountRows.data ?? []) as Array<{ client_id: unknown }>)
      .map((r) => String(r.client_id));
    return { role, isPlatform, scope, agencyIds: bureaus };
  }

  const scope = ((clientRows.data ?? []) as Array<{ client_id: unknown }>)
    .map((r) => String(r.client_id));
  return { role, isPlatform, scope, agencyIds: bureaus };
}

import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Launch-fase-limiet op Foundation (12 augustus 2026): niet om vraag af te remmen -- er zijn nul
// klanten -- maar om de API-belasting bewust te kunnen opschalen terwijl de Meta/LinkedIn-
// pipelines nog LIVE-ONGETEST zijn (nooit gedraaid tegen een echt gekoppeld account). Bewust GEEN
// live teller op de marketingpagina's: alleen een boolean naar buiten, nooit "X van de 50",
// dezelfde reden als waarom de social-proof-cijfers elders wachten tot er iets te tonen is -- een
// cijfer dat moet blijven kloppen is een belofte, en hier is geen self-serve aanmelding die het
// automatisch bijhoudt (agencies.licentie wordt vandaag handmatig gezet). Geen publieke API-route:
// de twee marketingpagina's die dit tonen (pricing, homepage) zijn server components en lezen dit
// rechtstreeks, geen client-side round-trip nodig zolang er geen live ticker gevraagd is.

export const FOUNDATION_CAP = 50;

/**
 * Is er nog een Foundation-plek vrij? `true` bij een leesfout -- een tijdelijke storing mag de
 * marketingpagina niet laten zeggen dat de gratis tier vol zit terwijl niemand dat weet.
 */
export async function foundationBeschikbaar(): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return true;
  const { count, error } = await admin
    .from("agencies")
    .select("id", { count: "exact", head: true })
    .eq("licentie", "basis");
  if (error || count == null) return true;
  return count < FOUNDATION_CAP;
}

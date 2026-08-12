import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseerLicentie } from "@/lib/chat/toegang";
import { saldoUit, recordCredit, type LedgerRij } from "./credit-costs";

// ============================================================================
// SECOND OPINION-TRIAL: 5 GRATIS RUNS BIJ DE EERSTE UPGRADE BOVEN FOUNDATION
// ============================================================================
//
// Los beleid van CREDIT_COSTS/controleerSaldo in credit-costs.ts hiernaast: die gaat over de nog
// onbesliste compute-creditprijs per analyse. Dit hier is een vast, apart cadeau -- 5 Second
// Opinion-runs, toegekend door de database-trigger in migratie 074 -- en leent alleen het
// credit_ledger-grootboek en zijn optelfunctie (saldoUit) om het te tellen, gefilterd op
// reason='second-opinion-trial'. Geen tweede optelsom naast saldoUit, geen tweede schrijffunctie
// naast recordCredit -- de hygienepoort bewaakt precies dit soort duplicatie.
//
// Second Opinion zelf heeft vandaag GEEN enkele poort (app/api/second-opinion/route.ts nam elk
// verzoek aan, ongeacht licentie) -- gevonden tijdens het bouwen hiervan. Foundation-bureaus
// (licentie 'basis') krijgen daarom hier hard 0: geen trial, geen toegang, want het is geen add-on
// die ze ooit gekocht hebben. Betaalde bureaus krijgen hun 5, en daarna een duidelijke blokkade
// tot ze de losse module aanschaffen (via /demo -- er is geen self-serve aankoopflow, zie de
// Intelligence Store-comment in lib/marketing/modules.ts).

export const SECOND_OPINION_TRIAL_REDEN = "second-opinion-trial";

export type SecondOpinionOordeel =
  | { toestand: "geen_bureau"; toegestaan: false; tekst: string }
  | { toestand: "foundation"; toegestaan: false; tekst: string }
  | { toestand: "uitgeput"; toegestaan: false; resterend: 0; tekst: string }
  | { toestand: "onbekend_saldo"; toegestaan: true; resterend: null }
  | { toestand: "beschikbaar"; toegestaan: true; resterend: number };

/**
 * Het oordeel. Puur: geen tijd, geen database -- zelfde vorm als beoordeelSaldo in
 * credit-costs.ts. `saldo === null` (leesfout of trigger nog niet gevuurd) blokkeert bewust NIET:
 * hetzelfde "we weten het niet mag nooit als blokkade gelden"-principe als leesSaldo daar, met
 * dezelfde reden -- Second Opinion had voor dit trial-systeem al helemaal geen poort, dus een
 * onbekend saldo hier is nooit een regressie op wat er gisteren mocht.
 */
export function beoordeelSecondOpinionTrial(
  licentie: string | null | undefined,
  saldo: number | null
): SecondOpinionOordeel {
  const genormaliseerd = normaliseerLicentie(licentie);
  if (genormaliseerd === "basis") {
    return {
      toestand: "foundation",
      toegestaan: false,
      tekst: "Second Opinion is een betaalde module. Upgrade vanaf Foundation om je 5 gratis proefruns te ontgrendelen.",
    };
  }
  if (saldo == null) return { toestand: "onbekend_saldo", toegestaan: true, resterend: null };
  if (saldo <= 0) {
    return {
      toestand: "uitgeput",
      toegestaan: false,
      resterend: 0,
      tekst: "Je 5 gratis Second Opinion-runs zijn op. Neem contact op om de module toe te voegen aan je tier.",
    };
  }
  return { toestand: "beschikbaar", toegestaan: true, resterend: saldo };
}

/**
 * Leest het second-opinion-trial-saldo van een bureau: dezelfde optelsom als leesSaldo in
 * credit-costs.ts (saldoUit), maar gefilterd op reason='second-opinion-trial' zodat dit nooit
 * doorelkaar loopt met de algemene compute-credits uit dezelfde tabel.
 */
export async function leesSecondOpinionTrialSaldo(
  supabase: SupabaseClient,
  agencyId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("event, amount")
      .eq("agency_id", agencyId)
      .eq("reason", SECOND_OPINION_TRIAL_REDEN);
    if (error || !data) return null;
    return saldoUit(data as LedgerRij[]);
  } catch {
    return null;
  }
}

/**
 * Schrijft één consume-rij van 1 credit. Fire-and-forget met stille catch, zelfde ontwerp als
 * recordCredit: kostenregistratie mag nooit een geslaagde audit breken.
 */
export async function verbruikSecondOpinionTrial(
  supabase: SupabaseClient,
  input: { agencyId: string; runKey: string }
): Promise<void> {
  await recordCredit(supabase, {
    agencyId: input.agencyId,
    event: "consume",
    amount: 1,
    reason: SECOND_OPINION_TRIAL_REDEN,
    runKey: input.runKey,
  });
}

/**
 * De volledige pre-flight controle: bureau + licentie opzoeken, trialsaldo lezen, oordelen. Eén
 * aanroep voor de route, zelfde vorm als controleerSaldo/controleerDekking hiernaast.
 */
export async function controleerSecondOpinionTrial(
  supabase: SupabaseClient,
  agencyId: string | null
): Promise<SecondOpinionOordeel> {
  if (!agencyId) {
    return { toestand: "geen_bureau", toegestaan: false, tekst: "Geen bureau gevonden bij deze klant." };
  }
  const { data, error } = await supabase
    .from("agencies")
    .select("licentie")
    .eq("id", agencyId)
    .maybeSingle();
  if (error || !data) {
    return { toestand: "geen_bureau", toegestaan: false, tekst: "Geen bureau gevonden bij deze klant." };
  }
  const saldo = await leesSecondOpinionTrialSaldo(supabase, agencyId);
  return beoordeelSecondOpinionTrial(data.licentie, saldo);
}

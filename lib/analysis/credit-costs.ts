import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// HET CREDITGROOTBOEK: SALDO EN KOSTEN, PUUR
// ============================================================================
//
// Fundament voor het tier-model uit de v2.0-blueprint (Compute Credits per tier). Dit bestand
// levert de rekensom -- wat kost een analyse in credits, wat is het saldo -- en een schrijffunctie
// voor het grootboek (migratie 070). Het roept zichzelf NERGENS aan vanuit de analysepijplijn.
//
// Dat is met opzet, en dezelfde reden als waarom MODEL_PRICES in o2-targets-cost.ts een tijdlang
// leeg heeft gestaan met een "nog in te vullen"-commentaar: CREDIT_COSTS hieronder is een
// PLACEHOLDER. De blueprint noemt creditpools per tier (10.000 / 25.000 / 50.000 / 100.000) maar
// legt nergens vast hoeveel credits één SOP-run of één deep-dive kost -- dat is een prijsbeslissing,
// geen technisch detail, en een verzonnen getal hier zou straks als een afgesproken prijs ogen
// terwijl niemand hem heeft vastgesteld. Vul CREDIT_COSTS pas in als die beslissing genomen is, en
// noteer de datum, net als bij MODEL_PRICES.
//
// Twee dingen die dit bestand BEWUST niet doet:
//
//   1. Geen charge-point. Een SOP-run doet meerdere LLM-calls (recordUsage per call); credits
//      horen per RUN afgeschreven te worden, niet per call. Waar dat gebeurt is een keuze in de
//      route/pijplijn, niet hier.
//   2. Geen blokkeer- of waarschuwlogica. uitgavenplafond.ts waarschuwt vanaf 80% en blokkeert bij
//      100% -- een bewuste keuze met een eigen redenering. Of credits hetzelfde patroon volgen, of
//      iets anders (bijv. altijd doorlaten en achteraf een Credit Pack voorstellen), is nog niet
//      besloten.

/**
 * Creditkosten per analyse-label (sop_type of call_label), in hele credits.
 *
 * ── NOG IN TE VULLEN ─────────────────────────────────────────────────────────
 *
 * Leeg totdat de prijsbeslissing genomen is. Onbekend label: geen entry, en dan blijft
 * creditKostenVoor() null -- eerlijker dan een schatting, zelfde regel als computeCallCost.
 */
export const CREDIT_COSTS: Record<string, number> = {
  // "monthly": 10,
  // "weekly": 5,
  // "biweekly": 7,
  // "deep-dive:...": ...,
};

/**
 * Wat een analyse kost in credits. Null bij een onbekend label -- dat maakt een saldoberekening
 * die dit label meetelt expliciet onvolledig in plaats van stil optimistisch.
 */
export function creditKostenVoor(
  label: string,
  costs: Record<string, number> = CREDIT_COSTS
): number | null {
  return label in costs ? costs[label] : null;
}

export interface LedgerRij {
  event: "grant" | "consume";
  amount: number;
}

/**
 * Het saldo als som van het grootboek: toekenningen erbij, verbruik eraf. Puur, geen tijd, geen
 * database -- zodat dit met vaste rijen te testen is, net als beoordeelPlafond in
 * uitgavenplafond.ts.
 */
export function saldoUit(rijen: LedgerRij[]): number {
  let saldo = 0;
  for (const r of rijen) {
    if (r.event === "grant") saldo += r.amount;
    else if (r.event === "consume") saldo -= r.amount;
  }
  return saldo;
}

/**
 * Bouwt een credit_ledger-rij exact conform migratie 070. Puur en los testbaar.
 */
export function buildLedgerRij(input: {
  agencyId: string;
  event: "grant" | "consume";
  amount: number;
  reason?: string | null;
  runKey?: string | null;
}): Record<string, unknown> {
  return {
    agency_id: input.agencyId,
    event: input.event,
    amount: input.amount,
    reason: input.reason ?? null,
    run_key: input.runKey ?? null,
  };
}

/**
 * Leest het volledige grootboek van een bureau en geeft het saldo. Bij een leesfout: 0 -- de
 * veilige kant op zolang er geen blokkeerlogica bestaat die op dit getal leunt (zie de kop van
 * dit bestand), zodat een database die even niet antwoordt geen analyse kan tegenhouden die dat
 * vandaag ook niet doet.
 */
export async function leesSaldo(
  supabase: SupabaseClient,
  agencyId: string
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("event, amount")
      .eq("agency_id", agencyId);
    if (error || !data) return 0;
    return saldoUit(data as LedgerRij[]);
  } catch {
    return 0;
  }
}

/**
 * Schrijft een grootboekrij. Fire-and-forget met stille catch, zelfde ontwerp als recordUsage in
 * o2-targets-cost.ts: kostenregistratie mag nooit een analyse breken. Wordt vandaag NERGENS
 * aangeroepen -- zie de kop van dit bestand voor waarom.
 */
export async function recordCredit(
  supabase: SupabaseClient,
  input: Parameters<typeof buildLedgerRij>[0]
): Promise<void> {
  try {
    await supabase.from("credit_ledger").insert(buildLedgerRij(input));
  } catch {
    // bewust stil: kostenregistratie is nooit een breekpunt voor de analyse
  }
}

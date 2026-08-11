import type { SupabaseClient } from "@supabase/supabase-js";
import { bureauVanKlant } from "./o2-targets-cost";

// ============================================================================
// HET CREDITGROOTBOEK: SALDO EN KOSTEN, PUUR
// ============================================================================
//
// Fundament voor het tier-model uit de v2.0-blueprint (Compute Credits per tier). Dit bestand
// levert de rekensom -- wat kost een analyse in credits, wat is het saldo -- en een schrijffunctie
// voor het grootboek (migratie 070).
//
// ── HET CHARGE-POINT: PER RUN, NIET PER LLM-CALL ────────────────────────────
//
// Onderzocht op 2026-08-11: er is GEEN gedeelde functie die bij elke SOP-run precies eenmaal
// vuurt. markProgressCompleted (lib/progress/server.ts) leek de kandidaat, maar dekt maar 4 van de
// 29 analyseroutes (monthly, weekly, biweekly, pdf) -- en zelfs binnen monthly/route.ts vuurt hij
// alleen op het Google-pad, niet op de Meta- en LinkedIn-paden (runMetaMonthlyAnalysis,
// runLinkedinMonthlyAnalysis roepen hem nooit aan; dat is een bestaand gat, los van credits).
// Het enige dat WEL bij elke route klopt: precies één terugkeer met de succesvolle
// Response.json(...) aan het eind. verbruikCredit() hieronder wordt daarom per route,
// vlak voor die ene terugkeer, aangeroepen -- vooralsnog alleen gewired op de drie
// automatische SOP-cadansen (monthly x3 kanalen, weekly, biweekly). De 22 handmatige
// deep-dive-routes (budget-allocation, bid-strategy, ...) hebben nog geen charge-point;
// dat is hetzelfde eenregelige patroon, alleen nog niet toegepast.
//
// ── WAAROM DE PRIJS ZELF NOG LEEG STAAT ──────────────────────────────────────
//
// Zelfde reden als waarom MODEL_PRICES in o2-targets-cost.ts een tijdlang leeg heeft gestaan met
// een "nog in te vullen"-commentaar: CREDIT_COSTS hieronder is een PLACEHOLDER. De blueprint noemt
// creditpools per tier (10.000 / 25.000 / 50.000 / 100.000) maar legt nergens vast hoeveel credits
// één SOP-run of één deep-dive kost -- dat is een prijsbeslissing, geen technisch detail, en een
// verzonnen getal hier zou straks als een afgesproken prijs ogen terwijl niemand hem heeft
// vastgesteld. Met CREDIT_COSTS leeg is verbruikCredit() vandaag een no-op op elke aanroep (zie
// creditKostenVoor: onbekend label geeft null, en dan wordt er niets weggeschreven) -- de wiring
// staat, de rekening nog niet. Vul CREDIT_COSTS pas in als die beslissing genomen is, en noteer de
// datum, net als bij MODEL_PRICES.
//
// ── WAT DIT BESTAND NOG NIET DOET ────────────────────────────────────────────
//
// Geen blokkeer- of waarschuwlogica. uitgavenplafond.ts waarschuwt vanaf 80% en blokkeert bij 100%
// -- een bewuste keuze met een eigen redenering. Of credits hetzelfde patroon volgen, of iets
// anders (bijv. altijd doorlaten en achteraf een Credit Pack voorstellen), is nog niet besloten.

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
 * o2-targets-cost.ts: kostenregistratie mag nooit een analyse breken.
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

/**
 * Het charge-point: één keer aanroepen vlak voor de succesvolle Response.json(...) van een
 * SOP-run. Vandaag altijd een no-op (CREDIT_COSTS is leeg, zie de kop van dit bestand) -- de
 * aanroep staat er al zodat het vullen van CREDIT_COSTS straks de ENIGE stap is, in plaats van
 * ook nog 5+ routes te moeten aanpassen.
 *
 * agencyId resolven via clientId (net als recordUsage): de routes kennen zelf geen agencyId,
 * alleen clientId. Geen bureau gevonden: geen rij, zelfde reden als de NOT NULL in migratie 070 --
 * een creditgebeurtenis zonder bureau is niemand om aan toe te rekenen.
 */
export async function verbruikCredit(
  supabase: SupabaseClient,
  input: {
    clientId?: string | null;
    agencyId?: string | null;
    label: string;
    runKey: string;
  }
): Promise<void> {
  const amount = creditKostenVoor(input.label);
  if (amount == null) return;
  const agencyId = input.agencyId ?? await bureauVanKlant(supabase, input.clientId);
  if (!agencyId) return;
  await recordCredit(supabase, { agencyId, event: "consume", amount, reason: input.label, runKey: input.runKey });
}

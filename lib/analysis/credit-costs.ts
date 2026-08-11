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
// ── CREDITS GELDEN ALLEEN VOOR DEEP DIVES, NOOIT VOOR AUTOMATISCHE SOP'S ─────
//
// Bijgesteld op 2026-08-11, na een eerdere, foute aanname: de automatische SOP-cadansen (monthly,
// weekly, biweekly) werden hier eerst OOK credit-gate't. Dat is teruggedraaid. De regel is: een
// bureau binnen zijn SOP-dekking (hoeveel klantaccounts tenminste automatische SOP's mogen
// draaien, per tier) draait AL zijn SOP's automatisch en zonder gedoe -- geen creditcheck, geen
// afschrijving. Overschrijdt het aantal gekoppelde accounts de SOP-dekking, dan is dat een APARTE
// controle bij het koppelen van een account (nog te bouwen: een melding met een keuze --
// upgraden, dekking bijkopen, of SOP's uitzetten voor de accounts die niet meer passen), niet iets
// wat dit bestand regelt.
//
// verbruikCredit()/controleerSaldo() hieronder gelden dus uitsluitend voor de HANDMATIGE
// deep-dive-routes (budget-allocation, bid-strategy, search-terms, ...). Daar geldt wel de harde
// blokkade uit de blueprint (zie hieronder) zodra CREDIT_COSTS is ingevuld.
//
// ── HET CHARGE-POINT: PER RUN, NIET PER LLM-CALL ────────────────────────────
//
// Onderzocht op 2026-08-11: er is GEEN gedeelde functie die bij elke run precies eenmaal vuurt.
// markProgressCompleted (lib/progress/server.ts) leek de kandidaat, maar dekt alleen monthly/
// weekly/biweekly/pdf -- en die vier zijn hierboven juist uitgesloten van credits. De deep-dive-
// routes hebben sowieso geen job-tracking. Het enige dat bij elke deep-dive-route klopt: precies
// één terugkeer met de succesvolle Response.json(...) aan het eind. verbruikCredit() wordt daarom
// per route, vlak voor die ene terugkeer, aangeroepen. Gewired op 7 van de 22 deep-dive-routes
// (de routes die daadwerkelijk een LLM-call en een eigen recordUsage hebben); de overige 15 doen
// geen LLM-call en hebben dus niets om credits voor af te schrijven.
//
// ── WAAROM DE PRIJS ZELF NOG LEEG STAAT ──────────────────────────────────────
//
// Zelfde reden als waarom MODEL_PRICES in o2-targets-cost.ts een tijdlang leeg heeft gestaan met
// een "nog in te vullen"-commentaar: CREDIT_COSTS hieronder is een PLACEHOLDER. De blueprint noemt
// creditpools per tier (10.000 / 25.000 / 50.000 / 100.000) maar legt nergens vast hoeveel credits
// één deep-dive kost -- dat is een prijsbeslissing, geen technisch detail, en een verzonnen getal
// hier zou straks als een afgesproken prijs ogen terwijl niemand hem heeft vastgesteld. Met
// CREDIT_COSTS leeg is verbruikCredit() vandaag een no-op op elke aanroep (zie creditKostenVoor:
// onbekend label geeft null, en dan wordt er niets weggeschreven) -- de wiring staat, de rekening
// nog niet. Vul CREDIT_COSTS pas in als die beslissing genomen is, en noteer de datum, net als bij
// MODEL_PRICES.
//
// ── BLOKKEREN: DE BLUEPRINT HEEFT DIT AL BESLIST ─────────────────────────────
//
// Anders dan bij het EUR-plafond (uitgavenplafond.ts, warn bij 80%, block bij 100%, een keuze die
// dit bestand zelf moest maken) staat de regel voor credits al in de blueprint: "Nooit onbeperkt.
// Elke tier krijgt een riante vaste credit-pool. Bereikt een agency het limiet [...]? Dan kopen ze
// een Credit Pack bij of ze upgraden." Dat is een harde blokkade bij saldo < kosten, met een
// koop/upgrade-pad als oplossing -- geen zachte waarschuwing zoals bij het EUR-plafond.
//
// GEEN "bijna op"-waarschuwingsband zoals uitgavenplafond.ts. Die zou een percentage van de
// TOEGEKENDE pool per periode vereisen (hoeveel credits kreeg dit bureau deze maand, hoeveel is
// daarvan op), en of credit-pools per kalendermaand resetten, doorrollen, of iets anders doen staat
// nergens vastgelegd -- de blueprint noemt alleen "een vaste credit-pool" per tier, geen
// resetritme. Dat verzinnen om een warn-band te kunnen tonen zou dezelfde fout zijn als CREDIT_COSTS
// vast getallen geven: een aanname die eruitziet als een beslissing.

/**
 * Creditkosten per deep-dive-label (sop_type/SOP_TYPE-constante uit de deep-dive-routes), in hele
 * credits. NIET voor monthly/weekly/biweekly -- die zijn per definitie nooit credit-gated, zie de
 * kop van dit bestand.
 *
 * ── NOG IN TE VULLEN ─────────────────────────────────────────────────────────
 *
 * Leeg totdat de prijsbeslissing genomen is. Onbekend label: geen entry, en dan blijft
 * creditKostenVoor() null -- eerlijker dan een schatting, zelfde regel als computeCallCost.
 */
export const CREDIT_COSTS: Record<string, number> = {
  // "budget_allocation": 10,
  // "bid_strategy": 10,
  // "search_terms": 8,
  // ...de overige deep-dive-labels...
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

export type CreditOordeel =
  | { toestand: "onbekende_kosten"; blokkeert: false }
  | { toestand: "geen_bureau"; blokkeert: false }
  | { toestand: "onbekend_saldo"; blokkeert: false }
  | { toestand: "genoeg"; blokkeert: false; resterend: number }
  | { toestand: "ontoereikend"; blokkeert: true; tekort: number; tekst: string };

/**
 * Het oordeel. Puur: geen tijd, geen database — alles komt uit `saldo` en `kosten`, zodat dit met
 * vaste getallen te testen is, net als beoordeelPlafond in uitgavenplafond.ts.
 *
 * Twee ingangen die NOOIT blokkeren, met opzet: `kosten === null` (onbekend label, CREDIT_COSTS
 * nog leeg) en `saldo === null` (leesSaldo kon het grootboek niet lezen). Beide zijn "we weten het
 * niet", en "we weten het niet" mag nooit hetzelfde gedrag krijgen als "het saldo is op" -- dat zou
 * een prijsdecisie die nog niet genomen is, of een tijdelijke storing, laten functioneren als een
 * harde blokkade die niemand zo bedoeld heeft.
 */
export function beoordeelSaldo(saldo: number | null, kosten: number | null): CreditOordeel {
  if (kosten == null) return { toestand: "onbekende_kosten", blokkeert: false };
  if (saldo == null) return { toestand: "onbekend_saldo", blokkeert: false };
  if (saldo >= kosten) return { toestand: "genoeg", blokkeert: false, resterend: saldo - kosten };
  return {
    toestand: "ontoereikend",
    blokkeert: true,
    tekort: kosten - saldo,
    tekst:
      `Onvoldoende credits: deze analyse kost ${kosten}, er resteren er ${Math.max(0, saldo)}. ` +
      `Koop een Credit Pack bij of upgrade de tier.`,
  };
}

/**
 * Leest het volledige grootboek van een bureau en geeft het saldo. Bij een leesfout: null, NIET 0.
 *
 * Dat onderscheid is met opzet, en is bijgesteld toen beoordeelSaldo/controleerSaldo hierop kwamen
 * te leunen: 0 is een geldig saldo (op, mag blokkeren), maar "de database antwoordde niet" is dat
 * niet. Zou leesSaldo bij een fout 0 teruggeven, dan blokkeert een tijdelijke storing een analyse
 * die dat op een normale dag niet zou doen -- exact de fout die deze functie oorspronkelijk claimde
 * te vermijden, tot er blokkeerlogica bijkwam die het getal ook echt gebruikte.
 */
export async function leesSaldo(
  supabase: SupabaseClient,
  agencyId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("event, amount")
      .eq("agency_id", agencyId);
    if (error || !data) return null;
    return saldoUit(data as LedgerRij[]);
  } catch {
    return null;
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

/**
 * De volledige pre-flight controle: lees de kosten, lees het grootboek, en oordeel. Eén aanroep
 * voor een route die wil weten of hij een SOP-run mag starten -- zelfde vorm als controleerPlafond
 * in uitgavenplafond.ts. Hoort VOOR het werk te draaien, niet erna (zie de wiring in de routes):
 * verbruikCredit schrijft achteraf af, dit hier is de poort ervoor.
 *
 * Vandaag altijd blokkeert: false, want CREDIT_COSTS is leeg (toestand "onbekende_kosten"). Dat is
 * bewust hetzelfde inerte gedrag als verbruikCredit: de wiring staat, de blokkade wordt pas echt
 * zodra er een prijs is.
 */
export async function controleerSaldo(
  supabase: SupabaseClient,
  input: {
    clientId?: string | null;
    agencyId?: string | null;
    label: string;
  }
): Promise<CreditOordeel> {
  const kosten = creditKostenVoor(input.label);
  if (kosten == null) return { toestand: "onbekende_kosten", blokkeert: false };
  const agencyId = input.agencyId ?? await bureauVanKlant(supabase, input.clientId);
  if (!agencyId) return { toestand: "geen_bureau", blokkeert: false };
  const saldo = await leesSaldo(supabase, agencyId);
  return beoordeelSaldo(saldo, kosten);
}

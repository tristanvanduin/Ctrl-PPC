import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseerLicentie, type Licentie } from "@/lib/chat/toegang";

// ============================================================================
// SOP-DEKKING: HOEVEEL ACCOUNTS EEN TIER AUTOMATISCHE SOP'S GEEFT
// ============================================================================
//
// Automatische SOP's (monthly/weekly/biweekly) zijn nooit credit-gated -- zie de kop van
// lib/analysis/credit-costs.ts. Ze zijn gedekt zolang een bureau BINNEN zijn SOP-dekking zit:
// hoeveel accounts tenminste automatische SOP's mogen draaien, per tier. Boven die dekking is er
// geen creditcheck die het oplost (dat bestaat voor deep dives, niet hiervoor); de bedoelde
// oplossing is een keuze: upgraden, dekking bijkopen, of SOP's uitzetten voor de accounts die
// niet meer passen (de sops_enabled-kolom, migratie 072).
//
// ── DE GETALLEN HIERONDER ZIJN INDICATIEF, NIET DEFINITIEF ──────────────────
//
// Anders dan CREDIT_COSTS (die leeg begon, want er was geen enkel getal genoemd) zijn deze
// waarden de indicatie die tijdens het ontwerp van het tier-model zelf is gegeven: tier 1 ~20,
// tier 2 ~50, tier 3 ~100, tier 4 ~200 klantaccounts, expliciet als "oid" (ongeveer) aangeduid --
// geen afgesproken prijs, wel een concreet startpunt. Ze zijn hier ingevuld zodat de rest van dit
// bestand (en de UI die erop leunt) meteen werkt, niet omdat de getallen al vastliggen. Wijzig ze
// hier, op één plek, zodra ze definitief zijn -- en noteer dan de datum, net als bij MODEL_PRICES.
export const SOP_DEKKING: Record<Licentie, number> = {
  basis: 0,            // gratis: dashboard en forecast altijd, automatische SOP's nooit.
  core: 20,
  growth: 50,
  scale: 100,
  professional: 200,
  enterprise: Number.POSITIVE_INFINITY, // "maximaal, maar hard gecapt" in de blueprint -- het
  // exacte plafond (blueprint noemt 500k CREDITS voor Enterprise, geen accountaantal) staat niet
  // vast. Oneindig hier is dus zelf ook een placeholder: "geen dekkingsprobleem op dit niveau",
  // niet "gegarandeerd geen limiet".
};

export type DekkingOordeel =
  | { toestand: "binnen_dekking"; aantalMetSops: number; limiet: number; ruimte: number }
  | { toestand: "overschreden"; aantalMetSops: number; limiet: number; overtal: number; tekst: string };

/**
 * Het oordeel. Puur: geen database, geen tier-opzoeking -- alles komt uit `aantalMetSops` en
 * `limiet`, zodat dit met vaste getallen te testen is, net als beoordeelSaldo/beoordeelPlafond.
 */
export function beoordeelDekking(aantalMetSops: number, limiet: number): DekkingOordeel {
  if (aantalMetSops <= limiet) {
    return { toestand: "binnen_dekking", aantalMetSops, limiet, ruimte: limiet - aantalMetSops };
  }
  const overtal = aantalMetSops - limiet;
  return {
    toestand: "overschreden",
    aantalMetSops,
    limiet,
    overtal,
    tekst:
      `${aantalMetSops} accounts hebben automatische SOP's aan, de tier dekt er ${limiet}. ` +
      `Kies: upgrade naar een hogere tier, koop extra dekking bij, of zet SOP's uit voor ` +
      `${overtal} ${overtal === 1 ? "account" : "accounts"} om binnen de dekking te komen.`,
  };
}

/**
 * Telt de accounts van een bureau met sops_enabled = true. Bij een leesfout: null, niet 0 --
 * zelfde afweging als leesSaldo in credit-costs.ts. Een 0 door een storing zou als "alles uit"
 * lezen en de dekkingsmelding onterecht laten verdwijnen; null laat de aanroeper weten dat het
 * getal niet vertrouwd kan worden.
 */
export async function telAccountsMetSops(
  supabase: SupabaseClient,
  agencyId: string
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .eq("sops_enabled", true);
    if (error || count == null) return null;
    return count;
  } catch {
    return null;
  }
}

/**
 * De client_id's van een bureau met sops_enabled = true -- het lijst-equivalent van
 * telAccountsMetSops hierboven. Nodig voor de portfolio-synthese (masterplan 17.15): "welke
 * klanten horen in dit bureau's portfolio" is precies dezelfde regel als "welke klanten tellen
 * mee voor de SOP-dekking", dus hergebruik in plaats van een tweede, licht andere definitie.
 * Bij een leesfout: null, zelfde afweging als telAccountsMetSops.
 */
export async function lijstAccountsMetSops(
  supabase: SupabaseClient,
  agencyId: string
): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("client_id")
      .eq("agency_id", agencyId)
      .eq("sops_enabled", true);
    if (error || !data) return null;
    return data.map((r) => String(r.client_id));
  } catch {
    return null;
  }
}

/**
 * Mag dit ene account automatische SOP's draaien? Dit is de handhaving achter sops_enabled,
 * aan te roepen in monthly/weekly/biweekly voordat een run start.
 *
 * Bij een leesfout of een onbekend account: true. Dezelfde permissieve kant als overal in dit
 * grootboek-cluster -- een storing mag geen run blokkeren die dat op een normale dag niet zou
 * zijn, en "geen rij gevonden" is geen reden om een klant zonder uitleg te weigeren.
 */
export async function magSopDraaien(
  supabase: SupabaseClient,
  clientId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("sops_enabled")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error || !data) return true;
    return data.sops_enabled !== false;
  } catch {
    return true;
  }
}

/**
 * De volledige controle: licentie opzoeken, accounts tellen, oordelen. Bij een onbekende
 * licentie of een leesfout: null -- de aanroeper (de banner) toont dan niets in plaats van een
 * foutieve "overschreden"-melding op basis van een gok.
 */
export async function controleerDekking(
  supabase: SupabaseClient,
  agencyId: string
): Promise<DekkingOordeel | null> {
  const { data, error } = await supabase
    .from("agencies")
    .select("licentie")
    .eq("id", agencyId)
    .maybeSingle();
  if (error || !data) return null;
  const licentie = normaliseerLicentie(data.licentie);
  const limiet = SOP_DEKKING[licentie];

  const aantal = await telAccountsMetSops(supabase, agencyId);
  if (aantal == null) return null;

  return beoordeelDekking(aantal, limiet);
}

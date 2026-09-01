import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_PRICES, computeCallCost } from "./o2-targets-cost";

// ============================================================================
// HET UITGAVENPLAFOND OP HET LLM-VERBRUIK
// ============================================================================
//
// ── WAT HET PROBLEEM IS ─────────────────────────────────────────────────────
//
// Elke analyse en elke chatbeurt kost geld bij Google, en niets in dit product houdt dat tegen.
// Een maandanalyse is ~30 calls; de sparren-knop is per klik één call en heeft geen bovengrens.
// Er is dus geen bedrag waarboven het product zegt: nu niet meer. De rekening komt achteraf en
// is dan al betaald.
//
// De boekhouding stond er wel al: llm_usage krijgt per call een rij, en sinds de prijstabel
// gevuld is staat er ook een cost_eur bij. Wat ontbrak is de vergelijking met een grens.
//
// ── VIJF KEUZES, EN WAAROM ──────────────────────────────────────────────────
//
// 1. HET PLAFOND VERGELIJKT MET BESTEED + SCHATTING, NIET MET BESTEED.
//    Een plafond kun je alleen vóór een call controleren, maar de kosten van die call ken je
//    pas erna. Wie alleen kijkt of het bestede bedrag onder de grens ligt, laat altijd nog één
//    call door en gaat er dus per definitie overheen -- bij een maandanalyse is dat niet één
//    call maar dertig. Daarom telt de verwachte kosten van wat er nú gaat gebeuren mee.
//
// 2. ONBEKENDE MODELLEN MAKEN HET TOTAAL EEN ONDERGRENS, EN DAT ZEGGEN WE.
//    computeCallCost geeft bewust null bij een model zonder prijs; die rijen tellen niet mee in
//    de som. Stond er ooit een model in de router dat niet in MODEL_PRICES staat -- en dat is
//    gebeurd: er staan 17 rijen `gemini-3.5-flash` in het grootboek uit juli -- dan is "je zit
//    onder je plafond" niet bewezen maar onbekend. Dat hoort in de tekst te staan, want anders
//    is een stil te laag totaal precies het geval waarin een plafond je niet beschermt.
//
// 3. GEEN PLAFOND INGESTELD BETEKENT GEEN PLAFOND.
//    Er is geen ingebouwde standaardgrens. Een limiet die zichzelf aanzet legt op een dag
//    iemands analyse stil zonder dat hij ooit een bedrag heeft afgesproken, en dat is erger dan
//    een rekening die tegenvalt.
//
// 4. DE WAARSCHUWINGSBAND ZIT OP 80%, EN WAARSCHUWEN IS NIET BLOKKEREN.
//    Tussen 80% en 100% draait alles gewoon door, met een melding erbij. Een plafond dat pas
//    van zich laat horen op het moment dat het dichtklapt, voelt als een storing.
//
// 5. DE MAAND IS DE KALENDERMAAND IN UTC.
//    Dezelfde tijdzone als llm_usage.created_at. Een plafond dat op een andere grens telt dan
//    de tabel waaruit hij leest, klopt elf maanden per jaar en één maand niet.
//
// ── WAT DIT NIET IS ─────────────────────────────────────────────────────────
//
// Geen plafond per klant en geen doorbelasting. Dat kan later op dezelfde som (llm_usage heeft
// client_id), maar een plafond per klant vraagt een scherm om het in te stellen en een gesprek
// over wie het mag verhogen. Dit is de grens op het geheel, en die is er nu niet.

/** De omgevingsvariabele. Leeg of afwezig betekent: geen plafond. Zie keuze 3. */
export const PLAFOND_ENV = "LLM_MAAND_PLAFOND_EUR";

/** Vanaf welk deel van het plafond er gewaarschuwd wordt. Zie keuze 4. */
export const WAARSCHUWINGSGRENS = 0.8;

export interface PlafondStand {
  /** Het ingestelde plafond in euro, of null als er geen is. */
  plafond: number | null;
  /** De som van cost_eur deze maand. Een ONDERGRENS zodra `onbekend` groter dan nul is. */
  besteed: number;
  /** Aantal calls deze maand zonder bekende modelprijs. Zie keuze 2. */
  onbekend: number;
  /** Wat de call die nu gaat gebeuren naar verwachting kost. Zie keuze 1. */
  schatting: number;
}

export type PlafondOordeel =
  | { toestand: "geen_plafond"; blokkeert: false }
  | { toestand: "ruim"; blokkeert: false; resterend: number; aandeel: number }
  | { toestand: "bijna"; blokkeert: false; resterend: number; aandeel: number; tekst: string }
  | { toestand: "over"; blokkeert: true; tekort: number; tekst: string };

const eur = (v: number): string =>
  `€ ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** De eerste dag van de volgende maand, als datum in tekst — het moment dat de teller op nul gaat. */
export function resetDatum(nu: Date = new Date()): string {
  const d = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

/** De eerste dag van de huidige maand in UTC, als ISO-timestamp. Zie keuze 5. */
export function maandStart(nu: Date = new Date()): string {
  return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1)).toISOString();
}

/**
 * Leest het plafond uit de omgeving. Null bij afwezig, leeg, onleesbaar of niet-positief.
 *
 * Een onleesbare waarde wordt bewust GEEN plafond en geen fout: een typefout in de configuratie
 * mag geen analyses stilleggen, en hem als 0 lezen zou precies dat doen -- dan blokkeert alles.
 */
export function leesPlafond(env: Record<string, string | undefined> = process.env): number | null {
  const ruw = (env[PLAFOND_ENV] ?? "").trim();
  if (!ruw) return null;
  const v = Number(ruw.replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Het oordeel. Puur: geen tijd, geen database, geen omgeving — alles komt uit `stand`, zodat
 * dit met vaste getallen te testen is.
 */
export function beoordeelPlafond(stand: PlafondStand): PlafondOordeel {
  const { plafond, besteed, onbekend, schatting } = stand;
  if (plafond == null || !(plafond > 0)) return { toestand: "geen_plafond", blokkeert: false };

  const na = Math.max(0, besteed) + Math.max(0, schatting);
  const aandeel = na / plafond;
  const resterend = Math.round((plafond - na) * 100) / 100;

  // Het voorbehoud bij een partieel totaal. Zie keuze 2.
  const voorbehoud = onbekend > 0
    ? ` Let op: ${onbekend} ${onbekend === 1 ? "call heeft" : "calls hebben"} geen bekende modelprijs, dus het werkelijke bedrag ligt hoger.`
    : "";

  if (na > plafond) {
    const tekort = Math.round((na - plafond) * 100) / 100;
    return {
      toestand: "over",
      blokkeert: true,
      tekort,
      tekst:
        `Het maandplafond van ${eur(plafond)} voor AI-verbruik is bereikt: ${eur(besteed)} besteed. ` +
        `De teller gaat op ${resetDatum()} weer op nul. Verhoog ${PLAFOND_ENV} om eerder verder te kunnen.` +
        voorbehoud,
    };
  }

  if (aandeel >= WAARSCHUWINGSGRENS) {
    return {
      toestand: "bijna",
      blokkeert: false,
      resterend,
      aandeel,
      tekst:
        `${Math.round(aandeel * 100)}% van het maandplafond van ${eur(plafond)} is verbruikt; ` +
        `nog ${eur(Math.max(0, resterend))} tot ${resetDatum()}.` + voorbehoud,
    };
  }

  return { toestand: "ruim", blokkeert: false, resterend, aandeel };
}

/**
 * Wat een call naar verwachting kost. Zie keuze 1.
 *
 * Bewust GEEN mediaan over de laatste runs: die zou over modellen en staplengtes heen middelen en
 * bij de eerste run van een nieuwe maand op niets kunnen leunen. Dit is de rekensom van
 * computeCallCost op de tokens die je zelf al kent voordat je verstuurt. Onbekend model, of geen
 * schatting mee te geven, geeft 0 — dan is het plafond een controle op wat er al besteed is en
 * niet strenger dan dat.
 */
export function schatCallKosten(model: string, promptTokens: number, completionTokens: number): number {
  return computeCallCost(model, promptTokens, completionTokens, MODEL_PRICES) ?? 0;
}

/**
 * Wat een complete SOP-run naar verwachting kost, per cadans. Voor de plafondcheck aan het
 * BEGIN van de analyse-routes: een maandanalyse is tientallen calls, en wie pas per call
 * controleert laat een halve run door voordat het plafond dichtgaat (zie keuze 1).
 *
 * De tokengetallen zijn gemeten aan de rookproef op demo-greentech (1 september 2026:
 * de Google-monthly deed ~66k prompt- plus ~25k completion-tokens over 8 calls; weekly en
 * biweekly zitten daar ruim onder) en bewust naar boven afgerond: een plafond dat iets te
 * vroeg dichtgaat is vervelend, één die te laat dichtgaat is precies het gat waarvoor hij
 * bestaat. Gerekend met het sterke catalogusmodel; echte accounts zijn groter dan de demo,
 * ook daarom de ruime kant.
 */
export function schatSopRunKosten(cadans: "monthly" | "weekly" | "biweekly"): number {
  const TOKENS: Record<typeof cadans, { prompt: number; completion: number }> = {
    monthly: { prompt: 120_000, completion: 40_000 },
    biweekly: { prompt: 60_000, completion: 20_000 },
    weekly: { prompt: 40_000, completion: 12_000 },
  };
  const t = TOKENS[cadans];
  return schatCallKosten("google/gemini-3.7-flash", t.prompt, t.completion);
}

/**
 * Het verbruik van de lopende kalendermaand uit llm_usage.
 *
 * Bij een leesfout: 0 besteed en 0 onbekend, dus het plafond blokkeert niet. Dat is de veilige
 * kant op — een database die even niet antwoordt, mag geen analyse tegenhouden — maar het is wel
 * een gat, en daarom staat het hier expliciet in plaats van in een lege catch.
 */
export async function leesMaandverbruik(
  supabase: SupabaseClient,
  nu: Date = new Date(),
  agencyId?: string | null
): Promise<{ besteed: number; onbekend: number }> {
  try {
    // ── PER BUREAU, NIET PLATFORMBREED ────────────────────────────────────────
    //
    // De eerste versie telde ALLE rijen van de maand op. Met één bureau is dat hetzelfde getal;
    // met twee bureaus betaalt het ene het plafond van het andere op, en loopt bureau A tegen een
    // blokkade aan door verbruik dat het niet gedaan heeft. Dat is geen randgeval maar de eerste
    // dag dat er een tweede klant is.
    //
    // Zonder agencyId blijft het gedrag platformbreed. Dat is met opzet: er zijn calls zonder
    // bureau (zie migratie 061), en die horen ergens tegen afgezet te worden.
    let q = supabase.from("llm_usage").select("cost_eur").gte("created_at", maandStart(nu));
    if (agencyId) q = q.eq("agency_id", agencyId);
    const { data, error } = await q;
    if (error || !data) return { besteed: 0, onbekend: 0 };
    let besteed = 0;
    let onbekend = 0;
    for (const r of data as Array<{ cost_eur: number | null }>) {
      if (r.cost_eur == null) onbekend++;
      else besteed += Number(r.cost_eur) || 0;
    }
    return { besteed: Math.round(besteed * 10000) / 10000, onbekend };
  } catch {
    return { besteed: 0, onbekend: 0 };
  }
}

/**
 * De volledige controle: lees de omgeving, lees het grootboek, en oordeel. Eén aanroep voor een
 * route die wil weten of hij mag versturen.
 */
export async function controleerPlafond(
  supabase: SupabaseClient,
  schatting: number,
  nu: Date = new Date(),
  /** Het bureau waarvoor het plafond geldt. Weglaten telt platformbreed; zie leesMaandverbruik. */
  agencyId?: string | null
): Promise<PlafondOordeel> {
  const plafond = leesPlafond();
  if (plafond == null) return { toestand: "geen_plafond", blokkeert: false };
  const { besteed, onbekend } = await leesMaandverbruik(supabase, nu, agencyId);
  return beoordeelPlafond({ plafond, besteed, onbekend, schatting });
}

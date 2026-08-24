/**
 * Enrichment matrix: determines which expert layers to apply per SOP type.
 *
 * Replaces the ad-hoc layer selection that was scattered across route handlers.
 * Each SOP type gets a consistent, configurable set of context layers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "../prompts/sop-prompts";
import {
  fetchStrategicContext,
  calculatePortfolioAnalysis,
  fetchHypothesisTracking,
  calculateLeadingIndicators,
  fetchSectorBenchmarks,
  fetchEnhancedChangeHistory,
  calculateGeoContext,
} from "./expert-layers";
import { computePmaxInsights, type PmaxInsights } from "./pmax-expert-layer";
import {
  getDimensionAvailability,
  buildAvailabilitySummary,
  type ClientDimensionProfile,
} from "./dimension-availability";
import { logger } from "@/lib/logger";

// ── Types ──────────────────────────────────────────────────────────────────

export type SopType = "monthly" | "weekly" | "biweekly";
export type EnrichmentChannel = "google_ads" | "meta_ads" | "linkedin_ads";

// ── WELKE LAGEN GELDEN VOOR WELK KANAAL ────────────────────────────────────
//
// Dit bestand heette "kanaalneutraal" omdat de matrix hieronder op CADANS is gesleuteld en niet op
// kanaal. Dat is de matrix ook -- maar de LAGEN eronder zijn dat grotendeels niet: zes van de acht
// bevragen `ads_*`-tabellen, en dat zijn Google Ads-tabellen. Ze zomaar voor Meta of LinkedIn
// aanroepen levert geen lege laag op maar een VERKEERDE: Google-data gepresenteerd als context van
// een ander kanaal.
//
// Het scherpste geval is sectorBenchmarks. Die tabel draagt "Bron: WordStream/LocaliQ/Triple Whale"
// -- Search-benchmarks. Een CTR van 1,2% is voor Meta-feed gezond en zou tegen een Search-benchmark
// als ver ondergemiddeld lezen. Erger nog: de weekly- en bi-weekly-preambule injecteren voor die
// kanalen al META_BENCHMARKS respectievelijk LINKEDIN_BENCHMARKS, dus er zouden twee elkaar
// tegensprekende benchmarkblokken in dezelfde prompt staan.
//
// Vandaar deze lijst. Een laag die hier in staat draait alleen voor Google; voor de andere kanalen
// wordt hij overgeslagen én gemeld, zodat de afwezigheid als structureel leest en niet als "er was
// niets te melden". Krimpt deze lijst, dan is er een kanaaleigen equivalent gebouwd -- dat is
// precies de bedoeling, en de plek waar hij ingeplugd hoort te worden staat hiermee vast.
const ALLEEN_GOOGLE: ReadonlySet<string> = new Set([
  "leadingIndicators",      // ads_account_weekly, ads_leading_indicators
  "sectorBenchmarks",       // benchmark_sectors is met Search-benchmarks gevuld; zie hierboven
  "changeHistory",          // ads_change_history
  "geoContext",             // ads_country_monthly, ads_country_yoy, ads_campaign_country_monthly
  "pmaxInsights",           // Performance Max is een Google-product
  "dimensionAvailability",  // ads_dimension_availability + de ads_*_monthly-tabellen
  "portfolioAnalysis",      // krijgt Google-gevormde campagnerijen aangeleverd
]);

export interface EnrichmentContext {
  strategicContext: string;
  portfolioAnalysis: string;
  hypothesisTracking: string;
  leadingIndicators: string;
  sectorBenchmarks: string;
  changeHistory: string;
  /** Summary of which analysis dimensions are available for this client */
  dimensionAvailability: string;
  /** Full dimension profile for programmatic use */
  dimensionProfile: ClientDimensionProfile | null;
  /** PMAX intelligence context */
  pmaxContext: string;
  /** Full PMAX insights for programmatic use */
  pmaxInsights: PmaxInsights | null;
  /** Geographic/country performance context */
  geoContext: string;
  /**
   * Lagen die niet opgehaald konden worden. Elke laag vangt zijn eigen fout af en laat zijn veld
   * dan op een lege string staan, en een lege string wordt in de prompt niets — waardoor een
   * mislukte laag niet te onderscheiden was van een laag die niets te melden had. Een
   * wijzigingshistorie die niet opgehaald kon worden las zo als "er is niets gewijzigd", en dat
   * is een andere conclusie dan "we hebben het niet kunnen nakijken".
   */
  failedLayers: string[];
  /**
   * Lagen die voor dit kanaal bewust NIET zijn opgehaald omdat ze op Google-tabellen leunen. Een
   * ander soort afwezigheid dan failedLayers: hier is niets misgegaan, deze laag bestaat gewoon
   * niet voor dit kanaal. Het verschil hoort in de prompt te staan, want "niet gecontroleerd" en
   * "niet van toepassing" leiden tot verschillende conclusies.
   */
  skippedLayers: string[];
}

/**
 * Which layers are enabled per SOP type.
 *
 * Monthly: all layers (full deep-dive)
 * Weekly: no portfolio or hypothesis (quick health check)
 * Biweekly: no portfolio or leading indicators (check-in against monthly)
 */
const ENRICHMENT_MATRIX: Record<SopType, {
  strategicContext: boolean;
  portfolioAnalysis: boolean;
  hypothesisTracking: boolean;
  leadingIndicators: boolean;
  sectorBenchmarks: boolean;
  changeHistory: boolean;
}> = {
  monthly: {
    strategicContext: true,
    portfolioAnalysis: true,
    hypothesisTracking: true,
    leadingIndicators: true,
    sectorBenchmarks: true,
    changeHistory: true,
  },
  weekly: {
    strategicContext: true,
    portfolioAnalysis: false,
    hypothesisTracking: false,
    leadingIndicators: true,
    sectorBenchmarks: true,
    changeHistory: true,
  },
  biweekly: {
    strategicContext: true,
    portfolioAnalysis: false,
    hypothesisTracking: true,
    leadingIndicators: false,
    sectorBenchmarks: true,
    changeHistory: true,
  },
};

// ── Builder ────────────────────────────────────────────────────────────────

interface EnrichmentOpts {
  supabase: SupabaseClient;
  clientId: string;
  accountType: AccountType;
  sopType: SopType;
  /** Het kanaal. Bepaalt welke lagen van toepassing zijn -- zie ALLEEN_GOOGLE hierboven. */
  channel?: EnrichmentChannel;
  /** Required for strategic context date filtering */
  analysisDate: string;
  /** Required for portfolio analysis — pass campaignData + campaignMetaData */
  campaignData?: Record<string, unknown>[];
  campaignMetaData?: Record<string, unknown>[];
}

/**
 * Build the enrichment context for an analysis run.
 * Only fetches layers enabled in the enrichment matrix for the given SOP type.
 * All layers run in parallel for performance.
 */
export async function buildEnrichmentContext(opts: EnrichmentOpts): Promise<EnrichmentContext> {
  const { supabase, clientId, accountType, sopType, analysisDate, campaignData, campaignMetaData } = opts;
  const channel = opts.channel ?? "google_ads";
  const matrix = ENRICHMENT_MATRIX[sopType];
  // Een laag draait als de matrix hem voor deze cadans aanzet EN hij voor dit kanaal bestaat.
  const geldt = (laag: string): boolean => channel === "google_ads" || !ALLEEN_GOOGLE.has(laag);

  const result: EnrichmentContext = {
    strategicContext: "",
    portfolioAnalysis: "",
    hypothesisTracking: "",
    leadingIndicators: "",
    sectorBenchmarks: "",
    changeHistory: "",
    dimensionAvailability: "",
    dimensionProfile: null,
    pmaxContext: "",
    pmaxInsights: null,
    geoContext: "",
    failedLayers: [],
    skippedLayers: [],
  };

  // Build array of parallel fetches based on matrix
  const tasks: Promise<void>[] = [];

  if (matrix.strategicContext) {
    tasks.push(
      fetchStrategicContext(supabase, clientId, analysisDate)
        .then((v) => { result.strategicContext = v; })
        .catch((e) => { logger.error("[enrichment] strategicContext failed:", e); result.failedLayers.push("strategicContext"); })
    );
  }

  if (geldt("portfolioAnalysis") && matrix.portfolioAnalysis && campaignData && campaignMetaData) {
    tasks.push(
      calculatePortfolioAnalysis(supabase, clientId, campaignData, campaignMetaData)
        .then((v) => { result.portfolioAnalysis = v; })
        .catch((e) => { logger.error("[enrichment] portfolioAnalysis failed:", e); result.failedLayers.push("portfolioAnalysis"); })
    );
  }

  if (matrix.hypothesisTracking) {
    tasks.push(
      fetchHypothesisTracking(supabase, clientId)
        .then((v) => { result.hypothesisTracking = v; })
        .catch((e) => { logger.error("[enrichment] hypothesisTracking failed:", e); result.failedLayers.push("hypothesisTracking"); })
    );
  }

  if (geldt("leadingIndicators") && matrix.leadingIndicators) {
    tasks.push(
      calculateLeadingIndicators(supabase, clientId)
        .then((v) => { result.leadingIndicators = v; })
        .catch((e) => { logger.error("[enrichment] leadingIndicators failed:", e); result.failedLayers.push("leadingIndicators"); })
    );
  }

  if (geldt("sectorBenchmarks") && matrix.sectorBenchmarks) {
    tasks.push(
      fetchSectorBenchmarks(supabase, accountType, clientId)
        .then((v) => { result.sectorBenchmarks = v; })
        .catch((e) => { logger.error("[enrichment] sectorBenchmarks failed:", e); result.failedLayers.push("sectorBenchmarks"); })
    );
  }

  if (geldt("changeHistory") && matrix.changeHistory) {
    tasks.push(
      fetchEnhancedChangeHistory(supabase, clientId)
        .then((v) => { result.changeHistory = v; })
        .catch((e) => { logger.error("[enrichment] changeHistory failed:", e); result.failedLayers.push("changeHistory"); })
    );
  }

  // PMAX bestaat alleen bij Google; voor de andere kanalen overslaan i.p.v. leeg laten.
  if (geldt("pmaxInsights")) tasks.push(
    computePmaxInsights(supabase, clientId)
      .then((insights) => {
        result.pmaxInsights = insights;
        result.pmaxContext = insights.promptContext;
      })
      .catch((e) => { logger.error("[enrichment] pmaxInsights failed:", e); result.failedLayers.push("pmaxInsights"); })
  );

  // Geo leest de ads_country_*-tabellen; die zijn Google.
  if (geldt("geoContext")) tasks.push(
    calculateGeoContext(supabase, clientId)
      .then((v) => { result.geoContext = v; })
      .catch((e) => { logger.error("[enrichment] geoContext failed:", e); result.failedLayers.push("geoContext"); })
  );

  // Dimensiebeschikbaarheid kijkt naar de ads_*-tabellen; ook Google.
  if (geldt("dimensionAvailability")) tasks.push(
    getDimensionAvailability(supabase, clientId)
      .then((profile) => {
        result.dimensionProfile = profile;
        result.dimensionAvailability = buildAvailabilitySummary(profile, sopType);
      })
      .catch((e) => { logger.error("[enrichment] dimensionAvailability failed:", e); result.failedLayers.push("dimensionAvailability"); })
  );

  for (const laag of ALLEEN_GOOGLE) {
    // Alleen melden wat voor deze cadans überhaupt aan zou hebben gestaan; een laag die de matrix
    // sowieso uitzet is geen kanaalbeperking en hoort de melding niet te vervuilen.
    const inMatrix = (matrix as Record<string, boolean>)[laag];
    const altijdAan = laag === "pmaxInsights" || laag === "geoContext" || laag === "dimensionAvailability";
    if (!geldt(laag) && (altijdAan || inMatrix)) result.skippedLayers.push(laag);
  }

  await Promise.all(tasks);

  // Mislukte lagen horen in de prompt te staan, niet alleen in de logs.
  //
  // De fout werd wel gelogd, maar de logregel leest niemand terwijl de analyse wel wordt gelezen.
  // Zonder deze melding kwam de uitvoer met gezag tot een conclusie die op een ontbrekende laag
  // rustte: geen wijzigingshistorie las als "er is niets gewijzigd", geen sectorbenchmarks als
  // "er valt niet te vergelijken".
  //
  // Het wordt aan dimensionAvailability geplakt omdat dat blok in stap 1 van alle drie de SOP's
  // al wordt meegestuurd. Ook als die laag zelf faalde: dan is de melding het hele blok, en juist
  // dan moet hij zichtbaar zijn.
  // Overgeslagen lagen: een ANDERE mededeling dan mislukte lagen, en dat verschil telt. "Niet
  // gecontroleerd" vraagt om voorzichtigheid; "bestaat niet voor dit kanaal" vraagt erom dat het
  // model er niet naar op zoek gaat en er ook niet over klaagt.
  if (result.skippedLayers.length > 0) {
    const melding = [
      "## Niet van toepassing op dit kanaal",
      `Deze contextlagen bestaan alleen voor Google Ads en zijn hier bewust overgeslagen: ${result.skippedLayers.join(", ")}.`,
      "Er is dus niets misgegaan. Behandel ze niet als ontbrekende data en doe er geen aanname over.",
      "De kanaaleigen benchmarks die je wél hebt, staan in de preambule hierboven.",
    ].join("\n");
    result.dimensionAvailability = result.dimensionAvailability
      ? `${result.dimensionAvailability}\n\n${melding}`
      : melding;
  }

  if (result.failedLayers.length > 0) {
    const melding = [
      "## Niet opgehaalde context",
      `De volgende lagen konden niet worden opgehaald: ${result.failedLayers.join(", ")}.`,
      "Dat betekent NIET dat daar niets te melden was, maar dat het niet gecontroleerd kon worden.",
      "Doe geen uitspraak die op deze lagen rust en benoem expliciet dat ze ontbraken.",
    ].join("\n");
    result.dimensionAvailability = result.dimensionAvailability
      ? `${result.dimensionAvailability}\n\n${melding}`
      : melding;
  }

  return result;
}

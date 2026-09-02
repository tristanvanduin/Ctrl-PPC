// Kernbegrippen voor de beslislaag. Bewust klein: alleen wat de code die dit importeert echt
// gebruikt (quality-gates, channel-provider, decision-skeleton, hypothesis-discovery,
// context-engine). Typen bouwen zonder consument is precies het patroon dat TOEGESTANE_WEZEN in
// scripts/check-hygiene.mjs bijhoudt -- gebouwd, nergens op aangesloten.

import type { SignalCategory } from "@/lib/signals/types";

export type GateStatus = "pass" | "warn" | "fail";

export interface QualityGateResult {
  gateName: string;
  status: GateStatus;
  /** Altijd false: shadow mode, geen poort blokkeert de pijplijn. */
  blocking: boolean;
  reason?: string;
  affectedEntity?: string;
  repairAttempted?: boolean;
  finalStatus: GateStatus;
}

export interface TenantScoped {
  agencyId: string;
  accountId: string;
}

/**
 * De brede kanalenlijst uit de blueprint, ruimer dan ChannelId in lib/analysis/channel-adapter.ts
 * (dat is de PROMPT-laag en kent alleen de kanalen met een sync-tabel). Zie CHANNEL_TO_ADAPTER
 * in channel-provider.ts voor de brug tussen de twee.
 */
export type Channel = "google" | "meta" | "linkedin" | "microsoft" | "tiktok_ads" | "tiktok_shop" | "shopify" | "crm" | "aicro";

export type RunType = "weekly" | "biweekly" | "monthly";

/**
 * Eén waarneming die een provider aanlevert. `category` is de categorie die de detector zelf
 * al kent (SignalStory.category in lib/signals/types.ts). Herbouw 2 september 2026: die werd
 * eerder weggegooid, waardoor classify() het enige productiesignaal (schedule_waste, categorie
 * budget_pacing) op tekst moest raden -- en dat lukte niet, want de verhaaltekst bevat geen
 * enkel trefwoord. De categorie die er al was reist nu mee.
 */
export interface Signal {
  id: string;
  channel: Channel;
  description: string;
  value?: number;
  category?: SignalCategory;
}

/**
 * Wat één provider voor één klant heeft gemeten. `null` uit collectSignals() betekent "niet
 * gemeten" (geen detector aangesloten) en is iets anders dan een lege lijst ("gemeten, niets
 * gevonden"). Dat onderscheid is de reden dat tiktok/shopify/crm géén provider hebben (zie
 * channel-provider.ts); voor meta en linkedin, die wel een provider hebben maar nog geen
 * detector, geldt sinds de herbouw dezelfde eerlijkheid via null.
 */
export interface SignaalVerzameling {
  signalen: Signal[];
  /** De datagrenzen waarop de detector echt draaide (uit de rijen zelf, niet uit de wandklok). */
  venster: { start: string | null; eind: string | null };
  /** True als de bron meer rijen had dan het plafond: de signalen zijn op een deel berekend. */
  rijenAfgekapt: boolean;
}

/** Het resultaat van channelProvider.analyze(). */
export interface ChannelAnalysisResult {
  channel: Channel;
  accountId: string;
  /** False als er geen detector is: dan zegt `signals: []` niets over het kanaal. */
  gemeten: boolean;
  signals: Signal[];
  summary?: string;
}

// Context Intelligence: alleen wat lib/context/context-types.ts en context-engine.ts echt gebruiken.

/**
 * Eén business event, gemapt uit client_settings.rai_events (de enige harde bron die vandaag
 * bestaat, zie lib/context/context-types.ts). Nooit door een AI verzonnen: dit is altijd een
 * doorvertaling van wat een gebruiker zelf heeft ingevuld in Instellingen.
 */
export interface BusinessEvent extends TenantScoped {
  id: string;
  name: string;
  cadence: "annual" | "biennial" | "custom" | null;
  editions: { date: string; label: string }[];
}

/** De contextlaag voor één klant: welke business events er lopen. */
export interface ContextAnalysis extends TenantScoped {
  businessEvents: BusinessEvent[];
}

// Hypothesis Discovery en Classification: alleen wat lib/decision/hypothesis-discovery.ts gebruikt.

/** Een mogelijke oorzaak, aangeleverd als discovery-invoer. */
export interface CandidateCause extends TenantScoped {
  id: string;
  description: string;
}

/**
 * Een hypothese. `category` is bewust een open string, geen HYPOTHESIS_CATEGORIES-lid: discovery
 * mag hypotheses opleveren die in geen enkele vaste categorie passen. classify() normaliseert dit
 * veld naar de gesloten lijst, of naar null als niets past.
 */
export interface Hypothesis extends TenantScoped {
  id: string;
  statement: string;
  category?: string | null;
}

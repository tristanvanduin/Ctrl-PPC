// Kernbegrippen voor de kwaliteitspoorten. Bewust klein: de bredere Decision Engine-typen uit
// EXECUTION_PLAN.md (Signal, Hypothesis, DecisionThread, ...) staan hier NIET, want niets in deze
// stap consumeert ze. Ze bouwen zonder consument is precies het patroon dat TOEGESTANE_WEZEN in
// scripts/check-hygiene.mjs bijhoudt -- gebouwd, nergens op aangesloten. Ze komen erbij zodra een
// route ze nodig heeft, niet vooruitlopend erop.

export type GateStatus = "pass" | "warn" | "fail";

export interface QualityGateResult {
  gateName: string;
  status: GateStatus;
  /** In Fase 1 altijd false: shadow mode, geen poort blokkeert de pijplijn. */
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

// Stap 3 (EXECUTION_PLAN.md): de Channel Provider-laag heeft deze vier nodig. Nog steeds bewust
// klein -- wat hieronder staat is precies wat lib/decision/channel-provider.ts aanroept, niet de
// volledige typenlijst uit hoofdstuk 13 van de blueprint. Signal en ChannelAnalysisResult krijgen
// hun definitieve vorm zodra de eerste echte provider ze vult; tot dan is dit het minimale
// contract dat compileert.

/**
 * De brede kanalenlijst uit de blueprint, ruimer dan ChannelId in lib/analysis/channel-adapter.ts
 * (dat is de PROMPT-laag en kent alleen de drie kanalen met een sync-tabel). Zie
 * CHANNEL_TO_ADAPTER in channel-provider.ts voor de brug tussen de twee.
 */
export type Channel = "google" | "meta" | "linkedin" | "microsoft" | "tiktok_ads" | "tiktok_shop" | "shopify" | "crm" | "aicro";

export type RunType = "weekly" | "biweekly" | "monthly";

/** Eén waarneming die een provider aanlevert. Vorm is provisorisch: firmt op zodra de eerste
 *  echte provider (Stap 3 registreert er nul) laat zien wat een gate er echt uit leest. */
export interface Signal {
  id: string;
  channel: Channel;
  description: string;
  value?: number;
}

/** Het resultaat van channelProvider.analyze(). Zelfde voorbehoud als Signal hierboven. */
export interface ChannelAnalysisResult {
  channel: Channel;
  accountId: string;
  signals: Signal[];
  summary?: string;
}

// Stap 5 (EXECUTION_PLAN.md): Context Intelligence. Zelfde regel als hierboven: alleen wat
// lib/context/context-types.ts en context-engine.ts echt gebruiken, niet de volledige
// blueprint-vorm.

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

/** De contextlaag voor één klant: welke business events er lopen. Krijgt meer velden zodra een
 *  consument ze nodig heeft (zie ContextEngine in lib/context/context-engine.ts). */
export interface ContextAnalysis extends TenantScoped {
  businessEvents: BusinessEvent[];
}

// Stap 6 (EXECUTION_PLAN.md): Hypothesis Discovery en Classification. Zelfde regel: alleen wat
// lib/decision/hypothesis-discovery.ts echt gebruikt.

/** Een mogelijke oorzaak, aangeleverd als discovery-invoer. Vorm is provisorisch, net als Signal:
 *  firmt op zodra een echte discovery-implementatie laat zien wat er echt in zit. */
export interface CandidateCause extends TenantScoped {
  id: string;
  description: string;
}

/**
 * Een hypothese. `category` is bewust een open string, geen HYPOTHESIS_CATEGORIES-lid: discovery
 * mag hypotheses opleveren die in geen enkele vaste categorie passen (zie hypothesis-discovery.ts
 * voor de reden waarom discovery en classificatie twee gescheiden stappen zijn). classify()
 * normaliseert dit veld naar de gesloten lijst, of naar null als niets past.
 */
export interface Hypothesis extends TenantScoped {
  id: string;
  statement: string;
  category?: string | null;
}

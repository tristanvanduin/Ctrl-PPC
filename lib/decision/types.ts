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

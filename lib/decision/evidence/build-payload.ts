// Master Synthesis (Pijler 6), Fase A: bundelt de twee onafhankelijke datastromen
// (channel-synthesis.ts, cross-channel-facts.ts) deterministisch tot één compact
// evidence_payload. Geen nieuwe berekening, geen herinterpretatie -- alleen samenvoegen, zodat
// Fase B (de LLM-call) precies één object krijgt in plaats van twee losse aanroepen te moeten
// combineren.

import type { ChannelSynthesis } from "./channel-synthesis";
import type { CrossChannelFacts } from "./cross-channel-facts";

export interface EvidencePayload {
  clientId: string;
  periodEnd: string;
  /** De kanalen die daadwerkelijk materiaal leverden -- de enige geldige waarden voor
   *  contributing_channels in de synthese-output (zie master-synthesis-schema.ts). */
  availableChannels: string[];
  channels: ChannelSynthesis[];
  crossChannel: CrossChannelFacts | null;
}

export function buildEvidencePayload(opts: {
  clientId: string;
  periodEnd: string;
  channels: ChannelSynthesis[];
  crossChannel: CrossChannelFacts | null;
}): EvidencePayload {
  return {
    clientId: opts.clientId,
    periodEnd: opts.periodEnd,
    availableChannels: opts.channels.map((c) => c.channel),
    channels: opts.channels,
    crossChannel: opts.crossChannel,
  };
}

/** Geen enkel kanaal en geen cross-channel-feiten: niets om te synthetiseren. */
export function isEvidencePayloadEmpty(payload: EvidencePayload): boolean {
  const geenKanalen = payload.channels.every((c) => c.recommendations.length === 0 && c.tasks.length === 0);
  const geenCrossChannel = !payload.crossChannel || payload.crossChannel.groups.every((g) => g.triggered === 0);
  return geenKanalen && geenCrossChannel;
}

// Master Synthesis, Fase A: bundelt de twee onafhankelijke datastromen (channel-synthesis.ts,
// cross-channel-facts.ts) deterministisch tot één compact evidence_payload. Geen nieuwe
// berekening, geen herinterpretatie -- alleen samenvoegen, plus de DEKKING: wanneer elk kanaal
// zijn run draaide, hoe ver die uit elkaar liggen en of ze de gevraagde periode überhaupt kunnen
// dekken. Zonder dat presenteerde de prompt een Google-run van maart naast een Meta-run van
// augustus als één periode.

import type { ChannelSynthesis } from "./channel-synthesis";
import type { CrossChannelFacts } from "./cross-channel-facts";

export interface EvidenceDekking {
  runDatums: { channel: string; analysisDate: string }[];
  nieuwsteRun: string | null;
  oudsteRun: string | null;
  spreidingDagen: number;
  /** True als de nieuwste kanaalrun op of vóór periodEnd ligt: die run kon de periode niet
   *  bevatten, de synthese gaat dan over een eerdere periode dan gevraagd. */
  verouderd: boolean;
  crossChannelDatum: string | null;
  /** Kanalen waarvan alleen de sterkste 5 aanbevelingen/taken zijn meegegeven. */
  afgekapteKanalen: string[];
}

export interface EvidencePayload {
  clientId: string;
  periodEnd: string;
  /** De kanalen die daadwerkelijk materiaal leverden -- de enige geldige waarden voor
   *  contributing_channels in de synthese-output (zie master-synthesis-schema.ts). */
  availableChannels: string[];
  channels: ChannelSynthesis[];
  crossChannel: CrossChannelFacts | null;
  dekking: EvidenceDekking;
}

// Dezelfde "spreiding tussen kanaalruns" die cross-channel-synthesis.ts als cyclus-tolerantie
// hanteert; hierboven wordt de synthese niet geblokkeerd maar wel gewaarschuwd.
export const SPREIDING_WAARSCHUWING_DAGEN = 10;

function dagenTussen(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round(Math.abs(tb - ta) / 86_400_000);
}

export function berekenDekking(channels: ChannelSynthesis[], crossChannel: CrossChannelFacts | null, periodEnd: string): EvidenceDekking {
  const runDatums = channels.map((c) => ({ channel: c.channel, analysisDate: c.analysisDate.slice(0, 10) }));
  const datums = runDatums.map((r) => r.analysisDate).filter(Boolean).sort();
  const oudsteRun = datums[0] ?? null;
  const nieuwsteRun = datums[datums.length - 1] ?? null;
  return {
    runDatums,
    nieuwsteRun,
    oudsteRun,
    spreidingDagen: oudsteRun && nieuwsteRun ? dagenTussen(oudsteRun, nieuwsteRun) : 0,
    verouderd: nieuwsteRun !== null && nieuwsteRun <= periodEnd.slice(0, 10),
    crossChannelDatum: crossChannel?.analysisDate ? crossChannel.analysisDate.slice(0, 10) : null,
    afgekapteKanalen: channels.filter((c) => c.truncated).map((c) => c.channel),
  };
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
    dekking: berekenDekking(opts.channels, opts.crossChannel, opts.periodEnd),
  };
}

/** Geen enkel kanaal en geen cross-channel-feiten: niets om te synthetiseren. */
export function isEvidencePayloadEmpty(payload: EvidencePayload): boolean {
  const geenKanalen = payload.channels.every((c) => c.recommendations.length === 0 && c.tasks.length === 0);
  const geenCrossChannel = !payload.crossChannel || payload.crossChannel.groups.every((g) => g.triggered === 0);
  return geenKanalen && geenCrossChannel;
}

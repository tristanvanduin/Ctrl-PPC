// Search Console als VERKLARENDE/VERIFIERENDE laag — spiegelt lib/ga4/context.ts qua opzet, met
// één verschil: GSC is organisch zoekgedrag en zegt daarmee het meest relevante over het
// Google Ads-kanaal (paid vs. organisch op dezelfde queries); voor Meta/LinkedIn levert het geen
// zinvolle SOP-context op en blijft de promptContext leeg (nul promptwijziging, geen valse
// koppeling).
//
// Twee dingen in dit bestand:
//  1. channelSearchConsoleContext/buildSearchConsoleContextBlock — hetzelfde patroon als GA4:
//     één call → een gelabeld promptContext-blok voor de Google Ads-SOP-prompt.
//  2. beoordeelMerkCannibalisatie — de driewegs-beslistabel uit MASTERPLAN sectie 5.6.0: Search
//     Console als ONAFHANKELIJKE bron naast de isBranded-naamgevingsheuristiek
//     (funnel-overlap.ts). Bronnen eens → hoge zekerheid; bronnen oneens → datakwaliteitssignaal,
//     geen optimalisatieclaim; te weinig GSC-bewijs → geen wijziging, de heuristiek-only-claim
//     blijft op zijn eigen, lagere zekerheid staan (nooit stilzwijgend op- of afgewaardeerd).

import { fetchGscDataset, type GscDeps } from "./data-access";
import { buildBrandCannibalizationSignals, buildPositionDropSignals } from "./signals";
import type { GscAvailability, GscDataset } from "./types";
import { mergeDetections, type DetectionResult, type SignalStory } from "@/lib/signals/types";
import type { ChannelId } from "@/lib/analysis/channel-adapter";

export interface GscContextBlock {
  availability: GscAvailability;
  promptContext: string;
  limitations: string[];
  signals: DetectionResult;
}

export async function channelSearchConsoleContext(clientId: string, channel: ChannelId, deps: GscDeps = {}): Promise<GscContextBlock> {
  const dataset = await fetchGscDataset(clientId, deps);
  return buildSearchConsoleContextBlock(dataset, channel);
}

// Puur (los te testen): dataset + kanaal → contextblok.
export function buildSearchConsoleContextBlock(dataset: GscDataset, channel: ChannelId): GscContextBlock {
  // Alleen zinvol naast Google Ads: organisch en betaald zoeken concurreren op dezelfde queries.
  if (channel !== "google_ads" || dataset.availability === "absent") {
    return { availability: dataset.availability, promptContext: "", limitations: dataset.limitations, signals: { triggered: [], checked: [] } };
  }

  const signals = mergeDetections([
    buildBrandCannibalizationSignals(dataset.rows, dataset.config?.brandTerms ?? []),
    buildPositionDropSignals(dataset.rows),
  ]);

  const lines: string[] = [];
  lines.push("## SEARCH CONSOLE-CONTEXT (organisch zoeken — verklarende laag; vervangt platformconclusies NIET)");
  lines.push("");
  const availLabel = dataset.availability === "mock" ? "DEMO/MOCK" : "LIVE";
  lines.push(`Beschikbaarheid: ${availLabel}.`);
  if (dataset.limitations.length > 0) lines.push(`Beperkingen: ${dataset.limitations.join(" ")}`);
  lines.push("");

  if (signals.triggered.length > 0) {
    for (const s of signals.triggered) lines.push(`- ${s.story}`);
  } else {
    lines.push("- Geen merk-cannibalisatie- of positie-drop-signaal binnen de geconfigureerde drempels.");
  }
  lines.push("");
  lines.push("INSTRUCTIE: gebruik dit als organisch tegenbewijs/context bij merktermen en zichtbaarheid, nooit als vervanging van de betaalde-platformcijfers.");

  return { availability: dataset.availability, promptContext: lines.join("\n"), limitations: dataset.limitations, signals };
}

// ── De driewegs-beslistabel (MASTERPLAN sectie 5.6.0) ──────────────────────────────────────────

export type MerkCannibalisatieUitkomst = "bewezen_binnen_platform" | "datakwaliteitssignaal" | "geen_wijziging";

export interface MerkCannibalisatieVerdict {
  uitkomst: MerkCannibalisatieUitkomst;
  toelichting: string;
}

/**
 * Legt het GSC-merkdominantiesignaal naast de isBranded-naamgevingsheuristiek van een campagne.
 * `gscBrandSignaal` is de (eventuele) getriggerde story uit buildBrandCannibalizationSignals — of
 * `null` als GSC onvoldoende bewijs had (geen trigger, ongeacht de reden: te weinig volume, te
 * lage positie, te weinig weekbuckets — allemaal "geen bewijs", niet "bewijs van het tegendeel").
 */
export function beoordeelMerkCannibalisatie(
  gscBrandSignaal: SignalStory | null,
  campagneIsBrandedByName: boolean
): MerkCannibalisatieVerdict {
  if (!gscBrandSignaal) {
    return {
      uitkomst: "geen_wijziging",
      toelichting: "Onvoldoende Search Console-bewijs voor de merktermen (te weinig volume, positie of weekbuckets). De naamgevings-classificatie blijft op zijn eigen, lagere zekerheid staan — afwezigheid van GSC-bewijs is geen bewijs van afwezigheid.",
    };
  }
  if (campagneIsBrandedByName) {
    return {
      uitkomst: "bewezen_binnen_platform",
      toelichting: "Search Console en de campagne-naamgeving zijn het eens: sterke, aanhoudende organische merkdominantie én een campagne die op merktermen draait. Kandidaat voor een brand-pause-test.",
    };
  }
  return {
    uitkomst: "datakwaliteitssignaal",
    toelichting: "Search Console toont sterke organische merkdominantie, maar geen enkele campagne is door de naamgeving als merkgedreven herkend. De twee bronnen spreken elkaar tegen over wat deze campagne is — controleer de campagnenaamgeving vóór je hierop budget verschuift.",
  };
}

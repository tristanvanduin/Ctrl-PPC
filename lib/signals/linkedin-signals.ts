// LinkedIn signaal-detectors (conversie + creative + pacing). Levert de losse "signaalverhalen"
// bovenop de LinkedIn-analyse, spiegelt het Google/Meta-signaal-frame in lib/signals/types.ts
// en meet UITSLUITEND op de eigen LinkedIn-metrieken. LinkedIn is B2B/leadgen: geen frequentie
// of hook-rate, maar wel lead-forms, CPL, CTR en video-completion.
//
// Vier detectors:
//   - lead-form drop-off: veel form-opens maar lage completion-rate (verspilde lead-intentie).
//   - CPL-druk: CPL stijgt materieel t.o.v. vorige periode of overschrijdt het target.
//   - betrokkenheid-zwakte: CTR ver onder de accountmediaan (relatief, geen verzonnen norm).
//   - video-drop-off: video-completion-rate ver onder de accountmediaan.

import { mergeDetections, type DetectionResult, type NotAssessable, type SignalStory } from "./types";
import { renderSignalSection, type SignalSectionResult } from "./render-section";
import { median } from "@/lib/util/stats";
import { formatPercent } from "@/lib/forecast-format";

export const FORM_COMPLETION_WEAK = 0.15; // onder 15% completion op geopende forms is zwak (heuristiek)
export const MIN_FORM_OPENS = 20;         // onder dit aantal opens is de rate ruis
export const CPL_RISE = 0.15;             // 15% CPL-stijging is materieel
export const MIN_IMPRESSIONS = 1000;
export const MIN_CLICKS = 20;
export const BENCH_FRAC = 0.6;            // onder 60% van de mediaan = zwak
export const MIN_RESULTS_CPL = 10;        // leads/conversies per venster; daaronder is een CPL-verschil toeval
export const MIN_PEERS = 3;               // minder campagnes met hetzelfde doel = geen mediaan om tegen af te zetten
export const MAX_STORIES = 3;

export interface LinkedInEntitySignalInput {
  entityUrn: string;
  name: string;                    // campagnenaam
  impressions: number;
  clicks: number;
  ctr: number | null;              // fractie
  /**
   * Het campagnedoel (objectiveType). CTR en video-voltooiing worden alleen binnen hetzelfde doel
   * vergeleken: een videocampagne is op kijkers ingekocht en hoort niet tegen de klikratio van
   * leadgeneratie te worden gelegd. Onbekend = eigen groep.
   */
  objective?: string | null;
  /** Het aantal resultaten achter cpl en prevCpl, in het recente en het vorige venster. */
  results?: number | null;
  prevResults?: number | null;
  /** Wat een "resultaat" is voor deze klant ("lead", "lead of websiteconversie"). */
  resultLabel?: string | null;
  cpl: number | null;
  formOpens: number | null;        // one_click_lead_form_opens
  formCompletionRate: number | null;
  videoCompletionRate: number | null;
  prevCtr?: number | null;
  prevCpl?: number | null;
}

export interface LinkedInSignalTargets {
  cplTarget?: number | null;
}


// ── 1. Lead-form drop-off ───────────────────────────────────────────────────────────
export function detectLinkedInFormDropOff(entities: LinkedInEntitySignalInput[]): DetectionResult {
  const checked = ["linkedin_form_dropoff"];
  const triggered: SignalStory[] = entities
    .filter((e) => (e.formOpens ?? 0) >= MIN_FORM_OPENS && e.formCompletionRate != null && e.formCompletionRate < FORM_COMPLETION_WEAK)
    .sort((a, b) => (a.formCompletionRate ?? 1) - (b.formCompletionRate ?? 1))
    .slice(0, MAX_STORIES)
    .map((e) => ({
      id: "linkedin_form_dropoff",
      category: "conversie_meting" as const,
      scope: e.name,
      story:
        `Bij "${e.name}" openen mensen het lead-formulier (${e.formOpens} keer), maar slechts ${Math.round((e.formCompletionRate ?? 0) * 100)}% maakt het af. ` +
        `De intentie is er; de wrijving zit in het formulier zelf.`,
      actionDirection: "verkort het formulier of gebruik pre-fill; elke extra veld kost afmakers, juist op LinkedIn",
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "form-opens", value: e.formOpens ?? 0 },
        { metric: "completion-rate", value: e.formCompletionRate ?? 0 },
      ],
    }));
  return { triggered, checked };
}

// ── 2. CPL-druk ─────────────────────────────────────────────────────────────────────
export function detectLinkedInCplPressure(entities: LinkedInEntitySignalInput[], targets?: LinkedInSignalTargets): DetectionResult {
  const id = "linkedin_cpl_pressure";
  const checked = [id];
  const cplTarget = Number(targets?.cplTarget ?? 0);
  const alle = entities
    .filter((e) => e.cpl != null && e.cpl > 0 && e.impressions >= MIN_IMPRESSIONS)
    .map((e) => {
      const rise = e.prevCpl != null && e.prevCpl > 0 ? (e.cpl! - e.prevCpl) / e.prevCpl : null;
      const overTarget = cplTarget > 0 ? e.cpl! > cplTarget : false;
      // Twee leads tegen een gaf "100% hoger dan de vorige periode". Bij kleine B2B-accounts is
      // dat de regel, niet de uitzondering: de stijging telt pas met volume in beide vensters,
      // het doel pas met volume in het recente.
      const nu = e.results ?? 0;
      const toen = e.prevResults ?? 0;
      const riseTelt = rise != null && rise >= CPL_RISE && nu >= MIN_RESULTS_CPL && toen >= MIN_RESULTS_CPL;
      const targetTelt = overTarget && nu >= MIN_RESULTS_CPL;
      const teDun = !riseTelt && !targetTelt && ((rise != null && rise >= CPL_RISE) || overTarget);
      return { e, rise, overTarget, riseTelt, targetTelt, teDun };
    });
  const scored = alle
    .filter((s) => s.riseTelt || s.targetTelt)
    .sort((x, y) => (y.rise ?? 0) - (x.rise ?? 0))
    .slice(0, MAX_STORIES);
  const dun = alle.filter((s) => s.teDun);
  const notAssessable: NotAssessable[] = dun.length > 0
    ? [{
        id,
        reason:
          `te weinig volume om een CPL-verschil te beoordelen bij ${dun.map((s) => `"${s.e.name}" (${s.e.results ?? 0} tegen ${s.e.prevResults ?? 0} resultaten)`).join(", ")}; ` +
          `onder ${MIN_RESULTS_CPL} per venster van 28 dagen is het verschil niet van toeval te onderscheiden.`,
      }]
    : [];

  const triggered: SignalStory[] = scored.map(({ e, rise, overTarget, riseTelt }) => ({
    id: "linkedin_cpl_pressure",
    category: "budget_pacing" as const,
    scope: e.name,
    story:
      `De kosten per ${e.resultLabel ?? "lead"} van "${e.name}" zijn €${(e.cpl ?? 0).toFixed(2)}` +
      (riseTelt ? `, ${Math.round((rise ?? 0) * 100)}% hoger dan de vorige periode (${e.results} tegen ${e.prevResults} resultaten)` : "") +
      (overTarget ? `, boven het CPL-target van €${cplTarget.toFixed(2)}` : "") +
      `. ${e.resultLabel ? "De resultaten" : "De leads"} worden duurder ingekocht.`,
    actionDirection: overTarget
      ? "toets targeting en bod: een te brede of te dure doelgroep drijft de CPL; scherp de ICP aan"
      : "kijk of de stijging door meer concurrentie of een zwakkere creative komt voordat je het bod aanpast",
    certainty: overTarget ? "bewezen_binnen_platform" as const : "indicatie" as const,
    evidence: [
      { metric: "CPL", value: Math.round((e.cpl ?? 0) * 100) / 100, prev: e.prevCpl ?? null },
      { metric: "CPL-target", value: cplTarget > 0 ? cplTarget : "geen" },
      { metric: "resultaten", value: e.results ?? 0, prev: e.prevResults ?? null },
    ],
  }));
  return { triggered, checked, ...(notAssessable.length > 0 ? { notAssessable } : {}) };
}

// Campagnes per doel. Onbekend doel is een eigen groep: wie geen doel meegeeft krijgt de oude
// vergelijking over alles, wie het wel meegeeft vergelijkt nooit meer over doelen heen.
function perDoel<E extends { objective?: string | null }>(entities: E[]): E[][] {
  const groepen = new Map<string, E[]>();
  for (const e of entities) {
    const k = (e.objective ?? "").trim().toUpperCase() || "ONBEKEND";
    groepen.set(k, [...(groepen.get(k) ?? []), e]);
  }
  return [...groepen.values()];
}

// ── 3. Betrokkenheid-zwakte (CTR relatief aan de accountmediaan) ────────────────────
export function detectLinkedInEngagementWeakness(entities: LinkedInEntitySignalInput[]): DetectionResult {
  const checked = ["linkedin_engagement_weakness"];
  const eligible = entities.filter((e) => e.impressions >= MIN_IMPRESSIONS && e.clicks >= MIN_CLICKS && e.ctr != null);
  // Per doel: "GreenTech Productvideo" (video-views, CTR 0,40%) kreeg het oordeel dat de
  // boodschap niet resoneert op grond van de mediaan van leadgeneratie-campagnes (1,36%). Een
  // videocampagne stuurt niet op klikken. Onder MIN_PEERS vergelijkbare campagnes is er geen
  // mediaan die iets zegt, en blijft de detector voor dat doel stil.
  const zwak = perDoel(eligible).flatMap((groep) => {
    if (groep.length < MIN_PEERS) return [];
    const med = median(groep.map((e) => e.ctr!));
    if (med == null || med <= 0) return [];
    return groep.filter((e) => e.ctr! < med * BENCH_FRAC).map((e) => ({ e, medCtr: med, peers: groep.length }));
  });

  const triggered: SignalStory[] = zwak
    .sort((a, b) => b.e.impressions - a.e.impressions)
    .slice(0, MAX_STORIES)
    .map(({ e, medCtr, peers }) => ({
      id: "linkedin_engagement_weakness",
      category: "creative" as const,
      scope: e.name,
      story:
        `De CTR van "${e.name}" (${formatPercent(e.ctr ?? 0, 2)}) ligt ver onder de mediaan van de ${peers} campagnes met hetzelfde doel (${formatPercent(medCtr, 2)}). ` +
        `De boodschap resoneert niet met deze doelgroep.`,
      actionDirection: "herzie de hook en het aanbod; op LinkedIn werkt een scherpe, functie-specifieke boodschap beter dan een generieke",
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "CTR", value: Math.round((e.ctr ?? 0) * 10000) / 100 },
        { metric: "mediaan CTR, zelfde doel", value: Math.round(medCtr * 10000) / 100 },
      ],
    }));
  return { triggered, checked };
}

// ── 4. Video-drop-off (completion relatief aan de accountmediaan) ───────────────────
export function detectLinkedInVideoDropOff(entities: LinkedInEntitySignalInput[]): DetectionResult {
  const checked = ["linkedin_video_dropoff"];
  const eligible = entities.filter((e) => e.impressions >= MIN_IMPRESSIONS && e.videoCompletionRate != null);
  const medVc = median(eligible.map((e) => e.videoCompletionRate!).filter((v): v is number => v != null));
  if (medVc == null || medVc <= 0) return { triggered: [], checked };

  const triggered: SignalStory[] = eligible
    .filter((e) => e.videoCompletionRate! < medVc * BENCH_FRAC)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_STORIES)
    .map((e) => ({
      id: "linkedin_video_dropoff",
      category: "creative" as const,
      scope: e.name,
      story:
        `De video van "${e.name}" wordt door weinig kijkers afgemaakt (completion-rate ${formatPercent(e.videoCompletionRate ?? 0, 0)}, ver onder de accountmediaan). ` +
        `De kern van de boodschap bereikt bijna niemand.`,
      actionDirection: "kort de video in of zet de kernboodschap vooraan; op LinkedIn kijkt men zelden een lange video uit",
      certainty: "bewezen_binnen_platform" as const,
      evidence: [
        { metric: "video-completion", value: Math.round((e.videoCompletionRate ?? 0) * 100) / 100 },
        { metric: "accountmediaan", value: Math.round(medVc * 100) / 100 },
      ],
    }));
  return { triggered, checked };
}

// ── Aggregator ──────────────────────────────────────────────────────────────────────
export function buildLinkedInSignals(input: { entities: LinkedInEntitySignalInput[]; targets?: LinkedInSignalTargets }): DetectionResult {
  return mergeDetections([
    detectLinkedInFormDropOff(input.entities),
    detectLinkedInCplPressure(input.entities, input.targets),
    detectLinkedInEngagementWeakness(input.entities),
    detectLinkedInVideoDropOff(input.entities),
  ]);
}

// Wiring: de merged detectie renderen tot een prompt-sectie voor de LinkedIn-analyse. Lege
// detectie geeft een lege sectie (byte-identieke prompt voor een account zonder signalen).
export function buildLinkedInSignalSection(input: { entities: LinkedInEntitySignalInput[]; targets?: LinkedInSignalTargets }): SignalSectionResult {
  return renderSignalSection(buildLinkedInSignals(input), "LinkedIn");
}

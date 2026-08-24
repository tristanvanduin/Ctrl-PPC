// Kanaal-afleiding voor de inzichten-laag. Eén plek die bepaalt bij welk kanaal een
// hypothese (sprint_hypotheses.source), een insight/aanbeveling (sop_type) of een taak
// (via zijn aanbeveling) hoort, zodat de UI-filters overal dezelfde indeling gebruiken.
// Bewuste default: alles wat niet expliciet Meta/LinkedIn/cross is, is Google — alle
// oudere bronnen (analysis, second_opinion, search_terms, SI7) zijn Google-pijplijnen.
// Puur en los getest.

export type InsightChannel = "google" | "meta" | "linkedin" | "cross";

export const CHANNEL_LABEL: Record<InsightChannel, string> = {
  google: "Google",
  meta: "Meta",
  linkedin: "LinkedIn",
  cross: "Cross-channel",
};

// Kleuraccenten per kanaal voor de badges (Tailwind-klassen).
//
// Feedback: "kleuren niet consistent" -- deze badges en de grafiekkleuren
// (lib/branding/chart-colors.ts CHANNEL_CHART_COLOR) kwamen uit twee losse, nooit op elkaar
// afgestemde systemen. LinkedIn stond hier op sky (lichtblauw), maar het dichtstbijzijnde
// gevalideerde palet-slot voor zijn grafiekkleur is aqua/teal (blauw was al aan Google
// toegewezen) -- vandaar teal in plaats van sky. Google (blauw) en Meta (indigo, dicht bij het
// palet se violet) matchten hun grafiekkleur al.
export const CHANNEL_BADGE_CLASS: Record<InsightChannel, string> = {
  google: "bg-blue-50 text-blue-700 border-blue-200",
  meta: "bg-indigo-50 text-indigo-700 border-indigo-200",
  linkedin: "bg-teal-50 text-teal-700 border-teal-200",
  cross: "bg-amber-50 text-amber-700 border-amber-200",
};

const META_KEYS = new Set(["meta_signals", "meta_briefing", "meta_creatives", "meta_monthly", "meta_funnel", "meta_kpi"]);
const LINKEDIN_KEYS = new Set(["linkedin_signals", "linkedin_monthly", "linkedin_icp", "linkedin_funnel", "linkedin_kpi"]);
const CROSS_KEYS = new Set(["cross_channel"]);

/** Kanaal van een sprint_hypotheses.source (SI2/SI7/SI8-bronnen). */
export function channelOfSource(source: string | null | undefined): InsightChannel {
  const s = (source ?? "").trim().toLowerCase();
  if (META_KEYS.has(s)) return "meta";
  if (LINKEDIN_KEYS.has(s)) return "linkedin";
  if (CROSS_KEYS.has(s)) return "cross";
  // Naast de expliciete sleutels ook de naamconventie zelf: elke bron of sop_type die met
  // `meta_` of `linkedin_` begint hoort bij dat kanaal. De lijsten hierboven waren met de hand
  // bijgehouden en liepen daardoor achter -- meta_weekly en linkedin_biweekly stonden er niet in
  // en werden dus stil als Google gelabeld. Een verkeerde badge is erger dan geen badge: hij
  // beweert iets. lib/analysis/extract-structured.ts leidt het kanaal al op precies deze manier af
  // (`sopType.startsWith("linkedin_")`), dus dit maakt één regel van twee.
  if (s.startsWith("meta_")) return "meta";
  if (s.startsWith("linkedin_")) return "linkedin";
  return "google";
}

/** Kanaal van een sop_type (sop_insights / sop_recommendations / sop_analysis_output). */
export function channelOfSopType(sopType: string | null | undefined): InsightChannel {
  // Zelfde sleutelruimte: de signaal-routes gebruiken hun bronnaam als sop_type.
  return channelOfSource(sopType);
}

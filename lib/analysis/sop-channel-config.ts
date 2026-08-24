// Gedeelde kanaal/cadans-configuratie voor de SOP's: welke sop_type-sleutel elke combinatie van
// kanaal en cadans gebruikt in sop_analysis_output, en hoe het kanaal heet in een gegenereerd
// bestand. Stond eerst alleen lokaal in components/insights/sop-trigger-buttons.tsx (de
// handmatige knoppen) -- de nightly cron (app/api/cron/trigger-sops) heeft dezelfde tabel nodig
// om te weten welke sop_type te bevragen en welk bestand te schrijven. Een tweede kopie hiervan
// is precies het soort duplicaat dat scripts/check-hygiene.mjs vangt (zie AGENTS.md, de
// median/safeDiv-les), dus verplaatst i.p.v. herhaald. De knoppen blijven functioneel identiek --
// dit is een zuivere verhuizing, geen gedragswijziging.

export type SopType = "weekly" | "biweekly" | "monthly";
export type SopChannel = "google_ads" | "meta_ads" | "linkedin_ads";

export const ALLE_SOP_TYPES: readonly SopType[] = ["weekly", "biweekly", "monthly"];
export const ALLE_SOP_CHANNELS: readonly SopChannel[] = ["google_ads", "meta_ads", "linkedin_ads"];

export const CHANNEL_CONFIG: Record<
  SopChannel,
  { types: SopType[]; sopTypeKey: Record<SopType, string>; headerLabel: string }
> = {
  google_ads: {
    types: ["weekly", "biweekly", "monthly"],
    sopTypeKey: { weekly: "weekly", biweekly: "biweekly", monthly: "monthly" },
    headerLabel: "SEA",
  },
  meta_ads: {
    types: ["weekly", "biweekly", "monthly"],
    sopTypeKey: { weekly: "meta_weekly", biweekly: "meta_biweekly", monthly: "meta_monthly" },
    headerLabel: "Meta Ads",
  },
  linkedin_ads: {
    types: ["weekly", "biweekly", "monthly"],
    sopTypeKey: { weekly: "linkedin_weekly", biweekly: "linkedin_biweekly", monthly: "linkedin_monthly" },
    headerLabel: "LinkedIn Ads",
  },
};

/**
 * De sop_type-sleutels van de MAANDanalyse, over alle kanalen heen: "monthly", "meta_monthly",
 * "linkedin_monthly".
 *
 * Bestaat omdat app/api/analysis/pdf/route.ts zijn kwaliteitspoort ophing aan de letterlijke
 * vergelijking `sopType === "monthly"`. Dat is alleen Google: een Meta- of LinkedIn-export sloeg de
 * poort dus volledig over en kon een geblokkeerde analyse alsnog als PDF opleveren. Afgeleid uit
 * CHANNEL_CONFIG en niet als losse lijst, want een vierde kanaal hoort hier vanzelf in te vallen --
 * een handgeschreven kopie loopt achter zonder dat iets het merkt.
 */
export const MONTHLY_SOP_TYPES: readonly string[] = ALLE_SOP_CHANNELS.map(
  (kanaal) => CHANNEL_CONFIG[kanaal].sopTypeKey.monthly
);

/** Of een sop_type een maandanalyse is, ongeacht kanaal. */
export function isMonthlySopType(sopType: string): boolean {
  return MONTHLY_SOP_TYPES.includes(sopType);
}

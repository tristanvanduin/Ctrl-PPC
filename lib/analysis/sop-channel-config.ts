// Gedeelde kanaal/cadans-configuratie voor de SOP's: welke sop_type-sleutel elke combinatie van
// kanaal en cadans gebruikt in sop_analysis_output, en hoe het kanaal heet in een gegenereerd
// bestand. Stond eerst alleen lokaal in components/insights/sop-trigger-buttons.tsx (de
// handmatige knoppen) -- de nightly cron (app/api/cron/trigger-sops) heeft dezelfde tabel nodig
// om te weten welke sop_type te bevragen en welk bestand te schrijven. Een tweede kopie hiervan
// is precies het soort duplicaat dat scripts/check-hygiene.mjs vangt (zie AGENTS.md, de
// median/safeDiv-les), dus verplaatst i.p.v. herhaald. De knoppen blijven functioneel identiek --
// dit is een zuivere verhuizing, geen gedragswijziging.

import { channelOfSopType, type InsightChannel } from "@/lib/insights/channel-of";

export type SopType = "weekly" | "biweekly" | "monthly";
export type SopChannel = "google_ads" | "meta_ads" | "linkedin_ads" | "microsoft_ads";

export const ALLE_SOP_TYPES: readonly SopType[] = ["weekly", "biweekly", "monthly"];
export const ALLE_SOP_CHANNELS: readonly SopChannel[] = ["google_ads", "meta_ads", "linkedin_ads", "microsoft_ads"];

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
  // Vierde kanaal (25 aug 2026). De sleutel is microsoft_ads en niet bing_ads: de beslissingslaag
  // (lib/decision/types.ts) reserveerde "microsoft" al, en dit is de officiele productnaam --
  // "Bing" is het label waaronder gebruikers hem kennen, en dat mag in UI-teksten gewoon zo heten.
  microsoft_ads: {
    types: ["weekly", "biweekly", "monthly"],
    sopTypeKey: { weekly: "microsoft_weekly", biweekly: "microsoft_biweekly", monthly: "microsoft_monthly" },
    headerLabel: "Microsoft Ads",
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

/** Van InsightChannel (de kanaalindeling van de inzichtenlaag) naar de SOP-kanaalsleutel. */
const SOP_KANAAL_VAN_INSIGHT: Partial<Record<InsightChannel, SopChannel>> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  microsoft: "microsoft_ads",
};

/**
 * Alle sop_type-sleutels van hetzelfde KANAAL als `sopType` -- de drie cadansen ervan.
 * Bijvoorbeeld: "meta_monthly" geeft ["meta_weekly", "meta_biweekly", "meta_monthly"].
 *
 * Bedoeld om taak- en voorstelhistorie binnen een kanaal te houden. De grens ligt bewust bij het
 * kanaal en niet bij de cadans: een Google-maandanalyse HOORT te zien wat de Google-weekly heeft
 * aangedragen (dat is precies de doorgeefketen uit lib/analysis/monthly-handoff.ts), maar niet
 * wat er op LinkedIn is gebeurd -- daar gelden andere ingrepen en een ander vocabulaire.
 *
 * Het kanaal komt uit channelOfSopType() en niet uit een eigen prefixregel. Die regel bestaat al
 * en een tweede kopie is precies wat scripts/check-hygiene.mjs vangt; erger nog, twee regels die
 * uiteenlopen zouden betekenen dat de UI een taak bij een ander kanaal indeelt dan de prompt.
 *
 * "cross_channel" hoort per definitie bij geen enkel kanaal en geeft een lege lijst: de aanroeper
 * leest dat als "geen kanaalfilter mogelijk" en filtert dan niet, in plaats van alles weg te
 * gooien.
 */
export function sopTypesVanZelfdeKanaal(sopType: string): string[] {
  const kanaal = SOP_KANAAL_VAN_INSIGHT[channelOfSopType(sopType)];
  if (!kanaal) return [];
  return ALLE_SOP_TYPES.map((cadans) => CHANNEL_CONFIG[kanaal].sopTypeKey[cadans]);
}

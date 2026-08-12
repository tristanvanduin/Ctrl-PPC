// Kanaal-specifieke inhoud voor buildWeeklyPrompt (fase C, 12 aug 2026). Geen parametrisatie-
// vraagstuk: Stap 2 (bleeders/verspilling) en Stap 3 (spend-anomalie-oorzaken) zijn voor Meta en
// LinkedIn inhoudelijk andere checks, niet Google's tekst met een woord vervangen. Google's
// bestaande tekst in sop-prompts.ts blijft de referentievorm qua diepte en toon.
//
// KOSTENBEWUST (expliciete eis, eigenaar, 12 aug 2026): dit draait automatisch 4x/maand per
// account. Alleen de kanaaleigen inhoud van de drie stappen verandert; de rest van de prompt
// (NUMBER_DISCIPLINE, WORLD_KNOWLEDGE_GROUNDING, urgentieniveaus, drempelwaarden, output-format,
// weekoverzicht) blijft gedeeld en ongewijzigd -- geen drie keer dezelfde scaffolding in tokens.
//
// Benchmarkcijfers (frequency-drempel, hook/hold rate) komen niet hier opnieuw voor: die staan al
// in lib/analysis/adapters/meta-ads.ts / linkedin-ads.ts (META_BENCHMARKS/LINKEDIN_BENCHMARKS,
// gebruikt door de monthly-analyse) en worden hier hergebruikt via buildWeeklyPrompt's bestaande
// benchmarks-parameter -- geen tweede plek met dezelfde getallen.

export interface WeeklyChannelContent {
  /** Welk platform/tool voor de tracking-verificatie in Stap 1. */
  trackingTool: string;
  wasteStepTitle: string;
  wasteStepDataset: string;
  wasteStepBody: string;
  spendAnomalyRootCauses: string;
}

export const META_WEEKLY: WeeklyChannelContent = {
  trackingTool: "Meta Pixel en Conversions API events in Events Manager",
  wasteStepTitle: "Ad Set & Creative Bleeders",
  wasteStepDataset: "meta_adset_daily, meta_ad_daily",
  wasteStepBody: `Identificeer bleeders op ad set- en advertentieniveau: cost > 2x gemiddelde account CPA,
0 conversies. Vlag daarnaast creative fatigue: frequency boven de benchmark-drempel (zie
Meta-benchmarks hierboven) EN hook rate dalend WoW -- dat is geen bleeder maar een winnende
creative aan het einde van zijn levensduur.

### Output format
Alleen bij bleeders:
"[URGENTIE] BLEEDER — Ad set/advertentie '[naam]' | €[cost] spend | 0 conversies |
Campagne: [naam] | Aanbeveling: [pauzeren of budget herverdelen]."

Bij creative fatigue:
"[URGENTIE] CREATIVE FATIGUE — '[naam]' | Frequency [X] (boven de drempel) |
Hook rate daalt van [X]% naar [Y]% WoW | Aanbeveling: nieuwe creative variant nodig."

Geen bleeders: "Ad set/creative check: geen bleeders of fatigue-signalen boven drempel deze week."`,
  spendAnomalyRootCauses: `a. Learning phase nog niet afgerond? (nieuwe/gewijzigde ad set heeft tijd en volume nodig)
     b. Doelgroep te smal? (interesse-/lookalike-targeting te beperkt -> verbreden)
     c. Bod- of kostenplafond te laag? (advertenties winnen de auctie niet)
     d. Creative afgekeurd of learning limited? (check delivery-status in Ads Manager)
     e. Frequency saturation binnen de doelgroep? (budget kan niet meer op zonder frequency-schade)`,
};

export const LINKEDIN_WEEKLY: WeeklyChannelContent = {
  trackingTool: "LinkedIn Insight Tag en conversietracking in Campaign Manager",
  wasteStepTitle: "Campagne & Creative Bleeders",
  wasteStepDataset: "linkedin_campaign_daily, linkedin_creative_daily",
  wasteStepBody: `Identificeer bleeders op campagne- en creativeniveau: cost > 2x gemiddelde account CPL,
0 leads. LinkedIn-volumes zijn doorgaans laag (B2B): weeg 0 leads bij weinig spend (<€50)
als "te vroeg om te beoordelen", niet als bleeder -- anders vlagt elke rustige week vals.

### Output format
Alleen bij bleeders:
"[URGENTIE] BLEEDER — Campagne/creative '[naam]' | €[cost] spend | 0 leads |
Aanbeveling: [pauzeren, targeting verbreden of bod verhogen]."

Geen bleeders: "Campagne/creative check: geen bleeders boven drempel deze week (of te weinig
volume om te beoordelen)."`,
  spendAnomalyRootCauses: `a. Doelgroep te smal? (functie/senioriteit/industrie te beperkt ingesteld -> verbreden)
     b. Bod te laag voor de B2B-auctie? (LinkedIn-CPC's liggen doorgaans hoger dan Search/Social)
     c. Objective/creative-formaat mismatch? (bijv. Text Ads bij een leadgen-doel)
     d. Dagbudget te vroeg opgebruikt? (check delivery pacing in Campaign Manager)
     e. Seizoenseffect? (B2B-budgetten dalen vaak rond december en in de zomer)`,
};

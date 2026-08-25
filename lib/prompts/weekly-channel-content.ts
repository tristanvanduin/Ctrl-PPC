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
     d. Learning limited of afgekeurde creative? Je krijgt learning_stage_info en het dagbudget per
        ad set mee -- lees de status daaruit in plaats van naar Ads Manager te verwijzen, en noem de
        ad set bij naam. LEARNING_LIMITED betekent te weinig conversies om uit de leerfase te komen;
        dat vraagt om consolideren of het conversiedoel verruimen, niet om meer budget.
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

export const MICROSOFT_WEEKLY: WeeklyChannelContent = {
  trackingTool: "UET-tag en conversiedoelen in Microsoft Advertising",
  wasteStepTitle: "Keyword & Zoekterm Bleeders",
  wasteStepDataset: "microsoft_adgroup_daily en microsoft_campaign_daily (7 dagen), microsoft_keyword_monthly (lopende maand), microsoft_breakdown_daily (network)",
  wasteStepBody: `Identificeer bleeders op ad group- en keywordniveau: cost > 2x gemiddelde account CPA,
0 conversies. VOLUMEREM: dit kanaal draait op een fractie van Google-volumes -- weeg 0 conversies
bij weinig spend (<EUR 25) als "te vroeg om te beoordelen", niet als bleeder, anders vlagt elke
rustige week vals. Vlag daarnaast Audience Network-lekkage als aparte bleeder-soort: een netwerk
dat deze week spend absorbeert zonder conversies is geen keywordprobleem maar een
plaatsingsprobleem, en de ingreep (uitsluiten of afmodulen) is een andere.

### Output format
Alleen bij bleeders:
"[URGENTIE] BLEEDER — Keyword/ad group '[naam]' | €[cost] spend | 0 conversies |
Campagne: [naam] | Aanbeveling: [negative toevoegen, bod verlagen of pauzeren]."

Bij netwerk-lekkage:
"[URGENTIE] NETWERK-LEK — Audience Network | €[cost] spend | [X] conversies |
aandeel [Y]% van weekspend | Aanbeveling: [uitsluiten of bid-modifier -X%]."

Geen bleeders: "Keyword/zoekterm check: geen bleeders boven drempel deze week (of te weinig
volume om te beoordelen)."`,
  spendAnomalyRootCauses: `a. Impressieaandeel verschoven? Je krijgt budget- en positieverlies apart mee -- die vragen
        tegengestelde ingrepen (budget: herallocatie of verhoging; positie: bod of relevantie).
     b. Audience Network-aandeel gegroeid? (stille spend-verschuiving naar native plaatsingen)
     c. Google-import ververst? Een re-import kan budgetten, biedingen of negatives overschreven
        hebben -- check import_source en leg de wijziging naast de importdatum.
     d. Biedstrategie opnieuw in de leerfase? (Smart Bidding leert hier trager: het volume is klein)
     e. Veiling zelf gekrompen of gegroeid? Bij dit volume beweegt de totale veilinggrootte mee met
        seizoen en kantooruren -- niet elke spend-dip is een accountprobleem.`,
};

// Eén opzoektabel in plaats van dezelfde ternary op vijf plekken in sop-prompts.ts. De Google-
// afwezigheid is bewust: google_ads valt op undefined terug en houdt zijn inline defaults --
// precies het oude ternary-gedrag, maar met één plek die kanalen kent in plaats van vijf.
export const WEEKLY_CHANNEL_CONTENT: Partial<Record<string, WeeklyChannelContent>> = {
  meta_ads: META_WEEKLY,
  linkedin_ads: LINKEDIN_WEEKLY,
  microsoft_ads: MICROSOFT_WEEKLY,
};

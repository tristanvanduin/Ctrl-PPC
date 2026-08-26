// De Microsoft Ads (Bing) ChannelAdapter op de gedeelde engine (C1). Definieert de Microsoft
// Monthly SOP als 6 pijlers in de F5-vorm (zelfde consolidatie als Meta en LinkedIn), maar met
// SEARCH-inhoud: dit kanaal is Google's mechanica -- keywords, zoektermen, impressieaandeel --
// op een tiende van het volume, plus drie hefbomen die nergens anders bestaan.
//
// ── WAT DIT KANAAL IS (de drie waarheden die elke pijler kleuren) ────────────
//
// 1. HET IS SEARCH. De Google-grammatica geldt: match types, negative-dekking, budget- versus
//    positieverlies in het impressieaandeel. Wie hier "creative fatigue" zoekt, zit op het
//    verkeerde kanaal.
// 2. HET IS KLEIN. 3 tot 10% van Google's volume in de EU. Week-op-week-schommelingen zijn
//    vaker ruis dan signaal; elke stellige uitspraak draagt daarom een volumegrens, en
//    percentages gaan altijd vergezeld van absolute aantallen ("+40% = 4 naar 7 conversies"
//    mag geen alarm heten).
// 3. HET HEEFT DRIE EIGEN HEFBOMEN:
//    - LinkedIn-profieltargeting: bid-modifiers op industry/company/job function, bovenop
//      search-intent. Het enige advertentiekanaal dat zoekgedrag met een B2B-profiel kruist.
//    - Import uit Google Ads: de standaardmanier waarop deze accounts draaien, en import-DRIFT
//      is de standaardfout -- verouderde negatives, biedstrategieen die niet 1-op-1 mappen,
//      budgetten die uit de pas lopen met de bron.
//    - Microsoft Audience Network: native plaatsingen die voor leadgen berucht lekken zolang
//      ze niet zijn uitgesloten of afgemoduleerd. De netwerksplitsing search/syndicated/
//      audience is hier een eigen analyse-as, geen voetnoot.
//
// Niet hier: de datalaag (lib/microsoft/analysis-data.ts en prepared-facts.ts) en de
// syncclient -- die laatste volgt pas wanneer er een Microsoft-account met API-toegang is,
// zelfde route als Meta. Dit bestand is de prompt-laag van de adapter.

import { registerAdapter, type ChannelAdapter } from "@/lib/analysis/channel-adapter";
import type { StepPurityRule } from "@/lib/analysis/step-validator";
import type { AccountType } from "@/lib/prompts/sop-prompts";

// Verplichte log-formats per pijler, in de Meta/LinkedIn-grammatica. Een pijler met meerdere
// niveaus draagt een formaat per sub-domein.
const MICROSOFT_LOG_FORMATS: Record<number, string> = {
  1: 'Log-formaat: "Het MoM verschil van X% op {doelmetric} is te verklaren door {KPI A}, {KPI B} - {KPI A} stijgt/daalt MoM met X% van {w1} naar {w2} ({absoluut a1} naar {a2}) - dit ligt wel/niet in lijn met de 13-maands trend - status: {OP SCHEMA/NIET OP SCHEMA/KRITIEK}."',
  2: 'Log-formaat campagne: "Campagne {X} draagt sterk bij aan {KPI A} - {KPI A} is X% boven/onder accountgemiddelde en steeg/daalde MoM met X% - budgetbenutting {Y}% bij biedstrategie {Z}." Log-formaat import: "Campagne {X} (import uit Google Ads) wijkt af van native: {metric} X% slechter/beter - vermoedelijke driftbron: {negatives/biedstrategie-mapping/budget} - pariteitscheck: {datum laatste import}."',
  3: 'Log-formaat keyword: "Keyword {X} ({match type}, QS {n}) is winnaar/bleeder - {KPI A} X% versus accountgemiddelde bij {clicks} kliks - aanbeveling: {bod/status/negative}." Log-formaat zoekterm: "Zoekterm {X} (via {keyword}) kost EUR {Y} bij {conversies} conversies - vervuiling: ja/nee - negative-dekking: {aanwezig/ontbreekt}."',
  4: 'Log-formaat profiel: "Segment {X} ({industry/company/function}) presteert X% boven/onder accountgemiddelde op {KPI A} bij {volume} conversies - minimumvolume gehaald: ja/nee - bid-modifier-kans: {+/-Y% of geen}." Log-formaat demografie/device: "Segment {X} ({leeftijd/geslacht/device/regio}) presteert boven/ondergemiddeld op {KPI A} - X% versus gemiddelde - desktop/mobile-aandeel {Y}%."',
  5: 'Log-formaat netwerk: "Netwerk {search/syndicated/audience} draagt {X}% van spend bij {Y}% van conversies - CPA EUR {Z} versus search EUR {W} - lek: ja/nee." Log-formaat impressieaandeel: "Campagne {X} verliest {Y}% aan budget en {Z}% aan positie - trend over {maanden}: {richting} - budget en positie vragen tegengestelde ingrepen." Log-formaat schedule: "Op {weekdag/dagdeel} is {KPI A} X% boven/onder gemiddeld - patroon zichtbaar over {periode}." Geen signaal: 1 regel "Werkwijze schedule: geen materieel weekdag- of dagdeelpatroon".',
  6: 'Log-formaat per hypothese: "Hypothese: {causale claim} - onderbouwing: {bevinding stap N} - evidence: deterministic/inferred/hypothesis - voorgestelde route: {containment/recovery/scale}."',
};

// Step-Purity Contract per pijler: wat de pijler mag duiden en wat niet.
const MICROSOFT_PURITY_CONTRACTS: Record<number, string> = {
  1: `### Step-Purity Contract
- Doel: accountstatus, KPI-keten, target-gap en trendstatus duiden, met UET-tracking-sanity
- Leidende databronnen: account-dagdata met maandaggregatie over 13 maanden, targets, benchmarks
- Mag beoordelen: account en hooguit campagne-allocatie als accountverklaring
- Primaire metrics: Conversies, Conversiewaarde, Spend, ROAS/CPA, CVR, CTR, CPC
- Mag concluderen: status, target-gap, trendrichting, waarschijnlijke bottleneck in de KPI-keten
- Mag NIET concluderen: keyword-, zoekterm-, profiel- of netwerk-root-cause als definitieve hoofdclaim`,
  2: `### Step-Purity Contract
- Doel: campagnestructuur, budgetallocatie en biedstrategieen EN import-pariteit duiden
- Leidende databronnen: campagne-dagdata, campagne-metadata (dagbudget, biedstrategie, import_source), adgroup-dagdata
- Mag beoordelen: campagne- en accountallocatie, ad groups binnen die structuur, geimporteerde versus native campagnes
- Mag concluderen: welke campagnes het accountresultaat verklaren, budgetfricties, biedregime-mismatch, import-drift met vermoedelijke driftbron
- Mag NIET concluderen: keyword- of zoekterm-root-cause als definitieve hoofdclaim (dat is pijler 3); profiel- of netwerkclaims`,
  3: `### Step-Purity Contract
- Doel: keyword-performance en match-type-mix EN zoektermvervuiling en negative-dekking duiden
- Leidende databronnen: keyword-maanddata (met quality score), zoekterm-maanddata
- Mag beoordelen: keyword, ad group en zoekterm
- Mag concluderen: winnaars en bleeders per keyword, QS-clusters, match-type-scheefgroei, vervuilende zoektermen met ontbrekende negatives, verspilde spend gekwantificeerd
- Mag NIET concluderen: profiel-, device- of netwerk-root-cause als definitieve hoofdclaim; uitspraken over segmenten onder de volumegrens niet stellig`,
  4: `### Step-Purity Contract
- Doel: LinkedIn-profieldimensies (industry/company/job function) EN demografie, device en geo duiden
- Leidende databronnen: profiel-maanddata per pivot, breakdown-dagdata (device), demografie- en geosegmenten
- Mag beoordelen: profielsegment, leeftijd, geslacht, device, regio
- Mag concluderen: boven/ondergemiddelde profielsegmenten boven de volumegrens met bid-modifier-kansen, desktop/mobile-verschillen, geo-scheefgroei
- Mag NIET concluderen: keyword- of netwerk-root-cause als definitieve hoofdclaim; segmenten onder de volumegrens niet stellig`,
  5: `### Step-Purity Contract
- Doel: netwerkverdeling (search/syndicated/audience), impressieaandeel over de tijd, en schedule-patronen duiden
- Leidende databronnen: breakdown-dagdata (network), impressieaandeel-maanddata (budget- en positieverlies), dagniveau-aggregatie
- Mag beoordelen: netwerk, impressieaandeel per campagne, weekdag/dagdeel
- Mag concluderen: Audience Network-lekkage gekwantificeerd, syndicated-kwaliteit, budget- versus positieverlies met de tegengestelde ingrepen benoemd, materiele schedule-patronen; bij geen signaal 1 regel
- Mag NIET concluderen: keyword- of profiel-root-cause als definitieve hoofdclaim`,
  6: `### Step-Purity Contract
- Doel: hypotheses en sprintplanning synthetiseren uit de voorgaande pijlers
- Leidende databronnen: alle voorgaande stap-conclusies en de canonical claim-set
- Mag beoordelen: het account-breed, als synthese
- Mag concluderen: gegronde hypotheses met evidence-niveau en routes
- Mag NIET concluderen: nieuwe cijfers verzinnen die niet uit eerdere stappen of de prepared context komen`,
};

// Kern-instructies per pijler. Een pijler met meerdere niveaus doorloopt ze binnen EEN antwoord,
// zelfde patroon als Meta/LinkedIn en Google's MONTHLY_MACRO_PORTFOLIO_INSTRUCTION.
const MICROSOFT_RAW_INSTRUCTIONS: Record<number, string> = {
  1: `## Stap 1: Account Performance
Bron: microsoft_account_daily over 13 maanden met maandaggregatie.
Werkwijze: toets de doelstellingen (CPA/ROAS-target uit client_settings). Verklaar het maand-op-maand verschil via de keten Conversiewaarde naar Conversies naar CVR naar Clicks naar CPC/Spend naar Impressions naar CTR. Zet de trend af tegen zowel 2 maanden als de 13-maands lijn. Voer een tracking-sanity uit: een abrupte CVR-breuk zonder spend- of positiewijziging wijst eerder op een UET-tag- of doelinstellingsprobleem dan op de markt. VOLUMEDISCIPLINE: dit kanaal draait op een fractie van Google-volumes; noem bij elk percentage het absolute aantal, en behandel een verschuiving onder de 10 conversies als indicatief, niet als bewezen.`,
  2: `## Stap 2: Structuur, Budget & Import (Campagne → Ad Group)

Doorloop de twee niveaus hieronder in deze volgorde, binnen ÉÉN antwoord: eerst de structuur zoals hij draait, dan de vraag of de structuur nog klopt met zijn bron.

---

### NIVEAU A — Structuur en Budget
Bron: microsoft_campaign_daily, microsoft_adgroup_daily en microsoft_campaigns (dagbudget, biedstrategie).
Werkwijze: verklaar welke campagnes het accountresultaat dragen, beoordeel budgetbenutting per campagne (vrijwel vol, structureel onderbesteed, of vol bij slechte efficiëntie -- die laatste twee vragen tegengestelde ingrepen), en toets of het biedregime past bij het campagnedoel. Ad groups binnen een campagne: benoem boven- en ondergemiddelde ad groups met absolute volumes erbij.

---

### NIVEAU B — Import-pariteit
Bron: microsoft_campaigns.import_source, vergeleken met de prestatie van native campagnes.
Werkwijze: gebruik NIVEAU A hierboven als startpunt. Voor elke campagne die uit Google Ads is geïmporteerd: wijkt de prestatie structureel af van vergelijkbare native campagnes, en zo ja, benoem de vermoedelijke driftbron -- verouderde negatives die niet zijn meegekomen, een biedstrategie die niet 1-op-1 mapt (tROAS/tCPA-vertaling), of een budget dat uit de pas loopt met de bron. Import-drift is bij dit kanaal de STANDAARDFOUT, geen randgeval: accounts worden vrijwel altijd als import geboren en daarna vergeten. Geen geïmporteerde campagnes: exact 1 zin binnen dit niveau en door.`,
  3: `## Stap 3: Keywords & Zoektermen

Doorloop de twee niveaus hieronder in deze volgorde, binnen ÉÉN antwoord: eerst de keywords waar het budget heen gaat, dan de zoektermen die dat budget werkelijk triggeren.

---

### NIVEAU A — Keyword Performance
Bron: microsoft_keyword_monthly (met match type en quality score).
Werkwijze: benoem winnaars en bleeders per keyword tegen het accountgemiddelde, met absolute kliks en conversies erbij (volumegrens!). Beoordeel de match-type-mix: broad zonder strakke negative-dekking is op dit kanaal duurder dan op Google, want het volume om automatisch bij te sturen ontbreekt. Signaleer quality-score-clusters: een groep keywords met QS onder 5 wijst op een relevantieprobleem van advertentie of landingspagina, niet van het bod.

---

### NIVEAU B — Zoektermen en Negative-dekking
Bron: microsoft_search_terms_monthly.
Werkwijze: gebruik NIVEAU A hierboven als startpunt. Kwantificeer vervuiling: zoektermen met spend maar zonder conversies, gegroepeerd op patroon, met de ontbrekende negatives benoemd. Let specifiek op geïmporteerde campagnes (NIVEAU B van stap 2): een negative-lijst die bij de import is achtergebleven, is hier zichtbaar als vervuiling die het Google-broneaccount niet heeft.`,
  4: `## Stap 4: Profiel & Doelgroep (LinkedIn-dimensies → Device)

Doorloop de twee niveaus hieronder in deze volgorde, binnen ÉÉN antwoord. NIVEAU A is wat dit kanaal uniek maakt: het enige searchkanaal met B2B-profieldimensies.

---

### NIVEAU A — LinkedIn-profieltargeting
Bron: microsoft_profile_monthly (pivot: industry, company, job function).
Werkwijze: zet elk profielsegment af tegen het accountgemiddelde op de primaire KPI, uitsluitend stellig boven de minimumvolumegrens (10 conversies per segment als vuistregel). Benoem bid-modifier-kansen expliciet: een segment dat structureel bovengemiddeld converteert verdient een positieve modifier, een structureel lek een negatieve of uitsluiting. Dit zijn bod-aanpassingen op search-intent, geen doelgroep-targeting zoals bij social -- de zoekopdracht blijft leidend.

---

### NIVEAU B — Device
Bron: microsoft_breakdown_daily (device).
Werkwijze: gebruik NIVEAU A hierboven als startpunt. Dit kanaal is desktop-zwaar (Edge/Windows-standaard, zakelijke machines): beoordeel het desktop/mobile-verschil op volume EN efficiëntie, en of de biedverdeling dat verschil volgt. Leeftijd, geslacht en geo zitten NIET in de aangeleverde data -- als een hypothese die dimensies nodig heeft, benoem dat dan expliciet als handmatige check in het platform; verzin er geen cijfers bij.`,
  5: `## Stap 5: Netwerk, Impressieaandeel & Schedule

Doorloop de drie niveaus hieronder in deze volgorde, binnen ÉÉN antwoord: eerst WAAR de vertoningen lopen, dan hoeveel veiling er wordt gemist, dan WANNEER het account anders presteert.

---

### NIVEAU A — Netwerkverdeling
Bron: microsoft_breakdown_daily (network: search, syndicated, audience).
Werkwijze: kwantificeer per netwerk het spend-aandeel tegen het conversie-aandeel. Het Microsoft Audience Network is voor leadgen berucht als stil lek: native plaatsingen die spend absorberen op search-budget. Een netwerk dat structureel meer dan 10% van spend draagt bij een CPA boven 2x het search-niveau is een lek, geen experiment. Syndicated partners: apart beoordelen, kwaliteit wisselt per partner.

---

### NIVEAU B — Impressieaandeel over de tijd
Bron: microsoft_campaign_impression_share (6 maanden, met budget- en positieverlies).
Werkwijze: gebruik NIVEAU A hierboven als context. Beoordeel per campagne de IS-ontwikkeling over de maanden -- een enkel meetpunt zegt niets. Scheid budget- van positieverlies expliciet: budget vraagt om herallocatie of verhoging, positie om bod of relevantie, en die ingrepen zijn tegengesteld.

---

### NIVEAU C — Schedule
Bron: dagniveau-aggregatie uit microsoft_account_daily (weekdagpatronen).
Werkwijze: beoordeel weekdagverschillen per KPI, met de B2B-verwachting (doordeweeks sterker dan het weekend) als referentie. Dagdeel-korrel (uren) zit NIET in de aangeleverde data; een uurschema-hypothese is een handmatige platformcheck, geen conclusie uit deze cijfers. Bij geen materieel signaal: exact 1 zin binnen dit niveau en door.`,
  6: `## Stap 6: Hypotheses en Sprintplanning
Bron: alle voorgaande stap-conclusies en de canonical claim-set.
Werkwijze: synthetiseer gegronde hypotheses met evidence-niveau en routes (containment/recovery/scale), mode-bewust. Weeg bij elke hypothese het kanaaLvolume mee: een ingreep die op Google in een week meetbaar is, heeft hier vaak een maand nodig -- zet het meetvenster er expliciet bij.`,
};

// Hecht log-format en purity-contract aan elke kern-instructie, zelfde patroon als Meta.
function withMicrosoftStepContract(step: number, instruction: string): string {
  const logFormat = MICROSOFT_LOG_FORMATS[step] || "";
  return `${instruction}\n\n${logFormat}\n\n${MICROSOFT_PURITY_CONTRACTS[step]}`;
}

const MICROSOFT_STEP_INSTRUCTIONS: Record<number, string> = Object.fromEntries(
  Object.keys(MICROSOFT_RAW_INSTRUCTIONS).map((k) => {
    const step = Number(k);
    return [step, withMicrosoftStepContract(step, MICROSOFT_RAW_INSTRUCTIONS[step])];
  })
);

// Regex die per pijler in de log-entries aanwezig moeten zijn (validator-input).
const MICROSOFT_LOG_FORMAT_SKELETONS: Record<number, RegExp[]> = {
  1: [/is te verklaren door/i, /MoM|maand op maand/i, /status:/i],
  2: [/draagt sterk bij aan|boven\/onder accountgemiddelde/i, /budgetbenutting|biedstrategie/i, /import|native|pariteit|geen ge[iï]mporteerde/i],
  3: [/winnaar|bleeder/i, /match type|QS|quality/i, /zoekterm/i, /negative/i, /vervuiling/i],
  4: [/industry|company|function|profiel/i, /minimumvolume|volume/i, /bid-modifier|modifier/i, /desktop|mobile|device/i],
  5: [/search|syndicated|audience/i, /spend/i, /impressieaandeel|budget.*positie|budgetverlies/i, /weekdag|dagdeel|geen materieel/i],
  6: [/hypothese/i, /evidence/i, /route/i],
};

// Purity-regels per pijler. Zelfde opzet als Meta: alleen note en forbiddenNarrativePatterns,
// omdat de allowedEntityTypes/allowedActionDomains-enums Google-specifiek zijn.
const MICROSOFT_PURITY_RULES: Partial<Record<number, StepPurityRule>> = {
  1: { forbiddenNarrativePatterns: [/keyword|zoekterm|profiel|industry|audience network|syndicated/i], note: "Accountstatus en KPI-keten; geen diepe oorzaakclaim over latere domeinen." },
  2: { forbiddenNarrativePatterns: [/zoektermvervuiling als hoofdoorzaak|profiel-root|audience network-root/i], note: "Structuur, budget en import-pariteit; keyword-/zoekterm-detail is pijler 3." },
  3: { forbiddenNarrativePatterns: [/audience network|syndicated|profielsegment als oorzaak/i], note: "Keywords en zoektermen; netwerk- en profielclaims horen in pijler 4 en 5." },
  4: { forbiddenNarrativePatterns: [/keyword-root|zoekterm-root|audience network als hoofdoorzaak/i], note: "Profiel, demografie, device en geo; segmenten onder de volumegrens niet stellig." },
  5: { forbiddenNarrativePatterns: [/keyword als bewezen oorzaak|profielsegment als bewezen oorzaak/i], note: "Netwerk, impressieaandeel en schedule; budget- en positieverlies gescheiden houden." },
  6: { forbiddenNarrativePatterns: [/nieuw cijfer|nieuwe metric die/i], note: "Synthese uit eerdere stappen; geen nieuwe cijfers verzinnen." },
};

// Benchmarks per accounttype, als richtwaarden. De getallen dragen de Microsoft-context:
// lagere CPC's dan Google, desktop-zwaar, klein volume, en het Audience Network als bekend lek.
export const MICROSOFT_BENCHMARKS: Record<AccountType, string> = {
  ecommerce_roas: "Microsoft Ads-benchmarks (richtwaarden, e-commerce ROAS): CPC doorgaans 20 tot 35% onder Google Search bij vergelijkbare CTR; desktop-aandeel 60 tot 75%; Audience Network-CPA zonder uitsluitingen vaak 2 tot 4x het search-niveau. Volume is een fractie van Google: stellige uitspraken vanaf ~10 conversies per segment. ROAS afmeten tegen de target uit client_settings.",
  ecommerce_cpa: "Microsoft Ads-benchmarks (richtwaarden, e-commerce CPA): CPC 20 tot 35% onder Google Search; desktop converteert doorgaans beter dan mobile op dit kanaal; Audience Network-CPA zonder uitsluitingen vaak 2 tot 4x search. CPA tegen de target; verschuivingen onder 10 conversies als indicatief behandelen.",
  leadgen_cpa: "Microsoft Ads-benchmarks (richtwaarden, leadgen CPA): CPC 20 tot 35% onder Google Search; het B2B-profiel (desktop, kantooruren, LinkedIn-dimensies) is hier het voordeel -- benut profielsegmenten boven de volumegrens voor bid-modifiers. Audience Network is voor leadgen het eerste lek om te controleren. CPA tegen de target.",
  leadgen_volume: "Microsoft Ads-benchmarks (richtwaarden, leadgen volume): volume is structureel klein (3 tot 10% van Google in de EU) -- bewaak volume versus CPA-plafond, en verwacht dat opschalen eerder tegen de veilinggrootte aanloopt dan tegen budget. Impressieaandeel-verlies aan budget is hier zeldzamer dan bij Google; positieverlies telt zwaarder.",
  hybrid: "Microsoft Ads-benchmarks (richtwaarden, hybride): CPC 20 tot 35% onder Google Search; desktop-zwaar; Audience Network-CPA zonder uitsluitingen vaak 2 tot 4x search; stellige uitspraken vanaf ~10 conversies per segment. Weeg ROAS en CPA tegen de doelstelling die in client_settings primair is.",
};

// De issue_cluster-lijst voor Microsoft (prompt-lijst): de search-clusters die Google ook kent,
// plus de drie kanaaleigen. Geen creative-clusters -- dit is search.
const MICROSOFT_ISSUE_CLUSTERS: readonly string[] = [
  "search_term_waste", "keyword_quality_gap", "search_budget_cap", "search_bidding_inflation",
  "import_drift", "audience_network_waste", "syndication_quality", "profile_targeting_opportunity",
  "device_performance_gap", "geo_allocation", "schedule_waste", "tracking_cvr_drop",
  "performance_winner", "efficiency_gain", "scaling_opportunity", "low_cvr_high_ctr",
  "volume_shortfall", "uncategorized",
];

// De entity_type-lijst voor Microsoft.
const MICROSOFT_ENTITY_TYPES: readonly string[] = [
  "account", "campaign", "adgroup", "keyword", "searchterm", "profile_segment", "network", "device", "country", "schedule",
];

// Microsoft-specifieke aliases voor canonicalisatie.
const MICROSOFT_METRIC_ALIASES: Array<[RegExp, string]> = [
  [/\b(ctr|click[- ]?through ?rate|doorklikratio)\b/i, "CTR"],
  [/\b(cpc|kosten ?per ?klik|cost ?per ?click)\b/i, "CPC"],
  [/\b(cpa|cost ?per ?(acquisition|conversion|lead))\b/i, "CPA"],
  [/\b(roas|return ?on ?ad ?spend)\b/i, "ROAS"],
  [/\b(cvr|conversie ?ratio|conversion ?rate)\b/i, "CVR"],
  [/\b(impressieaandeel|impression ?share|IS)\b/, "Impressieaandeel"],
  [/\b(quality ?score|kwaliteitsscore|QS)\b/, "Quality score"],
];

const MICROSOFT_ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/\b(zoekwoord|keyword|trefwoord)\b/i, "keyword"],
  [/\b(zoekterm|search ?term|zoekopdracht)\b/i, "searchterm"],
  [/\b(advertentiegroep|ad ?group)\b/i, "adgroup"],
  [/\b(profielsegment|industry|job ?function|linkedin[- ]?(profiel|dimensie))\b/i, "profile_segment"],
  [/\b(audience ?network|syndicated|zoekpartner|netwerk)\b/i, "network"],
];

export const microsoftAdsAdapter: ChannelAdapter = {
  channel: "microsoft_ads",
  sopTypeKey: "microsoft_monthly",
  // 6 pijlers in de F5-vorm, aaneengesloten 1..6 -- de standaard-aannames van de acceptance
  // (expectedStepNumbers, checkpointCount) volstaan, net als bij Meta en LinkedIn.
  stepCount: 6,
  expectedCheckpointCount: 1,
  benchmarks: MICROSOFT_BENCHMARKS,
  issueClusters: MICROSOFT_ISSUE_CLUSTERS,
  entityTypes: MICROSOFT_ENTITY_TYPES,
  stepInstructions: MICROSOFT_STEP_INSTRUCTIONS,
  logFormats: MICROSOFT_LOG_FORMATS,
  purityContracts: MICROSOFT_PURITY_CONTRACTS,
  logFormatSkeletons: MICROSOFT_LOG_FORMAT_SKELETONS,
  purityRules: MICROSOFT_PURITY_RULES,
  metricAliases: MICROSOFT_METRIC_ALIASES,
  entityAliases: MICROSOFT_ENTITY_ALIASES,
};

registerAdapter(microsoftAdsAdapter);

// Curated Supabase-rijen voor de demo-klant "demo-greentech", geserveerd door de mock-client
// in demo-mode. Voedt de tabs die direct uit Supabase lezen: Overzicht-aggregaties per beurs
// (ads_campaign_monthly), Inzichten (sop_*), Creative Performance / diepteanalyse
// (ads_creative_performance, RSA-assets), en de Meta/LinkedIn-views + forecasts (*_daily).
// Sinds kort ook de dimensies die de maand-SOP leest maar die geen eigen scherm hebben — week,
// ad-groep, zoekterm, YoY, apparaat, netwerk, schema, zoekwoord, doelgroep — zodat een demo-SOP
// niet halverwege op "geen data" uitkomt. Die worden afgeleid in lib/demo/google-sop-demo.ts.
//
// Bewust REALISTISCH: maandreeksen dragen groei + seizoen + lichte ruis (deterministisch, dus
// stabiel), échte conversiewaardes, en de dagseries variëren per dag (trend + weekdag + ruis).
// Geen platte, identieke maanden meer. Alle rijen: client_id = demo-greentech. Puur presentatie.

import { DEMO_GREENTECH_ID as CID } from "./greentech-mock";
import { demoGeoCountries, demoGeoStates, geoMonthlyRows, geoYoyMonthly } from "./geo-demo";
import { uspsToEnglishName } from "@/lib/geo/us-fips";
import {
  accountWeeklyRows, adgroupMonthlyRows, wastefulSearchTermRows, accountYoyRows, campaignYoyRows,
  campaignMetadataRows, devicePerformanceRows, networkPerformanceRows, adScheduleRows,
  keywordPerformanceRows, audiencePerformanceRows, geoCampaignRows, productPerformanceRows,
} from "./google-sop-demo";
import {
  PMAX_CAMPAIGN, VIDEO_CAMPAIGN, videoMetricsFor, assetGroupRows, pmaxNetworkRows,
  pmaxAssetRows, videoPlacementRows, pmaxPlacementRows, pmaxSearchCategoryRows,
} from "./pmax-video-demo";
import { OWNER_TEAM, OWNER_CLIENT } from "../branding/brand";
import { analyseOutputRows } from "./analyses-demo";
import { splitInt, splitAlong } from "./split";
import { microsoftDemoRows } from "./microsoft-demo";

type Row = Record<string, unknown>;

const dayISO = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
// In UTC, net als de serialisatie eronder. Met lokale setters kwam er in Amsterdam vlak na
// middernacht de laatste dag van de vórige maand uit ("2026-07-31" in plaats van "2026-08-01"),
// en dan leest elke groepering op month.slice(0,7) een maand te vroeg.
const monthISO = (back: number): string => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - back, 1)).toISOString().slice(0, 10);
};
const iso = () => new Date().toISOString();

// Deterministische maand-factor: groei (2%/mnd) × voorjaarsseizoen × lichte, per-reeks-unieke ruis.
function monthFactor(idxOldToNew: number, seed: number): number {
  const season = 1 + 0.22 * Math.sin(((idxOldToNew - 2) / 12) * 2 * Math.PI);
  const growth = Math.pow(1.02, idxOldToNew);
  const wobble = 1 + 0.06 * Math.sin(idxOldToNew * 1.7 + seed);
  return season * growth * wobble;
}
// Deterministische dag-factor: langzame trend × weekdag-dip in het weekend × lichte ruis.
function dayFactor(d: number, seed: number): number {
  const trend = 1 + 0.0012 * (150 - d);
  const weekday = new Date(Date.now() - d * 86_400_000).getDay();
  const weekend = weekday === 0 || weekday === 6 ? 0.72 : 1;
  const noise = 1 + 0.12 * Math.sin(d * 0.9 + seed);
  return trend * weekend * noise;
}

const N_MONTHS = 25; // twee jaar historie zodat de vorige beurs-editie een volledige curve heeft

// Recente uitgeef-versnelling (laatste dagen), zodat de spend-velocity-detector in de demo een
// tempo-afwijking vindt. `daysAgo` = 0 is vandaag.
const recentSpendBump = (daysAgo: number): number => (daysAgo < 6 ? 1.7 : 1);

// Zondag converteert structureel slechter (spend gelijk, minder conversies), zodat de
// weekday-efficiëntie-detector in de demo een dure dag vindt.
const weekdayConvPenalty = (daysAgo: number): number => (new Date(Date.now() - daysAgo * 86_400_000).getUTCDay() === 0 ? 0.4 : 1);

// ── ads_campaign_monthly: per campagne × 13 maanden (voedt o.a. het beurs/geo-clone-overzicht) ──
// Het kanaalpalet van dit account: Search, Display, Video en Performance Max — GreenTech zelf
// verkoopt niets via een productfeed, dus PMax draait hier op asset groups met tekst, beeld en
// video, gestuurd op standaanvragen. Eén uitzondering, klein en bewust: een beursorganisator die
// ook exposant-merchandise via een webshop verkoopt is een plausibele, aparte nevenstroom, geen
// omkering van het kernverhaal — toegevoegd zodat de Shopping-scorecard (lib/shopping-
// scorecard.ts) een echte demo-cel heeft in plaats van eerlijk "geen Shopping-campagnes" te tonen.
const CAMPAIGNS = [
  { id: "demo-c-grt", name: "GRT | Search | NL", type: "SEARCH", imp: 42000, clk: 2100, cost: 4200, conv: 60, aov: 130, seed: 0 },
  { id: "demo-c-gra", name: "GRA | Search | US", type: "SEARCH", imp: 30000, clk: 1400, cost: 3000, conv: 42, aov: 110, seed: 1 },
  { id: "demo-c-grn", name: "GRN | Search | Canada", type: "SEARCH", imp: 18000, clk: 900, cost: 1900, conv: 24, aov: 125, seed: 2 },
  { id: "demo-c-grn2", name: "GRN | Display | Canada", type: "DISPLAY", imp: 52000, clk: 620, cost: 850, conv: 8, aov: 125, seed: 5 },
  { id: "demo-c-brand", name: "GreenTech | Brand", type: "SEARCH", imp: 15000, clk: 1000, cost: 500, conv: 55, aov: 90, seed: 3 },
  // PMax: hoge waarde per conversie (een standaanvraag is meer waard dan een bezoekersregistratie).
  { id: PMAX_CAMPAIGN.id, name: PMAX_CAMPAIGN.name, type: "PERFORMANCE_MAX", imp: 78000, clk: 1500, cost: 3200, conv: 34, aov: 180, seed: 7 },
  // Video: awareness — veel vertoningen, weinig klikken, weinig directe conversies.
  { id: VIDEO_CAMPAIGN.id, name: VIDEO_CAMPAIGN.name, type: "VIDEO", imp: 240000, clk: 900, cost: 1800, conv: 12, aov: 110, seed: 9 },
  // Shopping: klein, merchandise-webshop naast de kern-leadgen — zie de toelichting hierboven.
  { id: "demo-c-shop", name: "GreenTech | Shopping | Merchandise", type: "SHOPPING", imp: 9000, clk: 380, cost: 420, conv: 6, aov: 45, seed: 11 },
];
const adsCampaignMonthly: Row[] = CAMPAIGNS.flatMap((c) =>
  Array.from({ length: N_MONTHS }, (_, i) => {
    const f = monthFactor(i, c.seed);
    const impressions = Math.round(c.imp * f);
    const clicks = Math.round(c.clk * f);
    const cost = Math.round(c.cost * f);
    const conversions = Math.round(c.conv * f);
    const conversionsValue = Math.round(conversions * c.aov);
  
  return {
      client_id: CID, campaign_id: c.id, campaign_name: c.name, campaign_type: c.type,
      campaign_status: "ENABLED", month: monthISO(N_MONTHS - 1 - i),
      impressions, clicks, cost, conversions, conversions_value: conversionsValue,
      ctr: impressions > 0 ? clicks / impressions : 0, avg_cpc: clicks > 0 ? cost / clicks : 0,
      conversion_rate: clicks > 0 ? conversions / clicks : 0, cost_per_conversion: conversions > 0 ? cost / conversions : 0,
      roas: cost > 0 ? conversionsValue / cost : 0,
      ...videoMetricsFor(c.type, impressions, cost),
    };
  })
);
// ads_account_monthly: maandtotalen over alle campagnes.
const adsAccountMonthly: Row[] = Array.from({ length: N_MONTHS }, (_, i) => {
  const month = monthISO(N_MONTHS - 1 - i);
  const inMonth = adsCampaignMonthly.filter((r) => r.month === month);
  const sum = (k: string) => inMonth.reduce((s, r) => s + (r[k] as number), 0);
  const cost = sum("cost"), conversions = sum("conversions"), conversionsValue = sum("conversions_value"), clicks = sum("clicks"), impressions = sum("impressions");
  return { client_id: CID, month, impressions, clicks, cost, conversions, conversions_value: conversionsValue,
    ctr: impressions > 0 ? clicks / impressions : 0, conversion_rate: clicks > 0 ? conversions / clicks : 0,
    cost_per_conversion: conversions > 0 ? cost / conversions : 0, roas: cost > 0 ? conversionsValue / cost : 0 };
});
// ── Impressieaandeel over de tijd ───────────────────────────────────────────
//
// Stond op DRIE rijen, alle drie in de lopende maand. De competitor-dimensie gold daarmee als
// "beschikbaar" (de dekkingscheck kijkt naar length > 0), maar de maand-SOP vraagt om auction
// insights OVER DE TIJD en de route haalt zes maanden op -- met een enkel meetpunt valt daar niets
// over te zeggen. Nu zes maanden per campagne.
//
// Het patroon is niet vlak, want dan was er nog steeds niets te melden: GRT loopt op van 12% naar
// 28% verlies aan budget (een campagne die geleidelijk vastloopt op zijn dagbudget), GRN blijft
// rond de 30% (structureel te krap), en Brand verliest vrijwel niets op budget maar wel wat op
// positie. Dat zijn drie verschillende conclusies, en dat is precies waar de stap voor bestaat.
const IS_CAMPAGNES = [
  { id: "demo-c-grt", naam: "GRT | Search | NL", kosten: 4200, conv: 60, isStart: 0.68, isEind: 0.55, budgetStart: 0.12, budgetEind: 0.28, rank: 0.05, dagbudget: 140, benutting: 0.97 },
  { id: "demo-c-grn", naam: "GRN | Search | Canada", kosten: 1900, conv: 24, isStart: 0.51, isEind: 0.48, budgetStart: 0.29, budgetEind: 0.31, rank: 0.08, dagbudget: 90, benutting: 0.95 },
  { id: "demo-c-brand", naam: "GreenTech | Brand", kosten: 500, conv: 55, isStart: 0.95, isEind: 0.93, budgetStart: 0.01, budgetEind: 0.01, rank: 0.03, dagbudget: 20, benutting: 0.8 },
];
const adsCampaignImpressionShare: Row[] = IS_CAMPAGNES.flatMap((c) =>
  // monthISO(5) is de oudste, monthISO(0) de lopende maand.
  Array.from({ length: 6 }, (_, i) => {
    const maandenTerug = 5 - i;
    const t = i / 5; // 0 = oudst, 1 = meest recent
    const meng = (van: number, naar: number) => Math.round((van + (naar - van) * t) * 100) / 100;
    // Kosten en conversies bewegen mee met het impressieaandeel: een campagne die meer aandeel
    // verliest, geeft ook minder uit. Anders spreekt deze tabel de campagnetabel tegen.
    const schaal = 0.85 + 0.15 * t;
    return {
      client_id: CID, campaign_id: c.id, campaign_name: c.naam, campaign_type: "SEARCH",
      month: monthISO(maandenTerug),
      cost: Math.round(c.kosten * schaal), conversions: Math.round(c.conv * schaal),
      search_impression_share: meng(c.isStart, c.isEind),
      search_budget_lost_is: meng(c.budgetStart, c.budgetEind),
      search_rank_lost_is: c.rank,
      daily_budget: c.dagbudget, budget_utilization: c.benutting,
    };
  })
);

// ── Inzichten: sop_* + sprint_hypotheses ──
const sopInsights: Row[] = [
  { id: "demo-i1", client_id: CID, sop_type: "analysis", analysis_date: dayISO(2), insight_type: "risk", title: "GRA | US — CVR gedaald", description: "GRA | Search | US — conversieratio 1,4% (was 2,1%). Oorzaak: bredere zoektermen na budgetverhoging.", severity: "high", affected_entity: "GRA | Search | US", affected_entity_type: "campaign", metric: "conversion_rate", current_value: 0.014, previous_value: 0.021, change_pct: -33, action_required: true, created_at: iso() },
  { id: "demo-i2", client_id: CID, sop_type: "analysis", analysis_date: dayISO(2), insight_type: "opportunity", title: "Brand — budgetcap", description: "GreenTech | Brand haalt target ruim en verliest 1% IS op budget; ruimte om op te schalen.", severity: "medium", affected_entity: "GreenTech | Brand", affected_entity_type: "campaign", metric: "search_impression_share", current_value: 0.93, previous_value: 0.9, change_pct: 3, action_required: true, created_at: iso() },
  { id: "demo-i3", client_id: CID, sop_type: "meta_signals", analysis_date: dayISO(3), insight_type: "trend", title: "Meta — creative fatigue", description: "Awareness EU: 3 creatives onder hun CTR-piek (−38%).", severity: "medium", affected_entity: "GRT | Awareness EU", affected_entity_type: "creative", metric: "ctr", current_value: 0.008, previous_value: 0.013, change_pct: -38, action_required: false, created_at: iso() },
  { id: "demo-i4", client_id: CID, sop_type: "linkedin_signals", analysis_date: dayISO(4), insight_type: "risk", title: "LinkedIn — lead-form drop", description: "Form-open → lead −24% over de recente 4 weken.", severity: "medium", affected_entity: "GRT | Leadgen NL", affected_entity_type: "campaign", metric: "lead_rate", current_value: 0.18, previous_value: 0.24, change_pct: -24, action_required: true, created_at: iso() },
];
const sopRecommendations: Row[] = [
  { id: "demo-r1", client_id: CID, insight_id: "demo-i1", sop_type: "analysis", analysis_date: dayISO(2), hypothesis: "Voeg negatieve zoektermen toe op GRA | US", expected_result: "CVR terug naar ~2%", measurement_metric: "conversion_rate", timeframe: "2 weken", rationale: "Brede termen na budgetverhoging verdunnen de kwaliteit.", ice_impact: 8, ice_confidence: 7, ice_ease: 8, ice_total: 74, status: "open" },
  { id: "demo-r2", client_id: CID, insight_id: "demo-i2", sop_type: "analysis", analysis_date: dayISO(2), hypothesis: "Verhoog dagbudget GreenTech | Brand met 25%", expected_result: "+18 conversies/mnd", measurement_metric: "conversions", timeframe: "1 maand", rationale: "Target ruim gehaald, verliest volume op budget.", ice_impact: 7, ice_confidence: 8, ice_ease: 9, ice_total: 78, status: "open" },
];
// Specifiek geformuleerde hypotheses (bron: signaal-detecties + import), bewust in status
// "pending": ze horen thuis in de goedkeuringswachtrij bij Bevindingen (naast inzichten en
// aanbevelingen). Pas na accepteren gaan ze naar de sprintplanning.
const sprintHypotheses: Row[] = [
  { id: "demo-h1", client_id: CID, source: "google_funnel", hypothesis: "Door negatieve zoektermen toe te voegen op GRA | Search | US (brede-match-vervuilers na de budgetverhoging) verwachten we de CVR van 1,4% terug te brengen naar ~2,0% binnen 2 weken.", expected_result: "CVR van 1,4% → ~2,0%; CPA −25%", measurement_metric: "conversion_rate", timeframe: "2 weken (meten vanaf week 30)", rationale: "Na de budgetverhoging verdunnen brede termen de kwaliteit; funnel-analyse toont de drop in de klik→conversie-fase.", ice_impact: 8, ice_confidence: 7, ice_ease: 8, ice_total: 74, status: "pending", created_at: iso() },
  { id: "demo-h2", client_id: CID, source: "meta_signals", hypothesis: "Door de 3 vermoeide creatives in GRT | Awareness EU te vervangen door 2 nieuwe hooks verwachten we de CTR terug te brengen richting de piek (0,8% → 1,2%) binnen 2 weken.", expected_result: "CTR 0,8% → ~1,2%; frequency terug onder 2,5", measurement_metric: "ctr", timeframe: "2 weken", rationale: "Creative fatigue gedetecteerd (−38% vs piek) op 3 creatives boven frequency 3.", ice_impact: 6, ice_confidence: 6, ice_ease: 7, ice_total: 61, status: "pending", created_at: iso() },
  { id: "demo-h3", client_id: CID, source: "linkedin_signals", hypothesis: "Door het lead-gen-formulier van GRT | Leadgen NL van 7 naar 4 velden te verkorten verwachten we de form-open → lead-ratio te herstellen (18% → 24%) binnen 3 weken.", expected_result: "Lead-rate 18% → ~24%; CPL −20%", measurement_metric: "one_click_leads", timeframe: "3 weken", rationale: "Form-open → lead daalde −24% over de recente 4 weken; formulierlengte is de vermoedelijke oorzaak.", ice_impact: 7, ice_confidence: 5, ice_ease: 6, ice_total: 58, status: "pending", created_at: iso() },
  { id: "demo-h4", client_id: CID, source: "sprint_import", hypothesis: "Door het dagbudget van GreenTech | Brand met 25% te verhogen verwachten we +18 conversies/maand te winnen, omdat de campagne 1% impressieaandeel op budget verliest bij een ruim gehaald target.", expected_result: "+18 conversies/mnd; IS-verlies op budget → 0%", measurement_metric: "conversions", timeframe: "1 maand", rationale: "Geïmporteerd uit de sprintplanning-CSV; Brand haalt het target ruim en verliest volume op budgetcap.", ice_impact: 7, ice_confidence: 8, ice_ease: 9, ice_total: 78, status: "pending", created_at: iso() },
];
// sprint_items ontbrak volledig, en daardoor liep de sprintpagina in de demo vast: de mock valt
// bij een onbekende tabel terug op de echte Supabase, en die is in een demo-omgeving niet
// bereikbaar. De pagina bleef dus op zijn spinner staan.
//
// De weeknummers staan relatief aan de huidige week, niet vast: het component markeert items
// ouder dan twee weken als verlopen, dus met vaste nummers zou de demo na verloop van tijd
// alleen nog verlopen taken tonen. Zo blijft er altijd een lopende, een geplande en een
// afgeronde week zichtbaar.
const HUIDIGE_WEEK = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
const sprintItems: Row[] = [
  { id: "demo-si1", client_id: CID, hypothesis_id: "demo-h1", week_number: HUIDIGE_WEEK, task: "Negatieve zoektermen toevoegen op GRA | Search | US (brede-match-vervuilers)", status: "in_progress", owner: OWNER_TEAM, owner_soort: "functie", owner_naam: "Performance marketeer", owner_user_id: null, metrics: "conversion_rate", review_timeframe: "2 weken", created_at: iso(), updated_at: iso() },
  { id: "demo-si2", client_id: CID, hypothesis_id: "demo-h2", week_number: HUIDIGE_WEEK, task: "Twee nieuwe hooks produceren voor GRT | Awareness EU", status: "todo", owner: OWNER_TEAM, owner_soort: "bedrijf", owner_naam: "Studio Noord", owner_user_id: null, metrics: "ctr", review_timeframe: "2 weken", created_at: iso(), updated_at: iso() },
  { id: "demo-si3", client_id: CID, hypothesis_id: "demo-h4", week_number: HUIDIGE_WEEK + 1, task: "Dagbudget GreenTech | Brand met 25% verhogen", status: "todo", owner: OWNER_TEAM, owner_soort: null, owner_naam: null, owner_user_id: null, metrics: "conversions", review_timeframe: "1 maand", created_at: iso(), updated_at: iso() },
  { id: "demo-si4", client_id: CID, hypothesis_id: "demo-h3", week_number: HUIDIGE_WEEK - 1, task: "Lead-gen-formulier GRT | Leadgen NL inkorten naar 4 velden", status: "done", owner: OWNER_CLIENT, owner_soort: "functie", owner_naam: "Webdeveloper", owner_user_id: null, metrics: "one_click_leads", review_timeframe: "3 weken", created_at: iso(), updated_at: iso() },
  { id: "demo-si5", client_id: CID, hypothesis_id: null, task: "Placement-uitsluitingen doorvoeren uit de video-analyse", week_number: HUIDIGE_WEEK - 1, status: "done", owner: OWNER_CLIENT, owner_soort: null, owner_naam: null, owner_user_id: null, metrics: "cost", review_timeframe: "1 week", created_at: iso(), updated_at: iso() },
];

// De drie taken dragen sinds migratie 104 hun eigen sop_type. Dat is hier niet cosmetisch: t3 is
// een META-taak, en zonder die kolom leidde components/insights/tasks-block.tsx het kanaal af uit
// de aanbeveling en viel bij het ontbreken daarvan terug op "google". Alle drie de demo-taken
// hebben geen recommendation_id, dus de Meta-taak stond met een Google-badge in de demo -- precies
// de fout die de kolom oplost, zichtbaar op het scherm dat hem hoort te laten zien.
//
// analysis_date staat er ook bij. De kolom is NOT NULL in de echte tabel en
// priorTasksVoorGrounding filtert en sorteert erop; een demo-rij zonder die waarde zou langs een
// pad lopen dat in productie niet bestaat.
const sopTasks: Row[] = [
  { id: "demo-t1", client_id: CID, sop_type: "weekly", analysis_date: dayISO(7), title: "Negatieve zoektermen toevoegen GRA | US", description: "Voeg brede-match-vervuilers toe als negative.", action_type: "negative_keywords", priority: "high", due_date: dayISO(-1), status: "open", frequency: "direct", affected_campaign: "GRA | Search | US" },
  { id: "demo-t2", client_id: CID, sop_type: "monthly", analysis_date: dayISO(14), title: "Dagbudget Brand +25%", description: "Verhoog het budget en monitor IS.", action_type: "budget", priority: "medium", due_date: dayISO(-3), status: "open", frequency: "direct", affected_campaign: "GreenTech | Brand" },
  { id: "demo-t3", client_id: CID, sop_type: "meta_weekly", analysis_date: dayISO(7), title: "Nieuwe Meta-creatives briefen", description: "Brief 3 nieuwe varianten voor Awareness EU.", action_type: "creative", priority: "medium", due_date: dayISO(4), status: "open", frequency: "direct", affected_campaign: "GRT | Awareness EU" },
];

// ── Creative: ads_creative_performance (6 mnd per ad, één fatiguet) + RSA-assets ──
const CREATIVES = [
  { ad: "demo-gcr-1", grp: "GRT Generiek", camp: "GRT | Search | NL", h: "GreenTech Amsterdam 2026 — Boek uw stand", d: "Ontmoet 12.000 tuinbouwprofessionals.", url: "https://demo.greentech-fictief.example/beurs", ctr0: 0.052, fade: 0.0 },
  { ad: "demo-gcr-2", grp: "GRT Generiek", camp: "GRT | Search | NL", h: "Tuinbouwtechniek van morgen", d: "Ontdek de innovaties op GreenTech.", url: "https://demo.greentech-fictief.example/bezoek", ctr0: 0.030, fade: 0.5 },
  { ad: "demo-gcr-3", grp: "GRA Search", camp: "GRA | Search | US", h: "GreenTech Americas — Mexico City", d: "The horticulture event for the Americas.", url: "https://demo.greentech-fictief.example/americas", ctr0: 0.047, fade: 0.1 },
  { ad: "demo-gcr-4", grp: "Brand", camp: "GreenTech | Brand", h: "GreenTech — Officiële website", d: "Alles over de beurs, tickets en exposanten.", url: "https://demo.greentech-fictief.example", ctr0: 0.067, fade: 0.0 },
];
const adsCreativePerformance: Row[] = CREATIVES.flatMap((c) =>
  Array.from({ length: 6 }, (_, k) => {
    const f = monthFactor(k + 6, c.ad.charCodeAt(9) % 5);
    const impressions = Math.round((8000 + k * 600) * (0.9 + 0.1 * Math.sin(k)));
    const ctr = c.ctr0 * (1 - c.fade * (k / 5));
    const clicks = Math.round(impressions * ctr);
    const conversions = Math.round(clicks * 0.045 * (f / monthFactor(6, 0)));
    return {
      client_id: CID, month: monthISO(5 - k), ad_id: c.ad, ad_group_name: c.grp, campaign_name: c.camp,
      ad_type: "RESPONSIVE_SEARCH_AD", headlines: [c.h, "Boek nu uw plek"], descriptions: [c.d], final_urls: [c.url],
      impressions, clicks, cost: Math.round(clicks * 1.9), conversions,
      conversions_value: Math.round(conversions * 120), ctr, conversion_rate: clicks > 0 ? conversions / clicks : 0,
    };
  })
);
const rsaAssets: Row[] = CREATIVES.flatMap((c) => [
  { client_id: CID, month: monthISO(0), ad_id: c.ad, field_type: "HEADLINE", asset_text: c.h, performance_label: c.fade > 0.3 ? "LOW" : "BEST", impressions: 9000, clicks: Math.round(9000 * c.ctr0), conversions: 12, cost: 340 },
  { client_id: CID, month: monthISO(0), ad_id: c.ad, field_type: "DESCRIPTION", asset_text: c.d, performance_label: "GOOD", impressions: 9000, clicks: Math.round(9000 * c.ctr0 * 0.9), conversions: 10, cost: 300 },
]);

// ── Meta + LinkedIn: entiteiten + dagseries (voor views, fatigue en forecast) ──
const META_ADS = [
  { id: "demo-m-hero", name: "GRT | Awareness EU — hero video", creative: "demo-mc-hero", imp: 1100, clk: 22, spend: 55, conv: 3, seed: 0, video: true },
  { id: "demo-m-life", name: "GRT | Awareness EU — lifestyle", creative: "demo-mc-life", imp: 1400, clk: 26, spend: 62, conv: 4, seed: 2 },
  { id: "demo-m-banner", name: "GRT | Retargeting — banner", creative: "demo-mc-banner", imp: 800, clk: 30, spend: 44, conv: 6, seed: 4 },
];
const metaAds: Row[] = META_ADS.map((a) => ({ client_id: CID, ad_id: a.id, name: a.name, creative_id: a.creative }));
const metaCreatives: Row[] = [
  { client_id: CID, creative_id: "demo-mc-hero", title: "GreenTech in 30 seconden", body: "Beleef de sfeer van de beurs.", thumbnail_url: "https://picsum.photos/seed/greentech-hero/320/200", format: "video", call_to_action_type: "LEARN_MORE", link_url: "https://demo.greentech-fictief.example" },
  { client_id: CID, creative_id: "demo-mc-life", title: "Innovatie in de kas", body: "Lifestyle-beeld met een teler.", thumbnail_url: "https://picsum.photos/seed/greentech-life/320/200", format: "single_image", call_to_action_type: "SIGN_UP", link_url: "https://demo.greentech-fictief.example/bezoek" },
  { client_id: CID, creative_id: "demo-mc-banner", title: "Boek uw stand", body: "Statische banner met CTA.", thumbnail_url: "https://picsum.photos/seed/greentech-banner/320/200", format: "single_image", call_to_action_type: "BOOK_TRAVEL", link_url: "https://demo.greentech-fictief.example/beurs" },
];
// ── De videokolommen op advertentieniveau ───────────────────────────────────
//
// meta_ad_daily droeg alleen impressions/link_clicks/spend/conversions, en daardoor kwam pijler 3
// (Creative & Visual) eruit met hook_rate_pct 0 en hold_rate_pct null. Dat raakt meer dan die ene
// pijler: de prompt vraagt letterlijk om "de funnel-metrics (hook rate, hold rate, link CTR, CVR)"
// tegen het accountgemiddelde, META_BENCHMARKS noemt "hook rate video 25 tot 40%, hold rate 10 tot
// 20%", en de weekly-bleeder-check vraagt om "hook rate dalend WoW". Drie plekken die leunden op een
// cijfer dat de demo niet kon leveren.
//
// De formules staan in lib/meta/prepared-compute.ts en zijn hier gevolgd, niet benaderd:
//   hook_rate_pct = video_3s_views / impressions
//   hold_rate_pct = video_p100     / video_3s_views
//
// ALLEEN de hero is video (zie meta_creatives: format "video"; de andere twee zijn single_image).
// Bij de andere twee blijven de kolommen dus AFWEZIG in plaats van nul -- een statische banner heeft
// geen hook rate, en een nul zou als een gemeten nul lezen. mapMetaDailyToComputeRow gebruikt
// numOrNull, dus afwezig komt als null door en valt netjes uit de ratio's.
//
// De hook rate van de hero DAALT over de tijd, van circa 36% naar 24%: hij zakt daarmee recent
// onder de benchmarkband van 25-40%, zodat zowel de fatigue-detectie in de monthly als de
// "hook rate dalend WoW"-check in de weekly een echt signaal hebben in plaats van een vlakke lijn.
// De hold rate blijft rond 15% (midden in de 10-20%-band): het probleem zit in de hook, niet in
// het vasthouden -- dat is een scherpere casus dan alles tegelijk laten dalen.
const metaHookRate = (dagenGeleden: number): number => 0.24 + 0.12 * (dagenGeleden / 149);

const metaAdDaily: Row[] = META_ADS.flatMap((a) =>
  Array.from({ length: 150 }, (_, d) => {
    const dagenGeleden = 149 - d;
    const f = dayFactor(dagenGeleden, a.seed);
    const impressions = Math.round(a.imp * f);
    const basis: Row = {
      client_id: CID, entity_id: a.id, date: dayISO(dagenGeleden),
      impressions, link_clicks: Math.round(a.clk * f), spend: Math.round(a.spend * f),
      conversions: Math.max(0, Math.round(a.conv * f)),
    };
    if (!a.video) return basis;
    const video3s = Math.round(impressions * metaHookRate(dagenGeleden));
    return {
      ...basis,
      video_3s_views: video3s,
      // thruplay (15s of afgerond) zit tussen 3s en p100 in; p100 is het echte 100%-kijkcijfer.
      video_thruplay: Math.round(video3s * 0.34),
      video_p100: Math.round(video3s * 0.15),
    };
  })
);
// De videokolommen tellen HIER ook op: het account is de som van zijn advertenties, en dat is de
// regel die de rest van deze demo ook volgt. Zonder deze sommen kwam het accountgemiddelde uit op
// hook_rate_pct 0 -- en dat leest als een GEMETEN nul, terwijl het "geen videodata" betekende. Een
// advertentie afzetten tegen een benchmark van nul maakt elke video oneindig bovengemiddeld.
//
// Het accountcijfer valt lager uit dan dat van de hero zelf (circa 8% tegen 25%), en dat hoort zo:
// maar een deel van de impressies is video, en Meta's accountrapportage wordt op precies dezelfde
// manier verdund door statische plaatsingen.
const metaDayAgg = (day: number) => META_ADS.reduce((s, a) => {
  const f = dayFactor(day, a.seed);
  const imp = Math.round(a.imp * f);
  s.impressions += imp; s.link_clicks += Math.round(a.clk * f);
  s.spend += Math.round(a.spend * f); s.conversions += Math.max(0, Math.round(a.conv * f));
  if (a.video) {
    const v3 = Math.round(imp * metaHookRate(day));
    s.video_3s_views += v3;
    s.video_thruplay += Math.round(v3 * 0.34);
    s.video_p100 += Math.round(v3 * 0.15);
  }
  return s;
}, { impressions: 0, link_clicks: 0, spend: 0, conversions: 0, video_3s_views: 0, video_thruplay: 0, video_p100: 0 });
// Meta raakt in de demo geleidelijk verzadigd: bereik wordt duurder (meer spend per vertoning)
// terwijl de advertentie minder aanslaat (minder klikken per vertoning). Dat is precies de
// signatuur waar de CPM/verzadigingsdetector op let — zonder zo'n verloop zou die kaart in de
// demo nooit iets tonen. Bewust alleen op Meta: Google en LinkedIn blijven vlak, zodat het
// contrast zichtbaar is en de detector laat zien dat hij per kanaal oordeelt.
// daysAgo loopt van 149 (oudst) naar 0 (recentst), dus het effect neemt toe naarmate het recenter is.
const metaSaturationSpend = (daysAgo: number): number => 1 + 0.65 * (1 - daysAgo / 150);
const metaSaturationClicks = (daysAgo: number): number => 1 - 0.35 * (1 - daysAgo / 150);

// Bij dat verzadigingsverloop hoort een oplopende frequency: hetzelfde publiek ziet de advertentie
// steeds vaker. Dat is de scherpste en vroegste indicatie dat een publiek opraakt — en de reden dat
// de detector die apart behandelt. Reach volgt eruit (impressies / frequency), zodat de twee
// consistent blijven in plaats van los van elkaar verzonnen.
const metaFrequency = (daysAgo: number): number => 1.8 + 1.4 * (1 - daysAgo / 150);

// Gemiddelde orderwaarde op accountniveau -- zelfde reden als META_CAMPAIGN_AOV verderop:
// conversion_value ontbrak hier volledig, dus Omzet/ROAS op de Meta-tab toonde altijd €0/0,00x.
// Gemikt op zo'n 2x ROAS bij de account-brede CPA (~€14) -- een B2B-beurscampagne op Meta is geen
// e-commerce, dus geen 5-10x. Eerste poging (AOV 130) gaf ~9x: los van de CPA gekozen in plaats
// van ervan afgeleid.
const META_ACCOUNT_AOV = 30;
const metaAccountDailyRecent: Row[] = Array.from({ length: 150 }, (_, d) => {
  const day = 149 - d; const a = metaDayAgg(day);
  const conv = a.conversions * weekdayConvPenalty(day);
  const frequency = metaFrequency(day);
  // leads:0, niet leads:conv -- sumSelectedConversions() (lib/analysis/channel-conversion-config.ts)
  // telt voor meta_ads standaard conversions+leads op; dezelfde waarde in allebei de velden
  // verdubbelde zo elke Meta-conversie in elke consument die de standaardselectie gebruikt
  // (ChannelPerformance vandaag al, en de kanaalafhankelijke KPI-rij die dit ontdekte).
  return { client_id: CID, date: dayISO(day), impressions: a.impressions, reach: Math.round(a.impressions / frequency), frequency: Math.round(frequency * 100) / 100, link_clicks: Math.round(a.link_clicks * metaSaturationClicks(day)), spend: Math.round(a.spend * recentSpendBump(day) * metaSaturationSpend(day)), conversions: conv, leads: 0, video_3s_views: a.video_3s_views, video_thruplay: a.video_thruplay, video_p100: a.video_p100, conversion_value: Math.round(conv * META_ACCOUNT_AOV) };
});
// Oudere geschiedenis (dag 150 t/m 729, ~19 maanden extra vóór het gedetailleerde venster
// hierboven): vlak/licht groeiend, GEEN verzadigings-/frequency-drama (metaSaturationSpend/Clicks
// en metaFrequency zijn bewust een RECENT verhaal -- buiten hun 0..150-domein gaan ze negatief).
// Zonder dit blok bestond Meta in de mock maar 150 dagen, terwijl Google twee jaar teruggaat: een
// kanaalafhankelijke blended vergelijking (lib/use-channel-period-data.ts) over "vorig jaar" zag
// Meta dan alleen in de huidige periode verschijnen en niet in de vergelijkingsperiode -- geen
// eerlijke YoY-delta maar een vertekende sprong doordat het kanaal "net was aangesloten". Verankerd
// op metaDayAgg(150), de dag net vóór het gedetailleerde venster, zodat er geen zichtbare sprong
// ontstaat op de naad.
const metaAccountDailyOlder: Row[] = Array.from({ length: 580 }, (_, i) => {
  const day = 729 - i; // 729 (oudst) .. 150 (grens met het gedetailleerde venster)
  const anchor = metaDayAgg(150);
  const groei = Math.pow(1 / 1.12, day / 365); // verder terug = iets lager, zelfde richting als de rest van het account (2024 < 2025 < 2026)
  const impressions = Math.round(anchor.impressions * groei);
  const frequency = 2.2; // vlak: geen verzadigingsverhaal in de oudere geschiedenis
  const conversions = Math.round(anchor.conversions * groei * weekdayConvPenalty(day));
  return {
    client_id: CID, date: dayISO(day), impressions, reach: Math.round(impressions / frequency), frequency,
    link_clicks: Math.round(anchor.link_clicks * groei), spend: Math.round(anchor.spend * groei),
    conversions, leads: 0, conversion_value: Math.round(conversions * META_ACCOUNT_AOV),
  };
});
const metaAccountDaily: Row[] = [...metaAccountDailyOlder, ...metaAccountDailyRecent];
// meta_campaigns + meta_campaign_daily voeden de ChannelPerformance-view (KPI's, maand-/campagnetabel).
// `objective` per campagne: zonder dit veld valt lib/meta/campaign-types.ts's detectMetaObjective
// terug op naamdetectie, en "Prospecting breed"/"Retargeting NL" matchen geen van de herkende
// trefwoorden (awareness/traffic/engagement/lead/app/sales) -- dan zou de objective-uitsplitsing
// op de Campagnes-tab (feedback punt 29+31) in demo-modus bijna leeg blijven. Echte waarden,
// zodat de demo hetzelfde ODAX-veld gebruikt als een live account.
const META_CAMPAIGNS = [
  { id: "demo-mcamp-aw", name: "GRT | Awareness EU", objective: "OUTCOME_AWARENESS", imp: 2500, clk: 48, spend: 117, conv: 7, seed: 0 },
  { id: "demo-mcamp-rt", name: "GRT | Retargeting NL", objective: "OUTCOME_SALES", imp: 800, clk: 30, spend: 44, conv: 6, seed: 4 },
  // Dominante, slecht converterende campagne: voedt de budget-concentratie-detector.
  { id: "demo-mcamp-pro", name: "GRT | Prospecting breed", objective: "OUTCOME_LEADS", imp: 6000, clk: 55, spend: 210, conv: 3, seed: 6 },
  // Ook op de andere beurzen actief, zodat Meta binnen GRN/GRA niet leeg is.
  { id: "demo-mcamp-grn", name: "GRN | Awareness NA", objective: "OUTCOME_AWARENESS", imp: 1800, clk: 34, spend: 82, conv: 5, seed: 7 },
  { id: "demo-mcamp-gra", name: "GRA | Retargeting US", objective: "OUTCOME_SALES", imp: 1100, clk: 26, spend: 54, conv: 4, seed: 8 },
];
const metaCampaigns: Row[] = META_CAMPAIGNS.map((c) => ({ client_id: CID, campaign_id: c.id, name: c.name, objective: c.objective, status: "ACTIVE" }));
// Gemiddelde orderwaarde per campagne -- eerder ontbrak conversion_value hier volledig (altijd
// undefined -> 0), waardoor Meta's Omzet/ROAS overal €0/0,00x toonde: precies de "conversions_value:
// 0"-vondst die masterplan 17.19/17.20's cross-account-test destijds al signaleerde. Per campagne
// afgeleid van zijn EIGEN spend/conv-CPA (~2x ROAS), niet los gekozen -- anders verschilt de
// impliciete ROAS willekeurig per campagne in plaats van een bewuste beurs-/kwaliteitsvariatie.
const META_CAMPAIGN_AOV: Record<string, number> = {
  "demo-mcamp-aw": 35, "demo-mcamp-rt": 15, "demo-mcamp-pro": 140, "demo-mcamp-grn": 33, "demo-mcamp-gra": 27,
};
const metaCampaignDaily: Row[] = META_CAMPAIGNS.flatMap((c) =>
  // leads:0 -- zelfde reden als metaAccountDaily hierboven, anders verdubbelt sumSelectedConversions().
  Array.from({ length: 150 }, (_, d) => {
    const f = dayFactor(149 - d, c.seed);
    const conversions = Math.max(0, Math.round(c.conv * f));
    return { client_id: CID, entity_id: c.id, date: dayISO(149 - d), impressions: Math.round(c.imp * f), link_clicks: Math.round(c.clk * f), spend: Math.round(c.spend * f), conversions, leads: 0, conversion_value: Math.round(conversions * META_CAMPAIGN_AOV[c.id]) };
  })
);

// ── meta_adsets + meta_adset_daily ──────────────────────────────────────────
//
// Het ad set-niveau ontbrak volledig, terwijl ALLE DRIE de Meta-cadansen het lezen: de weekly voor
// de bleeder- en fatigue-check (app/api/analysis/weekly/route.ts), de bi-weekly voor stap 3
// (biweekly/route.ts) en de monthly voor pijler 2 niveau B (lib/meta/analysis-data.ts). Bij Meta is
// dit het niveau waar budget en doelgroep leven -- zonder deze twee tabellen viel juist het
// waardevolste deel van de Meta-analyse in de demo terug op "geen data", en was er dus geen manier
// om zonder live klant te laten zien dat die analyse werkt.
//
// AFGELEID, NIET VERZONNEN. De dagrijen worden uit metaCampaignDaily gesplitst met splitInt/
// splitAlong, zodat de som van de ad sets per dag en per metriek exact zijn campagne is. Dat is
// dezelfde regel als in google-sop-demo.ts: een dimensie die niet optelt tot zijn ouder is precies
// de tegenstrijdigheid waar een analist over struikelt.
//
// FREQUENCY EN REACH WORDEN NIET GESPLITST maar per ad set gezet. Frequency is geen optelbare
// grootheid (dezelfde persoon in twee ad sets telt één keer) en reach evenmin --
// scripts/migrations/037_rollups.sql legt die uitzondering al vast voor de rollups. Ze afleiden met
// splitInt zou een getal opleveren dat er echt uitziet en nergens op slaat.
//
// Elk patroon hieronder is er één die een detector in de code echt zoekt:
//  - `pro-int` is de BLEEDER: het grootste spend-aandeel van zijn campagne en structureel 0
//    conversies, ruim boven de weekly-drempel (cost > 2x account-CPA bij 0 conversies).
//  - `pro-int` en `aw-int` dragen DEZELFDE targeting_summary: het overlap-risico dat pijler 2
//    niveau B expliciet zoekt ("zelfde doelgroepomschrijving in meerdere adsets"). Dat de
//    overlappende ad set óók de bleeder is, is het verhaal dat een analist hoort te vinden.
//  - `rt-web` loopt VERZADIGING op: frequency klimt van 2,4 naar 4,3 en kruist de 3,5 uit
//    META_BENCHMARKS ergens rond twee maanden geleden.
//  - `pro-int` staat op LEARNING_LIMITED, zodat de learning-status uit pijler 2 niveau A niet leeg is.
//
// targeting_summary is bewust gevuld: de kolom bestaat in migratie 007 maar wordt door geen enkele
// syncroute geschreven (zie lib/cross-channel/funnel-overlap.ts:35-37). In de demo hoort hij wél te
// staan, anders is niet te zien dat de analyse ermee werkt zodra een sync hem levert.
//
// EENHEID VAN daily_budget: hier in hele euro's. De Meta API levert dit veld in CENTEN, maar geen
// enkele analysestap leest meta_adsets.daily_budget vandaag (de enige daily_budget-lezer in de
// codebase is app/api/analysis/impression-share/route.ts, op een Google-tabel). Zodra pijler 2's
// budgetbenutting hem wél gaat lezen, moet hier de eenheid van de echte sync worden aangehouden --
// anders staat de demo een factor honderd naast productie.
const META_ADSETS = [
  // Awareness EU -- gezonde brede basis plus een interessesegment dat overlapt met prospecting.
  { id: "demo-mas-aw-broad", campaign: "demo-mcamp-aw", name: "GRT | Awareness EU — Broad (Advantage+)",
    targeting: "Advantage+ doelgroep (breed) · EU · 25-65", goal: "REACH", budget: 80, learning: "LEARNING_COMPLETE",
    w: { imp: 70, clk: 68, spend: 65, conv: 71 }, freq: (d: number) => 1.9 + 0.4 * (1 - d / 149) },
  { id: "demo-mas-aw-int", campaign: "demo-mcamp-aw", name: "GRT | Awareness EU — Interesse: duurzame landbouw",
    targeting: "Interesse: duurzame landbouw, tuinbouw · NL, BE · 25-55", goal: "REACH", budget: 40, learning: "LEARNING_COMPLETE",
    w: { imp: 30, clk: 32, spend: 35, conv: 29 }, freq: (d: number) => 2.2 + 0.5 * (1 - d / 149) },

  // Retargeting NL -- kleine, warme doelgroep die opraakt.
  { id: "demo-mas-rt-web", campaign: "demo-mcamp-rt", name: "GRT | Retargeting NL — Websitebezoekers 30d",
    targeting: "Custom audience: websitebezoekers 30 dagen · NL", goal: "OFFSITE_CONVERSIONS", budget: 25, learning: "LEARNING_COMPLETE",
    w: { imp: 62, clk: 65, spend: 60, conv: 67 }, freq: (d: number) => 2.4 + 1.9 * (1 - d / 149) },
  { id: "demo-mas-rt-news", campaign: "demo-mcamp-rt", name: "GRT | Retargeting NL — Custom: nieuwsbriefleden",
    targeting: "Custom audience: nieuwsbrieflijst · NL", goal: "OFFSITE_CONVERSIONS", budget: 20, learning: "LEARNING_COMPLETE",
    w: { imp: 38, clk: 35, spend: 40, conv: 33 }, freq: (d: number) => 2.6 + 0.3 * (1 - d / 149) },

  // Prospecting breed -- de dominante, slecht converterende campagne, hier uitgesplitst naar de
  // lookalike die alles oplevert en het interessesegment dat alles kost.
  { id: "demo-mas-pro-lal", campaign: "demo-mcamp-pro", name: "GRT | Prospecting breed — Lookalike 1% kopers",
    targeting: "Lookalike 1% (kopers 180d) · NL, BE, DE", goal: "OFFSITE_CONVERSIONS", budget: 60, learning: "LEARNING_COMPLETE",
    w: { imp: 45, clk: 48, spend: 38, conv: 100 }, freq: (d: number) => 1.7 + 0.3 * (1 - d / 149) },
  { id: "demo-mas-pro-int", campaign: "demo-mcamp-pro", name: "GRT | Prospecting breed — Interesse: tuinbouw breed",
    targeting: "Interesse: duurzame landbouw, tuinbouw · NL, BE · 25-55", goal: "OFFSITE_CONVERSIONS", budget: 150, learning: "LEARNING_LIMITED",
    w: { imp: 55, clk: 52, spend: 62, conv: 0 }, freq: (d: number) => 2.0 + 0.4 * (1 - d / 149) },

  // De andere twee beurzen, zodat Meta binnen GRN/GRA ook op ad set-niveau niet leeg is.
  { id: "demo-mas-grn-broad", campaign: "demo-mcamp-grn", name: "GRN | Awareness NA — Broad (Advantage+)",
    targeting: "Advantage+ doelgroep (breed) · US, CA · 25-65", goal: "REACH", budget: 55, learning: "LEARNING_COMPLETE",
    w: { imp: 66, clk: 64, spend: 62, conv: 68 }, freq: (d: number) => 1.8 + 0.4 * (1 - d / 149) },
  { id: "demo-mas-grn-int", campaign: "demo-mcamp-grn", name: "GRN | Awareness NA — Interesse: agritech",
    targeting: "Interesse: agritech, precisielandbouw · US, CA · 25-55", goal: "REACH", budget: 30, learning: "LEARNING_COMPLETE",
    w: { imp: 34, clk: 36, spend: 38, conv: 32 }, freq: (d: number) => 2.1 + 0.4 * (1 - d / 149) },
  { id: "demo-mas-gra-web", campaign: "demo-mcamp-gra", name: "GRA | Retargeting US — Websitebezoekers 30d",
    targeting: "Custom audience: websitebezoekers 30 dagen · US", goal: "OFFSITE_CONVERSIONS", budget: 22, learning: "LEARNING_COMPLETE",
    w: { imp: 58, clk: 60, spend: 57, conv: 62 }, freq: (d: number) => 2.3 + 0.6 * (1 - d / 149) },
  { id: "demo-mas-gra-news", campaign: "demo-mcamp-gra", name: "GRA | Retargeting US — Custom: nieuwsbriefleden",
    targeting: "Custom audience: nieuwsbrieflijst · US", goal: "OFFSITE_CONVERSIONS", budget: 18, learning: "LEARNING_COMPLETE",
    w: { imp: 42, clk: 40, spend: 43, conv: 38 }, freq: (d: number) => 2.5 + 0.3 * (1 - d / 149) },
];

const metaAdsets: Row[] = META_ADSETS.map((a) => ({
  client_id: CID, adset_id: a.id, campaign_id: a.campaign, name: a.name,
  status: "ACTIVE", effective_status: "ACTIVE",
  optimization_goal: a.goal, billing_event: "IMPRESSIONS",
  daily_budget: a.budget, destination_type: "WEBSITE",
  learning_stage_info: { status: a.learning },
  targeting_summary: a.targeting,
}));

// De splitsing zelf. Per campagne-dagrij worden de vier optelbare grootheden over de ad sets van
// die campagne verdeeld; conversion_value gaat mét splitAlong langs de al verdeelde conversies mee,
// zodat er geen ad set met nul conversies en tóch omzet ontstaat -- de fout die __demo_sop_inputs_
// test.ts elders al bewaakt, en die bij `pro-int` (conv-gewicht 0) anders gegarandeerd optreedt.
const metaAdsetDaily: Row[] = (() => {
  const perCampagne = new Map<string, typeof META_ADSETS>();
  for (const a of META_ADSETS) {
    const lijst = perCampagne.get(a.campaign) ?? [];
    lijst.push(a);
    perCampagne.set(a.campaign, lijst);
  }
  const out: Row[] = [];
  for (const rij of metaCampaignDaily) {
    const adsets = perCampagne.get(String(rij.entity_id)) ?? [];
    if (adsets.length === 0) continue;
    const datum = String(rij.date);
    const dagenGeleden = Math.round((Date.now() - Date.parse(`${datum}T00:00:00Z`)) / 86_400_000);
    const imp = splitInt(Number(rij.impressions), adsets.map((a) => a.w.imp));
    const clk = splitInt(Number(rij.link_clicks), adsets.map((a) => a.w.clk));
    const spend = splitInt(Number(rij.spend), adsets.map((a) => a.w.spend));
    const conv = splitInt(Number(rij.conversions), adsets.map((a) => a.w.conv));
    const waarde = splitAlong(Number(rij.conversion_value), conv, adsets.map((a) => a.w.imp));
    adsets.forEach((a, i) => {
      const frequency = Math.round(a.freq(Math.max(0, Math.min(149, dagenGeleden))) * 100) / 100;
      out.push({
        client_id: CID, entity_id: a.id, date: datum,
        impressions: imp[i], link_clicks: clk[i], spend: spend[i],
        conversions: conv[i], leads: 0, conversion_value: waarde[i],
        // reach volgt uit de eigen frequency van deze ad set, niet uit een splitsing.
        reach: frequency > 0 ? Math.round(imp[i] / frequency) : 0,
        frequency,
      });
    });
  }
  return out;
})();

// meta_breakdown_daily: plaatsing/leeftijd/device-segmenten met een dure verspiller
// (audience_network / desktop) en een efficiënte schaalkans (facebook), zodat de
// breakdown-efficiëntie-detector in de demo iets zinnigs vindt.
// drift: verschuiving van het conversie-aandeel over de tijd, zodat naast de segment-
// efficiëntie ook de Meta demografie-drift-detector iets vindt.
const META_BD_SEGMENTS = [
  { type: "publisher_platform", value: "instagram", spend: 20, conv: 0.8, drift: 0.6 },
  { type: "publisher_platform", value: "audience_network", spend: 14, conv: 0.12, drift: -0.6 },
  { type: "publisher_platform", value: "facebook", spend: 4, conv: 0.28, drift: 0 },
  { type: "age", value: "25-34", spend: 16, conv: 0.7, drift: -0.5 },
  { type: "age", value: "35-44", spend: 12, conv: 0.35, drift: 0 },
  { type: "age", value: "45-54", spend: 8, conv: 0.1, drift: 0.8 },
  { type: "device_platform", value: "mobile", spend: 26, conv: 0.9, drift: 0 },
  { type: "device_platform", value: "desktop", spend: 8, conv: 0.05, drift: 0 },
  // Plaatsing binnen het platform. Dit is de uitsplitsing waar een Meta-adverteerder als eerste
  // naar kijkt — het publisher_platform zegt op wélk netwerk je zat, de positie zegt wáár. Reels
  // krijgt hier het klassieke patroon: veel budget, weinig conversie, want de kijker zit in een
  // scroll-modus. Stories doet het omgekeerde.
  { type: "platform_position", value: "feed", spend: 18, conv: 0.75, drift: 0 },
  { type: "platform_position", value: "reels", spend: 13, conv: 0.14, drift: 0.5 },
  { type: "platform_position", value: "story", spend: 6, conv: 0.32, drift: 0 },
  { type: "platform_position", value: "right_hand_column", spend: 3, conv: 0.04, drift: -0.4 },
  // Gender: bewust vlak gehouden op efficiëntie. Niet elke uitsplitsing hoeft een probleem te
  // bevatten — een demo waarin élke dimensie scheef staat leert je niet meer te kijken.
  { type: "gender", value: "female", spend: 15, conv: 0.5, drift: 0 },
  { type: "gender", value: "male", spend: 16, conv: 0.52, drift: 0 },
  { type: "gender", value: "unknown", spend: 3, conv: 0.08, drift: 0 },
];
const META_BD_DAYS = 60;
const metaBreakdownDaily: Row[] = META_BD_SEGMENTS.flatMap((s) =>
  Array.from({ length: META_BD_DAYS }, (_, d) => {
    const age = META_BD_DAYS - 1 - d;
    const f = dayFactor(age, s.value.length);
    const recency = 1 - age / (META_BD_DAYS - 1);
    const driftMul = 1 + (s.drift ?? 0) * (recency - 0.5) * 2;
    return {
      client_id: CID, date: dayISO(age), level: "account", entity_id: "act",
      breakdown_type: s.type, breakdown_value: s.value,
      impressions: Math.round(2000 * f), link_clicks: Math.round(40 * f), clicks_all: Math.round(45 * f),
      spend: Math.round(s.spend * f), conversions: s.conv * f * driftMul, conversion_value: Math.round(s.conv * f * driftMul * 120),
    };
  })
);

// meta_hourly_performance: de nacht (00–04u) converteert structureel slecht, zodat de
// dagdeel-efficiëntie-detector in de demo een duur venster vindt.
const metaHourlyPerformance: Row[] = Array.from({ length: 30 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) => {
    const f = dayFactor(29 - d, h);
    const nightPenalty = h < 4 ? 0.25 : 1;
    const spend = 8 + (h >= 8 && h <= 20 ? 6 : 0);
    return {
      client_id: CID, date: dayISO(29 - d), hour: h,
      impressions: Math.round(300 * f), link_clicks: Math.round(6 * f),
      spend: Math.round(spend * f), conversions: spend * 0.04 * nightPenalty * f,
    };
  })
).flat();

// ── De campagnes, met budget en biedregime ─────────────────────────────────
//
// daily_budget, unit_cost, bid_strategy en cost_type stonden er niet, terwijl de weekly ze
// selecteert (weekly/route.ts, de "Budget vs. Vraag"-tak van stap 3) en de bi-weekly er zijn hele
// stap 4 op bouwt ("pacing t.o.v. budget", "wijst een CPL-stijging op een te laag bod"). Zonder
// budget valt er over pacing niets te zeggen: dan is er geen noemer.
//
// De budgetten staan in verhouding tot wat de campagne werkelijk uitgeeft, zodat elke uitkomst die
// de stap kent ook een geval heeft:
//
//   op schema        1, 2, 4     geeft vrijwel zijn dagbudget uit
//   vol maar duur    3           besteedt zijn budget volledig -- bij de slechtste CPL van het
//                                account. Budget is daar niet het probleem, bod en targeting wel;
//                                dat onderscheid is precies wat stap 4 moet maken.
//   onderbesteed     5, 6, 7     met MANUAL bieden en een laag unit_cost als verklaring, de
//                                standaardoorzaak in een B2B-auctie (wortelooorzaak b in de prompt).
const LI_CAMPAIGNS = [
  { urn: "urn:li:demo:1", name: "GRT | Leadgen NL", budget: 45, bod: 8.5, strategie: "TARGET_COST", kosten: "CPC" },
  { urn: "urn:li:demo:2", name: "GRT | Thought Leadership", budget: 35, bod: 32, strategie: "MAXIMUM_DELIVERY", kosten: "CPM" },
  { urn: "urn:li:demo:3", name: "GRT | Brede awareness", budget: 130, bod: 28, strategie: "MAXIMUM_DELIVERY", kosten: "CPM" },
  // Ook op de andere beurzen actief, zodat LinkedIn binnen GRN/GRA niet leeg is.
  { urn: "urn:li:demo:4", name: "GRN | Leadgen Canada", budget: 55, bod: 9.2, strategie: "TARGET_COST", kosten: "CPC" },
  { urn: "urn:li:demo:5", name: "GRA | Thought Leadership US", budget: 60, bod: 4.8, strategie: "MANUAL", kosten: "CPC" },
  // ── De twee gevallen die de bleeder-regel aan BEIDE kanten toetsen ────────
  //
  // De LinkedIn-weekly kent een rem die de andere kanalen niet hebben: "weeg 0 leads bij weinig
  // spend (<EUR 50) als 'te vroeg om te beoordelen', niet als bleeder -- anders vlagt elke rustige
  // week vals" (weekly-channel-content.ts). Die regel was op de demo niet te toetsen, want er was
  // geen enkele campagne zonder leads: de bleeder-stap kon er domweg niets vinden.
  //
  // Nu twee, aan weerszijden van de drempel. Zonder de tweede zou een test die de rem WEGHAALT nog
  // steeds slagen, en dan bewaakt hij hem niet.
  { urn: "urn:li:demo:6", name: "GRT | Text Ads — leadgen", budget: 20, bod: 3.2, strategie: "MANUAL", kosten: "CPC" },
  { urn: "urn:li:demo:7", name: "GRA | Retargeting — net live", budget: 25, bod: 6.0, strategie: "TARGET_COST", kosten: "CPC" },
];
const linkedinCampaigns: Row[] = LI_CAMPAIGNS.map((c) => ({
  client_id: CID, campaign_urn: c.urn, name: c.name, status: "ACTIVE",
  // Campagne 6 is Text Ads onder een leadgen-doel: precies de objective/format-mismatch die
  // wortelooorzaak c in de weekly-prompt noemt. De demo modelleert geen koppeling tussen campagne
  // en creative, dus het signaal moet uit de campagnerij zelf komen -- vandaar de naam.
  objective_type: "LEAD_GENERATION",
  daily_budget: c.budget, unit_cost: c.bod, bid_strategy: c.strategie, cost_type: c.kosten,
}));
// Twee creatives, allebei single_image, was te dun om de creative-weergave iets te laten zeggen:
// er viel niets te vergelijken en het formaat-onderscheid was onzichtbaar. Vijf stuks over de
// formaten die LinkedIn daadwerkelijk kent, met uiteenlopende prestaties — de video trekt
// vertoningen maar weinig leads, het document (whitepaper) is de leadmotor. Dat is het patroon
// dat een B2B-beursaccount in het echt laat zien.
const linkedinCreatives: Row[] = [
  { client_id: CID, creative_urn: "urn:li:demo:cr1", headline: "Ontmoet de tuinbouwsector op GreenTech", post_text: "Registreer uw team voor de vakbeurs.", image_storage_path: "https://picsum.photos/seed/li-greentech-1/320/200", cta_label: "Registreren", landing_url: "https://demo.greentech-fictief.example/li", format: "single_image" },
  { client_id: CID, creative_urn: "urn:li:demo:cr2", headline: "Whitepaper: kas-innovatie 2026", post_text: "Download de trendgids met 12 casussen uit de sector.", image_storage_path: "https://picsum.photos/seed/li-greentech-2/320/200", cta_label: "Download", landing_url: "https://demo.greentech-fictief.example/li-wp", format: "document" },
  { client_id: CID, creative_urn: "urn:li:demo:cr3", headline: "In 90 seconden over de beursvloer", post_text: "Een rondleiding langs de innovaties van vorig jaar.", image_storage_path: "https://picsum.photos/seed/li-greentech-3/320/200", cta_label: "Meer info", landing_url: "https://demo.greentech-fictief.example/li-video", format: "video" },
  { client_id: CID, creative_urn: "urn:li:demo:cr4", headline: "Vier redenen om te exposeren", post_text: "Van leadvolume tot leveranciersnetwerk — swipe door de cijfers.", image_storage_path: "https://picsum.photos/seed/li-greentech-4/320/200", cta_label: "Stand boeken", landing_url: "https://demo.greentech-fictief.example/li-stand", format: "carousel" },
  { client_id: CID, creative_urn: "urn:li:demo:cr5", headline: "Persoonlijke uitnodiging voor uw team", post_text: "Ontvang twee vrijkaarten voor de vakbeurs.", image_storage_path: "https://picsum.photos/seed/li-greentech-5/320/200", cta_label: "Uitnodiging", landing_url: "https://demo.greentech-fictief.example/li-invite", format: "message" },
];
// leads hier stonden op 3/6/2/4/3 per dag -- bij de bijbehorende spend (34/40/58/37/22) kwam dat
// op zo'n €10-11 per lead uit, Google/Meta-territorium terwijl LinkedIn B2B-leadgen doorgaans het
// duurste kanaal is (vaak €40-150+/lead). Verlaagd naar een realistischer CPL (~€35-45), gevonden
// toen de kanaalafhankelijke KPI-rij (lib/use-channel-period-data.ts) LinkedIn voor het eerst
// meetelde in een blended vergelijking en een absurde YoY-stijging liet zien.
const LI_META = [
  { urn: "urn:li:demo:cr1", imp: 620, clk: 11, spend: 34, leads: 1, seed: 1 },
  { urn: "urn:li:demo:cr2", imp: 780, clk: 14, spend: 40, leads: 2, seed: 3 },
  { urn: "urn:li:demo:cr3", imp: 2100, clk: 19, spend: 58, leads: 1, seed: 5 },
  { urn: "urn:li:demo:cr4", imp: 940, clk: 16, spend: 37, leads: 1, seed: 7 },
  { urn: "urn:li:demo:cr5", imp: 310, clk: 9, spend: 22, leads: 1, seed: 9 },
];
// ── Form opens: de kolom waar de hele Lead Gen Funnel-pijler op staat ───────
//
// linkedin_*_daily droeg wel one_click_leads maar geen one_click_lead_form_opens, en daardoor kwam
// pijler 5 (Lead Gen Funnel) eruit met een TEGENSTRIJDIG object: cpl 43,33 en leads 131,6 in
// hetzelfde antwoord als has_leadgen false en "Geen leadgen-campagnes in deze periode". De oorzaak
// is een enkele regel in lib/linkedin/prepared-facts.ts -- `has_leadgen: latest.form_opens > 0` --
// en de hele pijler gaat over open rate → completion rate → waar zit de drop-off.
//
// De formules staan in lib/linkedin/prepared-compute.ts en zijn hier gevolgd:
//   open_rate_pct            = form_opens / clicks
//   form_completion_rate_pct = leads      / form_opens
//
// 55% van de kliks opent het formulier. Bij de bestaande leadaantallen levert dat een completion
// rate rond 12 tot 14 procent: midden in de band die LINKEDIN_BENCHMARKS noemt ("form completion
// 10 tot 15%"). Bewust NIET uit de leads teruggerekend naar een vast percentage -- dan zou de
// completion rate een constante zijn en had de analyse er niets over te zeggen. Nu varieert hij
// mee met de dagcurve, zoals in werkelijkheid.
const linkedinFormOpens = (clicks: number): number => Math.round(clicks * 0.55);

const linkedinCreativeDaily: Row[] = LI_META.flatMap((c) =>
  Array.from({ length: 150 }, (_, d) => {
    const f = dayFactor(149 - d, c.seed);
    const clicks = Math.round(c.clk * f);
    return { client_id: CID, entity_urn: c.urn, date: dayISO(149 - d), impressions: Math.round(c.imp * f), clicks, spend: Math.round(c.spend * f), external_website_conversions: Math.round(f), one_click_leads: Math.max(0, Math.round(c.leads * f)), one_click_lead_form_opens: linkedinFormOpens(clicks) };
  })
);
// 730 dagen (~2 jaar), niet 150: LinkedIn heeft -- anders dan Meta -- geen dag-domein-begrensde
// verzadigingsformule (dayFactor blijft positief tot ver voorbij dag 730), dus hier volstaat het
// venster gewoon te verlengen. Nodig zodat een kanaalafhankelijke blended vergelijking over "vorig
// jaar" (lib/use-channel-period-data.ts) LinkedIn ook in de vergelijkingsperiode ziet, niet alleen
// in de huidige -- anders leest elke YoY-delta op "Alle kanalen" als een vertekende sprong doordat
// het kanaal daar leek "net te zijn aangesloten".
// Gemiddelde dealgrootte per LinkedIn-conversie ("conversie" = one_click_leads +
// external_website_conversions samen, dezelfde optelling als sumSelectedConversions() voor
// linkedin_ads default gebruikt) -- conversion_value ontbrak hier volledig (altijd undefined -> 0),
// zelfde gat als bij Meta hierboven. Gemikt op zo'n 1,8x ROAS bij de account-brede CPA (~€25):
// LinkedIn is B2B's duurste kanaal per lead, dus een lagere ROAS dan Meta is het punt, niet een bug.
const LI_ACCOUNT_AOV = 45;
const linkedinAccountDaily: Row[] = Array.from({ length: 730 }, (_, d) => {
  const day = 729 - d;
  const agg = LI_META.reduce((s, c) => { const f = dayFactor(day, c.seed); s.impressions += Math.round(c.imp * f); s.clicks += Math.round(c.clk * f); s.spend += Math.round(c.spend * f); s.leads += Math.max(0, Math.round(c.leads * f)); return s; }, { impressions: 0, clicks: 0, spend: 0, leads: 0 });
  const leads = agg.leads * weekdayConvPenalty(day);
  const conversions = Math.round(leads * 0.3);
  return { client_id: CID, date: dayISO(day), impressions: agg.impressions, clicks: agg.clicks, spend: Math.round(agg.spend * recentSpendBump(day)), external_website_conversions: conversions, one_click_leads: leads, one_click_lead_form_opens: linkedinFormOpens(agg.clicks), conversion_value: Math.round((conversions + leads) * LI_ACCOUNT_AOV) };
});
// linkedin_campaign_daily voedt de ChannelPerformance-view (per campagne).
// Expliciet i.p.v. formule: 'Brede awareness' domineert de spend maar levert weinig leads,
// zodat de budget-concentratie-detector in de demo een onderpresteerder vindt.
const LI_CAMP_DEFS = [
  { urn: "urn:li:demo:1", imp: 900, clk: 16, spend: 40, leads: 6, seed: 0 },
  { urn: "urn:li:demo:2", imp: 1200, clk: 20, spend: 30, leads: 5, seed: 2 },
  { urn: "urn:li:demo:3", imp: 4000, clk: 30, spend: 120, leads: 2, seed: 4 },
  { urn: "urn:li:demo:4", imp: 1100, clk: 18, spend: 48, leads: 7, seed: 6 },
  { urn: "urn:li:demo:5", imp: 1500, clk: 22, spend: 36, leads: 4, seed: 8 },
  // Zie de kop bij LI_CAMPAIGNS: twee gevallen aan weerszijden van de EUR 50-rem, allebei met nul
  // leads. Text Ads halen veel vertoningen en weinig kliks -- vandaar de scheve imp/clk-verhouding.
  // Over zeven dagen komt 14/dag op circa EUR 105 uit (bleeder) en 4/dag op circa EUR 30 (te vroeg
  // om te beoordelen). De dagcurve schaalt beide met dezelfde factor, dus die verhouding houdt.
  { urn: "urn:li:demo:6", imp: 3000, clk: 6, spend: 14, leads: 0, seed: 10 },
  { urn: "urn:li:demo:7", imp: 300, clk: 4, spend: 4, leads: 0, seed: 12 },
];
const linkedinCampaignDaily: Row[] = LI_CAMP_DEFS.flatMap((c) =>
  Array.from({ length: 150 }, (_, d) => {
    const f = dayFactor(149 - d, c.seed);
    const oneClickLeads = Math.max(0, Math.round(c.leads * f));
    const externalConv = Math.round(f);
    const clicks = Math.round(c.clk * f);
    return { client_id: CID, entity_urn: c.urn, date: dayISO(149 - d), impressions: Math.round(c.imp * f), clicks, spend: Math.round(c.spend * f), external_website_conversions: externalConv, one_click_leads: oneClickLeads, one_click_lead_form_opens: linkedinFormOpens(clicks), conversion_value: Math.round((oneClickLeads + externalConv) * LI_ACCOUNT_AOV) };
  })
);

// linkedin_demographic_daily + labels: functie/seniority-segmenten met een dure verspiller
// (Sales / Entry) en een efficiënte schaalkans (Marketing), zodat de demografie-segment-
// efficiëntie-detector in de demo iets vindt.
// drift: verschuiving van het lead-aandeel over de tijd (+ = stijgend recent, − = dalend),
// zodat naast de segment-efficiëntie ook de demografie-drift-detector iets vindt.
const LI_DEMO_SEGMENTS = [
  { pivot: "MEMBER_JOB_FUNCTION", urn: "urn:li:function:8", label: "Engineering", spend: 20, leads: 0.8, drift: 0 },
  { pivot: "MEMBER_JOB_FUNCTION", urn: "urn:li:function:25", label: "Sales", spend: 14, leads: 0.12, drift: -0.7 },
  { pivot: "MEMBER_JOB_FUNCTION", urn: "urn:li:function:15", label: "Marketing", spend: 4, leads: 0.28, drift: 0.7 },
  { pivot: "MEMBER_SENIORITY", urn: "urn:li:seniority:5", label: "Senior", spend: 22, leads: 0.9, drift: 0 },
  { pivot: "MEMBER_SENIORITY", urn: "urn:li:seniority:4", label: "Manager", spend: 11, leads: 0.34, drift: 0 },
  { pivot: "MEMBER_SENIORITY", urn: "urn:li:seniority:1", label: "Entry", spend: 8, leads: 0.06, drift: 0 },
  // Industrie en bedrijfsgrootte stonden wél in de vertaaltabel van de structuur-analyse maar
  // hadden geen demo-rijen, waardoor die twee dimensies in de demo altijd leeg bleven. Voor een
  // beurs is dit juist de scherpste snede: exposanten zitten in een handvol sectoren en het zijn
  // zelden de kleinste bedrijven die een stand boeken.
  { pivot: "MEMBER_INDUSTRY", urn: "urn:li:industry:2", label: "Tuinbouw & agrifood", spend: 18, leads: 0.85, drift: 0.3 },
  { pivot: "MEMBER_INDUSTRY", urn: "urn:li:industry:47", label: "Machinebouw", spend: 10, leads: 0.4, drift: 0 },
  { pivot: "MEMBER_INDUSTRY", urn: "urn:li:industry:135", label: "Zakelijke dienstverlening", spend: 9, leads: 0.08, drift: -0.5 },
  { pivot: "MEMBER_INDUSTRY", urn: "urn:li:industry:96", label: "IT & software", spend: 5, leads: 0.12, drift: 0 },
  { pivot: "MEMBER_COMPANY_SIZE", urn: "urn:li:companySize:D", label: "51-200", spend: 16, leads: 0.62, drift: 0 },
  { pivot: "MEMBER_COMPANY_SIZE", urn: "urn:li:companySize:E", label: "201-500", spend: 12, leads: 0.55, drift: 0.4 },
  { pivot: "MEMBER_COMPANY_SIZE", urn: "urn:li:companySize:B", label: "2-10", spend: 7, leads: 0.05, drift: 0 },
  { pivot: "MEMBER_COMPANY_SIZE", urn: "urn:li:companySize:G", label: "1001-5000", spend: 6, leads: 0.3, drift: 0 },
];
const LI_DEMO_DAYS = 60;
const linkedinDemographicDaily: Row[] = LI_DEMO_SEGMENTS.flatMap((s) =>
  Array.from({ length: LI_DEMO_DAYS }, (_, d) => {
    const age = LI_DEMO_DAYS - 1 - d; // dagen geleden
    const f = dayFactor(age, s.label.length);
    const recency = 1 - age / (LI_DEMO_DAYS - 1); // 0 oudste → 1 nieuwste
    const driftMul = 1 + (s.drift ?? 0) * (recency - 0.5) * 2; // van (1−drift) naar (1+drift)
    return {
      client_id: CID, date: dayISO(age), level: "account", entity_urn: "urn:li:account:demo",
      pivot_type: s.pivot, pivot_value_urn: s.urn,
      impressions: Math.round(1500 * f), clicks: Math.round(20 * f), spend: Math.round(s.spend * f),
      leads: s.leads * f * driftMul, conversions: s.leads * f * driftMul * 0.3, coverage_pct: 0.8,
    };
  })
);
// `linkedin_demographic_daily` zelf komt via dbSelect() altijd uit de ECHTE tabel (ook in
// demo-modus, zie geo-map-card.tsx/17.38's bevinding over dbSelect); alleen deze labeltabel
// wordt hier gemockt, want breakdown-donuts.tsx leest hem via een rechtstreekse
// supabase.from()-aanroep, en díe gaat in demo-modus wél door de mock (lib/supabase.ts).
// scripts/demo/seed-demo-client.ts's LI_DEMO_FUNCTIONS (het [S9]-scenario: "75% van de leads uit
// Education") zaait de echte tabel met eigen URN's, los van LI_DEMO_SEGMENTS hierboven -- zonder
// deze twee regels vindt de labelvertaling die URN's niet en toont de donut kale
// "urn:li:function:demo-edu"-tekst in plaats van "Education".
const linkedinUrnLabels: Row[] = LI_DEMO_SEGMENTS.map((s) => ({ urn: s.urn, label: s.label })).concat([
  { urn: "urn:li:function:demo-edu", label: "Education" },
  { urn: "urn:li:function:demo-ops", label: "Operations" },
]);

// ── client_targets + benchmark_sectors ──────────────────────────────────────
//
// Twee tabellen die de bi-weekly en de monthly allebei lezen en die in de demo leeg stonden. Geen
// van beide geeft een foutmelding als hij leeg is -- ze leveren stilzwijgend een slechter antwoord,
// en dat is precies de faalwijze waar deze demo tegen hoort te beschermen.
//
// client_targets is sinds migratie 082 de bron voor de doelstellingen; kpi_targets hierboven is de
// OUDE plek. De demo droeg alleen de oude, dus resolveTargets() kreeg nul rijen terug en gaf
// roas/cpa als 0 door aan computeComparisonFacts -- waarna de analyse tegen een doel van nul
// vergeleek in plaats van te zeggen dat er geen doel was. De waarden hieronder zijn WOORDELIJK
// dezelfde als in kpi_targets: twee bronnen die verschillende getallen noemen is precies de
// tegenstrijdigheid die een demo dodelijk maakt.
//
// Alleen google_ads: zowel monthly/route.ts:1789 als biweekly/route.ts:165 filtert hard op dat
// kanaal. Rijen voor meta/linkedin zouden nergens gelezen worden.
const clientTargets: Row[] = [
  { client_id: CID, channel: "google_ads", metric: "roas", target_value: 4, valid_from: monthISO(24), valid_to: null },
  { client_id: CID, channel: "google_ads", metric: "cpa", target_value: 60, valid_from: monthISO(24), valid_to: null },
];

// benchmark_sectors is een GEDEELDE referentietabel (migratie 012), niet klantdata -- vandaar dat
// hij per `sector` gaat en niet per client_id. Zonder rijen blijft het hele sectorbenchmark-blok
// uit de prompt, en kan de demo dus niet laten zien dat die laag bestaat.
//
// De waarden zijn zo gekozen dat de demo een GEMENGD beeld geeft en niet overal groen of overal
// rood: bij de julicijfers van dit account (CTR 1,87%, conv.rate 2,73%, CPA €66,66, ROAS 1,82)
// levert dit "gemiddeld" op CTR en CPA, en "onder sectorgemiddelde" op conversieratio en ROAS. Dat
// laatste rijmt met het gemiste ROAS-doel van 4 hierboven -- een demo waarin de benchmark en het
// doel elkaar tegenspreken, leest als een bug.
//
// Let op de ordening: voor cpa en avg_cpc is LAGER beter, dus daar loopt de reeks andersom
// (top10 < high < median < low). Zie labelBenchmark() in lib/analysis/comparison-facts.ts.
//
// avg_cpc staat er BEWUST NIET bij. De demo-maandrijen dragen avg_cpc 0, en tegen een omgekeerde
// benchmark leest 0 als "top 10% van de sector" -- een compliment voor een ontbrekend getal. Liever
// geen benchmark dan een onware.
const DEMO_SECTOR = "leadgen_generiek";
const benchmarkSectors: Row[] = [
  { sector: DEMO_SECTOR, account_type: "leadgen_cpa", metric: "ctr", low: 0.012, median: 0.018, high: 0.028, top10: 0.042 },
  { sector: DEMO_SECTOR, account_type: "leadgen_cpa", metric: "conversion_rate", low: 0.015, median: 0.030, high: 0.050, top10: 0.080 },
  { sector: DEMO_SECTOR, account_type: "leadgen_cpa", metric: "cpa", low: 120, median: 75, high: 45, top10: 28 },
  { sector: DEMO_SECTOR, account_type: "leadgen_cpa", metric: "roas", low: 1.2, median: 2.0, high: 3.2, top10: 5.0 },
];

const clientNotes: Row[] = [
  { id: "demo-note-1", client_id: CID, title: "Beursweek", content: "Piek verwacht rond de beursweek — budgetten tijdig ophogen.", created_at: iso(), updated_at: iso() },
];
const clientSyncStatus: Row[] = [{ client_id: CID, channel: "google_ads", status: "ok", last_sync_at: iso(), rows_synced: 1240 }];

// blended_account_monthly: per kanaal per maand, zodat de cross-channel-analyse (signalen,
// funnel, KPI-verhoudingen, pacing) in de demo end-to-end draait. Google uit de maandtotalen,
// Meta/LinkedIn geaggregeerd uit hun dagreeksen naar dezelfde maand-sleutel (YYYY-MM-01).
const blendedAccountMonthly: Row[] = (() => {
  const out: Row[] = [];
  for (const r of adsAccountMonthly) {
    out.push({ client_id: CID, month: r.month, channel: "google_ads", impressions: r.impressions, clicks: r.clicks, spend: r.cost, conversions: r.conversions, leads: 0 });
  }
  const aggDaily = (daily: Row[], channel: string, map: (r: Row) => { imp: number; clk: number; spend: number; conv: number; leads: number }) => {
    const byMonth = new Map<string, { imp: number; clk: number; spend: number; conv: number; leads: number }>();
    for (const r of daily) {
      const month = (r.date as string).slice(0, 7) + "-01";
      const m = map(r);
      const acc = byMonth.get(month) ?? { imp: 0, clk: 0, spend: 0, conv: 0, leads: 0 };
      acc.imp += m.imp; acc.clk += m.clk; acc.spend += m.spend; acc.conv += m.conv; acc.leads += m.leads;
      byMonth.set(month, acc);
    }
    for (const [month, a] of byMonth) out.push({ client_id: CID, month, channel, impressions: a.imp, clicks: a.clk, spend: a.spend, conversions: a.conv, leads: a.leads });
  };
  aggDaily(metaAccountDaily, "meta_ads", (r) => ({ imp: r.impressions as number, clk: r.link_clicks as number, spend: r.spend as number, conv: r.conversions as number, leads: 0 }));
  aggDaily(linkedinAccountDaily, "linkedin_ads", (r) => ({ imp: r.impressions as number, clk: r.clicks as number, spend: r.spend as number, conv: r.external_website_conversions as number, leads: r.one_click_leads as number }));
  return out;
})();

// ── Geo: land- en staatrijen voor de maand-SOP ─────────────────────────────
// Deze ontbraken, waardoor de SOP "geen landdata" concludeerde terwijl de kaart ernaast landen
// toonde. Afgeleid uit dezelfde definitie als de kaart en de markt-analyse (lib/demo/geo-demo.ts),
// zodat de drie het per definitie eens zijn.
const GEO_SOP_MONTHS = [monthISO(3), monthISO(2), monthISO(1)];
const adsCountryMonthly: Row[] = geoMonthlyRows(demoGeoCountries("google"), GEO_SOP_MONTHS).map((r) => ({
  client_id: CID, country_code: r.code, month: r.month,
  impressions: r.impressions, clicks: r.clicks, cost: r.cost,
  conversions: r.conversions, conversions_value: r.conversionsValue,
  ctr: r.ctr, avg_cpc: r.avgCpc, cost_per_conversion: r.costPerConversion,
  conversion_rate: r.conversionRate, roas: r.roas,
  campaign_count: 2, spend_share: 0, synced_at: iso(),
}));
// Land × campagne: de brug naar de land×kanaal-matrix, uit dezelfde landtotalen als hierboven.
const adsGeoPerformanceMonthly: Row[] = geoCampaignRows(
  CID, geoMonthlyRows(demoGeoCountries("google"), GEO_SOP_MONTHS).map((r) => ({ ...r, code: r.code })), iso()
);
// VS-staten voor de statenanalyse en de drilldown-kaart.
//
// region_name draagt de Engelse staatsnaam en niet de USPS-code. Dat lijkt een detail, maar het
// is precies de kolom waar dit ooit misging: de sync schreef er het geo-doeltype in en niemand
// merkte het, omdat de demo een code neerzette die toevallig óók te vertalen was. Een demo die
// er anders uitziet dan productie test de vertaalstap niet.
const adsRegionMonthly: Row[] = geoMonthlyRows(demoGeoStates("google"), GEO_SOP_MONTHS).map((r) => ({
  client_id: CID, country_code: "US", region_name: uspsToEnglishName(r.code), region_code: r.code, month: r.month,
  impressions: r.impressions, clicks: r.clicks, cost: r.cost,
  conversions: r.conversions, conversions_value: r.conversionsValue,
  ctr: r.ctr, avg_cpc: r.avgCpc, cost_per_conversion: r.costPerConversion,
  conversion_rate: r.conversionRate, roas: r.roas,
  campaign_count: 2, spend_share: 0, synced_at: iso(),
}));

// Landen-YoY: percentages uit de vorig-jaar-verhoudingen in geo-demo, niet los verzonnen. Frankrijk
// ontbreekt bewust — die markt is dit jaar geopend en heeft dus geen vergelijkingsjaar.
const adsCountryYoy: Row[] = demoGeoCountries("google").flatMap((agg) => {
  const series = geoYoyMonthly(agg, GEO_SOP_MONTHS);
  if (!series) return [];
  return series.map((y) => ({
    client_id: CID, country_code: agg.code, month: y.month,
    impressions_yoy_pct: y.impressions, clicks_yoy_pct: y.clicks, cost_yoy_pct: y.cost,
    conversions_yoy_pct: y.conversions, conversions_value_yoy_pct: y.conversionsValue,
    ctr_yoy_pct: y.ctr, avg_cpc_yoy_pct: y.avgCpc, conversion_rate_yoy_pct: y.conversionRate,
    roas_yoy_pct: y.roas, cost_per_conversion_yoy_pct: y.costPerConversion, synced_at: iso(),
  }));
});

// ── Google-dimensies voor de maand-SOP ─────────────────────────────────────
// Week-, ad-groep-, zoekterm-, YoY-, apparaat-, netwerk-, schema-, zoekwoord- en doelgroeprijen.
// Vrijwel alles is uit de reeksen hierboven gesplitst (zie lib/demo/google-sop-demo.ts), zodat de
// dimensies exact optellen tot het account en de campagnes waar ze uit komen.
const DIM_MONTHS = [monthISO(3), monthISO(2), monthISO(1), monthISO(0)];
const ADGROUP_SINCE = monthISO(13); // de SOP kijkt 13 maanden terug

const adsAccountWeekly: Row[] = accountWeeklyRows(CID, adsAccountMonthly, 26);
const adsAdgroupMonthly: Row[] = adgroupMonthlyRows(CID, adsCampaignMonthly, ADGROUP_SINCE);
// Zoektermen hangen aan dezelfde weken als de weekreeks, zodat de week-sleutels overeenkomen.
const adsSearchTermsWasteful: Row[] = wastefulSearchTermRows(
  CID, adsAccountWeekly.slice(-8).map((r) => String(r.week_start))
);
const adsAccountYoy: Row[] = accountYoyRows(CID, adsAccountMonthly);
const adsCampaignYoy: Row[] = campaignYoyRows(CID, adsCampaignMonthly);
const adsCampaignMetadata: Row[] = campaignMetadataRows(CID, iso());
const adsDevicePerformanceMonthly: Row[] = devicePerformanceRows(CID, adsAccountMonthly, DIM_MONTHS, iso());
const adsNetworkPerformanceMonthly: Row[] = networkPerformanceRows(CID, adsAccountMonthly, DIM_MONTHS, iso());
const adsAdSchedulePerformance: Row[] = adScheduleRows(CID, adsAccountMonthly, dayISO(31), dayISO(1), iso());
const adsKeywordPerformanceMonthly: Row[] = keywordPerformanceRows(CID, adsAdgroupMonthly, DIM_MONTHS, iso());
const adsAudiencePerformanceMonthly: Row[] = audiencePerformanceRows(CID, adsAccountMonthly, DIM_MONTHS, iso());
// Alleen de Shopping-campagne (afleiden, niet verzinnen): productPerformanceRows splitst per
// product uit exact déze campagnetotalen, niet uit het accounttotaal zoals de doelgroep-/
// netwerkrijen hierboven -- een productfeed bestaat alleen binnen zijn eigen campagne.
const adsProductPerformanceMonthly: Row[] = productPerformanceRows(
  CID, adsCampaignMonthly.filter((r) => r.campaign_id === "demo-c-shop"), iso()
);

// ── PMax en Video ──────────────────────────────────────────────────────────
// Asset groups, netwerkverdeling, assets, plaatsingen en zoekcategorieën. Deze tabellen voedden de
// PMax-expertlaag, de video-diepteanalyse, de placement-uitsluitadviezen en vijf controlepunten in
// de second opinion — die alle vijf leeg bleven zolang de demo geen PMax- of videocampagne had.
const adsAssetGroupPerformanceMonthly: Row[] = assetGroupRows(CID, adsCampaignMonthly, DIM_MONTHS, iso());
const adsPmaxNetworkBreakdown: Row[] = pmaxNetworkRows(CID, adsAssetGroupPerformanceMonthly, iso());
// monthISO(1) is de laatste afgesloten maand -- dezelfde als waar de rest van de demo op eindigt.
const sopAnalysisOutput: Row[] = analyseOutputRows(CID, monthISO(1).slice(0, 7), iso());
const adsPmaxAssetPerformance: Row[] = pmaxAssetRows(CID, DIM_MONTHS, iso());
const adsVideoPlacements: Row[] = videoPlacementRows(CID, DIM_MONTHS, iso());
const adsPmaxPlacements: Row[] = pmaxPlacementRows(CID, DIM_MONTHS, iso());
const adsPmaxSearchCategories: Row[] = pmaxSearchCategoryRows(CID, adsPmaxNetworkBreakdown, iso());

// Bestanden: precies één set standaardmappen (geen dubbelen) + een paar voorbeeldbestanden,
// zodat het tabblad Bestanden er in de demo netjes en volledig uitziet.
const clientFolders: Row[] = ["SOP's", "Briefings", "Sprintplanning", "Rapportages", "Overig"].map((name, i) => ({
  id: `demo-folder-${i}`, client_id: CID, name, created_at: iso(),
}));
const clientFiles: Row[] = [
  { id: "demo-file-1", client_id: CID, folder: "SOP's", file_name: "SOP_zoeknetwerk_greentech.pdf", file_size: 184320, content_type: "application/pdf", storage_path: `${CID}/SOP's/demo-sop.pdf`, uploaded_at: dayISO(9) },
  { id: "demo-file-2", client_id: CID, folder: "Briefings", file_name: "Creative_briefing_awareness_EU.docx", file_size: 45210, content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", storage_path: `${CID}/Briefings/demo-briefing.docx`, uploaded_at: dayISO(5) },
  { id: "demo-file-3", client_id: CID, folder: "Sprintplanning", file_name: "Sprintplanning_Q3_2026.csv", file_size: 12880, content_type: "text/csv", storage_path: `${CID}/Sprintplanning/demo-sprint.csv`, uploaded_at: dayISO(3) },
  { id: "demo-file-4", client_id: CID, folder: "Rapportages", file_name: "Maandrapportage_juni_2026.pdf", file_size: 962560, content_type: "application/pdf", storage_path: `${CID}/Rapportages/demo-rapport.pdf`, uploaded_at: dayISO(12) },
];

// client_settings: merk-identiteit, beurs-edities (voor de event-relatieve beursforecast) en
// KPI-doelen. De edities geven elke geo-clone een huidige + vorige beurs, zodat de
// dagen-tot-beurs-projectie (incl. het blended totaal over de kanalen) in de demo echt draait.
const clientSettings: Row[] = [{
  client_id: CID,
  brand_guide: { brandName: "GreenTech", visual: { primaryColor: "#0B7A3B", accentColor: "#8BC34A", secondaryColor: "#0A3D2C", headingFont: "Gilroy, Ubuntu, sans-serif" } },
  // 22 augustus 2026: deze drie misten `id` (en droegen afwijkende namen/edities/cadans dan de
  // echte, doorgeseede database) -- lib/demo/event-forecaster.tsx's T-minus Forecaster leest de
  // eventlijst via dbSelectOne (dus altijd de echte database, met id "demo-grt" etc.), maar
  // app/api/analysis/event-pacing/route.ts zoekt datzelfde event op via supabaseForClient (in
  // demo-modus dus deze mock) op `e.id === eventId`. Zonder `id` hier matchte dat nooit: de
  // dropdown toonde "GreenTech Amsterdam", en de pagina eronder zei "Event demo-grt niet gevonden
  // bij deze klant". Nu woordelijk gelijk aan wat de productiedatabase voor demo-greentech draagt.
  rai_events: {
    events: [
      { id: "demo-grt", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [{ date: "2026-06-11", label: "2026" }, { date: "2027-06-10", label: "2027" }] },
      { id: "demo-gra", name: "GreenTech Americas", abbrev: "GRA", cadence: "annual", editions: [{ date: "2025-09-16", label: "2025" }, { date: "2026-09-15", label: "2026" }] },
      { id: "demo-grn", name: "GreenTech North America", abbrev: "GRN", cadence: "custom", editions: [{ date: "2026-11-04", label: "2026" }] },
    ],
  },
  kpi_targets: { conversionsAbsolute: 700, revenueAbsolute: 90000, roasTarget: 4, cpaTarget: 60 },
  // De sector waarop benchmark_sectors wordt opgezocht. Stond niet ingevuld, waardoor sectorKey
  // terugviel op de accounttype-afleiding en er alsnog niets gevonden werd.
  sector: DEMO_SECTOR,
  // Zonder ingevuld ICP blijft LinkedIn's pijler 4 (Doelgroep: ICP-fit & Verzadiging) beschrijvend
  // en zonder fit-score -- de adapter zegt dat zelf: "Zonder ingevuld ICP: beschrijvend, geen
  // fit-score, met expliciete melding". Dat is het eerlijke gedrag, maar het betekent ook dat de
  // demo de kernstap van de LinkedIn-analyse niet kon laten zien.
  //
  // URN's, geen labels: computeIcpFitForPivot vergelijkt met `icpSet.has(s.pivotValueUrn)`
  // (lib/linkedin/icp-fit.ts), dus labels zouden hier stil een fit van 0% opleveren. Deze vier
  // lijsten gebruiken exact de URN's uit LI_DEMO_SEGMENTS hierboven.
  //
  // De keuze is die van een vakbeurs voor de tuinbouw, en is zo gezet dat elke pivot een echt
  // waste-segment overhoudt in plaats van een fit van 100%: Sales (veel spend, nauwelijks leads),
  // Entry-senioriteit, zakelijke dienstverlening en de kleinste bedrijven vallen erbuiten. Dat is
  // precies de snede die de analyse hoort te vinden.
  linkedin_icp: {
    job_functions: ["urn:li:function:8", "urn:li:function:15"],           // Engineering, Marketing
    seniorities: ["urn:li:seniority:5", "urn:li:seniority:4"],            // Senior, Manager
    industries: ["urn:li:industry:2", "urn:li:industry:47"],              // Tuinbouw & agrifood, Machinebouw
    company_sizes: ["urn:li:companySize:D", "urn:li:companySize:E", "urn:li:companySize:G"],
  },
  // Conversie-acties ontbraken, en dat had een gevolg dat verder reikte dan dit veld: zonder
  // primaire actie valt de accounttype-bepaling terug op "hybrid", wat de SOP labelt als
  // "Hybrid (Shopping + Search)". Een vakbeurs verkoopt geen producten in een webshop — er is
  // geen enkele Shopping-campagne in deze demo — dus dat label was gewoon onjuist. Met de
  // standaanvraag als primaire actie klopt het weer: leadgen op CPA.
  conversion_actions: [
    { id: "demo-ca-stand", name: "Standaanvraag (formulier)", category: "primary", activeInAds: true, includedInDashboard: true },
    { id: "demo-ca-bezoek", name: "Bezoekersregistratie", category: "secondary", activeInAds: true, includedInDashboard: true },
    { id: "demo-ca-brochure", name: "Download exposantenbrochure", category: "secondary", activeInAds: true, includedInDashboard: true },
    { id: "demo-ca-bel", name: "Telefoongesprek langer dan 60s", category: "secondary", activeInAds: true, includedInDashboard: false },
    { id: "demo-ca-nieuwsbrief", name: "Aanmelding nieuwsbrief", category: "secondary", activeInAds: false, includedInDashboard: false },
  ],
  channel_conversion_config: { meta_ads: ["conversions", "leads"], linkedin_ads: ["one_click_leads", "external_website_conversions"] },
  // GA4-insight-layer config (property + key events + funnelstappen). In demo levert data-access
  // de gemockte GA4-dataset; dit documenteert de vorm van client_settings.ga4_config.
  ga4_config: { propertyId: "properties/demo-greentech", keyEvents: ["form_submit", "generate_lead"], funnelSteps: ["session_start", "view_item", "form_start", "form_submit"] },
}];

// De volledige map; tabellen die hier niet in staan → passthrough naar de echte client.
// ── Klantgroepen ───────────────────────────────────────────────────────────
// Zonder deze rijen bleef het blok "Klantgroepen" op /settings in demomodus leeg, en dan is er
// geen manier om te zien wat een groep kan zijn. Twee groepen, met opzet in twee verschillende
// standen: één die iemand zelf heeft gemaakt en één die het naamalgoritme voorstelt. Dat verschil
// is het hele punt van dat scherm, dus het hoort in de demo zichtbaar te zijn.
const DEMO_GROEP_MERK = "demo-groep-merk";
const DEMO_GROEP_VRIJ = "demo-groep-vrij";

const clientGroups: Row[] = [
  { id: DEMO_GROEP_VRIJ, name: "Beurzen 2026", sort_order: 1,
    soort: "vrij", bevestigd: true, reden: null, created_at: iso() },
  { id: DEMO_GROEP_MERK, name: "GreenTech", sort_order: 2,
    soort: "merk", bevestigd: false, reden: "regiosuffix+scheidingsteken", created_at: iso() },
];

const clientGroupMembers: Row[] = [
  { group_id: DEMO_GROEP_VRIJ, client_id: CID },
  { group_id: DEMO_GROEP_MERK, client_id: CID },
];

// Eén keer berekend, net als de module-constanten hierboven: demoRows() kan per render meermaals
// worden aangeroepen en de Microsoft-generator bouwt duizenden dagrijen.
const microsoftTables = microsoftDemoRows(CID);

export function demoRows(): Record<string, Row[]> {
  return {
    // Microsoft (Bing) [S14-S20]: uit dezelfde generator als de seed -- zie lib/demo/microsoft-demo.ts.
    ...microsoftTables,
    ads_campaign_monthly: adsCampaignMonthly,
    ads_account_monthly: adsAccountMonthly,
    ads_account_weekly: adsAccountWeekly,
    ads_adgroup_monthly: adsAdgroupMonthly,
    ads_campaign_impression_share: adsCampaignImpressionShare,
    ads_search_terms_wasteful: adsSearchTermsWasteful,
    ads_account_yoy: adsAccountYoy,
    ads_campaign_yoy: adsCampaignYoy,
    ads_campaign_metadata: adsCampaignMetadata,
    ads_device_performance_monthly: adsDevicePerformanceMonthly,
    ads_network_performance_monthly: adsNetworkPerformanceMonthly,
    ads_ad_schedule_performance: adsAdSchedulePerformance,
    ads_keyword_performance_monthly: adsKeywordPerformanceMonthly,
    ads_audience_performance_monthly: adsAudiencePerformanceMonthly,
    ads_product_performance_monthly: adsProductPerformanceMonthly,
    ads_asset_group_performance_monthly: adsAssetGroupPerformanceMonthly,
    ads_pmax_network_breakdown: adsPmaxNetworkBreakdown,
    ads_pmax_asset_performance: adsPmaxAssetPerformance,
    ads_pmax_placements: adsPmaxPlacements,
    ads_pmax_search_categories: adsPmaxSearchCategories,
    ads_video_placements: adsVideoPlacements,
    // Drie gedraaide analyses. Zie de kop van analyses-demo.ts voor waarom het er drie zijn en
    // niet twintig.
    sop_analysis_output: sopAnalysisOutput,
    sop_insights: sopInsights,
    sop_recommendations: sopRecommendations,
    sprint_hypotheses: sprintHypotheses,
    client_groups: clientGroups,
    client_group_members: clientGroupMembers,
    sprint_items: sprintItems,
    sop_tasks: sopTasks,
    task_completions: [],
    ads_creative_performance: adsCreativePerformance,
    google_ads_rsa_assets: rsaAssets,
    google_ads_ad_meta: [],
    meta_ads: metaAds,
    meta_creatives: metaCreatives,
    meta_ad_daily: metaAdDaily,
    meta_account_daily: metaAccountDaily,
    meta_campaigns: metaCampaigns,
    meta_campaign_daily: metaCampaignDaily,
    meta_adsets: metaAdsets,
    meta_adset_daily: metaAdsetDaily,
    meta_breakdown_daily: metaBreakdownDaily,
    meta_hourly_performance: metaHourlyPerformance,
    linkedin_campaigns: linkedinCampaigns,
    linkedin_creatives: linkedinCreatives,
    linkedin_creative_daily: linkedinCreativeDaily,
    linkedin_account_daily: linkedinAccountDaily,
    linkedin_campaign_daily: linkedinCampaignDaily,
    linkedin_demographic_daily: linkedinDemographicDaily,
    linkedin_urn_labels: linkedinUrnLabels,
    client_notes: clientNotes,
    client_sync_status: clientSyncStatus,
    client_folders: clientFolders,
    client_files: clientFiles,
    ads_country_monthly: adsCountryMonthly,
    ads_geo_performance_monthly: adsGeoPerformanceMonthly,
    ads_country_yoy: adsCountryYoy,
    ads_region_monthly: adsRegionMonthly,
    blended_account_monthly: blendedAccountMonthly,
    client_settings: clientSettings,
    client_targets: clientTargets,
    benchmark_sectors: benchmarkSectors,
  };
}

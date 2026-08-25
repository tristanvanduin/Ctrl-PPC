// ============================================================================
// DEMO-KLANT SEED — "demo-greentech" (volledig fictief, gequarantaineerd)
// ----------------------------------------------------------------------------
// Doel: alle analyses end-to-end testbaar maken (Google, Meta, LinkedIn, cross-channel,
// geo-clones/beursanalyse) zonder echte klanten te vervuilen. Alles hangt aan EEN client_id
// (demo-greentech) en is met scripts/demo/teardown-demo-client.ts in een keer te verwijderen.
//
// De data is deterministisch (geen randomness) en per detector ONTWORPEN:
//   [S1]  Meta creative fatigue      — "Hero Video A": CTR -42% bij frequency 4.2
//   [S2]  Meta frequency-saturatie   — campagne Awareness op frequency 4.6
//   [S3]  Meta ranking-zwakte        — "Static Banner C": BELOW_AVERAGE quality ranking
//   [S4]  Meta hook-zwakte           — "Product Carousel D": hook-rate ver onder de mediaan
//   [S5]  LinkedIn form drop-off     — GRT ABM: 10% completion op 60+ opens
//   [S6]  LinkedIn CPL-druk          — GRT ABM: CPL +25% recent vs prior venster
//   [S7]  Zaai-oogst (cross)         — social-vertoningen juni +40%, brand-klikken +18%
//   [S8]  Mix-shift/Simpson (cross)  — LinkedIn-spend juni x3 (eigen CPA stabiel) => blended CPA stijgt
//   [S9]  Doelgroep-tegenspraak      — LinkedIn-leads 75% uit "Education", buiten het Google-ICP
//   [S10] Beursanalyse GRT           — aanloop 2026 ~35% achter op 2025 bij gelijke spend (effectiviteitsvraag)
//   [S11] Beursanalyse GRA           — op koers (+10%) => geen actie
//   [S12] GRN eerste editie          — degradatiepad "eerste editie" zichtbaar
//   [S13] Impression share           — GRT budget-gelimiteerd, GRA rang-gelimiteerd
//   stil: "GreenTech | Brand" gezond => detectors horen daar te zwijgen
//
// Microsoft Ads (Bing), het vierde kanaal, op ~10% van de Google-volumes:
//   [S14] Import-drift          — "GRT | Search | NL (import)": CPA loopt 12 weken op, native strak
//   [S15] Audience Network-lek  — ~18% van spend, ~1% van conversies (CPA ver boven search)
//   [S16] Profiel-volumerem     — "Tuinbouw & Agri" onder account-CPA én boven de volumegrens
//                                 (bid-modifier-kans); "Inkoop" oogt briljant maar zit ONDER de grens
//   [S17] Desktop >> mobile     — in volume en in CPA (B2B-search)
//   [S18] Impressieaandeel      — import: budgetverlies loopt op; brand vrijwel vol; native rank-verlies
//   [S19] Keyword-bleeder       — "greenhouse solutions" > 2x account-CPA zonder conversies;
//                                 "kas kopen tweedehands" blijft onder de EUR 25-rem (te vroeg, geen bleeder)
//   [S20] Zoektermvervuiling    — verouderde negatives op de importcampagne (jobs/tickets/gratis)
//
// Objective-dekking (17 augustus 2026, masterplan 16.3): Meta en LinkedIn hebben elk twee extra
// campagnes met een ander objective, zodat lib/meta/campaign-analysis.ts en
// lib/linkedin/campaign-analysis.ts over meerdere objectives getest kunnen worden, niet alleen
// de twee/een die de scenario's hierboven al gebruikten.
//   Meta:     OUTCOME_TRAFFIC (CTR daalt, spend stijgt), OUTCOME_LEADS (manualChecks-dekking)
//   LinkedIn: WEBSITE_VISITS (kliks dalen, spend stijgt), VIDEO_VIEWS (voltooiing 10%)
//
// Draaien:
//   npx tsx scripts/demo/seed-demo-client.ts            # insert via supabase-js (env nodig)
//   npx tsx scripts/demo/seed-demo-client.ts --sql      # print SQL (voor de Management API)
//   npx tsx scripts/demo/seed-demo-client.ts --check    # bewijs: draai de detectors op de data
// ============================================================================

import { fysiekeTabel } from "../../lib/data-access/feitentabellen";
import { createClient } from "@supabase/supabase-js";
import type { MetaObjective } from "../../lib/meta/campaign-types";
import type { LinkedInObjective } from "../../lib/linkedin/campaign-types";
import { splitInt } from "../../lib/demo/split";

export const DEMO_CLIENT = "demo-greentech";
const DEMO_NAME = "DEMO — GreenTech (fictief)";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: string, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return iso(d); };

// Ankerdatum: "vandaag" voor de gegenereerde reeksen. Bewust vast, zodat de scenario's
// stabiel blijven; ruim binnen de 70-dagen-vensters van de signaal-routes.
const TODAY = new Date().toISOString().slice(0, 10);
const monthsBack = (n: number) => { const d = new Date(TODAY); d.setDate(1); d.setMonth(d.getMonth() - n); return iso(d); };

// ── Google: maanddata per campagne met event-cycli ─────────────────────────
// GRT-edities: vorig jaar juni en dit jaar juni (jaarlijks). De 2026-aanloop ligt bewust
// ~35% achter op 2025 bij vrijwel gelijke spend [S10].
interface GMonth { campaign: string; monthIdx: number; imp: number; clicks: number; cost: number; conv: number; value: number }

// Gemiddelde orderwaarde per beurs/segment -- eerder stond hier overal value:0, waardoor omzet en
// ROAS voor GRT/GRA/GRN identiek (nul) waren, ongeacht hoe de conversies liepen. Amerikaanse
// standaanvragen (GRA) zijn gemiddeld groter dan de jonge, nog kleinschalige Canadese markt (GRN);
// Brand is het hoogste-intent verkeer en dus de hoogste AOV.
const GOOGLE_AOV: Record<string, number> = {
  "GRT | Search | NL": 180, "GRT | Performance Max": 150,
  "GRA | Search | US": 220, "GRN | Search | NA": 140,
  "GreenTech | Brand": 200, "GreenTech | Display | Prospecting": 80,
};

// maandIdx 0 = huidige maand, 1 = vorige, ... 23 = 2 jaar terug.
function googleMonthly(): GMonth[] {
  const rows: GMonth[] = [];
  // Eventcyclus-vorm: aanloop piekt richting de beursmaand (juni voor GRT, sept voor GRA).
  const grtCycle = (mIdx: number, factor: number) => {
    const month = new Date(monthsBack(mIdx)).getMonth() + 1; // 1..12
    const dist = Math.min(Math.abs(month - 6), 12 - Math.abs(month - 6)); // afstand tot juni
    const ramp = dist <= 5 ? (6 - dist) / 6 : 0.15;
    return Math.round(factor * (0.25 + ramp));
  };
  for (let m = 23; m >= 0; m--) {
    const thisYear = m < 12; // jongste 12 maanden = het "achterliggende" jaar [S10]
    const grtConvFactor = thisYear ? 26 : 40; // 2026-aanloop ~35% lager dan 2025
    const grtConv = grtCycle(m, grtConvFactor);
    rows.push({ campaign: "GRT | Search | NL", monthIdx: m, imp: 42000, clicks: 2100, cost: 4150 + (m % 3) * 50, conv: grtConv, value: grtConv * GOOGLE_AOV["GRT | Search | NL"] });
    const grtPmaxConv = grtCycle(m, thisYear ? 12 : 18);
    rows.push({ campaign: "GRT | Performance Max", monthIdx: m, imp: 61000, clicks: 1500, cost: 2600, conv: grtPmaxConv, value: grtPmaxConv * GOOGLE_AOV["GRT | Performance Max"] });
    // GRA: beurs in september, beide jaren op koers (+10% dit jaar) [S11]
    const graMonth = new Date(monthsBack(m)).getMonth() + 1;
    const graDist = Math.min(Math.abs(graMonth - 9), 12 - Math.abs(graMonth - 9));
    const graRamp = graDist <= 5 ? (6 - graDist) / 6 : 0.15;
    const graConv = Math.round((thisYear ? 33 : 30) * (0.25 + graRamp));
    rows.push({ campaign: "GRA | Search | US", monthIdx: m, imp: 30000, clicks: 1400, cost: 3000, conv: graConv, value: graConv * GOOGLE_AOV["GRA | Search | US"] });
    // GRN: dunne, jonge reeks (alleen laatste 8 maanden) [S12]
    if (m < 8) rows.push({ campaign: "GRN | Search | NA", monthIdx: m, imp: 9000, clicks: 380, cost: 900, conv: 8, value: 8 * GOOGLE_AOV["GRN | Search | NA"] });
    // Brand: stabiel, +18% klikken in de golf-maanden (oogst van de social-golf) [S7].
    // m<=1: de laatste volle maand en de lopende maand (detectors sluiten de lopende uit).
    const brandClicks = m <= 1 ? 1180 : 1000;
    rows.push({ campaign: "GreenTech | Brand", monthIdx: m, imp: 15000, clicks: brandClicks, cost: 500, conv: 45, value: 45 * GOOGLE_AOV["GreenTech | Brand"] });
    rows.push({ campaign: "GreenTech | Display | Prospecting", monthIdx: m, imp: 90000, clicks: 700, cost: 800, conv: 2, value: 2 * GOOGLE_AOV["GreenTech | Display | Prospecting"] });
  }
  return rows;
}

// ── Meta: dag-data met de creative-scenario's [S1-S4, S7, S8] ─────────────
interface MetaDaily { entity: string; date: string; imp: number; linkClicks: number; spend: number; conv: number; freq: number | null; hook: number | null; hold: number | null; qr?: string | null; er?: string | null; cr?: string | null; lpv?: number; atc?: number; ic?: number; leads?: number }

const META_ADS = [
  { id: "demo-ad-hero-a", name: "Hero Video A", campaign: "demo-mc-awareness" },
  { id: "demo-ad-lifestyle-b", name: "Lifestyle Video B", campaign: "demo-mc-awareness" },
  { id: "demo-ad-banner-c", name: "Static Banner C", campaign: "demo-mc-retargeting" },
  { id: "demo-ad-carousel-d", name: "Product Carousel D", campaign: "demo-mc-retargeting" },
];
const META_CAMPAIGNS = [
  // GRT in de naam zodat de beurs-scope (Fase 3) ook op Meta demonstreerbaar is; retargeting
  // blijft generiek zodat de "hele account vs beurs"-splitsing zichtbaar wordt.
  // objective per campagne eerlijk gezet op wat de naam/scenario betekent (17 augustus 2026,
  // masterplan 16.3) -- voorheen kregen beide campagnes hardcoded OUTCOME_AWARENESS, ook
  // Retargeting, wat het nieuwe objective-gedreven lib/meta/campaign-types.ts meteen fout zou
  // classificeren voor een campagne die converteert (add_to_cart/initiate_checkout in de data).
  { id: "demo-mc-awareness", name: "GRT | Awareness EU", objective: "OUTCOME_AWARENESS" },
  { id: "demo-mc-retargeting", name: "GreenTech Retargeting", objective: "OUTCOME_SALES" },
  // 17 augustus 2026, masterplan 16.3: twee extra objectives zodat de demo-klant de nieuwe
  // objective-gedreven analyse (lib/meta/campaign-types.ts + campaign-analysis.ts) over meer dan
  // twee van de zes ODAX-objectives daadwerkelijk kan testen.
  { id: "demo-mc-traffic", name: "GreenTech Blog Traffic", objective: "OUTCOME_TRAFFIC" },
  { id: "demo-mc-leads", name: "GreenTech Demo Aanvraag", objective: "OUTCOME_LEADS" },
  // GRA/GRN op Meta -- voorheen bestond alleen GRT hier, waardoor de beurs-scope (campagnenaam-
  // filter) voor GRA/GRN op Meta altijd leeg was. GRA spiegelt [S11] (gestage groei, op koers);
  // GRN spiegelt [S12] (jonge campagne, pas de laatste weken actief).
  { id: "demo-mc-gra-awareness", name: "GRA | Awareness US", objective: "OUTCOME_AWARENESS" },
  { id: "demo-mc-grn-leads", name: "GRN | Lead Gen NA", objective: "OUTCOME_LEADS" },
];

// Gemiddelde orderwaarde per Meta-entiteit -- eerder overal conversion_value:0, waardoor Meta-
// ROAS voor elk kanaal en elke beurs identiek (nul) was. GRA (VS) heeft grotere deals dan de
// jonge GRN-markt; de ads erven de AOV van hun campagne.
const META_AOV: Record<string, number> = {
  "demo-mc-awareness": 140, "demo-mc-retargeting": 150, "demo-mc-traffic": 90, "demo-mc-leads": 160,
  "demo-mc-gra-awareness": 175, "demo-mc-grn-leads": 105, "demo-meta-account": 130,
  "demo-ad-hero-a": 140, "demo-ad-lifestyle-b": 140, "demo-ad-banner-c": 150, "demo-ad-carousel-d": 150,
};
const metaAov = (entity: string): number => META_AOV[entity] ?? 130;

function metaAdDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28; // recent venster vs prior venster
    // [S1] Hero A: CTR zakt van 1.2% naar 0.7% terwijl frequency op 4.2 staat; blijft converteren.
    rows.push({ entity: "demo-ad-hero-a", date, imp: 1600, linkClicks: recent ? 11 : 19, spend: 55, conv: 2, freq: recent ? 4.2 : 3.1, hook: 0.42, hold: 0.3 });
    // Lifestyle B: gezond en stabiel (moet stil blijven).
    rows.push({ entity: "demo-ad-lifestyle-b", date, imp: 1400, linkClicks: 17, spend: 45, conv: 2, freq: 2.2, hook: 0.5, hold: 0.35 });
    // [S3] Banner C: recent BELOW_AVERAGE quality ranking.
    rows.push({ entity: "demo-ad-banner-c", date, imp: 900, linkClicks: 8, spend: 25, conv: 1, freq: 2.6, hook: 0.44, hold: 0.3, qr: recent ? "BELOW_AVERAGE_10" : "AVERAGE", er: "AVERAGE", cr: "AVERAGE" });
    // [S4] Carousel D: hook-rate ver onder de account-mediaan.
    rows.push({ entity: "demo-ad-carousel-d", date, imp: 1100, linkClicks: 10, spend: 30, conv: 1, freq: 2.4, hook: 0.12, hold: 0.1 });
  }
  return rows;
}

function metaCampaignDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28;
    // [S2] Awareness-campagne zit recent op frequency 4.6.
    rows.push({ entity: "demo-mc-awareness", date, imp: 3000, linkClicks: 28, spend: 100, conv: 4, freq: recent ? 4.6 : 3.0, hook: null, hold: null });
    rows.push({ entity: "demo-mc-retargeting", date, imp: 2000, linkClicks: 18, spend: 55, conv: 2, freq: 2.5, hook: null, hold: null });
    // Traffic: CTR zakt van 1,2% naar 0,6% terwijl besteding juist stijgt -- duurdere kliks voor
    // hetzelfde resultaat, het cpc-rising-scenario voor OUTCOME_TRAFFIC.
    rows.push({ entity: "demo-mc-traffic", date, imp: 4000, linkClicks: recent ? 24 : 48, spend: recent ? 220 : 150, conv: 3, freq: null, hook: null, hold: null });
    // Leads: geen tweede Leads-campagne in de demo, dus geen CPL-baseline om tegen af te zetten
    // (getest los in __meta_campaign_analysis_test.ts) -- hier gaat het om de manualChecks
    // (form-completion, leadkwaliteit) die ook zonder baseline al relevant zijn.
    rows.push({ entity: "demo-mc-leads", date, imp: 1800, linkClicks: 22, spend: 95, conv: 2, freq: null, hook: null, hold: null, leads: 1.6 });
    // [S11-Meta] GRA: aanloop naar september, spend/kliks lopen geleidelijk op -- spiegelt de
    // gezonde Google-koers voor dezelfde beurs.
    rows.push({ entity: "demo-mc-gra-awareness", date, imp: recent ? 3600 : 2200, linkClicks: recent ? 34 : 19, spend: recent ? 140 : 80, conv: recent ? 5 : 2, freq: null, hook: null, hold: null });
    // [S12-Meta] GRN: jonge campagne, pas de laatste 3 weken actief -- "eerste editie".
    if (d < 21) rows.push({ entity: "demo-mc-grn-leads", date, imp: 900, linkClicks: 9, spend: 45, conv: 1, freq: null, hook: null, hold: null, leads: 0.7 });
  }
  return rows;
}

// Account-dagniveau voedt de blended view. 160 dagen => 4+ VOLLE maanden. De boosts zijn
// op kalendermaand uitgelijnd (de detectors sluiten de lopende, halve maand uit): de golf
// [S7] zit in de laatste volle maand en loopt door in de lopende maand.
const CUR_MONTH = TODAY.slice(0, 7);
const PREV_FULL_MONTH = monthsBack(1).slice(0, 7);
const isSurgeMonth = (date: string) => { const m = date.slice(0, 7); return m === CUR_MONTH || m === PREV_FULL_MONTH; };

function metaAccountDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 159; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const surge = isSurgeMonth(date);
    // Funnel-fasen: landing->winkelwagen zakt in de laatste 28 dagen van 20% naar 12%
    // (materiele drop-off voor de losse funnel-analyse), de rest blijft stabiel.
    const recent28 = d < 28;
    rows.push({ entity: "demo-meta-account", date, imp: surge ? 7000 : 5000, linkClicks: surge ? 63 : 45, spend: 150, conv: 6, freq: null, hook: null, hold: null, lpv: 30, atc: recent28 ? 3.6 : 6, ic: recent28 ? 2.4 : 4 });
  }
  return rows;
}

// Waar het budget heen gaat, per uitsplitsing (17.38: de opener op Meta Overzicht toont dit als
// donut naast de kaart, net als CampaignTypeSplit bij Google -- die had precies dit euvel
// (ads_campaign_monthly.campaign_type stond leeg) tot de seed het vulde). meta_breakdown_daily
// had een client-side mock (lib/demo/demo-rows.ts) maar nooit een rij in de ECHTE tabel; dbSelect
// (client-read.ts) leest altijd de echte tabel, ook in demo-modus -- de mock wordt daar niet
// voor gebruikt. Vijf dimensies, elk met een scheve verdeling (één duidelijke koploper) zodat de
// donut iets te tonen heeft.
const META_BREAKDOWN_SEGMENTS: { type: string; value: string; spend: number; conv: number }[] = [
  { type: "platform_position", value: "feed", spend: 18, conv: 1.4 },
  { type: "platform_position", value: "reels", spend: 13, conv: 0.3 },
  { type: "platform_position", value: "story", spend: 6, conv: 0.6 },
  { type: "publisher_platform", value: "facebook", spend: 20, conv: 1.6 },
  { type: "publisher_platform", value: "instagram", spend: 14, conv: 0.7 },
  { type: "publisher_platform", value: "audience_network", spend: 4, conv: 0.1 },
  { type: "device_platform", value: "mobile", spend: 26, conv: 1.9 },
  { type: "device_platform", value: "desktop", spend: 8, conv: 0.4 },
  { type: "age", value: "25-34", spend: 16, conv: 1.3 },
  { type: "age", value: "35-44", spend: 12, conv: 0.6 },
  { type: "age", value: "45-54", spend: 6, conv: 0.2 },
  { type: "gender", value: "female", spend: 19, conv: 1.2 },
  { type: "gender", value: "male", spend: 15, conv: 0.9 },
];
function metaBreakdownDaily(): Row[] {
  const rows: Row[] = [];
  for (let d = 59; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    for (const s of META_BREAKDOWN_SEGMENTS) {
      rows.push({
        client_id: DEMO_CLIENT, date, level: "account", entity_id: "act",
        breakdown_type: s.type, breakdown_value: s.value,
        impressions: Math.round(s.spend * 40), clicks_all: Math.round(s.spend * 0.9), link_clicks: Math.round(s.spend * 0.8),
        spend: s.spend, conversions: s.conv, conversion_value: Math.round(s.conv * 120),
      });
    }
  }
  return rows;
}

// ── LinkedIn: dag-data [S5, S6, S7, S8, S9] ────────────────────────────────
interface LiDaily { urn: string; date: string; imp: number; clicks: number; spend: number; leads: number; opens: number; conv: number; vidStart: number; vidDone: number }

const LI_CAMPAIGNS = [
  { urn: "urn:li:sponsoredCampaign:demo1", name: "GRT ABM Benelux", objective: "LEAD_GENERATION" },
  { urn: "urn:li:sponsoredCampaign:demo2", name: "GreenTech Lead Gen EU", objective: "LEAD_GENERATION" },
  // 17 augustus 2026, masterplan 16.3: twee extra objectives zodat de demo-klant de nieuwe
  // objective-gedreven analyse (lib/linkedin/campaign-types.ts + campaign-analysis.ts) over meer
  // dan één van de zeven objectiveType-waarden daadwerkelijk kan testen.
  { urn: "urn:li:sponsoredCampaign:demo3", name: "GreenTech Gids Downloads", objective: "WEBSITE_VISITS" },
  { urn: "urn:li:sponsoredCampaign:demo4", name: "GreenTech Productvideo", objective: "VIDEO_VIEWS" },
  // GRA/GRN op LinkedIn -- voorheen bestond alleen GRT hier, dus was de beurs-scope voor GRA/GRN
  // op LinkedIn altijd leeg. Toegevoegd aan het EIND (niet ertussenin): liCampaignDaily/liAccountDaily
  // en het --check-blok verwijzen naar LI_CAMPAIGNS[0..3] op index, dus invoegen zou die verschuiven.
  { urn: "urn:li:sponsoredCampaign:demo5", name: "GRA ABM Americas", objective: "LEAD_GENERATION" },
  { urn: "urn:li:sponsoredCampaign:demo6", name: "GRN Lead Gen NA", objective: "LEAD_GENERATION" },
];

// Gemiddelde orderwaarde per LinkedIn-campagne -- eerder overal conversion_value:0. GRA (VS) sluit
// grotere deals dan de jonge GRN-markt; de twee content-campagnes (Gids Downloads/Productvideo)
// converteren per ontwerp niet (altijd conv:0 in liCampaignDaily), dus hun AOV is irrelevant.
const LI_AOV: Record<string, number> = {
  "urn:li:sponsoredCampaign:demo1": 260, "urn:li:sponsoredCampaign:demo2": 220,
  "urn:li:sponsoredCampaign:demo5": 300, "urn:li:sponsoredCampaign:demo6": 190,
  "demo-li-account": 240,
};
const liAov = (urn: string): number => LI_AOV[urn] ?? 240;

// Fractionele dag-snelheden (bijv. 0,25 leads/dag) horen bij lage-volume LinkedIn-campagnes en
// moeten desondanks als geheel getal de database in (one_click_leads/one_click_lead_form_opens/
// external_website_conversions zijn bigint, migratie 008). Los per dag afronden zou 0,25/dag
// STRUCTUREEL naar 0 afronden -- elke dag apart -- en zo de hele S5/S6/S8-scenario's leegtrekken
// in plaats van ze te spreiden. Cumulatief afronden bewaart de bedoelde som exact en levert per
// dag toch een geldig heel getal (17 augustus 2026, ontdekt bij de eerste echte insert-run: een
// eerdere versie van dit bestand werkte alleen ooit via --check, dat gaat via JS-getallen en
// merkt een niet-geheel-getal in een bigint-kolom nooit).
function heelGetal(staat: { cum: number; vorig: number }, perDag: number): number {
  staat.cum += perDag;
  const afgerond = Math.round(staat.cum);
  const delta = afgerond - staat.vorig;
  staat.vorig = afgerond;
  return delta;
}

function liCampaignDaily(): LiDaily[] {
  const rows: LiDaily[] = [];
  const s0 = { leads: { cum: 0, vorig: 0 }, opens: { cum: 0, vorig: 0 }, conv: { cum: 0, vorig: 0 } };
  const s1 = { leads: { cum: 0, vorig: 0 }, opens: { cum: 0, vorig: 0 }, conv: { cum: 0, vorig: 0 } };
  const s4 = { leads: { cum: 0, vorig: 0 }, opens: { cum: 0, vorig: 0 }, conv: { cum: 0, vorig: 0 } };
  const s5 = { leads: { cum: 0, vorig: 0 }, opens: { cum: 0, vorig: 0 }, conv: { cum: 0, vorig: 0 } };
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28;
    // [S5]+[S6] GRT ABM: 10% form-completion op ruime opens; spend recent hoger bij gelijke leads => CPL +25%.
    rows.push({ urn: LI_CAMPAIGNS[0].urn, date, imp: 1500, clicks: 30, spend: recent ? 125 : 100, leads: heelGetal(s0.leads, 0.25), opens: heelGetal(s0.opens, recent ? 2.5 : 2.2), conv: heelGetal(s0.conv, 0.3), vidStart: 40, vidDone: 22 });
    // Lead Gen EU: gezond (completion ~30%, stabiele CPL) — hoort stil te blijven.
    rows.push({ urn: LI_CAMPAIGNS[1].urn, date, imp: 1200, clicks: 26, spend: 90, leads: heelGetal(s1.leads, 0.9), opens: heelGetal(s1.opens, 3), conv: heelGetal(s1.conv, 0.5), vidStart: 35, vidDone: 20 });
    // Gids Downloads (WEBSITE_VISITS): kliks dalen terwijl besteding stijgt — duurdere kliks
    // voor hetzelfde resultaat, het cpc-issue-scenario.
    rows.push({ urn: LI_CAMPAIGNS[2].urn, date, imp: 2200, clicks: recent ? 18 : 34, spend: recent ? 140 : 95, leads: 0, opens: 0, conv: 0, vidStart: 0, vidDone: 0 });
    // Productvideo (VIDEO_VIEWS): lage voltooiing (10%) — de meeste kijkers haken vroeg af.
    rows.push({ urn: LI_CAMPAIGNS[3].urn, date, imp: 3000, clicks: 12, spend: 60, leads: 0, opens: 0, conv: 0, vidStart: 200, vidDone: 20 });
    // [S11-LinkedIn] GRA: aanloop naar september, spend/leads lopen geleidelijk op -- spiegelt
    // dezelfde gezonde koers als Google en Meta voor deze beurs.
    rows.push({ urn: LI_CAMPAIGNS[4].urn, date, imp: recent ? 1800 : 1100, clicks: recent ? 28 : 16, spend: recent ? 130 : 70, leads: heelGetal(s4.leads, recent ? 0.6 : 0.3), opens: heelGetal(s4.opens, recent ? 2.0 : 1.2), conv: heelGetal(s4.conv, recent ? 0.5 : 0.2), vidStart: 0, vidDone: 0 });
    // [S12-LinkedIn] GRN: jonge campagne, pas de laatste 3 weken actief -- "eerste editie".
    if (d < 21) rows.push({ urn: LI_CAMPAIGNS[5].urn, date, imp: 600, clicks: 7, spend: 35, leads: heelGetal(s5.leads, 0.2), opens: heelGetal(s5.opens, 0.8), conv: heelGetal(s5.conv, 0.1), vidStart: 0, vidDone: 0 });
  }
  return rows;
}

function liAccountDaily(): LiDaily[] {
  const rows: LiDaily[] = [];
  const s = { leads: { cum: 0, vorig: 0 }, opens: { cum: 0, vorig: 0 }, conv: { cum: 0, vorig: 0 } };
  for (let d = 159; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const surge = isSurgeMonth(date);
    // [S8] Golf-maand: spend x3 met evenredig meer conversies => eigen CPA stabiel (~150),
    // maar het blended gewicht verschuift naar het dure kanaal (mix-druk zichtbaar).
    // [S7] Vertoningen mee omhoog: onderdeel van de zaai-golf.
    rows.push({ urn: "demo-li-account", date, imp: surge ? 3400 : 2400, clicks: surge ? 62 : 45, spend: surge ? 300 : 100, leads: heelGetal(s.leads, surge ? 1.4 : 1.1), opens: heelGetal(s.opens, 5), conv: heelGetal(s.conv, surge ? 2.0 : 0.66), vidStart: 70, vidDone: 40 });
  }
  return rows;
}

// [S9] Demografie: 75% van de leads uit "Education", buiten het Google-ICP (Operations/Growers).
const LI_DEMO_FUNCTIONS = [
  { urn: "urn:li:function:demo-edu", label: "Education", leadsPerDay: 0.9 },
  { urn: "urn:li:function:demo-ops", label: "Operations", leadsPerDay: 0.3 },
];

// ── Microsoft (Bing): search op ~10% van de Google-volumes [S14-S20] ───────
// Grondwaarheid is het AD-GROUP-niveau: campagne- en accountdagen worden er per dag uit opgeteld
// en de breakdown-segmenten worden uit de accountdag verdeeld -- afleiden, niet verzinnen: de
// niveaus sommeren exact naar elkaar, en controles op die sommen mogen daarop rekenen.

const MS_CAMPAIGNS = [
  // [S14] Als Google-import geboren; de drift zelf (verouderde negatives, niet-vertaalde
  // bid-mapping) zit in de dagdata hieronder, niet in deze metadata.
  { id: "demo-ms-import", name: "GRT | Search | NL (import)", budget: 30, bid: "enhanced_cpc", importSource: "google_ads" as string | null },
  { id: "demo-ms-native", name: "GreenTech | Search | Native", budget: 20, bid: "target_cpa", importSource: null },
  { id: "demo-ms-brand", name: "GreenTech | Brand | Bing", budget: 5, bid: "manual_cpc", importSource: null },
];
const MS_ADGROUPS = [
  { id: "demo-msag-import-generiek", campaign: "demo-ms-import", name: "GRT Generiek (import)" },
  { id: "demo-msag-import-beurs", campaign: "demo-ms-import", name: "GRT Beurs (import)" },
  { id: "demo-msag-native-kassen", campaign: "demo-ms-native", name: "Kassen & Teelt" },
  { id: "demo-msag-native-toeleveranciers", campaign: "demo-ms-native", name: "Toeleveranciers" },
  { id: "demo-msag-brand", campaign: "demo-ms-brand", name: "Brand NL" },
];
// Zelfde AOV-redenering als GOOGLE_AOV/META_AOV: brand is het hoogste-intent verkeer.
const MS_AOV: Record<string, number> = { "demo-ms-import": 170, "demo-ms-native": 180, "demo-ms-brand": 200 };

interface MsDaily { adgroup: string; campaign: string; date: string; imp: number; clicks: number; spend: number; conv: number }
const r3ms = (v: number) => Math.round(v * 1000) / 1000;

// 400 dagen => 13+ maanden voor de maandanalyse-trend. Conversies zijn numeric (geen bigint),
// dus fractionele dagsnelheden mogen hier gewoon de database in -- geen heelGetal() nodig.
function msAdgroupDaily(): MsDaily[] {
  const rows: MsDaily[] = [];
  for (let d = 399; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const maand = Number(date.slice(5, 7));
    // Seizoen alleen op de beurs-adgroup: aanloop naar GRT in mei/juni.
    const seizoen = maand === 5 || maand === 6 ? 1.4 : 1;
    // [S14] De drift: de importcampagne verliest over de laatste 12 weken lineair 40% van zijn
    // conversiesnelheid bij gelijkblijvende spend -- de CPA loopt op van ~14 naar ~24, terwijl
    // de native campagne ernaast strak blijft draaien.
    const drift = d < 84 ? 1 - ((84 - d) / 84) * 0.4 : 1;
    rows.push({ adgroup: "demo-msag-import-generiek", campaign: "demo-ms-import", date, imp: 220, clicks: 9, spend: 12, conv: r3ms(0.85 * drift) });
    rows.push({ adgroup: "demo-msag-import-beurs", campaign: "demo-ms-import", date, imp: Math.round(110 * seizoen), clicks: Math.round(4 * seizoen), spend: 6, conv: r3ms(0.4 * drift * seizoen) });
    rows.push({ adgroup: "demo-msag-native-kassen", campaign: "demo-ms-native", date, imp: 150, clicks: 6, spend: 8, conv: 0.6 });
    rows.push({ adgroup: "demo-msag-native-toeleveranciers", campaign: "demo-ms-native", date, imp: 80, clicks: 3, spend: 4, conv: 0.26 });
    rows.push({ adgroup: "demo-msag-brand", campaign: "demo-ms-brand", date, imp: 60, clicks: 5, spend: 3, conv: 0.5 });
  }
  return rows;
}

// [S15]+[S17] De verdeel-assen over de accountdag; conversies wegen naar search en naar desktop.
// Audience Network: 18% van spend tegen 1% van conversies -- het lek-criterium uit de adapter
// (>10% spend bij CPA > 2x search) moet hierop aanslaan.
const MS_NETWERK = [
  { value: "Search", spendW: 0.7, convW: 0.93, impW: 0.55 },
  { value: "Syndicated search partners", spendW: 0.12, convW: 0.06, impW: 0.2 },
  { value: "Audience Network", spendW: 0.18, convW: 0.01, impW: 0.25 },
];
const MS_DEVICE = [
  { value: "Desktop", spendW: 0.68, convW: 0.8, impW: 0.62 },
  { value: "Mobile", spendW: 0.28, convW: 0.17, impW: 0.33 },
  { value: "Tablet", spendW: 0.04, convW: 0.03, impW: 0.05 },
];

// Verdeel een (mogelijk fractioneel) totaal exact over gewichten: alles behalve het laatste
// segment wordt op centen afgerond, het laatste krijgt de rest -- de segmenten sommeren zo altijd
// exact naar het accounttotaal (zelfde bedoeling als splitInt, maar dan voor euro's en conversies).
function verdeelExact(totaal: number, gewichten: number[]): number[] {
  const delen = gewichten.map((w) => Math.round(totaal * w * 100) / 100);
  const som = delen.slice(0, -1).reduce((s, v) => s + v, 0);
  delen[delen.length - 1] = Math.round((totaal - som) * 100) / 100;
  return delen;
}

// ── Instellingen: edities, doelen, ICP ─────────────────────────────────────
const year = Number(TODAY.slice(0, 4));
// GRT's editiedatum (10 juni) staat los van TODAY, en googleMonthly()'s aanloop-vorm (grtCycle)
// is kalendermaand-cyclisch en blijft dus altijd geldig -- maar de EDITIE-lijst voor de
// event-relatieve vergelijking [S10] moet een "aanstaande" editie bevatten, anders pikt
// pickCurrentEdition() (lib/fair/geo-clone-analysis.ts) zodra 10 juni is gepasseerd de editie van
// dit jaar als AFGELOPEN op, en verschuift "huidig"/"vorig" een heel jaar: de aanloop-vergelijking
// mist dan zijn basis (ontdekt via --check toen de asOfDate na 10 juni lag).
//
// De +35 dagen respijt hieronder is zelf ook een fix, niet cosmetisch: zonder respijt springt
// "huidige editie" (zie pickCurrentEdition) de OCHTEND na 10 juni al een vol jaar vooruit. Het
// nieuwe venster (campaignStartDate = editiedatum + FAIR_DURATION_DAYS + 1) begint dan pas net,
// en de enige beschikbare maandpunten liggen op de 1e van de maand -- allebei net buiten het
// "gelijke-dagen-uit"-venster van alignEditionsAtEqualDaysOut(). Resultaat: [S10] faalde 19 van
// de 365 dagen per jaar (11-29 juni) met een lege "0 vs 0"-vergelijking i.p.v. de ontworpen
// ~-35%, gevonden via een dagsweep van scripts/demo/seed-demo-client.ts --check over een heel
// jaar TODAY-waarden nadat de masterplan-notitie "delta -0,06 i.p.v. -35%" op 17 augustus meldde
// dat dit datumafhankelijk was. Met dit respijt blijft `pickCurrentEdition` tot 15 juli
// terugvallen op de editie die net is geweest (bijna een vol jaar opgebouwde data, een eerlijke
// terugblik), en pas daarna schuift de vergelijking vooruit naar de volgende editie -- op dat
// moment staat er al minstens één maandpunt in het nieuwe venster.
const grtEditionPassed = addDays(`${year}-06-10`, 35) < TODAY;
const grtCurrentYear = grtEditionPassed ? year + 1 : year;
const RAI_EVENTS = {
  events: [
    { id: "demo-grt", name: "GreenTech Amsterdam", abbrev: "GRT", cadence: "annual", editions: [
      { date: `${grtCurrentYear - 1}-06-11`, label: `${grtCurrentYear - 1}` },
      { date: `${grtCurrentYear}-06-10`, label: `${grtCurrentYear}` },
    ] },
    { id: "demo-gra", name: "GreenTech Americas", abbrev: "GRA", cadence: "annual", editions: [
      { date: `${year - 1}-09-16`, label: `${year - 1}` },
      { date: `${year}-09-15`, label: `${year}` },
    ] },
    { id: "demo-grn", name: "GreenTech North America", abbrev: "GRN", cadence: "custom", editions: [
      { date: `${year}-11-04`, label: `${year}` },
    ] },
  ],
};
const KPI_TARGETS = { conversionsMode: "absolute", conversionsAbsolute: 2600, conversionsGrowthPct: 0, revenueMode: "absolute", revenueAbsolute: 0, revenueGrowthPct: 0, roasTarget: 0, cpaTarget: 45 };
const AUDIENCE_PROFILE = { google_ads: { job_function: ["Operations", "Grower", "Horticulture Manager"], seniority: ["Senior", "Owner"] } };
const GEO_CLONE_SETTINGS = [
  { geo_clone: "GRT", goals: { conversionsAbsolute: 320 }, event: null, branding: { brandName: "GreenTech Amsterdam (demo)" } },
  { geo_clone: "GRA", goals: { conversionsAbsolute: 200 }, event: null, branding: null },
  // Bescheiden doel: GRN draait pas 8 maanden (m<8 in googleMonthly, "eerste editie" [S12]) --
  // een doel op GRT/GRA-schaal zou de projectie kunstmatig altijd laten missen.
  { geo_clone: "GRN", goals: { conversionsAbsolute: 70 }, event: null, branding: null },
];

// ── Rijen bouwen per tabel ─────────────────────────────────────────────────
type Row = Record<string, unknown>;

export function buildAllRows(): Record<string, Row[]> {
  const g = googleMonthly();
  const byMonth = new Map<number, { imp: number; clicks: number; cost: number; conv: number; value: number }>();
  for (const r of g) {
    const acc = byMonth.get(r.monthIdx) ?? { imp: 0, clicks: 0, cost: 0, conv: 0, value: 0 };
    acc.imp += r.imp; acc.clicks += r.clicks; acc.cost += r.cost; acc.conv += r.conv; acc.value += r.value;
    byMonth.set(r.monthIdx, acc);
  }

  const campaignIdOf = (name: string) => `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Zelfde classificatie als hierbeneden al voor ads_campaign_impression_share gebeurt (SEARCH op
  // de campagnes die daar met de hand zijn opgegeven) -- hier afgeleid uit de campagnenaam, want
  // ads_campaign_monthly dekt ALLE campagnes uit googleMonthly(), niet alleen de drie met
  // impression-share-data. Zonder deze kolom (die tot 17.32 overal null bleef) kan geen enkele
  // "spend per campagnetype"-weergave iets tonen voor deze klant, ook al bestaat de data zelf al
  // jaren -- gevonden bij het bouwen van precies zo'n weergave voor de Google-opener.
  const campagneType = (naam: string): "SEARCH" | "PERFORMANCE_MAX" | "SHOPPING" | "DISPLAY" =>
    naam.includes("Performance Max") ? "PERFORMANCE_MAX" : naam.includes("Display") ? "DISPLAY" : "SEARCH";

  const tables: Record<string, Row[]> = {};

  tables["ads_campaign_monthly"] = g.map((r) => ({
    client_id: DEMO_CLIENT, campaign_id: campaignIdOf(r.campaign), campaign_name: r.campaign, campaign_status: "ENABLED",
    campaign_type: campagneType(r.campaign),
    month: monthsBack(r.monthIdx), impressions: r.imp, clicks: r.clicks, cost: r.cost, conversions: r.conv,
    conversions_value: r.value, ctr: r2(r.clicks / r.imp), avg_cpc: r2(r.cost / r.clicks),
    cost_per_conversion: r.conv > 0 ? r2(r.cost / r.conv) : null, conversion_rate: r2(r.conv / r.clicks),
    roas: r.cost > 0 ? r2(r.value / r.cost) : 0,
  }));

  tables["ads_account_monthly"] = [...byMonth.entries()].map(([mIdx, a]) => ({
    client_id: DEMO_CLIENT, month: monthsBack(mIdx), impressions: a.imp, clicks: a.clicks, cost: a.cost,
    conversions: a.conv, conversions_value: a.value, ctr: r2(a.clicks / a.imp), avg_cpc: r2(a.cost / a.clicks),
    cost_per_conversion: a.conv > 0 ? r2(a.cost / a.conv) : null, conversion_rate: r2(a.conv / a.clicks),
    roas: a.cost > 0 ? r2(a.value / a.cost) : 0,
  }));

  // Weekdata: de laatste 26 weken, kwart van de maandtotalen (deterministische verdeling).
  const weekly: Row[] = [];
  for (let w = 25; w >= 0; w--) {
    const weekStart = addDays(TODAY, -7 * w - ((new Date(TODAY).getDay() + 6) % 7)); // maandagen
    const mIdx = Math.min(23, Math.max(0, Math.floor((new Date(TODAY).getTime() - new Date(weekStart).getTime()) / (30.44 * 86400000))));
    const a = byMonth.get(mIdx)!;
    const weekValue = r2(a.value / 4.33);
    const weekCost = r2(a.cost / 4.33);
    weekly.push({
      client_id: DEMO_CLIENT, week_start: weekStart, impressions: Math.round(a.imp / 4.33), clicks: Math.round(a.clicks / 4.33),
      cost: weekCost, conversions: Math.round(a.conv / 4.33), conversions_value: weekValue,
      ctr: r2(a.clicks / a.imp), avg_cpc: r2(a.cost / a.clicks), cost_per_conversion: a.conv > 0 ? r2(a.cost / a.conv) : null,
      conversion_rate: r2(a.conv / a.clicks), roas: weekCost > 0 ? r2(weekValue / weekCost) : 0,
    });
  }
  tables["ads_account_weekly"] = weekly;

  // [S13] Impression share, laatste 2 maanden.
  const isRows: Row[] = [];
  for (const mIdx of [1, 0]) {
    const month = monthsBack(mIdx);
    isRows.push(
      { client_id: DEMO_CLIENT, campaign_id: campaignIdOf("GRT | Search | NL"), campaign_name: "GRT | Search | NL", campaign_type: "SEARCH", month, impressions: 42000, clicks: 2100, cost: 4200, conversions: 26, search_impression_share: 0.55, search_budget_lost_is: 0.28, search_rank_lost_is: 0.05, daily_budget: 140, budget_utilization: 0.97 },
      { client_id: DEMO_CLIENT, campaign_id: campaignIdOf("GRA | Search | US"), campaign_name: "GRA | Search | US", campaign_type: "SEARCH", month, impressions: 30000, clicks: 1400, cost: 3000, conversions: 30, search_impression_share: 0.62, search_budget_lost_is: 0.04, search_rank_lost_is: 0.22, daily_budget: 100, budget_utilization: 0.7 },
      { client_id: DEMO_CLIENT, campaign_id: campaignIdOf("GreenTech | Brand"), campaign_name: "GreenTech | Brand", campaign_type: "SEARCH", month, impressions: 15000, clicks: 1000, cost: 500, conversions: 45, search_impression_share: 0.93, search_budget_lost_is: 0.01, search_rank_lost_is: 0.03, daily_budget: 20, budget_utilization: 0.8 },
    );
  }
  tables["ads_campaign_impression_share"] = isRows;

  // Verspillende zoektermen (recent).
  const wasteTerms = ["greenhouse jobs", "tuinbouw vacature", "greentech festival tickets", "gratis kas bouwen", "hydroponics diy home"];
  tables["ads_search_terms_wasteful"] = wasteTerms.map((term, i) => ({
    client_id: DEMO_CLIENT, week_start: addDays(TODAY, -7), search_term: term, campaign_name: "GRT | Search | NL",
    ad_group_name: "GRT Generiek", impressions: 400 + i * 90, clicks: 30 + i * 6, cost: r2(60 + i * 25), match_type: "BROAD",
  }));

  // RSA-assets + ad-meta (fictief domein: de landing-audit toont dan eerlijk het degradatiepad).
  const rsaMonth = monthsBack(0);
  const headlines = ["Ontmoet ons op GreenTech", "Tuinbouwtechniek van morgen", "Boek uw stand nu", "Innovatie in de kas", "GreenTech Amsterdam 2026"];
  tables["google_ads_ad_meta"] = [
    { client_id: DEMO_CLIENT, ad_id: "demo-rsa-1", campaign_name: "GRT | Search | NL", ad_group_name: "GRT Generiek", ad_type: "RESPONSIVE_SEARCH_AD", final_url: "https://demo.greentech-fictief.example/beurs", status: "ENABLED" },
  ];
  tables["google_ads_rsa_assets"] = headlines.map((h, i) => ({
    client_id: DEMO_CLIENT, month: rsaMonth, campaign_name: "GRT | Search | NL", ad_group_name: "GRT Generiek",
    ad_id: "demo-rsa-1", asset_id: `demo-asset-${i}`, field_type: "HEADLINE", asset_text: h, pinned_field: i === 0 ? "HEADLINE_1" : null,
    performance_label: i < 2 ? "BEST" : i < 4 ? "GOOD" : "LOW", impressions: 9000 - i * 1500, clicks: 200 - i * 30, conversions: 5, cost: 300,
  }));

  // Meta-structuur + dagdata.
  // status kent een check-constraint (active/expired/error/disabled); "disabled" markeert
  // eerlijk dat dit geen echte koppeling is, terwijl de currency de blended view voedt.
  tables["meta_connections"] = [{ client_id: DEMO_CLIENT, ad_account_id: "act_demo", token_ref: "demo", currency: "EUR", status: "disabled", last_sync_at: new Date().toISOString() }];
  tables["meta_campaigns"] = META_CAMPAIGNS.map((c) => ({ campaign_id: c.id, client_id: DEMO_CLIENT, name: c.name, objective: c.objective, status: "ACTIVE", effective_status: "ACTIVE" }));
  tables["meta_ads"] = META_ADS.map((a) => ({ ad_id: a.id, adset_id: `${a.campaign}-as1`, campaign_id: a.campaign, client_id: DEMO_CLIENT, name: a.name, status: "ACTIVE", effective_status: "ACTIVE" }));
  // Alleen meta_ad_daily kent de ranking-kolommen; campagne- en account-niveau niet.
  const metaBase = (r: MetaDaily): Row => ({
    client_id: DEMO_CLIENT, date: r.date, entity_id: r.entity, impressions: r.imp, link_clicks: r.linkClicks,
    spend: r.spend, conversions: r.conv, conversion_value: Math.round(r.conv * metaAov(r.entity) * 100) / 100,
    frequency: r.freq, hook_rate: r.hook, hold_rate: r.hold,
    landing_page_views: r.lpv ?? null, add_to_cart: r.atc ?? null, initiate_checkout: r.ic ?? null, leads: r.leads ?? null,
  });
  tables["meta_ad_daily"] = metaAdDaily().map((r) => ({
    ...metaBase(r), quality_ranking: r.qr ?? null, engagement_rate_ranking: r.er ?? null, conversion_rate_ranking: r.cr ?? null,
  }));
  tables["meta_campaign_daily"] = metaCampaignDaily().map(metaBase);
  tables["meta_account_daily"] = metaAccountDaily().map(metaBase);
  tables["meta_breakdown_daily"] = metaBreakdownDaily();

  // LinkedIn-structuur + dagdata.
  tables["linkedin_connections"] = [{ client_id: DEMO_CLIENT, ad_account_urn: "urn:li:sponsoredAccount:demo", token_ref: "demo", status: "disabled", currency: "EUR", last_sync_at: new Date().toISOString() }];
  tables["linkedin_campaigns"] = LI_CAMPAIGNS.map((c) => ({ campaign_urn: c.urn, client_id: DEMO_CLIENT, name: c.name, status: "ACTIVE", objective_type: c.objective }));
  const liRow = (r: LiDaily): Row => ({
    client_id: DEMO_CLIENT, date: r.date, entity_urn: r.urn, impressions: r.imp, clicks: r.clicks, spend: r.spend,
    one_click_leads: r.leads, one_click_lead_form_opens: r.opens, external_website_conversions: r.conv,
    conversion_value: Math.round(r.conv * liAov(r.urn) * 100) / 100, video_starts: r.vidStart, video_completions: r.vidDone,
  });
  tables["linkedin_campaign_daily"] = liCampaignDaily().map(liRow);
  tables["linkedin_account_daily"] = liAccountDaily().map(liRow);
  tables["linkedin_urn_labels"] = LI_DEMO_FUNCTIONS.map((f) => ({ urn: f.urn, label: f.label, taxonomy: "function" }));
  const demoRows: Row[] = [];
  // leads is bigint (linkedin_demographic_daily); zelfde cumulatieve-afronding als heelGetal()
  // hierboven, anders rondt leadsPerDay (0,9 / 0,3) elke dag apart naar 0 af.
  const demoLeadsStaat = new Map(LI_DEMO_FUNCTIONS.map((f) => [f.urn, { cum: 0, vorig: 0 }]));
  for (let d = 59; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    for (const f of LI_DEMO_FUNCTIONS) {
      demoRows.push({ client_id: DEMO_CLIENT, date, level: "CAMPAIGN", entity_urn: LI_CAMPAIGNS[0].urn, pivot_type: "MEMBER_JOB_FUNCTION", pivot_value_urn: f.urn, impressions: 400, clicks: 9, spend: 30, leads: heelGetal(demoLeadsStaat.get(f.urn)!, f.leadsPerDay), conversions: 0, coverage_pct: 0.9 });
    }
  }
  tables["linkedin_demographic_daily"] = demoRows;

  // Google creative-performance: RSA's met echte tekst + metrics, zodat de Creative
  // Performance-view de tekstpreview kan tonen (de sync vult deze arrays voor echte klanten).
  const rsaCreatives = [
    { ad: "demo-gcr-1", grp: "GRT Generiek", type: "RESPONSIVE_SEARCH_AD", h: "GreenTech Amsterdam 2026 — Boek uw stand", d: "Ontmoet 12.000 tuinbouwprofessionals. Vroegboekkorting tot 1 maart.", url: "https://demo.greentech-fictief.example/beurs", imp: 42000, clk: 2100, cost: 4150, conv: 78 },
    { ad: "demo-gcr-2", grp: "GRT Generiek", type: "RESPONSIVE_SEARCH_AD", h: "Tuinbouwtechniek van morgen", d: "Ontdek de innovaties op GreenTech. Registreer gratis als bezoeker.", url: "https://demo.greentech-fictief.example/bezoek", imp: 61000, clk: 1500, cost: 2600, conv: 30 },
    { ad: "demo-gcr-3", grp: "GRA Search", type: "RESPONSIVE_SEARCH_AD", h: "GreenTech Americas — Mexico City", d: "The horticulture event for the Americas. Book your booth now.", url: "https://demo.greentech-fictief.example/americas", imp: 30000, clk: 1400, cost: 3000, conv: 33 },
    { ad: "demo-gcr-4", grp: "Brand", type: "RESPONSIVE_SEARCH_AD", h: "GreenTech — Officiële website", d: "Alles over de beurs, tickets en exposanten op één plek.", url: "https://demo.greentech-fictief.example", imp: 15000, clk: 1000, cost: 500, conv: 45 },
    { ad: "demo-gcr-5", grp: "GRT Generiek", type: "RESPONSIVE_SEARCH_AD", h: "Gratis kas-inspiratie downloaden", d: "Download de trendgids 2026. (Test: nul conversies.)", url: "https://demo.greentech-fictief.example/gids", imp: 22000, clk: 900, cost: 700, conv: 0 },
  ];
  tables["ads_creative_performance"] = rsaCreatives.map((r) => ({
    client_id: DEMO_CLIENT, month: monthsBack(0), campaign_id: campaignIdOf(r.grp), campaign_name: r.grp,
    ad_group_id: `${r.ad}-grp`, ad_group_name: r.grp, ad_id: r.ad, ad_type: r.type,
    headlines: [r.h], descriptions: [r.d], final_urls: [r.url],
    impressions: r.imp, clicks: r.clk, cost: r.cost, conversions: r.conv,
    ctr: r2(r.clk / r.imp), conversion_rate: r2(r.conv / r.clk),
  }));

  // Meta-creatives: koppel aan de bestaande demo-ads via creative_id, met titel/body/thumbnail.
  const metaCreativeOf: Record<string, { fmt: string; title: string; body: string; cta: string; thumb: string }> = {
    "demo-ad-hero-a": { fmt: "video", title: "GreenTech in 30 seconden", body: "Beleef de sfeer van de beurs — hero-video.", cta: "LEARN_MORE", thumb: "https://picsum.photos/seed/greentech-hero/320/200" },
    "demo-ad-lifestyle-b": { fmt: "single_image", title: "Innovatie in de kas", body: "Lifestyle-beeld met een teler in beeld.", cta: "SIGN_UP", thumb: "https://picsum.photos/seed/greentech-life/320/200" },
    "demo-ad-banner-c": { fmt: "single_image", title: "Boek uw stand", body: "Statische banner met call-to-action.", cta: "BOOK_TRAVEL", thumb: "https://picsum.photos/seed/greentech-banner/320/200" },
    "demo-ad-carousel-d": { fmt: "carousel", title: "Producten op de beurs", body: "Carousel met exposanten.", cta: "SHOP_NOW", thumb: "https://picsum.photos/seed/greentech-carousel/320/200" },
  };
  tables["meta_ads"] = META_ADS.map((a) => ({ ad_id: a.id, adset_id: `${a.campaign}-as1`, campaign_id: a.campaign, client_id: DEMO_CLIENT, name: a.name, status: "ACTIVE", effective_status: "ACTIVE", creative_id: `${a.id}-cr` }));
  tables["meta_creatives"] = META_ADS.map((a) => {
    const c = metaCreativeOf[a.id];
    return { creative_id: `${a.id}-cr`, client_id: DEMO_CLIENT, format: c.fmt, title: c.title, body: c.body, call_to_action_type: c.cta, link_url: "https://demo.greentech-fictief.example", thumbnail_url: c.thumb };
  });

  // LinkedIn-creatives + hun dagmetrics (per creative), zodat de LinkedIn-view rendert.
  const liCreatives = [
    { urn: "urn:li:sponsoredCreative:demo1", camp: LI_CAMPAIGNS[0].urn, fmt: "single_image", headline: "Ontmoet uw ICP op GreenTech", post: "Voor tuinbouw-beslissers: plan een meeting op de beurs.", cta: "Register", img: "https://picsum.photos/seed/li-abm/320/200" },
    { urn: "urn:li:sponsoredCreative:demo2", camp: LI_CAMPAIGNS[1].urn, fmt: "single_image", headline: "Download het beursprogramma", post: "Lead-gen creative met programmagids.", cta: "Download", img: "https://picsum.photos/seed/li-leadgen/320/200" },
  ];
  tables["linkedin_creatives"] = liCreatives.map((c) => ({ creative_urn: c.urn, campaign_urn: c.camp, client_id: DEMO_CLIENT, status: "ACTIVE", format: c.fmt, headline: c.headline, post_text: c.post, cta_label: c.cta, landing_url: "https://demo.greentech-fictief.example", image_storage_path: c.img }));
  const liCreativeDaily: Row[] = [];
  // external_website_conversions/one_click_leads zijn bigint (linkedin_creative_daily); zelfde
  // cumulatieve afronding als heelGetal() hierboven.
  const c0 = { conv: { cum: 0, vorig: 0 }, leads: { cum: 0, vorig: 0 } };
  const c1 = { conv: { cum: 0, vorig: 0 }, leads: { cum: 0, vorig: 0 } };
  for (let d = 45; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    liCreativeDaily.push(
      { client_id: DEMO_CLIENT, date, entity_urn: liCreatives[0].urn, impressions: 800, clicks: 12, spend: 60, external_website_conversions: heelGetal(c0.conv, 0.3), one_click_leads: heelGetal(c0.leads, 0.2), ctr: 0.015 },
      { client_id: DEMO_CLIENT, date, entity_urn: liCreatives[1].urn, impressions: 700, clicks: 16, spend: 50, external_website_conversions: heelGetal(c1.conv, 0.5), one_click_leads: heelGetal(c1.leads, 0.9), ctr: 0.023 },
    );
  }
  tables["linkedin_creative_daily"] = liCreativeDaily;

  // ── Microsoft (Bing): structuur, dag- en maanddata [S14-S20] ──────────────
  tables["microsoft_campaigns"] = MS_CAMPAIGNS.map((c) => ({
    campaign_id: c.id, client_id: DEMO_CLIENT, name: c.name, campaign_type: "search", status: "active",
    daily_budget: c.budget, bid_strategy: c.bid, import_source: c.importSource,
    imported_at: c.importSource ? `${monthsBack(8)}T09:00:00Z` : null,
    serving_status: "eligible",
  }));
  tables["microsoft_adgroups"] = MS_ADGROUPS.map((a) => ({
    adgroup_id: a.id, campaign_id: a.campaign, client_id: DEMO_CLIENT, name: a.name, status: "active",
  }));

  const msAg = msAdgroupDaily();
  interface MsSom { imp: number; clicks: number; spend: number; conv: number; value: number }
  const msDailyRow = (date: string, entity: string, v: MsSom): Row => ({
    client_id: DEMO_CLIENT, date, entity_id: entity,
    impressions: v.imp, clicks: v.clicks, spend: r2(v.spend), conversions: r3ms(v.conv), conversion_value: r2(v.value),
    ctr: v.imp > 0 ? r2(v.clicks / v.imp) : 0, avg_cpc: v.clicks > 0 ? r2(v.spend / v.clicks) : 0,
  });
  tables["microsoft_adgroup_daily"] = msAg.map((r) =>
    msDailyRow(r.date, r.adgroup, { imp: r.imp, clicks: r.clicks, spend: r.spend, conv: r.conv, value: r.conv * MS_AOV[r.campaign] }));

  // Campagne- en accountdagen: exact de som van hun ad groups -- geen eigen verzonnen reeks.
  const msCampagneDag = new Map<string, MsSom>();
  for (const r of msAg) {
    const key = `${r.campaign}::${r.date}`;
    const a = msCampagneDag.get(key) ?? { imp: 0, clicks: 0, spend: 0, conv: 0, value: 0 };
    a.imp += r.imp; a.clicks += r.clicks; a.spend += r.spend; a.conv += r.conv; a.value += r.conv * MS_AOV[r.campaign];
    msCampagneDag.set(key, a);
  }
  tables["microsoft_campaign_daily"] = [...msCampagneDag.entries()].map(([key, v]) =>
    msDailyRow(key.split("::")[1], key.split("::")[0], v));

  const msAccountDag = new Map<string, MsSom>();
  for (const [key, v] of msCampagneDag) {
    const date = key.split("::")[1];
    const a = msAccountDag.get(date) ?? { imp: 0, clicks: 0, spend: 0, conv: 0, value: 0 };
    a.imp += v.imp; a.clicks += v.clicks; a.spend += v.spend; a.conv += v.conv; a.value += v.value;
    msAccountDag.set(date, a);
  }
  tables["microsoft_account_daily"] = [...msAccountDag.entries()].map(([date, v]) => msDailyRow(date, "demo-ms-account", v));

  // [S15]+[S17] Breakdown: de accountdag verdeeld over netwerk- en device-segmenten, laatste 150
  // dagen. splitInt voor de bigint-kolommen, verdeelExact voor euro's en (numerieke) conversies.
  const msBreakdown: Row[] = [];
  const msBreakdownStart = addDays(TODAY, -149);
  for (const [date, v] of [...msAccountDag.entries()].filter(([d]) => d >= msBreakdownStart)) {
    for (const [type, segmenten] of [["network", MS_NETWERK], ["device", MS_DEVICE]] as const) {
      const imp = splitInt(v.imp, segmenten.map((s) => s.impW));
      const clicks = splitInt(v.clicks, segmenten.map((s) => s.impW));
      const spend = verdeelExact(v.spend, segmenten.map((s) => s.spendW));
      const conv = verdeelExact(v.conv, segmenten.map((s) => s.convW));
      const value = verdeelExact(v.value, segmenten.map((s) => s.convW));
      segmenten.forEach((s, i) => {
        msBreakdown.push({
          client_id: DEMO_CLIENT, date, level: "account", entity_id: "demo-ms-account",
          breakdown_type: type, breakdown_value: s.value,
          impressions: imp[i], clicks: clicks[i], spend: spend[i], conversions: conv[i], conversion_value: value[i],
        });
      });
    }
  }
  tables["microsoft_breakdown_daily"] = msBreakdown;

  // [S19] Keywords, maandkorrel: de bleeder boven 2x account-CPA (~15) zonder conversies, de
  // EUR 25-tegenhanger die "te vroeg" moet blijven, en het lage-QS-cluster op de importcampagne.
  const msKeywords = [
    { id: "kassenbouw-offerte", tekst: "kassenbouw offerte", match: "phrase", camp: MS_CAMPAIGNS[1], ag: MS_ADGROUPS[2], imp: 850, clicks: 46, cost: 55, conv: 5, qs: 8 },
    { id: "kas-kopen-zakelijk", tekst: "kas kopen zakelijk", match: "exact", camp: MS_CAMPAIGNS[1], ag: MS_ADGROUPS[2], imp: 400, clicks: 28, cost: 38, conv: 4, qs: 9 },
    { id: "kweekkas-bedrijf", tekst: "kweekkas bedrijf", match: "exact", camp: MS_CAMPAIGNS[1], ag: MS_ADGROUPS[3], imp: 300, clicks: 15, cost: 20, conv: 2, qs: 7 },
    { id: "greentech-amsterdam", tekst: "greentech amsterdam", match: "exact", camp: MS_CAMPAIGNS[2], ag: MS_ADGROUPS[4], imp: 700, clicks: 52, cost: 18, conv: 6, qs: 10 },
    { id: "greenhouse-solutions", tekst: "greenhouse solutions", match: "broad", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[0], imp: 1400, clicks: 60, cost: 68, conv: 0, qs: 4 },
    { id: "greenhouse-equipment", tekst: "greenhouse equipment", match: "broad", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[0], imp: 800, clicks: 34, cost: 42, conv: 1, qs: 4 },
    { id: "tuinbouw-automatisering", tekst: "tuinbouw automatisering", match: "phrase", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[1], imp: 500, clicks: 22, cost: 30, conv: 2, qs: 3 },
    { id: "kas-kopen-tweedehands", tekst: "kas kopen tweedehands", match: "broad", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[0], imp: 300, clicks: 14, cost: 12, conv: 0, qs: 6 },
  ];
  const msMaanden = [5, 4, 3, 2, 1, 0].map((m) => monthsBack(m));
  tables["microsoft_keyword_monthly"] = msMaanden.flatMap((month) => msKeywords.map((k) => ({
    client_id: DEMO_CLIENT, month, campaign_id: k.camp.id, campaign_name: k.camp.name,
    ad_group_id: k.ag.id, ad_group_name: k.ag.name, keyword_id: `demo-mskw-${k.id}`,
    keyword_text: k.tekst, match_type: k.match,
    impressions: k.imp, clicks: k.clicks, cost: k.cost, conversions: k.conv,
    conversions_value: r2(k.conv * MS_AOV[k.camp.id]),
    ctr: r2(k.clicks / k.imp), avg_cpc: r2(k.cost / k.clicks),
    conversion_rate: k.clicks > 0 ? r2(k.conv / k.clicks) : 0,
    cost_per_conversion: k.conv > 0 ? r2(k.cost / k.conv) : null,
    quality_score: k.qs,
  })));

  // [S20] Zoektermen: de vervuiling op de import is precies wat het Google-account als negative
  // kent -- verouderde negatives zijn het gezicht van import-drift.
  const msTermen = [
    { term: "greenhouse jobs", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[0], clicks: 18, cost: 22, conv: 0 },
    { term: "greentech festival tickets", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[1], clicks: 12, cost: 16, conv: 0 },
    { term: "greenhouse gas emissions", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[0], clicks: 11, cost: 14, conv: 0 },
    { term: "gratis kas bouwplan", camp: MS_CAMPAIGNS[0], ag: MS_ADGROUPS[0], clicks: 9, cost: 11, conv: 0 },
    { term: "kassenbouw offerte aanvragen", camp: MS_CAMPAIGNS[1], ag: MS_ADGROUPS[2], clicks: 20, cost: 30, conv: 3 },
    { term: "kas laten bouwen prijs", camp: MS_CAMPAIGNS[1], ag: MS_ADGROUPS[2], clicks: 16, cost: 26, conv: 2 },
    { term: "greentech beurs amsterdam", camp: MS_CAMPAIGNS[2], ag: MS_ADGROUPS[4], clicks: 30, cost: 8, conv: 4 },
  ];
  tables["microsoft_search_terms_monthly"] = msMaanden.flatMap((month) => msTermen.map((t) => ({
    client_id: DEMO_CLIENT, month, campaign_id: t.camp.id, ad_group_id: t.ag.id,
    campaign_name: t.camp.name, ad_group_name: t.ag.name, search_term: t.term, match_type: "broad",
    impressions: t.clicks * 18, clicks: t.clicks, cost: t.cost, conversions: t.conv,
    conversions_value: r2(t.conv * MS_AOV[t.camp.id]), ctr: r2(1 / 18),
    conversion_rate: t.clicks > 0 ? r2(t.conv / t.clicks) : 0,
  })));

  // [S18] Impressieaandeel: het budgetverlies van de import loopt over zes maanden op van 0.10
  // naar 0.26 (en de conversies zakken mee -- de drift-echo), brand staat vrijwel vol, native
  // verliest op positie. Budget- en positieverlies vragen tegengestelde ingrepen.
  tables["microsoft_campaign_impression_share"] = msMaanden.flatMap((month, i) => [
    { client_id: DEMO_CLIENT, campaign_id: MS_CAMPAIGNS[0].id, campaign_name: MS_CAMPAIGNS[0].name, campaign_type: "search", month, impressions: 9900, clicks: 390, cost: 540, conversions: 30 - i * 2, impression_share: r2(0.46 - i * 0.008), budget_lost_is: r2(0.1 + i * 0.032), rank_lost_is: 0.08, daily_budget: 30, budget_utilization: 0.98 },
    { client_id: DEMO_CLIENT, campaign_id: MS_CAMPAIGNS[1].id, campaign_name: MS_CAMPAIGNS[1].name, campaign_type: "search", month, impressions: 6900, clicks: 270, cost: 360, conversions: 26, impression_share: 0.55, budget_lost_is: 0.03, rank_lost_is: 0.18, daily_budget: 20, budget_utilization: 0.72 },
    { client_id: DEMO_CLIENT, campaign_id: MS_CAMPAIGNS[2].id, campaign_name: MS_CAMPAIGNS[2].name, campaign_type: "search", month, impressions: 1800, clicks: 150, cost: 90, conversions: 15, impression_share: 0.93, budget_lost_is: 0.01, rank_lost_is: 0.02, daily_budget: 5, budget_utilization: 0.55 },
  ]);

  // [S16] Profieldimensies (het enige searchkanaal met LinkedIn-targeting): Tuinbouw & Agri zit
  // onder de account-CPA én boven de volumegrens (bid-modifier-kans); Inkoop oogt briljant
  // (CPA ~6) maar draagt maar 3 conversies -- de volumerem moet remmen.
  const msProfiel = [
    { pivot: "industry", waarde: "Tuinbouw & Agri", imp: 5200, clicks: 210, spend: 200, conv: 18 },
    { pivot: "industry", waarde: "Bouw & Installatie", imp: 2600, clicks: 95, spend: 120, conv: 7 },
    { pivot: "industry", waarde: "Onderwijs", imp: 2100, clicks: 70, spend: 90, conv: 2 },
    { pivot: "job_function", waarde: "Operations", imp: 4100, clicks: 160, spend: 180, conv: 14 },
    { pivot: "job_function", waarde: "Inkoop", imp: 500, clicks: 21, spend: 18, conv: 3 },
    { pivot: "job_function", waarde: "Onbekend", imp: 3800, clicks: 120, spend: 140, conv: 6 },
  ];
  tables["microsoft_profile_monthly"] = msMaanden.flatMap((month) => msProfiel.map((p) => ({
    client_id: DEMO_CLIENT, month, pivot_type: p.pivot, pivot_value: p.waarde,
    impressions: p.imp, clicks: p.clicks, spend: p.spend, conversions: p.conv,
  })));

  // Instellingen + sync-status.
  // linkedin_icp: het ICP matcht op URN; alleen Operations is ICP, dus de Education-leads
  // (75%) zijn waste — voedt de losse ICP-fit-analyse met een materiele bevinding.
  tables["client_settings"] = [{
    client_id: DEMO_CLIENT, kpi_targets: KPI_TARGETS, rai_events: RAI_EVENTS, audience_profile: AUDIENCE_PROFILE,
    linkedin_icp: { job_functions: ["urn:li:function:demo-ops"], seniorities: [], industries: [], company_sizes: [] },
  }];
  tables["geo_clone_settings"] = GEO_CLONE_SETTINGS.map((s) => ({ client_id: DEMO_CLIENT, ...s }));
  tables["client_sync_status"] = [{ client_id: DEMO_CLIENT, last_sync_at: new Date().toISOString(), last_sync_status: "demo", last_successful_sync_at: new Date().toISOString(), datasets_available: 10, datasets_total: 10, freshness_status: "fresh" }];

  // ── PMax-detail: assetgroepen, netwerkverdeling en assetdekking (22 augustus 2026) ─────────
  // PmaxNetworkSplit en PmaxAssetCoverage lazen al ads_pmax_network_breakdown /
  // ads_asset_group_performance_monthly / ads_pmax_asset_performance via dbSelect (dus ook in
  // productie, niet alleen de mock) -- maar dit seed-script vulde geen van de drie, dus beide
  // kaarten renderden `null` voor demo-greentech zodra iemand met een niet-gemockt (dbSelect-)pad
  // keek. lib/demo/pmax-video-demo.ts heeft dezelfde soort generatoren voor de mock, maar die
  // hangen aan een andere campagne-identiteit ("GreenTech | PMax | Standhouders") dan de PMax-rij
  // die dit script al genereert ("GRT | Performance Max", zie GOOGLE_AOV/googleMonthly hierboven)
  // -- vandaar losse generatoren hier, gekoppeld aan de campagne die al bestaat, met hetzelfde
  // verhaal: een budget-absorberende groep en een Maps/YouTube-zware netwerkverdeling.
  const pmaxCampaignName = "GRT | Performance Max";
  const pmaxCampaignId = campaignIdOf(pmaxCampaignName);
  const pmaxMonths = g.filter((r) => r.campaign === pmaxCampaignName && r.monthIdx <= 5);

  const assetGroupIdOf = (naam: string) => `${pmaxCampaignId}-${naam.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Drie assetgroepen: twee die presteren naar hun aandeel, en "Bezoekers — breed" die 32% van
  // de kosten draagt tegen 11% van de conversies (budget-absorptie, controlepunt 47) EN onder
  // Google's minima zit (zie assetGroups hieronder) -- zo hebben zowel de aandelen-logica in
  // lib/pmax/assetdekking.ts als de tekort-detectie een echte rij om op te reageren.
  const ASSET_GROUPS = [
    { naam: "Standhouders — Nederland", costW: 0.36, convW: 0.48 },
    { naam: "Standhouders — internationaal", costW: 0.32, convW: 0.41 },
    { naam: "Bezoekers — breed", costW: 0.32, convW: 0.11 },
  ];

  // Zeven netwerken met dezelfde scheefstand als lib/demo/pmax-video-demo.ts: Maps en YouTube
  // zijn duur en leveren weinig, Search draait de meeste conversies tegen weinig kosten.
  const PMAX_NETWORKS = [
    { type: "MAPS", costW: 0.34, convW: 0.11, impW: 0.22 },
    { type: "YOUTUBE", costW: 0.27, convW: 0.09, impW: 0.38 },
    { type: "SEARCH", costW: 0.23, convW: 0.57, impW: 0.09 },
    { type: "SEARCH_PARTNERS", costW: 0.12, convW: 0.15, impW: 0.07 },
    { type: "DISCOVER", costW: 0.035, convW: 0.06, impW: 0.16 },
    { type: "CONTENT", costW: 0.005, convW: 0.02, impW: 0.08 },
    { type: "GMAIL", costW: 0, convW: 0, impW: 0 },
  ];

  const assetGroupMonthly: Row[] = [];
  const networkBreakdown: Row[] = [];

  for (const m of pmaxMonths) {
    const month = monthsBack(m.monthIdx);
    const costW = ASSET_GROUPS.map((a) => a.costW);
    const convW = ASSET_GROUPS.map((a) => a.convW);
    const groupCost = splitInt(Math.round(m.cost), costW);
    const groupConv = splitInt(Math.round(m.conv), convW);
    const groupImp = splitInt(m.imp, costW);
    const groupClicks = splitInt(m.clicks, costW);
    const groupValue = splitInt(Math.round(m.value), convW);

    ASSET_GROUPS.forEach((a, i) => {
      assetGroupMonthly.push({
        client_id: DEMO_CLIENT, month, campaign_id: pmaxCampaignId, campaign_name: pmaxCampaignName,
        asset_group_id: assetGroupIdOf(a.naam), asset_group_name: a.naam, asset_group_status: "ENABLED",
        impressions: groupImp[i], clicks: groupClicks[i], cost: groupCost[i], conversions: groupConv[i],
        conversions_value: groupValue[i],
      });

      // Netwerkverdeling per assetgroep, met dezelfde zeven netwerken en gewichten in elke groep:
      // de scheefstand is een eigenschap van PMax zelf (waar Google het budget laat landen), niet
      // van één assetgroep.
      const netCost = splitInt(groupCost[i], PMAX_NETWORKS.map((n) => n.costW));
      const netConv = splitInt(groupConv[i], PMAX_NETWORKS.map((n) => n.convW));
      const netImp = splitInt(groupImp[i], PMAX_NETWORKS.map((n) => n.impW));
      const netClicks = splitInt(groupClicks[i], PMAX_NETWORKS.map((n) => n.impW));
      const netValue = splitInt(groupValue[i], PMAX_NETWORKS.map((n) => n.convW));
      PMAX_NETWORKS.forEach((n, j) => {
        networkBreakdown.push({
          client_id: DEMO_CLIENT, month, campaign_id: pmaxCampaignId, campaign_name: pmaxCampaignName,
          asset_group_id: assetGroupIdOf(a.naam), asset_group_name: a.naam, network_type: n.type,
          impressions: netImp[j], clicks: netClicks[j], cost: netCost[j], conversions: netConv[j],
          conversions_value: netValue[j],
        });
      });
    });
  }
  tables["ads_asset_group_performance_monthly"] = assetGroupMonthly;
  tables["ads_pmax_network_breakdown"] = networkBreakdown;

  // Assetdekking: per groep de acht Google-veldtypen. "Standhouders — Nederland" en
  // "— internationaal" zitten ruim boven de minima uit lib/pmax/assetdekking.ts; "Bezoekers —
  // breed" mist een kop (2 van de 3 minimum) EN heeft geen eigen video -- precies het scenario
  // dat PmaxAssetCoverage moet tonen: een tekort onder Google's minimum, gecombineerd met de
  // groep die het meeste budget absorbeert zonder te leveren.
  const pmaxAssetMonth = pmaxMonths.length > 0 ? monthsBack(pmaxMonths[0].monthIdx) : monthsBack(0);
  type AssetSpec = { type: string; labels: string[] };
  const compleetGroep: AssetSpec[] = [
    { type: "HEADLINE", labels: ["BEST", "GOOD", "GOOD", "GOOD", "LEARNING"] },
    { type: "LONG_HEADLINE", labels: ["GOOD", "GOOD"] },
    { type: "DESCRIPTION", labels: ["BEST", "GOOD", "GOOD"] },
    { type: "MARKETING_IMAGE", labels: ["GOOD", "GOOD"] },
    { type: "SQUARE_MARKETING_IMAGE", labels: ["GOOD", "GOOD"] },
    { type: "LOGO", labels: ["GOOD"] },
    { type: "YOUTUBE_VIDEO", labels: ["GOOD"] },
  ];
  const tekortGroep: AssetSpec[] = [
    // 2 koppen: onder het minimum van 3, en de tweede presteert LOW -- een echte tekort- én
    // zwakte-rij tegelijk.
    { type: "HEADLINE", labels: ["GOOD", "LOW"] },
    { type: "LONG_HEADLINE", labels: ["GOOD"] },
    { type: "DESCRIPTION", labels: ["LOW", "PENDING"] },
    { type: "MARKETING_IMAGE", labels: ["GOOD"] },
    { type: "SQUARE_MARKETING_IMAGE", labels: ["GOOD"] },
    { type: "LOGO", labels: ["GOOD"] },
    // Geen YOUTUBE_VIDEO-rij: geen eigen video.
  ];
  const assetPerformance: Row[] = [];
  const vulGroep = (groepNaam: string, specs: AssetSpec[]) => {
    specs.forEach((spec, typeIdx) => {
      spec.labels.forEach((label, k) => {
        assetPerformance.push({
          client_id: DEMO_CLIENT, month: pmaxAssetMonth, campaign_id: pmaxCampaignId, campaign_name: pmaxCampaignName,
          asset_group_id: assetGroupIdOf(groepNaam), asset_group_name: groepNaam,
          asset_id: `${assetGroupIdOf(groepNaam)}-${spec.type.toLowerCase()}-${typeIdx}-${k}`,
          asset_type: spec.type, performance_label: label,
        });
      });
    });
  };
  vulGroep("Standhouders — Nederland", compleetGroep);
  vulGroep("Standhouders — internationaal", compleetGroep);
  vulGroep("Bezoekers — breed", tekortGroep);
  tables["ads_pmax_asset_performance"] = assetPerformance;

  return tables;
}

// ── Uitvoeren ──────────────────────────────────────────────────────────────
const sqlLit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

function printSql(tables: Record<string, Row[]>) {
  console.log(`-- DEMO-SEED voor ${DEMO_CLIENT} — gegenereerd, niet met de hand bewerken`);
  console.log(`delete from client_settings where client_id='${DEMO_CLIENT}';`);
  for (const [table, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue;
    // fysiekeTabel(), niet de logische naam: sommige tabellen (bijv. meta_ad_daily ->
    // meta_ad_daily_legacy) zijn hernoemd en "table" is dan geen schrijfbare naam meer. Stond hier
    // eerder als kale "table" terwijl de insert eronder al wel fysiekeTabel() gebruikte -- de
    // delete raakte dus de verkeerde (of niet-bestaande) tabel, ontdekt toen een herseed op oude
    // rijen in meta_ad_daily_legacy botste (masterplan 16.7-vervolg, 17 augustus).
    if (table !== "linkedin_urn_labels") console.log(`delete from ${fysiekeTabel(table)} where client_id='${DEMO_CLIENT}';`);
    const cols = Object.keys(rows[0]);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = chunk.map((r) => `(${cols.map((c) => sqlLit(r[c])).join(",")})`).join(",\n");
      const conflict = table === "linkedin_urn_labels" ? " on conflict (urn) do update set label=excluded.label" : "";
      console.log(`insert into ${fysiekeTabel(table)} (${cols.join(",")}) values\n${values}${conflict};`);
    }
  }
  // Demo-klant in de app-klantenlijst (idempotent).
  console.log(`update app_settings set value = (
    select case when exists (select 1 from jsonb_array_elements(value) e where e->>'id'='${DEMO_CLIENT}')
      then value
      else value || '[{"id":"${DEMO_CLIENT}","name":"${DEMO_NAME}","source":"demo"}]'::jsonb end
  ), updated_at=now() where key='api_clients';`);
}

async function insertViaSupabase(tables: Record<string, Row[]>) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Zet NEXT_PUBLIC_SUPABASE_URL en een key in de omgeving (of gebruik --sql)."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  for (const [table, rows] of Object.entries(tables)) {
    // fysiekeTabel(), niet de logische naam -- zie de toelichting bij printSql() hierboven.
    if (table !== "linkedin_urn_labels") {
      const { error: delError } = await db.from(fysiekeTabel(table)).delete().eq("client_id", DEMO_CLIENT);
      if (delError) { console.error(`✗ ${table} (delete): ${delError.message}`); process.exit(1); }
    }
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await db.from(fysiekeTabel(table)).upsert(rows.slice(i, i + 400));
      if (error) { console.error(`✗ ${table}: ${error.message}`); process.exit(1); }
    }
    console.log(`✓ ${table}: ${rows.length} rijen`);
  }

  // Acht van de tabellen hierboven (zie lib/data-access/feitentabellen.ts) zijn VIEWS over
  // fact_core -- de upserts hierboven schrijven naar hun *_legacy-tegenhanger, niet naar wat
  // de app daadwerkelijk leest. Zonder deze projectie bleef demo-greentech na elke her-seed
  // tot een maand stale zichtbaar in de app (ontdekt bij het live-testen van de wekelijkse SOP:
  // meta_account_daily/linkedin_account_daily/ads_account_monthly toonden nog data van de vórige
  // seed-run, ook al meldde deze functie hierboven "160 rijen" succesvol). Migratie 050/078
  // riep dit destijds handmatig aan voor demo-greentech; nu hoort het bij de seed zelf.
  const { error: refreshError } = await db.rpc("refresh_fact_from_legacy", { p_client_id: DEMO_CLIENT });
  if (refreshError) { console.error(`✗ refresh_fact_from_legacy: ${refreshError.message}`); process.exit(1); }
  console.log(`✓ refresh_fact_from_legacy(${DEMO_CLIENT}) -- fact_core/meta_metrics/linkedin_metrics geprojecteerd`);

  // Klantenlijst bijwerken.
  const { data } = await db.from("app_settings").select("value").eq("key", "api_clients").maybeSingle();
  const list = Array.isArray(data?.value) ? (data!.value as Row[]) : [];
  if (!list.some((c) => c.id === DEMO_CLIENT)) {
    list.push({ id: DEMO_CLIENT, name: DEMO_NAME, source: "demo" });
    await db.from("app_settings").upsert({ key: "api_clients", value: list, updated_at: new Date().toISOString() });
    console.log("✓ demo-klant toegevoegd aan de klantenlijst");
  }
  console.log(`\nKlaar. Verwijderen kan met: npx tsx scripts/demo/teardown-demo-client.ts`);
}

// --check: bewijs dat de scenario's de detectors echt triggeren (geen DB nodig).
async function check() {
  const { shapeMetaAdInputs, shapeMetaLevelInputs, shapeLinkedInInputs } = await import("../../lib/analysis/channel-signal-data");
  const { buildMetaCreativeSignals } = await import("../../lib/signals/meta-creative");
  const { buildLinkedInSignals } = await import("../../lib/signals/linkedin-signals");
  const { buildCrossChannelSignals } = await import("../../lib/signals/cross-channel");
  const { analyzeGeoClone } = await import("../../lib/fair/geo-clone-analysis");

  const tables = buildAllRows();
  let failed = 0;
  const expect = (cond: boolean, label: string) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) failed++; };

  // De gegenereerde Row-objecten hebben runtime exact de juiste vorm; de cast via
  // unknown overbrugt alleen het statische verschil met de detector-invoertypes.
  type AnyRow = Record<string, unknown>;
  const rowsAs = <T,>(t: Row[]): T[] => t as unknown as T[];
  const adNames = new Map(META_ADS.map((a) => [a.id, { adName: a.name, campaignName: META_CAMPAIGNS.find((c) => c.id === a.campaign)?.name ?? null }]));
  const meta = buildMetaCreativeSignals({
    ads: shapeMetaAdInputs(rowsAs(tables["meta_ad_daily"]), adNames),
    levels: shapeMetaLevelInputs(rowsAs(tables["meta_campaign_daily"]), new Map(META_CAMPAIGNS.map((c) => [c.id, { adName: c.name }]))),
  });
  const metaIds = meta.triggered.map((s) => s.id).join(",");
  expect(/fatigue/.test(metaIds), `[S1] Meta fatigue getriggerd (${meta.triggered.length} verhalen)`);
  expect(/frequency|saturat/.test(metaIds), "[S2] Meta frequency-saturatie getriggerd");

  const li = buildLinkedInSignals({ entities: shapeLinkedInInputs(rowsAs(tables["linkedin_campaign_daily"]), new Map(LI_CAMPAIGNS.map((c) => [c.urn, c.name]))) });
  const liIds = li.triggered.map((s) => s.id).join(",");
  expect(/form/.test(liIds), `[S5] LinkedIn form drop-off getriggerd (${li.triggered.length} verhalen)`);
  expect(/cpl/.test(liIds), "[S6] LinkedIn CPL-druk getriggerd");

  // Cross: maandreeksen uit de account-dagdata afleiden zoals de blended view dat doet.
  const toMonthly = (rows: AnyRow[], channel: string, map: (r: AnyRow) => { imp: number; clicks: number; spend: number; conv: number; leads: number }) => {
    const acc = new Map<string, { impressions: number; clicks: number; spend: number; conversions: number; leads: number }>();
    for (const r of rows) {
      const m = String((r as Record<string, unknown>).date).slice(0, 7);
      const v = map(r); const a = acc.get(m) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0, leads: 0 };
      a.impressions += v.imp; a.clicks += v.clicks; a.spend += v.spend; a.conversions += v.conv; a.leads += v.leads;
      acc.set(m, a);
    }
    // Alleen volle maanden: de oudste maand kan partieel zijn en de lopende maand sluiten
    // de detectors (en de cross-route) uit.
    return [...acc.entries()].sort().slice(1).filter(([month]) => month < CUR_MONTH).map(([month, a]) => ({ channel, month, ...a }));
  };
  const gRow = (r: AnyRow) => r as Record<string, number>;
  const channels = [
    ...(tables["ads_account_monthly"] as AnyRow[]).filter((r) => String(gRow(r).month).slice(0, 7) < CUR_MONTH).slice(-4).map((r) => ({ channel: "google_ads", month: String(gRow(r).month).slice(0, 7), impressions: gRow(r).impressions, clicks: gRow(r).clicks, spend: gRow(r).cost, conversions: gRow(r).conversions, leads: 0 })),
    ...toMonthly(tables["meta_account_daily"] as AnyRow[], "meta_ads", (r) => ({ imp: gRow(r).impressions, clicks: gRow(r).link_clicks, spend: gRow(r).spend, conv: gRow(r).conversions, leads: 0 })),
    ...toMonthly(tables["linkedin_account_daily"] as AnyRow[], "linkedin_ads", (r) => ({ imp: gRow(r).impressions, clicks: gRow(r).clicks, spend: gRow(r).spend, conv: gRow(r).external_website_conversions as number, leads: gRow(r).one_click_leads as number })),
  ];
  const brand = (tables["ads_campaign_monthly"] as AnyRow[])
    .filter((r) => /brand/i.test(String(gRow(r).campaign_name)) && String(gRow(r).month).slice(0, 7) < CUR_MONTH)
    .map((r) => ({ month: String(gRow(r).month).slice(0, 7), clicks: gRow(r).clicks }));
  const cross = buildCrossChannelSignals({ channels, brand });
  const crossIds = cross.triggered.map((s) => s.id).join(",");
  expect(/zaai/.test(crossIds), `[S7] zaai-oogst getriggerd (${cross.triggered.length} cross-verhalen)`);

  // [S9] Doelgroep-tegenspraak: LinkedIn-leads vs het Google-ICP.
  const { audienceContradiction } = await import("../../lib/cross-channel/audience-coherence");
  const leadsByFn = new Map<string, number>();
  for (const r of tables["linkedin_demographic_daily"] as AnyRow[]) {
    const rr = r as Record<string, unknown>;
    leadsByFn.set(String(rr.pivot_value_urn), (leadsByFn.get(String(rr.pivot_value_urn)) ?? 0) + Number(rr.leads));
  }
  const totalLeads = [...leadsByFn.values()].reduce((s, v) => s + v, 0);
  const labelOf = new Map(LI_DEMO_FUNCTIONS.map((f) => [f.urn, f.label]));
  const segments = [...leadsByFn.entries()].map(([urn, leads]) => ({ dimension: "job_function" as const, value: labelOf.get(urn) ?? urn, conversionShare: leads / totalLeads }));
  const coherence = audienceContradiction(
    { channel: "linkedin_ads", segments },
    { channel: "google_ads", byDimension: AUDIENCE_PROFILE.google_ads }
  );
  expect(coherence.flags.length === 1 && coherence.flags[0].outsideProfileSharePct > 50, `[S9] doelgroep-tegenspraak geflagd (${coherence.flags[0]?.outsideProfileSharePct}% buiten ICP)`);

  // Meta/LinkedIn dagpunten per beurs, exact zoals app/api/analysis/geo-clone/route.ts ze opbouwt --
  // bewijst dat de nieuwe GRA/GRN-campagnes op Meta/LinkedIn ook echt de blended beursprojectie
  // voeden, niet alleen los in hun eigen kanaaltabel staan.
  const { matchGeoCloneByCampaignName } = await import("../../lib/fair/geo-clone-catalog");
  const channelPointsFor = (geoClone: string) => {
    const metaIds = new Set(META_CAMPAIGNS.filter((c) => matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone).map((c) => c.id));
    const metaByDate = new Map<string, number>();
    for (const r of tables["meta_campaign_daily"] as AnyRow[]) {
      if (!metaIds.has(String(gRow(r).entity_id))) continue;
      const d = String((r as Record<string, unknown>).date); metaByDate.set(d, (metaByDate.get(d) ?? 0) + Number(gRow(r).conversions));
    }
    const liIds = new Set(LI_CAMPAIGNS.filter((c) => matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone).map((c) => c.urn));
    const liByDate = new Map<string, number>();
    for (const r of tables["linkedin_campaign_daily"] as AnyRow[]) {
      if (!liIds.has(String(gRow(r).entity_urn))) continue;
      const d = String((r as Record<string, unknown>).date); liByDate.set(d, (liByDate.get(d) ?? 0) + Number(gRow(r).external_website_conversions));
    }
    const points: { channel: string; points: { date: string; value: number }[] }[] = [];
    if (metaByDate.size > 0) points.push({ channel: "meta_ads", points: [...metaByDate.entries()].map(([date, value]) => ({ date, value })) });
    if (liByDate.size > 0) points.push({ channel: "linkedin_ads", points: [...liByDate.entries()].map(([date, value]) => ({ date, value })) });
    return points;
  };

  // Beursanalyse GRT: achterstand => actionNeeded; GRA: op koers; GRN: eerste editie (geen vorige
  // editie om tegen af te zetten, maar draait wel en blend't Meta/LinkedIn mee).
  const grt = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "annual", editions: RAI_EVENTS.events[0].editions, conversionsTarget: 320, asOfDate: TODAY,
  });
  expect(grt.actionNeeded === true, `[S10] GRT-beursanalyse: achterstand gedetecteerd (delta ${grt.conversions?.deltaPct})`);
  const gra = analyzeGeoClone({
    geoClone: "GRA", fairLabel: "GreenTech Americas", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "annual", editions: RAI_EVENTS.events[1].editions, conversionsTarget: 200, asOfDate: TODAY,
    channelConvPoints: channelPointsFor("GRA"),
  });
  expect(gra.conversions?.comparable === true, `[S11] GRA-beursanalyse vergelijkbaar (delta ${gra.conversions?.deltaPct})`);
  expect(gra.blendedForecast !== null, `[S11] GRA blend't Meta/LinkedIn mee (${gra.perChannelForecast.length} kanalen)`);
  const grn = analyzeGeoClone({
    geoClone: "GRN", fairLabel: "GreenTech North America", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "custom", editions: RAI_EVENTS.events[2].editions, conversionsTarget: 70, asOfDate: TODAY,
    channelConvPoints: channelPointsFor("GRN"),
  });
  expect(grn.conversions !== null && grn.previousEditionId === null, `[S12] GRN-beursanalyse: eerste editie, geen vorige om tegen af te zetten`);
  expect(grn.blendedForecast !== null, `[S12] GRN blend't Meta/LinkedIn mee (${grn.perChannelForecast.length} kanalen)`);

  // ── Objective-analyse: bewijs dat de nieuwe Meta/LinkedIn-bevindingen-engines draaien op de
  // demo-klant, over meerdere objectives heen (masterplan 16.3). Maandaggregatie hier gebeurt
  // rechtstreeks uit de dag-rijen die ook naar de DB zouden gaan -- geen aparte databron.
  const { analyzeMetaCampaigns } = await import("../../lib/meta/campaign-analysis");
  const { analyzeLinkedInCampaigns } = await import("../../lib/linkedin/campaign-analysis");
  const monthOf = (date: string): number => Number(date.slice(5, 7));

  const metaCampaignsForAnalysis = META_CAMPAIGNS.map((c) => {
    const rows = (tables["meta_campaign_daily"] as AnyRow[]).filter((r) => r.entity_id === c.id);
    const byMonth = new Map<number, { imp: number; clicks: number; spend: number; conv: number; leads: number; atc: number; ic: number; freqSum: number; freqN: number; hookSum: number; hookN: number }>();
    for (const r of rows) {
      const mk = monthOf(String(r.date));
      const a = byMonth.get(mk) ?? { imp: 0, clicks: 0, spend: 0, conv: 0, leads: 0, atc: 0, ic: 0, freqSum: 0, freqN: 0, hookSum: 0, hookN: 0 };
      a.imp += Number(r.impressions ?? 0); a.clicks += Number(r.link_clicks ?? 0); a.spend += Number(r.spend ?? 0);
      a.conv += Number(r.conversions ?? 0); a.leads += Number(r.leads ?? 0);
      a.atc += Number(r.add_to_cart ?? 0); a.ic += Number(r.initiate_checkout ?? 0);
      if (r.frequency != null) { a.freqSum += Number(r.frequency); a.freqN++; }
      if (r.hook_rate != null) { a.hookSum += Number(r.hook_rate); a.hookN++; }
      byMonth.set(mk, a);
    }
    const monthly = [...byMonth.entries()].sort(([x], [y]) => x - y).map(([month, a]) => ({
      month, impressions: a.imp, reach: 0, frequency: a.freqN > 0 ? a.freqSum / a.freqN : 0, linkClicks: a.clicks, spend: a.spend,
      cpm: a.imp > 0 ? (a.spend / a.imp) * 1000 : 0, cpcLink: a.clicks > 0 ? a.spend / a.clicks : 0, ctrLink: a.imp > 0 ? a.clicks / a.imp : 0,
      conversions: a.conv, conversionValue: 0, purchaseRoas: 0, cpa: a.conv > 0 ? a.spend / a.conv : 0, leads: a.leads,
      addToCart: a.atc, initiateCheckout: a.ic, landingPageViews: 0, videoThruplay: 0,
      hookRate: a.hookN > 0 ? a.hookSum / a.hookN : 0, holdRate: 0, postEngagement: 0,
    }));
    return { campaignId: c.id, campaignName: c.name, objective: c.objective as MetaObjective, status: "ACTIVE" as const, monthly };
  });
  const metaAnalysis = analyzeMetaCampaigns({ clientId: DEMO_CLIENT, campaigns: metaCampaignsForAnalysis });
  const metaObjectives = new Set(metaCampaignsForAnalysis.map((c) => c.objective));
  expect(metaAnalysis.findings.length > 0 || metaAnalysis.manualChecks.length > 0,
    `[objective-analyse] Meta: ${metaAnalysis.findings.length} bevindingen + ${metaAnalysis.manualChecks.length} manualChecks over ${metaObjectives.size} objectives`);
  for (const f of metaAnalysis.findings.slice(0, 3)) console.log(`  · ${f.campaignName} (${f.objectiveLabel}): ${f.description}`);

  const linkedinCampaignsForAnalysis = LI_CAMPAIGNS.map((c) => {
    const rows = (tables["linkedin_campaign_daily"] as AnyRow[]).filter((r) => r.entity_urn === c.urn);
    const byMonth = new Map<number, { imp: number; clicks: number; spend: number; leads: number; opens: number; conv: number; vidStart: number; vidDone: number }>();
    for (const r of rows) {
      const mk = monthOf(String(r.date));
      const a = byMonth.get(mk) ?? { imp: 0, clicks: 0, spend: 0, leads: 0, opens: 0, conv: 0, vidStart: 0, vidDone: 0 };
      a.imp += Number(r.impressions ?? 0); a.clicks += Number(r.clicks ?? 0); a.spend += Number(r.spend ?? 0);
      a.leads += Number(r.one_click_leads ?? 0); a.opens += Number(r.one_click_lead_form_opens ?? 0);
      a.conv += Number(r.external_website_conversions ?? 0);
      a.vidStart += Number(r.video_starts ?? 0); a.vidDone += Number(r.video_completions ?? 0);
      byMonth.set(mk, a);
    }
    const monthly = [...byMonth.entries()].sort(([x], [y]) => x - y).map(([month, a]) => ({
      month, impressions: a.imp, clicks: a.clicks, spend: a.spend,
      ctr: a.imp > 0 ? a.clicks / a.imp : 0, cpc: a.clicks > 0 ? a.spend / a.clicks : 0, cpm: a.imp > 0 ? (a.spend / a.imp) * 1000 : 0,
      landingPageClicks: a.clicks, oneClickLeadFormOpens: a.opens, oneClickLeads: a.leads,
      externalWebsiteConversions: a.conv, conversionValue: 0, cpl: a.leads > 0 ? a.spend / a.leads : 0,
      formCompletionRate: a.opens > 0 ? a.leads / a.opens : 0, videoStarts: a.vidStart, videoViews: a.vidStart,
      videoCompletions: a.vidDone, videoCompletionRate: a.vidStart > 0 ? a.vidDone / a.vidStart : 0, totalEngagements: 0,
    }));
    return { campaignUrn: c.urn, campaignName: c.name, objective: c.objective as LinkedInObjective, status: "ACTIVE" as const, monthly };
  });
  const linkedinAnalysis = analyzeLinkedInCampaigns({ clientId: DEMO_CLIENT, campaigns: linkedinCampaignsForAnalysis });
  const liObjectives = new Set(linkedinCampaignsForAnalysis.map((c) => c.objective));
  expect(linkedinAnalysis.findings.length > 0 || linkedinAnalysis.manualChecks.length > 0,
    `[objective-analyse] LinkedIn: ${linkedinAnalysis.findings.length} bevindingen + ${linkedinAnalysis.manualChecks.length} manualChecks over ${liObjectives.size} objectives`);
  for (const f of linkedinAnalysis.findings.slice(0, 3)) console.log(`  · ${f.campaignName} (${f.objectiveLabel}): ${f.description}`);

  // ── Microsoft [S14-S20]: bewijs dat de prepared-facts-laag de scenario's echt ziet, via
  // dezelfde mappers als de routes -- geen aparte databron, geen tweede waarheid.
  const { buildMicrosoftStepFacts, VOLUME_GRENS_CONVERSIES } = await import("../../lib/microsoft/prepared-facts");
  const {
    mapMicrosoftDailyToComputeRow, mapMicrosoftBreakdownToComputeRow, mapMicrosoftKeywordRow,
    mapMicrosoftSearchTermRow, mapMicrosoftImpressionShareRow, mapMicrosoftProfileRow,
    mapMicrosoftCampaignMetaRow,
  } = await import("../../lib/microsoft/analysis-data");

  const msNaam = new Map<string, string>([
    ...MS_CAMPAIGNS.map((c) => [c.id, c.name] as const),
    ...MS_ADGROUPS.map((a) => [a.id, a.name] as const),
  ]);
  const msFacts = buildMicrosoftStepFacts({
    account: (tables["microsoft_account_daily"] as AnyRow[]).map((r) => mapMicrosoftDailyToComputeRow(r)),
    campaigns: (tables["microsoft_campaign_daily"] as AnyRow[]).map((r) => mapMicrosoftDailyToComputeRow(r, msNaam.get(String(r.entity_id)))),
    adgroups: (tables["microsoft_adgroup_daily"] as AnyRow[]).map((r) => mapMicrosoftDailyToComputeRow(r, msNaam.get(String(r.entity_id)))),
    campaignMeta: (tables["microsoft_campaigns"] as AnyRow[]).map(mapMicrosoftCampaignMetaRow),
    keywords: (tables["microsoft_keyword_monthly"] as AnyRow[]).map(mapMicrosoftKeywordRow),
    searchTerms: (tables["microsoft_search_terms_monthly"] as AnyRow[]).map(mapMicrosoftSearchTermRow),
    impressionShare: (tables["microsoft_campaign_impression_share"] as AnyRow[]).map(mapMicrosoftImpressionShareRow),
    breakdowns: (tables["microsoft_breakdown_daily"] as AnyRow[]).map(mapMicrosoftBreakdownToComputeRow),
    profile: (tables["microsoft_profile_monthly"] as AnyRow[]).map(mapMicrosoftProfileRow),
  });
  // De pijler-structuren zijn Record<number, unknown> richting de prompt; hier lezen we ze terug
  // met dezelfde vrijheid als de prompt-JSON dat doet.
  type Vrij = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const feit = (n: number): Vrij => msFacts[n] as Vrij;

  const pariteit = feit(2).import_pariteit as Vrij;
  expect(pariteit.stellig === true && (pariteit.cpa_delta_pct_import_vs_native ?? 0) > 30,
    `[S14] import-drift: import-CPA ${pariteit.import_benchmark?.cpa} vs native ${pariteit.native_benchmark?.cpa} (+${pariteit.cpa_delta_pct_import_vs_native}%, stellig)`);

  const netwerk = feit(5).netwerk as Vrij;
  const audience = (netwerk.segments as Vrij[]).find((s) => /audience/i.test(String(s.segment)));
  expect(audience?.lek === true && (audience.spend_share_pct ?? 0) > 10,
    `[S15] Audience Network-lek: ${audience?.spend_share_pct}% van spend, CPA ${audience?.cpa_vs_search}x search`);

  const profielPivots = (feit(4).profiel as Vrij).pivots as Record<string, Vrij[]>;
  const tuinbouw = profielPivots.industry?.find((s) => s.segment === "Tuinbouw & Agri");
  const inkoop = profielPivots.job_function?.find((s) => s.segment === "Inkoop");
  expect(tuinbouw?.boven_volumegrens === true && (tuinbouw?.vs_account_cpa?.delta_pct ?? 0) < -15,
    `[S16] Tuinbouw & Agri: CPA ${tuinbouw?.cpa} (${tuinbouw?.vs_account_cpa?.delta_pct}% vs account, boven de volumegrens)`);
  expect(inkoop != null && inkoop.boven_volumegrens === false && (inkoop.cpa ?? 99) < (tuinbouw?.cpa ?? 0),
    `[S16] Inkoop oogt beter (CPA ${inkoop?.cpa}) maar zit onder de grens van ${VOLUME_GRENS_CONVERSIES}`);

  const device = feit(4).demografie_device as Vrij;
  const desktop = (device.segments as Vrij[]).find((s) => s.segment === "Desktop");
  const mobiel = (device.segments as Vrij[]).find((s) => s.segment === "Mobile");
  expect((desktop?.spend_share_pct ?? 0) > 55 && (desktop?.cpa ?? 99) < (mobiel?.cpa ?? 0),
    `[S17] desktop ${desktop?.spend_share_pct}% van spend, CPA ${desktop?.cpa} vs mobile ${mobiel?.cpa}`);

  const isFeiten = feit(5).impressieaandeel as Vrij;
  const importIs = (isFeiten.campagnes as Vrij[]).find((c) => c.campaign_name === MS_CAMPAIGNS[0].name);
  const brandIs = (isFeiten.campagnes as Vrij[]).find((c) => c.campaign_name === MS_CAMPAIGNS[2].name);
  expect((importIs?.budget_lost_trend ?? 0) > 0.1,
    `[S18] budgetverlies import loopt op (+${importIs?.budget_lost_trend} over ${importIs?.maanden?.length} maanden)`);
  expect((brandIs?.maanden?.at(-1)?.impression_share ?? 0) >= 0.9,
    `[S18] brand vrijwel vol (IS ${brandIs?.maanden?.at(-1)?.impression_share})`);

  const kw = (feit(3).keywords ?? {}) as Vrij;
  expect((kw.bleeders as Vrij[]).some((b) => b.keyword === "greenhouse solutions"),
    `[S19] bleeder gevonden (${kw.bleeders?.length} bleeder(s), account-CPA ${kw.account_cpa})`);
  expect(!(kw.bleeders as Vrij[]).some((b) => b.keyword === "kas kopen tweedehands"),
    "[S19] de EUR 25-tegenhanger is GEEN bleeder");
  expect((kw.lage_quality_score as Vrij[]).length >= 3,
    `[S19] laag-QS-cluster (${kw.lage_quality_score?.length} keywords onder QS 5)`);

  const termen = (feit(3).zoektermen ?? {}) as Vrij;
  expect((termen.vervuilers as Vrij[]).some((t) => t.search_term === "greenhouse jobs"),
    `[S20] zoektermvervuiling op de import (${termen.vervuilers?.length} vervuilers, EUR ${termen.totale_verspilling} verspild)`);

  console.log(failed > 0 ? `\n${failed} scenario('s) NIET getriggerd` : "\nAlle gecontroleerde scenario's triggeren zoals ontworpen.");
  if (failed > 0) process.exit(1);
}

const mode = process.argv[2];
if (mode === "--sql") printSql(buildAllRows());
else if (mode === "--check") check();
else insertViaSupabase(buildAllRows());

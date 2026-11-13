// ============================================================================
// DEMO-KLANT SEED — "demo-greentech" (volledig fictief, gequarantaineerd)
// ----------------------------------------------------------------------------
// Doel: alle analyses end-to-end testbaar maken (Google, Meta, LinkedIn, cross-channel,
// geo-clones/beursanalyse) zonder echte klanten te vervuilen. Alles hangt aan EEN client_id
// (demo-greentech) en is met scripts/demo/teardown-demo-client.ts in een keer te verwijderen.
//
// De data is deterministisch (geen randomness) en per detector ONTWORPEN:
//   [S1]  Meta creative fatigue      — "Hero Video A": CTR -42% bij een frequentie van 4.2 over 28 dagen
//   [S2]  Meta frequency-saturatie   — campagne Awareness op 4.6 over 28 dagen
//         (periodewaarden in meta_period_reach, migratie 110; de dagwaarden zijn realistisch 1.1-1.6)
//   [S3]  Meta ranking-zwakte        — "Static Banner C": BELOW_AVERAGE quality ranking
//   [S4]  Meta hook-zwakte           — "Product Carousel D": hook-rate ver onder de mediaan
//   [S5]  LinkedIn form drop-off     — GRT ABM: 10% completion op 60+ opens
//   [S6]  LinkedIn CPL-druk          — GRT ABM: CPL +25% recent vs prior venster (leads + websiteconversies);
//                                      "GreenTech Gids Downloads": kosten per websiteconversie +77%
//   [S7]  Zaai-oogst (cross)         — social-vertoningen juni +40%, brand-klikken +18%
//   [S8]  Mix-shift/Simpson (cross)  — LinkedIn-spend juni x3 (eigen CPA stabiel) => blended CPA stijgt
//   [S9]  Doelgroep-tegenspraak      — LinkedIn-leads 75% uit "Education", buiten het Google-ICP
//   [S10] Beursanalyse GRT           — aanloop 2026 ~35% achter op 2025 bij gelijke spend (effectiviteitsvraag)
//   [S11] Beursanalyse GRA           — op koers (+10%) => geen actie
//   [S12] GRN eerste editie          — degradatiepad "eerste editie" zichtbaar
//   [S13] Impression share           — GRT budget-gelimiteerd (maar CPA te hoog: eerst efficiëntie), GRA rang-gelimiteerd
//   stil: "GreenTech | Brand", "Lifestyle Video B", "GreenTech Lead Gen EU" gezond => detectors horen daar te zwijgen
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
import { wisDemoProjectie } from "../../lib/demo/projectie-opruimen";
import { createClient } from "@supabase/supabase-js";
import type { MetaObjective } from "../../lib/meta/campaign-types";
import type { LinkedInObjective } from "../../lib/linkedin/campaign-types";
import { splitInt } from "../../lib/demo/split";
import { today } from "../../lib/reporting-date";
import { microsoftDemoRows, MS_CAMPAIGNS, MS_ADGROUPS } from "../../lib/demo/microsoft-demo";

export const DEMO_CLIENT = "demo-greentech";
const DEMO_NAME = "DEMO — GreenTech (fictief)";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: string, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return iso(d); };

// Ankerdatum: "vandaag" voor de gegenereerde reeksen. Bewust vast, zodat de scenario's
// stabiel blijven; ruim binnen de 70-dagen-vensters van de signaal-routes.
//
// ALLES HIERONDER HANGT AAN DEZE ENE DATUM (maandIdx 0 = de maand van TODAY, dag 0 = TODAY): de
// seed is klokrelatief. Wie hem vandaag draait, krijgt een demo die tot vandaag loopt; hij stopte
// op 25 augustus 2026 omdat hij toen voor het laatst gedraaid is, niet omdat die datum ergens
// vaststaat. scripts/demo/herseed-demo.mjs draait hem opnieuw (bouwplan fase 4).
//
// Twee dingen die daarbij telden:
// - De dag is de AMSTERDAMSE dag (today()), niet de UTC-dag: een herseed om 00:30 legde het venster
//   anders een dag te vroeg, en begin van de maand een hele maand.
// - DEMO_VANDAAG=JJJJ-MM-DD zet een vaste klok, voor een test of om een seed te reproduceren.
const VASTE_DAG = process.env.DEMO_VANDAAG;
if (VASTE_DAG !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(VASTE_DAG)) {
  console.error(`DEMO_VANDAAG moet JJJJ-MM-DD zijn, niet "${VASTE_DAG}".`);
  process.exit(1);
}
const TODAY = VASTE_DAG ?? today();
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
  // De lopende maand als maand-tot-nu, zoals de Google-sync hem levert. Hij stond hier als volle
  // maand, en dat verborg in de demo de fout dat de beursanalyse een maandpunt op de 1e als hele
  // maand telde (doorlichting 13 november 2026). Nu de beursanalyse maandpunten over de verstreken
  // dagen verdeelt, zou een volle lopende maand juist een voorsprong verzinnen.
  const dag = Number(TODAY.slice(8, 10));
  const dagenInMaand = new Date(Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), 0)).getUTCDate();
  const frac = dag / dagenInMaand;
  return rows.map((r) => r.monthIdx !== 0 ? r : {
    ...r,
    imp: Math.round(r.imp * frac), clicks: Math.round(r.clicks * frac), cost: Math.round(r.cost * frac * 100) / 100,
    conv: Math.round(r.conv * frac * 100) / 100, value: Math.round(r.value * frac * 100) / 100,
  });
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

// De dagfrequenties hieronder zijn wat een dag-sync echt oplevert (1,1 tot 1,6): dezelfde persoon
// ziet een advertentie zelden vaker dan een keer per dag. Ze stonden op 4,2 en 4,6, en daardoor
// gingen S1 en S2 in de demo af op een getal dat op een echt account nooit voorkomt; de detector
// bleef daar stil. De periodewaarde (vertoningen gedeeld door het over 28 dagen ontdubbelde bereik)
// staat apart in META_PERIODE_FREQUENTIE en gaat als meta_period_reach de database in.
function metaAdDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = 63; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28; // recent venster vs prior venster
    // [S1] Hero A: CTR zakt van 1.2% naar 0.7%; over 28 dagen ziet dezelfde persoon hem 4,2 keer.
    rows.push({ entity: "demo-ad-hero-a", date, imp: 1600, linkClicks: recent ? 11 : 19, spend: 55, conv: 2, freq: recent ? 1.5 : 1.3, hook: 0.42, hold: 0.3 });
    // Lifestyle B: gezond en stabiel (moet stil blijven).
    rows.push({ entity: "demo-ad-lifestyle-b", date, imp: 1400, linkClicks: 17, spend: 45, conv: 2, freq: 1.2, hook: 0.5, hold: 0.35 });
    // [S3] Banner C: recent BELOW_AVERAGE quality ranking.
    rows.push({ entity: "demo-ad-banner-c", date, imp: 900, linkClicks: 8, spend: 25, conv: 1, freq: 1.3, hook: 0.44, hold: 0.3, qr: recent ? "BELOW_AVERAGE_10" : "AVERAGE", er: "AVERAGE", cr: "AVERAGE" });
    // [S4] Carousel D: hook-rate ver onder de account-mediaan.
    rows.push({ entity: "demo-ad-carousel-d", date, imp: 1100, linkClicks: 10, spend: 30, conv: 1, freq: 1.25, hook: 0.12, hold: 0.1 });
  }
  return rows;
}

// Frequentie over het recente venster van 28 dagen, per advertentie en campagne: wat een
// periodelezing (insights zonder time_increment) zou geven. [S1] Hero A 4,2 en [S2] Awareness 4,6
// liggen boven de drempels (3 en 4); de rest eronder.
const META_PERIODE_FREQUENTIE: Record<string, { level: "ad" | "campaign"; freq: number }> = {
  "demo-ad-hero-a": { level: "ad", freq: 4.2 },
  "demo-ad-lifestyle-b": { level: "ad", freq: 2.2 },
  "demo-ad-banner-c": { level: "ad", freq: 2.6 },
  "demo-ad-carousel-d": { level: "ad", freq: 2.4 },
  "demo-mc-awareness": { level: "campaign", freq: 4.6 },
  "demo-mc-retargeting": { level: "campaign", freq: 2.5 },
  "demo-mc-traffic": { level: "campaign", freq: 1.9 },
  "demo-mc-leads": { level: "campaign", freq: 1.7 },
  "demo-mc-gra-awareness": { level: "campaign", freq: 2.0 },
  "demo-mc-grn-leads": { level: "campaign", freq: 1.4 },
};

/** meta_period_reach (migratie 110): een rij per entiteit over het recente venster van 28 dagen. */
function metaPeriodReach(dagRijen: MetaDaily[]): Row[] {
  const start = addDays(TODAY, -27);
  const imp = new Map<string, number>();
  for (const r of dagRijen) if (r.date >= start) imp.set(r.entity, (imp.get(r.entity) ?? 0) + r.imp);
  return Object.entries(META_PERIODE_FREQUENTIE)
    .filter(([entity]) => (imp.get(entity) ?? 0) > 0)
    .map(([entity, p]) => {
      const impressions = imp.get(entity)!;
      const reach = Math.round(impressions / p.freq);
      return { client_id: DEMO_CLIENT, level: p.level, entity_id: entity, period_start: start, period_end: TODAY, impressions, reach, frequency: Math.round((impressions / reach) * 100) / 100 };
    });
}

// Campagne-dagrijen lopen CAMPAGNE_DAGEN terug in plaats van 64: de objective-analyse (--check)
// rekent alleen op VOLLE maanden, en met 64 dagen is dat er één. De signaalvensters (2 x 28
// dagen) liggen ruim binnen dit bereik; alles ouder dan 28 dagen heeft de "prior"-waarden.
const CAMPAGNE_DAGEN = 125;

function metaCampaignDaily(): MetaDaily[] {
  const rows: MetaDaily[] = [];
  for (let d = CAMPAGNE_DAGEN - 1; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28;
    // [S2] Awareness-campagne: over 28 dagen frequentie 4.6 (META_PERIODE_FREQUENTIE), per dag 1.6.
    rows.push({ entity: "demo-mc-awareness", date, imp: 3000, linkClicks: 28, spend: 100, conv: 4, freq: recent ? 1.6 : 1.3, hook: null, hold: null });
    rows.push({ entity: "demo-mc-retargeting", date, imp: 2000, linkClicks: 18, spend: 55, conv: 2, freq: 1.2, hook: null, hold: null });
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
// grotere deals dan de jonge GRN-markt. Productvideo converteert per ontwerp niet; Gids Downloads
// levert sinds de doorlichting van 13 november websiteconversies ([S6], kosten per conversie
// lopen op) en valt voor de AOV terug op het accountgemiddelde.
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
  const s2 = { conv: { cum: 0, vorig: 0 } };
  for (let d = CAMPAGNE_DAGEN - 1; d >= 0; d--) {
    const date = addDays(TODAY, -d);
    const recent = d < 28;
    // [S5]+[S6] GRT ABM: 10% form-completion op ruime opens; spend recent hoger bij gelijke leads => CPL +25%.
    rows.push({ urn: LI_CAMPAIGNS[0].urn, date, imp: 1500, clicks: 30, spend: recent ? 125 : 100, leads: heelGetal(s0.leads, 0.25), opens: heelGetal(s0.opens, recent ? 2.5 : 2.2), conv: heelGetal(s0.conv, 0.3), vidStart: 40, vidDone: 22 });
    // Lead Gen EU: gezond (completion ~30%, stabiele CPL) — hoort stil te blijven.
    rows.push({ urn: LI_CAMPAIGNS[1].urn, date, imp: 1200, clicks: 26, spend: 90, leads: heelGetal(s1.leads, 0.9), opens: heelGetal(s1.opens, 3), conv: heelGetal(s1.conv, 0.5), vidStart: 35, vidDone: 20 });
    // Gids Downloads (WEBSITE_VISITS): kliks dalen terwijl besteding stijgt — duurdere kliks
    // voor hetzelfde resultaat, het cpc-issue-scenario. [S6] Hij converteert op de website (geen
    // lead-formulier): de CPL-druk telde alleen formulieren en zag deze campagne nooit, ook niet nu
    // de kosten per conversie van ~€ 158 naar ~€ 280 gaan.
    rows.push({ urn: LI_CAMPAIGNS[2].urn, date, imp: 2200, clicks: recent ? 18 : 34, spend: recent ? 140 : 95, leads: 0, opens: 0, conv: heelGetal(s2.conv, recent ? 0.5 : 0.6), vidStart: 0, vidDone: 0 });
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
  // Na meta_ad_daily en meta_campaign_daily: hun vertoningen zijn de teller van de periodefrequentie.
  tables["meta_period_reach"] = metaPeriodReach([...metaAdDaily(), ...metaCampaignDaily()]);
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

  // ── Microsoft (Bing) [S14-S20]: uit de gedeelde generator ─────────────────
  // Eén bron voor de seed (echte database) én demoRows() (mock + rookproef) -- zie de kop van
  // lib/demo/microsoft-demo.ts. Twee losse kopieën zouden stil uit elkaar lopen.
  Object.assign(tables, microsoftDemoRows(DEMO_CLIENT));

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

// Tabellen uit een migratie die nog niet overal gedraaid is. De seed slaat ze over als ze niet
// bestaan, in plaats van halverwege af te breken: de rest van de demo werkt zonder.
const OPTIONELE_TABELLEN: Record<string, string> = {
  meta_period_reach: "migratie 110 (Meta-periodelezing); zonder deze tabel meldt de Meta-signaalroute 'frequentie niet te beoordelen'",
};

function printSql(tables: Record<string, Row[]>) {
  console.log(`-- DEMO-SEED voor ${DEMO_CLIENT} — gegenereerd, niet met de hand bewerken`);
  console.log(`delete from client_settings where client_id='${DEMO_CLIENT}';`);
  for (const [table, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue;
    if (OPTIONELE_TABELLEN[table]) {
      // In een plpgsql-blok wordt een statement pas bij uitvoering gepland, dus een tak die niet
      // loopt raakt een ontbrekende tabel niet.
      const cols = Object.keys(rows[0]);
      const values = rows.map((r) => `(${cols.map((c) => sqlLit(r[c])).join(",")})`).join(",\n");
      console.log(`-- ${table}: ${OPTIONELE_TABELLEN[table]}`);
      console.log(`do $seed$ begin if to_regclass('public.${table}') is not null then\n  delete from ${table} where client_id='${DEMO_CLIENT}';\n  insert into ${table} (${cols.join(",")}) values\n${values};\nend if; end $seed$;`);
      continue;
    }
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
      if (delError && OPTIONELE_TABELLEN[table]) {
        console.warn(`⚠ ${table} overgeslagen (${delError.message}): ${OPTIONELE_TABELLEN[table]}`);
        continue;
      }
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
  // Eerst de oude projectie van dit account weg, dan opnieuw projecteren. De projectie wist zelf
  // nooit iets, en het venster hierboven schuift mee met de rundatum: zonder deze stap bleef elke
  // dag die uit het venster viel als wees in fact_core staan (zie lib/demo/projectie-opruimen.ts).
  try {
    const opruim = await wisDemoProjectie(db, DEMO_CLIENT);
    console.log(`✓ oude projectie gewist (${opruim.accountIds.length} account, ${opruim.tabellen.length} tabelwissingen)`);
  } catch (e) {
    console.error(`✗ oude projectie wissen: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
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
  const { analyzeCampaignImpressionShare } = await import("../../lib/analysis/impression-share-facts");
  const { resolveChannelConversionConfig, sumSelectedConversions } = await import("../../lib/analysis/channel-conversion-config");

  const tables = buildAllRows();
  let failed = 0;
  // Elk scenario moet minstens een assert hebben, en elke assert moet slagen. Tot 13 november
  // stond hier "Alle gecontroleerde scenario's triggeren" terwijl S3, S4, S8, S13 en het stille
  // scenario nergens getoetst werden en S8 in werkelijkheid niet afging.
  const ALLE_SCENARIOS = [...Array.from({ length: 20 }, (_, i) => `S${i + 1}`), "stil"];
  const gedekt = new Set<string>();
  const expect = (scenario: string, cond: boolean, label: string) => {
    gedekt.add(scenario);
    console.log(`${cond ? "✓" : "✗"} [${scenario}] ${label}`);
    if (!cond) failed++;
  };

  // De gegenereerde Row-objecten hebben runtime exact de juiste vorm; de cast via
  // unknown overbrugt alleen het statische verschil met de detector-invoertypes.
  type AnyRow = Record<string, unknown>;
  const rowsAs = <T,>(t: Row[]): T[] => t as unknown as T[];
  const gRow = (r: AnyRow) => r as Record<string, number>;
  const scopes = (stories: { id: string; scope: string }[], id: RegExp) => stories.filter((s) => id.test(s.id)).map((s) => s.scope);

  // ── Meta [S1-S4]: met de periodelezing, zoals de route hem leest ─────────────
  const adNames = new Map(META_ADS.map((a) => [a.id, { adName: a.name, campaignName: META_CAMPAIGNS.find((c) => c.id === a.campaign)?.name ?? null }]));
  const campNames = new Map(META_CAMPAIGNS.map((c) => [c.id, { adName: c.name }]));
  const periode = rowsAs<{ level: string; entity_id: string; period_start: string; period_end: string; impressions: number; reach: number }>(tables["meta_period_reach"]);
  const metaAds = rowsAs<Parameters<typeof shapeMetaAdInputs>[0][number]>(tables["meta_ad_daily"]);
  const metaCamps = rowsAs<Parameters<typeof shapeMetaLevelInputs>[0][number]>(tables["meta_campaign_daily"]);
  const meta = buildMetaCreativeSignals({
    ads: shapeMetaAdInputs(metaAds, adNames, periode.filter((p) => p.level === "ad")),
    levels: shapeMetaLevelInputs(metaCamps, campNames, periode.filter((p) => p.level === "campaign")),
  });
  const metaVerwacht: [string, RegExp, string][] = [
    ["S1", /^meta_creative_fatigue$/, "Hero Video A"],
    ["S2", /^meta_frequency_saturation$/, "GRT | Awareness EU"],
    ["S3", /^meta_ranking_weakness$/, "Static Banner C"],
    ["S4", /^meta_hook_hold_weakness$/, "Product Carousel D"],
  ];
  for (const [sc, id, naam] of metaVerwacht) {
    expect(sc, scopes(meta.triggered, id).some((s) => s.includes(naam)), `${id.source.replace(/[\^$]/g, "")} op "${naam}"`);
  }
  const dagFreqMax = Math.max(...metaAds.map((r) => Number((r as unknown as AnyRow).frequency ?? 0)), ...metaCamps.map((r) => Number((r as unknown as AnyRow).frequency ?? 0)));
  expect("S1", dagFreqMax <= 2, `de dagfrequenties zijn realistisch (hoogste ${dagFreqMax}); de 4,2 en 4,6 staan alleen in de periodelezing`);
  // Zonder periodelezing (migratie 110 niet gedraaid) zegt de detector dat hij het niet weet.
  const metaZonder = buildMetaCreativeSignals({ ads: shapeMetaAdInputs(metaAds, adNames), levels: shapeMetaLevelInputs(metaCamps, campNames) });
  const onbekend = (metaZonder.notAssessable ?? []).map((n) => n.id);
  expect("S2", !metaZonder.triggered.some((s) => /fatigue|saturation/.test(s.id)) && onbekend.includes("meta_creative_fatigue") && onbekend.includes("meta_frequency_saturation"),
    "zonder periodelezing: frequentie 'niet te beoordelen', niet stil 'niets gevonden'");
  // Wat hierboven groen staat, rekent met periode-rijen uit deze seed. De app heeft ze pas als
  // migratie 110 gedraaid is en de dagelijkse Meta-run hem vult; de demo-app (de mock in
  // lib/demo/demo-rows.ts) heeft de tabel niet. Daar toont het Meta-tabblad bij S1 en S2 dus
  // "niet te beoordelen". Geen fout van de detector, wel iets wat deze controle niet mag verzwijgen.
  {
    const { demoRows: mockRijen } = await import("../../lib/demo/demo-rows");
    const inMock = ((mockRijen() as Record<string, unknown[]>)["meta_period_reach"] ?? []).length > 0;
    if (!inMock) console.log("  let op [S1, S2] de demo-app en productie tonen frequentie 'niet te beoordelen' tot migratie 110 gedraaid is (de mock kent meta_period_reach niet)");
  }
  const metaVals = meta.triggered.filter((s) => !metaVerwacht.some(([, id, naam]) => id.test(s.id) && s.scope.includes(naam)));
  expect("stil", metaVals.length === 0, `Meta: geen verhaal buiten S1-S4${metaVals.length ? ` (vals: ${metaVals.map((s) => `${s.id} op ${s.scope}`).join("; ")})` : ""}`);
  expect("stil", !meta.triggered.some((s) => s.scope.includes("Lifestyle Video B")), "Lifestyle Video B blijft stil");

  // ── LinkedIn [S5, S6]: met doel per campagne en de standaard-conversieselectie, zoals de route ──
  const liConfig = resolveChannelConversionConfig(null);
  const li = buildLinkedInSignals({
    entities: shapeLinkedInInputs(rowsAs(tables["linkedin_campaign_daily"]), new Map(LI_CAMPAIGNS.map((c) => [c.urn, c.name])), {
      objectives: new Map(LI_CAMPAIGNS.map((c) => [c.urn, c.objective])),
      results: (r) => sumSelectedConversions(r as unknown as AnyRow, "linkedin_ads", liConfig),
      resultLabel: "resultaat",
    }),
  });
  const liVerwacht: [string, RegExp, string][] = [
    ["S5", /^linkedin_form_dropoff$/, "GRT ABM Benelux"],
    ["S6", /^linkedin_cpl_pressure$/, "GRT ABM Benelux"],
    ["S6", /^linkedin_cpl_pressure$/, "GreenTech Gids Downloads"],
  ];
  for (const [sc, id, naam] of liVerwacht) {
    expect(sc, scopes(li.triggered, id).includes(naam), `${id.source.replace(/[\^$]/g, "")} op "${naam}"`);
  }
  // Ontworpen (objective-dekking, kop van dit bestand): Productvideo heeft 10% video-voltooiing.
  const liOntworpen: [RegExp, string][] = [...liVerwacht.map(([, id, naam]) => [id, naam] as [RegExp, string]), [/^linkedin_video_dropoff$/, "GreenTech Productvideo"]];
  const liVals = li.triggered.filter((s) => !liOntworpen.some(([id, naam]) => id.test(s.id) && s.scope === naam));
  expect("stil", liVals.length === 0, `LinkedIn: geen onontworpen verhaal${liVals.length ? ` (vals: ${liVals.map((s) => `${s.id} op ${s.scope}`).join("; ")})` : ""}`);
  expect("stil", !scopes(li.triggered, /engagement/).includes("GreenTech Productvideo"), "geen 'CTR onder de mediaan' op de video-views-campagne");
  expect("stil", !li.triggered.some((s) => s.scope === "GreenTech Lead Gen EU"), "GreenTech Lead Gen EU blijft stil");

  // ── Cross [S7, S8]: maandreeksen uit de account-dagdata, zoals de blended view ──
  const toMonthly = (rows: AnyRow[], channel: string, map: (r: AnyRow) => { imp: number; clicks: number; spend: number; conv: number; leads: number }) => {
    const acc = new Map<string, { impressions: number; clicks: number; spend: number; conversions: number; leads: number }>();
    for (const r of rows) {
      const m = String(r.date).slice(0, 7);
      const v = map(r); const a = acc.get(m) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0, leads: 0 };
      a.impressions += v.imp; a.clicks += v.clicks; a.spend += v.spend; a.conversions += v.conv; a.leads += v.leads;
      acc.set(m, a);
    }
    // Alleen volle maanden: de oudste maand kan partieel zijn en de lopende maand sluiten
    // de detectors (en de cross-route) uit.
    return [...acc.entries()].sort().slice(1).filter(([month]) => month < CUR_MONTH).map(([month, a]) => ({ channel, month, ...a }));
  };
  const channels = [
    ...(tables["ads_account_monthly"] as AnyRow[]).filter((r) => String(gRow(r).month).slice(0, 7) < CUR_MONTH).sort((a, b) => String(a.month).localeCompare(String(b.month))).slice(-4).map((r) => ({ channel: "google_ads", month: String(gRow(r).month).slice(0, 7), impressions: gRow(r).impressions, clicks: gRow(r).clicks, spend: gRow(r).cost, conversions: gRow(r).conversions, leads: 0 })),
    ...toMonthly(tables["meta_account_daily"] as AnyRow[], "meta_ads", (r) => ({ imp: gRow(r).impressions, clicks: gRow(r).link_clicks, spend: gRow(r).spend, conv: gRow(r).conversions, leads: 0 })),
    ...toMonthly(tables["linkedin_account_daily"] as AnyRow[], "linkedin_ads", (r) => ({ imp: gRow(r).impressions, clicks: gRow(r).clicks, spend: gRow(r).spend, conv: gRow(r).external_website_conversions as number, leads: gRow(r).one_click_leads as number })),
  ];
  const brand = (tables["ads_campaign_monthly"] as AnyRow[])
    .filter((r) => /brand/i.test(String(gRow(r).campaign_name)) && String(gRow(r).month).slice(0, 7) < CUR_MONTH)
    .map((r) => ({ month: String(gRow(r).month).slice(0, 7), clicks: gRow(r).clicks }));
  const cross = buildCrossChannelSignals({ channels, brand });
  expect("S7", cross.triggered.some((s) => s.id === "cross_zaai_oogst"), "zaai-oogst: social-golf valt samen met meer brand-klikken");
  const mix = cross.triggered.find((s) => s.id === "cross_mix_shift");
  expect("S8", mix !== undefined, `mix-shift: ${mix ? mix.evidence.find((e) => /mix-deel/.test(e.metric))?.value + " procentpunt mix / prestatie" : "gaat niet af"}`);
  expect("S8", mix !== undefined && /linkedin_ads van \d+% naar \d+%/.test(mix.story), "het verhaal noemt de verschuiving naar LinkedIn");

  // ── [S9] Doelgroep-tegenspraak: LinkedIn-leads vs het Google-ICP ──
  const { audienceContradiction } = await import("../../lib/cross-channel/audience-coherence");
  const leadsByFn = new Map<string, number>();
  for (const r of tables["linkedin_demographic_daily"] as AnyRow[]) {
    leadsByFn.set(String(r.pivot_value_urn), (leadsByFn.get(String(r.pivot_value_urn)) ?? 0) + Number(r.leads));
  }
  const totalLeads = [...leadsByFn.values()].reduce((s, v) => s + v, 0);
  const labelOf = new Map(LI_DEMO_FUNCTIONS.map((f) => [f.urn, f.label]));
  const segments = [...leadsByFn.entries()].map(([urn, leads]) => ({ dimension: "job_function" as const, value: labelOf.get(urn) ?? urn, conversionShare: leads / totalLeads }));
  const coherence = audienceContradiction({ channel: "linkedin_ads", segments }, { channel: "google_ads", byDimension: AUDIENCE_PROFILE.google_ads });
  expect("S9", coherence.flags.length === 1 && coherence.flags[0].outsideProfileSharePct > 50, `doelgroep-tegenspraak (${coherence.flags[0]?.outsideProfileSharePct}% buiten ICP)`);

  // ── Beursanalyse [S10-S12] ──
  // Meta/LinkedIn dagpunten per beurs, exact zoals app/api/analysis/geo-clone/route.ts ze opbouwt.
  const { matchGeoCloneByCampaignName } = await import("../../lib/fair/geo-clone-catalog");
  const channelPointsFor = (geoClone: string) => {
    const metaIds = new Set(META_CAMPAIGNS.filter((c) => matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone).map((c) => c.id));
    const metaByDate = new Map<string, number>();
    for (const r of tables["meta_campaign_daily"] as AnyRow[]) {
      if (!metaIds.has(String(r.entity_id))) continue;
      const d = String(r.date); metaByDate.set(d, (metaByDate.get(d) ?? 0) + Number(r.conversions));
    }
    const liIds = new Set(LI_CAMPAIGNS.filter((c) => matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone).map((c) => c.urn));
    const liByDate = new Map<string, number>();
    for (const r of tables["linkedin_campaign_daily"] as AnyRow[]) {
      if (!liIds.has(String(r.entity_urn))) continue;
      const d = String(r.date); liByDate.set(d, (liByDate.get(d) ?? 0) + Number(r.external_website_conversions));
    }
    // Het begin van de kanaaldata van het hele account, zoals de route het meegeeft.
    const eerste = (t: string) => (tables[t] as AnyRow[]).map((r) => String(r.date).slice(0, 10)).sort()[0] ?? null;
    const points: { channel: string; points: { date: string; value: number }[]; historyStart: string | null }[] = [];
    if (metaByDate.size > 0) points.push({ channel: "meta_ads", points: [...metaByDate.entries()].map(([date, value]) => ({ date, value })), historyStart: eerste("meta_campaign_daily") });
    if (liByDate.size > 0) points.push({ channel: "linkedin_ads", points: [...liByDate.entries()].map(([date, value]) => ({ date, value })), historyStart: eerste("linkedin_campaign_daily") });
    return points;
  };
  const grt = analyzeGeoClone({
    geoClone: "GRT", fairLabel: "GreenTech Amsterdam", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "annual", editions: RAI_EVENTS.events[0].editions, conversionsTarget: 320, asOfDate: TODAY,
  });
  const grtDelta = grt.conversions?.deltaPct ?? null;
  const grtVoorbij = grt.forecast?.method === "beurs_bereikt";
  expect("S10", grtDelta != null && grtDelta <= -0.2 && grtDelta >= -0.5, `GRT ligt materieel achter (delta ${grtDelta}, ontworpen ~-35%)`);
  expect("S10", grt.actionNeeded === !grtVoorbij, `GRT: ${grtVoorbij ? "na de beurs een evaluatie, geen actie" : "actie in de wachtrij"}`);
  expect("S10", Math.abs(grt.cost?.deltaPct ?? 1) <= 0.05, `GRT: bij gelijke spend (${grt.cost?.deltaPct}), dus een effectiviteitsvraag`);
  const gra = analyzeGeoClone({
    geoClone: "GRA", fairLabel: "GreenTech Americas", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "annual", editions: RAI_EVENTS.events[1].editions, conversionsTarget: 200, asOfDate: TODAY,
    channelConvPoints: channelPointsFor("GRA"),
  });
  const graDelta = gra.conversions?.deltaPct ?? null;
  const graSpend = gra.cost?.deltaPct ?? null;
  // Het getal, niet alleen "vergelijkbaar": met een vorige editie waarvan de historie pas in
  // december begint stond hier +38,1% conversies en +20% spend, en dat kreeg een vinkje.
  expect("S11", gra.conversions?.comparable === true && graDelta != null && graDelta > 0 && graDelta <= 0.2, `GRA op koers: conversies ${graDelta} (ontworpen +10%)`);
  expect("S11", graSpend != null && Math.abs(graSpend) <= 0.05, `GRA spend gelijk (${graSpend})`);
  expect("S11", gra.actionNeeded === false, "GRA: geen actie");
  expect("S11", gra.blendedForecast !== null, `GRA blend't Meta/LinkedIn mee (${gra.perChannelForecast.length} kanalen)`);
  const grn = analyzeGeoClone({
    geoClone: "GRN", fairLabel: "GreenTech North America", rows: rowsAs(tables["ads_campaign_monthly"]),
    cadence: "custom", editions: RAI_EVENTS.events[2].editions, conversionsTarget: 70, asOfDate: TODAY,
    channelConvPoints: channelPointsFor("GRN"),
  });
  expect("S12", grn.conversions !== null && grn.previousEditionId === null, "GRN: eerste editie, geen vorige om tegen af te zetten");
  expect("S12", grn.blendedForecast !== null, `GRN blend't Meta/LinkedIn mee (${grn.perChannelForecast.length} kanalen)`);
  expect("S12", grn.forecast?.method !== "beurs_bereikt" || grn.actionNeeded === false, `GRN na de beurs: evaluatie, geen actie (${grn.forecast?.method})`);

  // ── [S13] Impressieaandeel ──
  const is = analyzeCampaignImpressionShare(rowsAs(tables["ads_campaign_impression_share"]));
  const isVan = (naam: string) => is.campaigns.find((c) => c.campaignName === naam);
  expect("S13", isVan("GRT | Search | NL")?.driver === "budget", "GRT verliest zichtbaarheid aan budget");
  expect("S13", isVan("GRA | Search | US")?.driver === "rank", "GRA verliest zichtbaarheid aan rang");
  // Zelfde campagne als S10 ("geen investeringskwestie maar een effectiviteitsvraag"): de CPA ligt
  // ver boven het account, dus geen budgetverhoging maar eerst efficiëntie.
  expect("S13", isVan("GRT | Search | NL")?.action !== "raise_budget" && /eerst efficiëntie/.test(isVan("GRT | Search | NL")?.budgetTegengehouden ?? ""),
    `GRT is geen budgetkandidaat: ${isVan("GRT | Search | NL")?.budgetTegengehouden}`);
  expect("stil", isVan("GreenTech | Brand")?.driver === "none", "Brand: impressieaandeel gezond");
  expect("stil", !cross.triggered.some((s) => /brand/i.test(s.scope)), "Brand krijgt geen eigen cross-verhaal");

  // ── Objective-analyse: Meta/LinkedIn-bevindingen-engines over meerdere objectives ─────────
  // Alleen VOLLE maanden, en gesorteerd op jaar en maand. De lopende maand gaf hier "Conversies
  // dalen -58%" op drie campagnes met een constante dagwaarde (13 dagen november tegen 31 dagen
  // oktober), met een vinkje; en sorteren op maandnummer zonder jaar zette januari voor november.
  const { analyzeMetaCampaigns } = await import("../../lib/meta/campaign-analysis");
  const { analyzeLinkedInCampaigns } = await import("../../lib/linkedin/campaign-analysis");
  const volleMaanden = (rows: AnyRow[]): Map<string, AnyRow[]> => {
    const perMaand = new Map<string, AnyRow[]>();
    for (const r of rows) {
      const ym = String(r.date).slice(0, 7);
      if (ym >= CUR_MONTH) continue;
      perMaand.set(ym, [...(perMaand.get(ym) ?? []), r]);
    }
    // Een maand is vol als hij op de 1e begint (de oudste maand van het venster is dat meestal niet).
    for (const [ym, rs] of perMaand) if (!rs.some((r) => String(r.date) === `${ym}-01`)) perMaand.delete(ym);
    return new Map([...perMaand.entries()].sort(([a], [b]) => a.localeCompare(b)));
  };
  const n = (v: unknown) => Number(v ?? 0);

  const metaCampaignsForAnalysis = META_CAMPAIGNS.map((c) => {
    const maanden = volleMaanden((tables["meta_campaign_daily"] as AnyRow[]).filter((r) => r.entity_id === c.id));
    const monthly = [...maanden.entries()].map(([ym, rs]) => {
      const imp = rs.reduce((s, r) => s + n(r.impressions), 0), clicks = rs.reduce((s, r) => s + n(r.link_clicks), 0);
      const spend = rs.reduce((s, r) => s + n(r.spend), 0), conv = rs.reduce((s, r) => s + n(r.conversions), 0);
      const hooks = rs.filter((r) => r.hook_rate != null);
      return {
        month: Number(ym.slice(5, 7)), impressions: imp, reach: 0,
        // Geen maandfrequentie: die vraagt een ontdubbeld bereik over de maand (zie
        // campaign-analysis.ts). Het gemiddelde van de dagwaarden is een andere grootheid.
        frequency: 0, linkClicks: clicks, spend,
        cpm: imp > 0 ? (spend / imp) * 1000 : 0, cpcLink: clicks > 0 ? spend / clicks : 0, ctrLink: imp > 0 ? clicks / imp : 0,
        conversions: conv, conversionValue: 0, purchaseRoas: 0, cpa: conv > 0 ? spend / conv : 0, leads: rs.reduce((s, r) => s + n(r.leads), 0),
        addToCart: rs.reduce((s, r) => s + n(r.add_to_cart), 0), initiateCheckout: rs.reduce((s, r) => s + n(r.initiate_checkout), 0), landingPageViews: 0, videoThruplay: 0,
        hookRate: hooks.length > 0 ? hooks.reduce((s, r) => s + n(r.hook_rate), 0) / hooks.length : 0, holdRate: 0, postEngagement: 0,
      };
    });
    return { campaignId: c.id, campaignName: c.name, objective: c.objective as MetaObjective, status: "ACTIVE" as const, monthly };
  });
  const metaAnalysis = analyzeMetaCampaigns({ clientId: DEMO_CLIENT, campaigns: metaCampaignsForAnalysis });
  const metaObjectives = new Set(metaCampaignsForAnalysis.map((c) => c.objective));
  console.log(`  objective-analyse Meta: ${metaAnalysis.findings.length} bevindingen + ${metaAnalysis.manualChecks.length} manualChecks over ${metaObjectives.size} objectives (op ${metaCampaignsForAnalysis[0]?.monthly.length ?? 0} volle maand(en))`);
  for (const f of metaAnalysis.findings.slice(0, 3)) console.log(`  · ${f.campaignName} (${f.objectiveLabel}): ${f.description}`);
  expect("stil", !metaAnalysis.findings.some((f) => /Conversies dalen/.test(f.description)), "objective-analyse Meta: geen 'Conversies dalen' op een constante dagwaarde");

  const linkedinCampaignsForAnalysis = LI_CAMPAIGNS.map((c) => {
    const maanden = volleMaanden((tables["linkedin_campaign_daily"] as AnyRow[]).filter((r) => r.entity_urn === c.urn));
    const monthly = [...maanden.entries()].map(([ym, rs]) => {
      const som = (k: string) => rs.reduce((s, r) => s + n(r[k]), 0);
      const imp = som("impressions"), clicks = som("clicks"), spend = som("spend"), leads = som("one_click_leads"), opens = som("one_click_lead_form_opens");
      const vidStart = som("video_starts"), vidDone = som("video_completions");
      return {
        month: Number(ym.slice(5, 7)), impressions: imp, clicks, spend,
        ctr: imp > 0 ? clicks / imp : 0, cpc: clicks > 0 ? spend / clicks : 0, cpm: imp > 0 ? (spend / imp) * 1000 : 0,
        landingPageClicks: clicks, oneClickLeadFormOpens: opens, oneClickLeads: leads,
        externalWebsiteConversions: som("external_website_conversions"), conversionValue: 0, cpl: leads > 0 ? spend / leads : 0,
        formCompletionRate: opens > 0 ? leads / opens : 0, videoStarts: vidStart, videoViews: vidStart,
        videoCompletions: vidDone, videoCompletionRate: vidStart > 0 ? vidDone / vidStart : 0, totalEngagements: 0,
      };
    });
    return { campaignUrn: c.urn, campaignName: c.name, objective: c.objective as LinkedInObjective, status: "ACTIVE" as const, monthly };
  });
  const linkedinAnalysis = analyzeLinkedInCampaigns({ clientId: DEMO_CLIENT, campaigns: linkedinCampaignsForAnalysis });
  const liObjectives = new Set(linkedinCampaignsForAnalysis.map((c) => c.objective));
  console.log(`  objective-analyse LinkedIn: ${linkedinAnalysis.findings.length} bevindingen + ${linkedinAnalysis.manualChecks.length} manualChecks over ${liObjectives.size} objectives`);
  for (const f of linkedinAnalysis.findings.slice(0, 3)) console.log(`  · ${f.campaignName} (${f.objectiveLabel}): ${f.description}`);
  expect("objective-analyse", metaAnalysis.findings.length + metaAnalysis.manualChecks.length > 0 && linkedinAnalysis.findings.length + linkedinAnalysis.manualChecks.length > 0,
    "de Meta- en LinkedIn-regelmachines draaien over meerdere objectives");

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
  // Zelfde venster als de echte maandroute: periodEnd is daar het einde van de laatste VOLLE
  // maand, dus de feiten draaien hier ook op volle maanden. Zonder deze trim ankert latestMonth
  // op de lopende, halve maand en is de import-pariteit begin van elke maand nooit "stellig" --
  // dan faalde [S14] de 1e t/m ±12e van de maand om een reden die in productie niet bestaat.
  const msVolleMaandGrens = TODAY.slice(0, 7) + "-01";
  const msTotVolleMaand = (tabel: string, veld: "date" | "month"): AnyRow[] =>
    (tables[tabel] as AnyRow[]).filter((r) => String(r[veld] ?? "") < msVolleMaandGrens);
  const msFacts = buildMicrosoftStepFacts({
    account: msTotVolleMaand("microsoft_account_daily", "date").map((r) => mapMicrosoftDailyToComputeRow(r)),
    campaigns: msTotVolleMaand("microsoft_campaign_daily", "date").map((r) => mapMicrosoftDailyToComputeRow(r, msNaam.get(String(r.entity_id)))),
    adgroups: msTotVolleMaand("microsoft_adgroup_daily", "date").map((r) => mapMicrosoftDailyToComputeRow(r, msNaam.get(String(r.entity_id)))),
    campaignMeta: (tables["microsoft_campaigns"] as AnyRow[]).map(mapMicrosoftCampaignMetaRow),
    keywords: msTotVolleMaand("microsoft_keyword_monthly", "month").map(mapMicrosoftKeywordRow),
    searchTerms: msTotVolleMaand("microsoft_search_terms_monthly", "month").map(mapMicrosoftSearchTermRow),
    impressionShare: msTotVolleMaand("microsoft_campaign_impression_share", "month").map(mapMicrosoftImpressionShareRow),
    breakdowns: msTotVolleMaand("microsoft_breakdown_daily", "date").map(mapMicrosoftBreakdownToComputeRow),
    profile: msTotVolleMaand("microsoft_profile_monthly", "month").map(mapMicrosoftProfileRow),
  });
  // De pijler-structuren zijn Record<number, unknown> richting de prompt; hier lezen we ze terug
  // met dezelfde vrijheid als de prompt-JSON dat doet.
  type Vrij = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const feit = (k: number): Vrij => msFacts[k] as Vrij;

  const pariteit = feit(2).import_pariteit as Vrij;
  expect("S14", pariteit.stellig === true && (pariteit.cpa_delta_pct_import_vs_native ?? 0) > 30,
    `import-drift: import-CPA ${pariteit.import_benchmark?.cpa} vs native ${pariteit.native_benchmark?.cpa} (+${pariteit.cpa_delta_pct_import_vs_native}%, stellig)`);

  const netwerk = feit(5).netwerk as Vrij;
  const audience = (netwerk.segments as Vrij[]).find((s) => /audience/i.test(String(s.segment)));
  expect("S15", audience?.lek === true && (audience.spend_share_pct ?? 0) > 10,
    `Audience Network-lek: ${audience?.spend_share_pct}% van spend, CPA ${audience?.cpa_vs_search}x search`);
  const searchSeg = (netwerk.segments as Vrij[]).find((s) => String(s.segment).toLowerCase() === "search");
  expect("stil", searchSeg?.lek === false, "Microsoft: het search-netwerk zelf is geen lek");

  const profielPivots = (feit(4).profiel as Vrij).pivots as Record<string, Vrij[]>;
  const tuinbouw = profielPivots.industry?.find((s) => s.segment === "Tuinbouw & Agri");
  const inkoop = profielPivots.job_function?.find((s) => s.segment === "Inkoop");
  expect("S16", tuinbouw?.boven_volumegrens === true && (tuinbouw?.vs_account_cpa?.delta_pct ?? 0) < -15,
    `Tuinbouw & Agri: CPA ${tuinbouw?.cpa} (${tuinbouw?.vs_account_cpa?.delta_pct}% vs account, boven de volumegrens)`);
  expect("S16", inkoop != null && inkoop.boven_volumegrens === false && (inkoop.cpa ?? 99) < (tuinbouw?.cpa ?? 0),
    `Inkoop oogt beter (CPA ${inkoop?.cpa}) maar zit onder de grens van ${VOLUME_GRENS_CONVERSIES}`);

  const device = feit(4).demografie_device as Vrij;
  const desktop = (device.segments as Vrij[]).find((s) => s.segment === "Desktop");
  const mobiel = (device.segments as Vrij[]).find((s) => s.segment === "Mobile");
  expect("S17", (desktop?.spend_share_pct ?? 0) > 55 && (desktop?.cpa ?? 99) < (mobiel?.cpa ?? 0),
    `desktop ${desktop?.spend_share_pct}% van spend, CPA ${desktop?.cpa} vs mobile ${mobiel?.cpa}`);

  const isFeiten = feit(5).impressieaandeel as Vrij;
  const importIs = (isFeiten.campagnes as Vrij[]).find((c) => c.campaign_name === MS_CAMPAIGNS[0].name);
  const brandIs = (isFeiten.campagnes as Vrij[]).find((c) => c.campaign_name === MS_CAMPAIGNS[2].name);
  expect("S18", (importIs?.budget_lost_trend ?? 0) > 0.1,
    `budgetverlies import loopt op (+${importIs?.budget_lost_trend} over ${importIs?.maanden?.length} maanden)`);
  expect("S18", (brandIs?.maanden?.at(-1)?.impression_share ?? 0) >= 0.9,
    `brand vrijwel vol (IS ${brandIs?.maanden?.at(-1)?.impression_share})`);

  const kw = (feit(3).keywords ?? {}) as Vrij;
  expect("S19", (kw.bleeders as Vrij[]).some((b) => b.keyword === "greenhouse solutions"),
    `bleeder gevonden (${kw.bleeders?.length} bleeder(s), account-CPA ${kw.account_cpa})`);
  expect("S19", !(kw.bleeders as Vrij[]).some((b) => b.keyword === "kas kopen tweedehands"),
    "de EUR 25-tegenhanger is GEEN bleeder");
  expect("S19", (kw.lage_quality_score as Vrij[]).length >= 3,
    `laag-QS-cluster (${kw.lage_quality_score?.length} keywords onder QS 5)`);

  const termen = (feit(3).zoektermen ?? {}) as Vrij;
  expect("S20", (termen.vervuilers as Vrij[]).some((t) => t.search_term === "greenhouse jobs"),
    `zoektermvervuiling op de import (${termen.vervuilers?.length} vervuilers, EUR ${termen.totale_verspilling} verspild)`);

  // ── Dekking: elk scenario heeft een assert gehad ──
  const ongedekt = ALLE_SCENARIOS.filter((s) => !gedekt.has(s));
  if (ongedekt.length > 0) {
    console.log(`✗ niet getoetst: ${ongedekt.join(", ")}`);
    failed += ongedekt.length;
  }
  const gedektAantal = ALLE_SCENARIOS.length - ongedekt.length;
  console.log(failed > 0
    ? `\n${failed} controle(s) mislukt; ${gedektAantal} van de ${ALLE_SCENARIOS.length} scenario's (S1-S20 en stil) getoetst.`
    : `\nAlle ${ALLE_SCENARIOS.length} scenario's (S1-S20 en stil) getoetst: elk gaat af zoals ontworpen en niets gaat vals af.`);
  if (failed > 0) process.exit(1);
}

const mode = process.argv[2];
if (mode === "--sql") printSql(buildAllRows());
else if (mode === "--check") check();
else insertViaSupabase(buildAllRows());

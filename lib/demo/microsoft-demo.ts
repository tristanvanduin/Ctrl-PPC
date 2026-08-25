// Microsoft (Bing) demo-tabellen [S14-S20]: ÉÉN bron voor twee consumenten. De seed
// (scripts/demo/seed-demo-client.ts) schrijft deze rijen naar de echte database voor live
// SOP-runs, en demoRows() (lib/demo/demo-rows.ts) serveert ze aan de mock-client voor de
// demo-modus in de app -- de rookproef (lib/demo/__demo_sop_dekking_test.ts) toetst diezelfde
// rijen. Twee losse generatoren zouden uit elkaar lopen zonder dat iemand het merkt; dit is
// dezelfde les als de median/safeDiv-consolidatie in AGENTS.md, maar dan voor data.
//
// De scenario's (nummering volgt de kop van seed-demo-client.ts):
//   [S14] Import-drift          — de importcampagne verliest 12 weken lang conversiesnelheid
//   [S15] Audience Network-lek  — 18% van spend, ~1% van conversies
//   [S16] Profiel-volumerem     — Tuinbouw & Agri boven de grens (kans); Inkoop eronder (rem)
//   [S17] Desktop >> mobile     — in volume en CPA
//   [S18] Impressieaandeel      — import: budgetverlies loopt op; brand vol; native rank-verlies
//   [S19] Keyword-bleeder       — boven 2x account-CPA zonder conversies + de EUR 25-tegenhanger
//   [S20] Zoektermvervuiling    — verouderde negatives op de importcampagne
//
// Grondwaarheid is het AD-GROUP-niveau: campagne- en accountdagen worden er per dag uit opgeteld
// en de breakdown-segmenten worden uit de accountdag verdeeld -- afleiden, niet verzinnen: de
// niveaus sommeren exact naar elkaar, en controles op die sommen mogen daarop rekenen.

import { splitInt } from "./split";

type Row = Record<string, unknown>;

const TODAY = new Date().toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: string, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return iso(d); };
const monthsBack = (n: number) => { const d = new Date(TODAY); d.setDate(1); d.setMonth(d.getMonth() - n); return iso(d); };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const MS_CAMPAIGNS = [
  // [S14] Als Google-import geboren; de drift zelf (verouderde negatives, niet-vertaalde
  // bid-mapping) zit in de dagdata hieronder, niet in deze metadata.
  { id: "demo-ms-import", name: "GRT | Search | NL (import)", budget: 30, bid: "enhanced_cpc", importSource: "google_ads" as string | null },
  { id: "demo-ms-native", name: "GreenTech | Search | Native", budget: 20, bid: "target_cpa", importSource: null },
  { id: "demo-ms-brand", name: "GreenTech | Brand | Bing", budget: 5, bid: "manual_cpc", importSource: null },
];
export const MS_ADGROUPS = [
  { id: "demo-msag-import-generiek", campaign: "demo-ms-import", name: "GRT Generiek (import)" },
  { id: "demo-msag-import-beurs", campaign: "demo-ms-import", name: "GRT Beurs (import)" },
  { id: "demo-msag-native-kassen", campaign: "demo-ms-native", name: "Kassen & Teelt" },
  { id: "demo-msag-native-toeleveranciers", campaign: "demo-ms-native", name: "Toeleveranciers" },
  { id: "demo-msag-brand", campaign: "demo-ms-brand", name: "Brand NL" },
];
// Zelfde AOV-redenering als GOOGLE_AOV/META_AOV in de seed: brand is het hoogste-intent verkeer.
export const MS_AOV: Record<string, number> = { "demo-ms-import": 170, "demo-ms-native": 180, "demo-ms-brand": 200 };

interface MsDaily { adgroup: string; campaign: string; date: string; imp: number; clicks: number; spend: number; conv: number }

// 400 dagen => 13+ maanden voor de maandanalyse-trend. Conversies zijn numeric (geen bigint),
// dus fractionele dagsnelheden mogen gewoon de database in -- geen heelGetal() nodig.
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
    rows.push({ adgroup: "demo-msag-import-generiek", campaign: "demo-ms-import", date, imp: 220, clicks: 9, spend: 12, conv: r3(0.85 * drift) });
    rows.push({ adgroup: "demo-msag-import-beurs", campaign: "demo-ms-import", date, imp: Math.round(110 * seizoen), clicks: Math.round(4 * seizoen), spend: 6, conv: r3(0.4 * drift * seizoen) });
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

export function microsoftDemoRows(clientId: string): Record<string, Row[]> {
  const tables: Record<string, Row[]> = {};

  tables["microsoft_campaigns"] = MS_CAMPAIGNS.map((c) => ({
    campaign_id: c.id, client_id: clientId, name: c.name, campaign_type: "search", status: "active",
    daily_budget: c.budget, bid_strategy: c.bid, import_source: c.importSource,
    imported_at: c.importSource ? `${monthsBack(8)}T09:00:00Z` : null,
    serving_status: "eligible",
  }));
  tables["microsoft_adgroups"] = MS_ADGROUPS.map((a) => ({
    adgroup_id: a.id, campaign_id: a.campaign, client_id: clientId, name: a.name, status: "active",
  }));

  const msAg = msAdgroupDaily();
  interface MsSom { imp: number; clicks: number; spend: number; conv: number; value: number }
  const msDailyRow = (date: string, entity: string, v: MsSom): Row => ({
    client_id: clientId, date, entity_id: entity,
    impressions: v.imp, clicks: v.clicks, spend: r2(v.spend), conversions: r3(v.conv), conversion_value: r2(v.value),
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
          client_id: clientId, date, level: "account", entity_id: "demo-ms-account",
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
    client_id: clientId, month, campaign_id: k.camp.id, campaign_name: k.camp.name,
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
    client_id: clientId, month, campaign_id: t.camp.id, ad_group_id: t.ag.id,
    campaign_name: t.camp.name, ad_group_name: t.ag.name, search_term: t.term, match_type: "broad",
    impressions: t.clicks * 18, clicks: t.clicks, cost: t.cost, conversions: t.conv,
    conversions_value: r2(t.conv * MS_AOV[t.camp.id]), ctr: r2(1 / 18),
    conversion_rate: t.clicks > 0 ? r2(t.conv / t.clicks) : 0,
  })));

  // [S18] Impressieaandeel: het budgetverlies van de import loopt over zes maanden op van 0.10
  // naar 0.26 (en de conversies zakken mee -- de drift-echo), brand staat vrijwel vol, native
  // verliest op positie. Budget- en positieverlies vragen tegengestelde ingrepen.
  tables["microsoft_campaign_impression_share"] = msMaanden.flatMap((month, i) => [
    { client_id: clientId, campaign_id: MS_CAMPAIGNS[0].id, campaign_name: MS_CAMPAIGNS[0].name, campaign_type: "search", month, impressions: 9900, clicks: 390, cost: 540, conversions: 30 - i * 2, impression_share: r2(0.46 - i * 0.008), budget_lost_is: r2(0.1 + i * 0.032), rank_lost_is: 0.08, daily_budget: 30, budget_utilization: 0.98 },
    { client_id: clientId, campaign_id: MS_CAMPAIGNS[1].id, campaign_name: MS_CAMPAIGNS[1].name, campaign_type: "search", month, impressions: 6900, clicks: 270, cost: 360, conversions: 26, impression_share: 0.55, budget_lost_is: 0.03, rank_lost_is: 0.18, daily_budget: 20, budget_utilization: 0.72 },
    { client_id: clientId, campaign_id: MS_CAMPAIGNS[2].id, campaign_name: MS_CAMPAIGNS[2].name, campaign_type: "search", month, impressions: 1800, clicks: 150, cost: 90, conversions: 15, impression_share: 0.93, budget_lost_is: 0.01, rank_lost_is: 0.02, daily_budget: 5, budget_utilization: 0.55 },
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
    client_id: clientId, month, pivot_type: p.pivot, pivot_value: p.waarde,
    impressions: p.imp, clicks: p.clicks, spend: p.spend, conversions: p.conv,
  })));

  return tables;
}

// De rookproef op de demo-data: kan ELKE combinatie van kanaal en cadans in de demo überhaupt
// draaien, of valt hij terug op "geen data"?
// Draaien: npx tsx lib/demo/__demo_sop_dekking_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// Er zijn geen live klanten. De demo-data is daarmee de enige plek waar te bewijzen valt dat de
// negen SOP-combinaties werken -- en die bewijskracht is precies zo groot als de dekking van die
// data. Dat ging al een keer mis en niemand zag het: meta_adsets en meta_adset_daily ontbraken
// volledig terwijl alle drie de Meta-cadansen ze lezen, dus het ad set-niveau (bij Meta het niveau
// waar budget en doelgroep leven) viel in elke demo-run stil terug op leeg. Tsc zag dat niet, de
// tests niet en de build niet: een lege tabel is geen typefout, het is een lege array.
//
// ── WAAROM HIJ DE ROUTES LEEST IN PLAATS VAN EEN LIJST BIJ TE HOUDEN ────────
//
// Een handgeschreven lijst "welke tabel hoort bij welke SOP" is over drie maanden onjuist zonder
// dat iemand het merkt -- dan bewaakt de test een structuur die niet meer bestaat. Daarom leidt hij
// de tabellen af uit de broncode van de routes zelf: verandert een route van bron, dan verandert
// deze test mee. Dezelfde redenering als scripts/check-hygiene.mjs, die ook de bron scant in plaats
// van een inventaris bij te houden.
//
// ── WAT HIJ NIET IS ─────────────────────────────────────────────────────────
//
// Dit is de GRATIS helft van de rookproef: hij toetst de invoer, niet de uitvoer. Of het model met
// die invoer een goede analyse schrijft, kan alleen een echte run of een replay uitwijzen
// (app/api/eval/replay). Deze test zegt alleen: de data die de route opvraagt, is er. Dat is de
// voorwaarde, niet het bewijs -- en het is de helft die zonder API-sleutel, zonder server en zonder
// kosten bij elke gates-run kan draaien.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoRows } from "./demo-rows";
import { buildMetaStepFacts } from "@/lib/meta/prepared-facts";
import { buildLinkedinStepFacts } from "@/lib/linkedin/prepared-facts";
import { mapMetaDailyToComputeRow, mapMetaBreakdownToComputeRow } from "@/lib/meta/analysis-data";
import { mapLinkedinDailyToComputeRow, mapLinkedinDemographicToComputeRow } from "@/lib/linkedin/analysis-data";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const WORTEL = join(import.meta.dirname, "..", "..");
const lees = (p: string): string => readFileSync(join(WORTEL, p), "utf8");

// ── Tabellen uit een stuk broncode halen ────────────────────────────────────
//
// In elk van deze aanroepvormen is de tabelnaam het EERSTE stringliteral binnen de haakjes:
//   .from("meta_campaigns")
//   fetchMetaDaily(supabase, clientId, "meta_adset_daily", start, eind)
//   fetchNameMap(supabase, clientId, "meta_adsets", "adset_id", "name")
//   fetchLinkedinDaily("linkedin_account_daily", start)
// supabase en clientId zijn identifiers, geen strings, dus "eerste string" is eenduidig. De
// kolomnamen komen er altijd ná.
const AANROEP = /(?:\.from|fetchMetaDaily|fetchDaily|fetchNameMap|fetchLinkedinDaily|fetchLinkedinNameMap)\(([^)]*)\)/g;

function tabellenIn(bron: string): Set<string> {
  const uit = new Set<string>();
  for (const m of bron.matchAll(AANROEP)) {
    const eerste = m[1].match(/"([a-z][a-z0-9_]+)"/);
    if (eerste) uit.add(eerste[1]);
  }
  return uit;
}

/** Snijdt één functie uit een bestand: van zijn signatuur tot de volgende top-level functie.
 *  De zoekterm eist een newline vóór het `function`-sleutelwoord, dus de eigen signatuur (die aan
 *  het begin van `rest` staat, zónder voorafgaande newline) matcht zichzelf niet, en een ingesprongen
 *  binnenfunctie evenmin. */
function functie(bron: string, naam: string): string {
  const start = bron.indexOf(`async function ${naam}(`);
  if (start < 0) return "";
  const rest = bron.slice(start);
  const volgende = rest.search(/\n(?:export )?(?:async )?function /);
  return volgende < 0 ? rest : rest.slice(0, volgende);
}

const weekly = lees("app/api/analysis/weekly/route.ts");
const biweekly = lees("app/api/analysis/biweekly/route.ts");
const monthly = lees("app/api/analysis/monthly/route.ts");
const metaData = lees("lib/meta/analysis-data.ts");
const linkedinData = lees("lib/linkedin/analysis-data.ts");

// De negen combinaties, elk met de broncode die zijn datatoegang bevat. Voor de monthly van Meta en
// LinkedIn zit het ophalen in de gedeelde analysis-data-module, niet in de routefunctie zelf.
const COMBINATIES: Array<{ kanaal: string; cadans: string; bron: string }> = [
  { kanaal: "google_ads", cadans: "weekly", bron: functie(weekly, "runGoogleWeeklyAnalysis") },
  { kanaal: "meta_ads", cadans: "weekly", bron: functie(weekly, "runMetaWeeklyAnalysis") },
  { kanaal: "linkedin_ads", cadans: "weekly", bron: functie(weekly, "runLinkedinWeeklyAnalysis") },
  { kanaal: "google_ads", cadans: "biweekly", bron: functie(biweekly, "runGoogleBiWeeklyAnalysis") },
  { kanaal: "meta_ads", cadans: "biweekly", bron: functie(biweekly, "runMetaBiWeeklyAnalysis") },
  { kanaal: "linkedin_ads", cadans: "biweekly", bron: functie(biweekly, "runLinkedinBiWeeklyAnalysis") },
  { kanaal: "google_ads", cadans: "monthly", bron: monthly.slice(monthly.indexOf("export async function POST")) },
  { kanaal: "meta_ads", cadans: "monthly", bron: functie(monthly, "runMetaMonthlyAnalysis") + metaData },
  { kanaal: "linkedin_ads", cadans: "monthly", bron: functie(monthly, "runLinkedinMonthlyAnalysis") + linkedinData },
];

// ── Tabellen die in de demo leeg MOGEN zijn, met de reden erbij ─────────────
//
// Zelfde discipline als TOEGESTANE_WEZEN in scripts/check-hygiene.mjs: een uitzondering zonder
// reden is over drie maanden niet meer van een vergissing te onderscheiden. Deze lijst hoort te
// krimpen. Groeit hij, dan is er een SOP-stap die in de demo niets kan laten zien.
const MAG_LEEG = new Map([
  ["meta_creative_patterns",
    "vision-pijplijn (M3); de prompt heeft een uitgeschreven uitweg: 'onvoldoende geanalyseerde creatives'"],
  ["meta_creative_visual_features",
    "idem meta_creative_patterns -- pijler 3 niveau B valt terug op exact één zin"],
  ["meta_change_log",
    "wordt door geen enkele syncroute gevuld (lib/meta/sync.ts is wees, gated op MDP-approval)"],
  ["linkedin_lead_forms",
    "adapter zegt zelf 'indien gesynct'; pijler 5 valt terug op 'geen leadgen-campagnes: 1 regel en door'"],
  ["ads_change_history",
    "wijzigingshistorie komt uit de Google-sync, niet uit de demo; enrichment levert dan een lege string"],
  ["google_ads_product_performance",
    "de dagvariant; de canonieke maandbron ads_product_performance_monthly (lib/types/dimensional.ts:306) IS gevuld en voedt de productstap"],
  ["google_ads_checkout_funnel",
    "stap 12 heeft een eigen beschikbaarheidsinstructie (buildStep12AvailabilityInstruction) die leegte expliciet meldt"],
  ["ads_negative_keywords",
    "leeg betekent hier iets echts: een account zonder uitsluitingslijsten. Geen verzonnen rijen om een lijst te vullen"],
  ["ads_search_terms_monthly",
    "volumeFor() geeft null bij nul rijen -- de route noemt dat zelf de conservatieve regel: bron-onbekend, niet 'geen volume'"],
]);

// ── De toets ────────────────────────────────────────────────────────────────

const rijen = demoRows() as Record<string, unknown[]>;
const gevuld = (t: string): boolean => Array.isArray(rijen[t]) && rijen[t].length > 0;

console.log("Elke combinatie leest tabellen die de demo ook vult");
const ontbrekend = new Map<string, string[]>();
for (const c of COMBINATIES) {
  const label = `${c.kanaal} / ${c.cadans}`;
  if (c.bron.length === 0) { check(label, false, "kon de routefunctie niet vinden -- is hij hernoemd?"); continue; }
  const nodig = [...tabellenIn(c.bron)].filter((t) => !MAG_LEEG.has(t));
  const leeg = nodig.filter((t) => !gevuld(t));
  check(label, leeg.length === 0, leeg.length ? `leeg in de demo: ${leeg.join(", ")}` : "");
  if (leeg.length) ontbrekend.set(label, leeg);
}

console.log("\nDe uitzonderingenlijst is nog waar hij voor bedoeld is");
for (const [tabel, reden] of MAG_LEEG) {
  // Een uitzondering voor een tabel die inmiddels wél gevuld is, hoort weg: hij verbergt dan een
  // echte controle in plaats van een bekende leemte te documenteren.
  check(`${tabel} is nog steeds leeg`, !gevuld(tabel), `staat inmiddels gevuld -- haal de uitzondering weg (${reden})`);
}

console.log("\nHet Meta ad set-niveau is compleet en telt op tot zijn campagnes");
const adsets = (rijen.meta_adsets ?? []) as Record<string, unknown>[];
const adsetDaily = (rijen.meta_adset_daily ?? []) as Record<string, unknown>[];
const campaignDaily = (rijen.meta_campaign_daily ?? []) as Record<string, unknown>[];
const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);

check("elke ad set hoort bij een bestaande campagne", (() => {
  const campagnes = new Set(((rijen.meta_campaigns ?? []) as Record<string, unknown>[]).map((c) => String(c.campaign_id)));
  return adsets.length > 0 && adsets.every((a) => campagnes.has(String(a.campaign_id)));
})());

check("elke dagrij hoort bij een bestaande ad set", (() => {
  const ids = new Set(adsets.map((a) => String(a.adset_id)));
  return adsetDaily.length > 0 && adsetDaily.every((r) => ids.has(String(r.entity_id)));
})());

// De kern van de afleiding: per campagne per dag moeten de optelbare grootheden exact terugkomen.
// Wijkt hier iets af, dan spreekt de ad set-tabel zijn eigen campagnetabel tegen -- en dat is het
// soort tegenstrijdigheid waar een analist in de demo meteen over valt.
for (const veld of ["impressions", "link_clicks", "spend", "conversions", "conversion_value"]) {
  const perCampagneDag = new Map<string, number>();
  const adsetNaarCampagne = new Map(adsets.map((a) => [String(a.adset_id), String(a.campaign_id)]));
  for (const r of adsetDaily) {
    const sleutel = `${adsetNaarCampagne.get(String(r.entity_id))}|${r.date}`;
    perCampagneDag.set(sleutel, (perCampagneDag.get(sleutel) ?? 0) + num(r, veld));
  }
  const afwijkend = campaignDaily.filter((c) => perCampagneDag.get(`${c.entity_id}|${c.date}`) !== num(c, veld));
  check(`${veld}: ad sets = hun campagne, elke dag`, afwijkend.length === 0,
    afwijkend.length ? `${afwijkend.length} dagen wijken af, bv. ${afwijkend[0].entity_id} op ${afwijkend[0].date}` : "");
}

check("geen omzet zonder conversie", adsetDaily.every((r) => !(num(r, "conversions") === 0 && num(r, "conversion_value") > 0)));

check("frequency is niet gesplitst maar per ad set gezet", (() => {
  // Zou frequency zijn meegesplitst, dan lag de som per campagne-dag op de campagnewaarde. Hij
  // hoort juist per ad set een eigen, niet-optelbare waarde te zijn.
  return adsetDaily.every((r) => num(r, "frequency") > 1 && num(r, "frequency") < 10);
})());

console.log("\nDe patronen die het ad set-niveau moet laten zien");
const perAdset = (id: string) => adsetDaily.filter((r) => String(r.entity_id) === id);

check("er is een bleeder: spend zonder enige conversie", (() => {
  const bleeder = perAdset("demo-mas-pro-int");
  const spend = bleeder.reduce((s, r) => s + num(r, "spend"), 0);
  const conv = bleeder.reduce((s, r) => s + num(r, "conversions"), 0);
  return bleeder.length > 0 && spend > 0 && conv === 0;
})());

check("de bleeder ligt ruim boven de weekly-drempel (2x account-CPA)", (() => {
  // De weekly vlagt een bleeder bij cost > 2x de gemiddelde account-CPA en 0 conversies. Ligt de
  // demo-bleeder daar niet ruim boven, dan bewijst de demo de detector niet.
  const week = (rs: Record<string, unknown>[]) => rs.slice(-7);
  const account = (rijen.meta_account_daily ?? []) as Record<string, unknown>[];
  const accWeek = week(account);
  const cpa = accWeek.reduce((s, r) => s + num(r, "spend"), 0) / Math.max(1, accWeek.reduce((s, r) => s + num(r, "conversions"), 0));
  const bleederSpend = week(perAdset("demo-mas-pro-int")).reduce((s, r) => s + num(r, "spend"), 0);
  return bleederSpend > 2 * cpa;
})());

check("twee ad sets delen dezelfde doelgroepomschrijving (overlap-risico)", (() => {
  const perTargeting = new Map<string, string[]>();
  for (const a of adsets) {
    const t = String(a.targeting_summary ?? "");
    perTargeting.set(t, [...(perTargeting.get(t) ?? []), String(a.adset_id)]);
  }
  return [...perTargeting.values()].some((ids) => ids.length > 1);
})());

check("frequency kruist de benchmark-drempel van 3,5 recent", (() => {
  const rt = perAdset("demo-mas-rt-web");
  const oud = rt.slice(0, 10).reduce((s, r) => s + num(r, "frequency"), 0) / 10;
  const nieuw = rt.slice(-10).reduce((s, r) => s + num(r, "frequency"), 0) / 10;
  return oud < 3.5 && nieuw > 3.5;
})());

check("er is een ad set met learning limited", adsets.some((a) => JSON.stringify(a.learning_stage_info ?? {}).includes("LEARNING_LIMITED")));

check("targeting_summary is overal gevuld", adsets.every((a) => String(a.targeting_summary ?? "").length > 5));

console.log("\nLinkedIn heeft een ICP, in URN's en met echte waste");
const settings = ((rijen.client_settings ?? []) as Record<string, unknown>[])[0] ?? {};
const icp = settings.linkedin_icp as Record<string, string[]> | undefined;

check("client_settings draagt een linkedin_icp", !!icp);
check("alle vier de ICP-dimensies zijn gevuld", (() => {
  if (!icp) return false;
  return (["job_functions", "seniorities", "industries", "company_sizes"] as const)
    .every((k) => Array.isArray(icp[k]) && icp[k].length > 0);
})());

check("het ICP gebruikt URN's, geen labels", (() => {
  if (!icp) return false;
  // computeIcpFitForPivot vergelijkt met pivotValueUrn; labels zouden stil 0% fit opleveren.
  return Object.values(icp).flat().every((v) => String(v).startsWith("urn:li:"));
})());

check("elke ICP-waarde bestaat ook echt in de demografiedata", (() => {
  if (!icp) return false;
  const aanwezig = new Set(((rijen.linkedin_demographic_daily ?? []) as Record<string, unknown>[]).map((r) => String(r.pivot_value_urn)));
  const onbekend = Object.values(icp).flat().filter((v) => !aanwezig.has(String(v)));
  return onbekend.length === 0;
})());

check("elke pivot houdt een waste-segment over (geen 100% fit)", (() => {
  if (!icp) return false;
  const demo = (rijen.linkedin_demographic_daily ?? []) as Record<string, unknown>[];
  const paren: Array<[string, keyof typeof icp]> = [
    ["MEMBER_JOB_FUNCTION", "job_functions"], ["MEMBER_SENIORITY", "seniorities"],
    ["MEMBER_INDUSTRY", "industries"], ["MEMBER_COMPANY_SIZE", "company_sizes"],
  ];
  return paren.every(([pivot, sleutel]) => {
    const inSet = new Set(icp[sleutel] ?? []);
    const urns = new Set(demo.filter((r) => r.pivot_type === pivot).map((r) => String(r.pivot_value_urn)));
    return [...urns].some((u) => !inSet.has(u)) && [...urns].some((u) => inSet.has(u));
  });
})());


// ── DE TWEEDE LAAG: leveren de stappen ook FEITEN? ──────────────────────────
//
// Alles hierboven toetst of de TABELLEN gevuld zijn. Dat is één laag te grof, en dat heeft precies
// gedaan wat een te grove test doet: hij stond groen terwijl drie stappen niets te zeggen hadden.
//
//  - Meta pijler 3 kwam eruit met hook_rate_pct 0 en hold_rate_pct null, omdat meta_ad_daily geen
//    videokolommen droeg -- terwijl de prompt, META_BENCHMARKS en de weekly-bleeder-check alle drie
//    op die cijfers leunen.
//  - LinkedIn pijler 5 leverde een TEGENSTRIJDIG object: cpl 43,33 en leads 131,6 naast has_leadgen
//    false en "Geen leadgen-campagnes in deze periode", omdat one_click_lead_form_opens ontbrak.
//  - De competitor-dimensie had één maand, dus over "auction insights over de tijd" viel niets te zeggen.
//
// De tabellen waren in alle drie de gevallen gevuld. Het waren de KOLOMMEN erin die ontbraken.
// Daarom draait deze sectie de echte fact-builders van productie en kijkt naar de uitkomst.

const metaFeiten = buildMetaStepFacts({
  account: (rijen.meta_account_daily ?? []).map((x) => mapMetaDailyToComputeRow(x as Record<string, unknown>)),
  campaigns: (rijen.meta_campaign_daily ?? []).map((x) => mapMetaDailyToComputeRow(x as Record<string, unknown>)),
  adsets: (rijen.meta_adset_daily ?? []).map((x) => mapMetaDailyToComputeRow(x as Record<string, unknown>)),
  ads: (rijen.meta_ad_daily ?? []).map((x) => mapMetaDailyToComputeRow(x as Record<string, unknown>, "demo")),
  breakdowns: (rijen.meta_breakdown_daily ?? []).map((x) => mapMetaBreakdownToComputeRow(x as Record<string, unknown>)),
  targets: { roasTarget: 4, cpaTarget: 60 },
});

const linkedinFeiten = buildLinkedinStepFacts({
  account: (rijen.linkedin_account_daily ?? []).map((x) => mapLinkedinDailyToComputeRow(x as Record<string, unknown>)),
  campaigns: (rijen.linkedin_campaign_daily ?? []).map((x) => mapLinkedinDailyToComputeRow(x as Record<string, unknown>)),
  creatives: (rijen.linkedin_creative_daily ?? []).map((x) => mapLinkedinDailyToComputeRow(x as Record<string, unknown>)),
  demographics: (rijen.linkedin_demographic_daily ?? []).map((x) => mapLinkedinDemographicToComputeRow(x as Record<string, unknown>)),
  icp: (settings.linkedin_icp ?? null) as never,
  targets: { cplTarget: 80 },
});

/** Een pijler die zichzelf als onbeschikbaar meldt, kan in een demo-run niets laten zien. */
function pijlerBeschikbaar(feiten: unknown): boolean {
  if (feiten == null) return false;
  if (typeof feiten === "object" && "available" in (feiten as Record<string, unknown>)) {
    return (feiten as Record<string, unknown>).available !== false;
  }
  return true;
}

console.log("\nElke pijler levert feiten, niet alleen een tabel");
for (let i = 1; i <= 6; i++) {
  check(`meta pijler ${i}`, pijlerBeschikbaar(metaFeiten[i]), JSON.stringify(metaFeiten[i]).slice(0, 90));
  check(`linkedin pijler ${i}`, pijlerBeschikbaar(linkedinFeiten[i]), JSON.stringify(linkedinFeiten[i]).slice(0, 90));
}

console.log("\nDe ratio's waar de prompts op leunen zijn ook echt berekend");
{
  const p3 = (metaFeiten[3] ?? {}) as Record<string, Record<string, unknown>>;
  const cp = (p3.creative_performance ?? {}) as Record<string, unknown>;
  const bench = (cp.account_benchmark ?? {}) as Record<string, unknown>;
  // META_BENCHMARKS noemt "hook rate video 25 tot 40%, hold rate 10 tot 20%" en de weekly vraagt om
  // "hook rate dalend WoW". Een nul hier zou als een GEMETEN nul lezen, niet als ontbrekende data.
  check("meta: account-hook rate is berekend", Number(bench.hook_rate_pct) > 0, String(bench.hook_rate_pct));
  check("meta: account-hold rate is berekend", bench.hold_rate_pct != null && Number(bench.hold_rate_pct) > 0, String(bench.hold_rate_pct));

  const ads = (cp.ads ?? []) as Record<string, unknown>[];
  const videoAds = ads.filter((a) => Number(a.hook_rate_pct) > 0);
  check("meta: minstens één advertentie heeft een hook rate", videoAds.length > 0);
  // Statische advertenties horen GEEN hook rate te hebben; een nul daar is correct en betekent
  // "geen video", niet "slecht presterende video".
  check("meta: niet elke advertentie is video", videoAds.length < ads.length, `${videoAds.length}/${ads.length}`);
  check("meta: de hold rate ligt in een plausibele band",
    videoAds.every((a) => Number(a.hold_rate_pct) > 5 && Number(a.hold_rate_pct) < 40),
    videoAds.map((a) => a.hold_rate_pct).join(", "));
}
{
  const p5 = (linkedinFeiten[5] ?? {}) as Record<string, unknown>;
  // Dit is het geval dat zichzelf tegensprak: leads en cpl berekend, has_leadgen false.
  check("linkedin: has_leadgen is waar", p5.has_leadgen === true, JSON.stringify(p5));
  check("linkedin: geen tegenspraak tussen leads en has_leadgen",
    !(Number(p5.leads) > 0 && p5.has_leadgen === false), JSON.stringify(p5));
  check("linkedin: open rate is berekend", Number(p5.open_rate_pct) > 0, String(p5.open_rate_pct));
  // LINKEDIN_BENCHMARKS noemt "form completion 10 tot 15%"; buiten die band zou de demo zijn eigen
  // benchmark tegenspreken.
  const completion = Number(p5.completion_rate_pct);
  check("linkedin: completion rate ligt in de benchmarkband", completion >= 10 && completion <= 15, String(completion));
}

console.log("\nDe competitor-dimensie heeft een reeks, geen enkel punt");
{
  const is = (rijen.ads_campaign_impression_share ?? []) as Record<string, unknown>[];
  const maanden = new Set(is.map((r) => String(r.month)));
  // De maand-SOP haalt zes maanden op en vraagt om auction insights OVER DE TIJD; met één meetpunt
  // valt daar niets over te zeggen, ook al is de tabel technisch "gevuld".
  check("meerdere maanden", maanden.size >= 4, `${maanden.size} maanden`);
  const perCampagne = new Map<string, number[]>();
  for (const r of is) {
    const k = String(r.campaign_name);
    perCampagne.set(k, [...(perCampagne.get(k) ?? []), Number(r.search_budget_lost_is)]);
  }
  // Een vlakke reeks levert geen bevinding op. Minstens één campagne moet een ontwikkeling tonen.
  check("minstens één campagne beweegt",
    [...perCampagne.values()].some((v) => Math.max(...v) - Math.min(...v) > 0.05),
    [...perCampagne.entries()].map(([k, v]) => `${k}: ${Math.min(...v)}-${Math.max(...v)}`).join(" | "));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (ontbrekend.size > 0) {
  console.log("\nOntbrekende demo-dekking per combinatie:");
  for (const [label, tabellen] of ontbrekend) console.log(`  ${label}: ${tabellen.join(", ")}`);
}
if (failed > 0) process.exit(1);

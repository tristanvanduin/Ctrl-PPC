// De redeneerketen van extractie naar scherm: wat de parser doorlaat, hoe een bevinding op het
// scherm komt, en of de getallen erin uit de brondata komen.
// Draaien: node_modules/.bin/tsx lib/analysis/__redeneerketen_bevindingen_test.ts
//
// De invoer is de opgeslagen "Findings Extractie" van de Google-weekly van demo-greentech op
// 1 september 2026, letterlijk. Daarvan kwamen er 3 van de 10 in sop_insights: de parser gooide de
// zeven met "benchmark_type": null stil weg, waaronder alle vijf de zoekterm-bleeders
// (doorlichting 13 november, sectie 2).

import { parseFindings, normaliseerDoelVeld, type Finding } from "@/lib/schema/analysis-schema";
import { bevindingBeschrijving, bevindingTitel, afgevallenWaarschuwing, toetsExtractie, extractieUitkomst, NIET_HERLEIDBAAR_LABEL } from "./bevinding-weergave";
import { bouwBronFeiten, toetsTekst } from "./brondata-toets";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const EXTRACTIE_1_SEPTEMBER = `[{"step":1,"entity_type":"account","entity_name":"Account","metric":"cpa","current_value":94.84,"previous_value":45,"change_pct":110.8,"severity":"high","insight_type":"anomaly","is_seasonal":false,"is_structural":true,"cause":"Aanhoudende verspilling op niet-converterende zoektermen en hoge CPC (€1,65) in verhouding tot conversieratio (2,0%)","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":"monthly_target"},{"step":1,"entity_type":"account","entity_name":"Account","metric":"conversions","current_value":29,"previous_value":57,"change_pct":-49.1,"severity":"high","insight_type":"risk","is_seasonal":false,"is_structural":false,"cause":"Conversietempo ligt aanzienlijk onder het benodigde weektempo voor de maanddoelstelling van 229 conversies (mede beïnvloed door 3 dagen conversielag)","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":"pace_target"},{"step":2,"entity_type":"searchterm","entity_name":"hydroponics diy home","metric":"cost","current_value":160,"previous_value":null,"change_pct":null,"severity":"critical","insight_type":"risk","is_seasonal":false,"is_structural":true,"cause":"Niet-converterende zoekterm met 54 klikken en 0 conversies sinds 2026-08-18","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":null},{"step":2,"entity_type":"searchterm","entity_name":"gratis kas bouwen","metric":"cost","current_value":135,"previous_value":null,"change_pct":null,"severity":"critical","insight_type":"risk","is_seasonal":false,"is_structural":true,"cause":"Niet-commerciële zoekterm met 48 klikken en 0 conversies sinds 2026-08-26","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":null},{"step":2,"entity_type":"searchterm","entity_name":"greentech festival tickets","metric":"cost","current_value":110,"previous_value":null,"change_pct":null,"severity":"high","insight_type":"risk","is_seasonal":false,"is_structural":true,"cause":"Niet-relevante evenement-gerelateerde zoekterm met 42 klikken en 0 conversies sinds 2026-08-26","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":null},{"step":2,"entity_type":"searchterm","entity_name":"tuinbouw vacature","metric":"cost","current_value":85,"previous_value":null,"change_pct":null,"severity":"high","insight_type":"risk","is_seasonal":false,"is_structural":true,"cause":"Wervingsgerelateerde zoekterm met 36 klikken en 0 conversies sinds 2026-08-26","action_required":true,"evidence_level":"deterministic","confidence":"medium","benchmark_type":null},{"step":2,"entity_type":"searchterm","entity_name":"greenhouse jobs","metric":"cost","current_value":60,"previous_value":null,"change_pct":null,"severity":"medium","insight_type":"risk","is_seasonal":false,"is_structural":true,"cause":"Nieuwe wervingsgerelateerde zoekterm met 30 klikken en 0 conversies","action_required":false,"evidence_level":"deterministic","confidence":"medium","benchmark_type":null},{"step":3,"entity_type":"campaign","entity_name":"GRT | Search | NL","metric":"search_budget_lost_is","current_value":28,"previous_value":null,"change_pct":null,"severity":"high","insight_type":"anomaly","is_seasonal":false,"is_structural":true,"cause":"Campagne is budgetbeperkt (28% budget lost IS, 97% benutting) maar presteert met CPA €172,92 (+284,3%) ver onder doelstelling door bleeders","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":null},{"step":3,"entity_type":"campaign","entity_name":"GRA | Search | US","metric":"search_rank_lost_is","current_value":22,"previous_value":null,"change_pct":null,"severity":"medium","insight_type":"performance","is_seasonal":false,"is_structural":true,"cause":"Volumeverlies door positie, bod of kwaliteitsscore (rank lost IS 22% vs budget lost IS 4%) bij CPA van €83,33 (+85,2% boven target)","action_required":false,"evidence_level":"deterministic","confidence":"high","benchmark_type":null},{"step":3,"entity_type":"campaign","entity_name":"GreenTech | Display | Prospecting","metric":"cpa","current_value":400,"previous_value":45,"change_pct":788.9,"severity":"high","insight_type":"performance","is_seasonal":false,"is_structural":true,"cause":"Blijvende underperformance met €800 spend voor slechts 2 conversies","action_required":true,"evidence_level":"deterministic","confidence":"high","benchmark_type":"monthly_target"}]`;

console.log("De parser laat de opgeslagen extractie van 1 september volledig door");
const parse = parseFindings(EXTRACTIE_1_SEPTEMBER);
const bevindingen: Finding[] = parse.success ? parse.data : [];
check("parse slaagt", parse.success);
check("10 van de 10 bevindingen (was 3)", bevindingen.length === 10, String(bevindingen.length));
check("niets afgevallen, dus geen dropped", parse.success && !parse.dropped);
check("alle vijf de zoekterm-bleeders zijn er", bevindingen.filter((f) => f.entity_type === "searchterm").length === 5);
check("beide impressieaandeel-bevindingen zijn er", bevindingen.some((f) => f.metric === "search_budget_lost_is") && bevindingen.some((f) => f.metric === "search_rank_lost_is"));

console.log("\nWat wel afvalt, wordt gemeld met de reden");
{
  const kapot = JSON.parse(EXTRACTIE_1_SEPTEMBER) as Array<Record<string, unknown>>;
  kapot[2] = { ...kapot[2], severity: "enorm" };
  const r = parseFindings(JSON.stringify(kapot));
  check("de rest blijft", r.success && r.data.length === 9);
  check("dropped telt er een", r.success && r.dropped?.counts.findings === 1, JSON.stringify(r.success ? r.dropped : null));
  check("met welke bevinding en waarom", r.success && !!r.dropped?.reasons[0]?.includes("hydroponics diy home") && r.dropped.reasons[0].includes("severity"));
  const w = afgevallenWaarschuwing(r.success ? r.dropped ?? null : null, 9);
  check("de run krijgt een leesbare waarschuwing", !!w && w.startsWith("1 van de 10 bevindingen vielen af"), String(w));
  check("geen waarschuwing als niets afviel", afgevallenWaarschuwing(null, 10) === null);
}

console.log("\nHet doel staat niet meer in 'vorige waarde'");
{
  const cpa = bevindingen[0];
  check("het CPA-doel 45 is target_value", cpa.target_value === 45, JSON.stringify(cpa));
  check("en previous_value is leeg", cpa.previous_value === null);
  const tempo = bevindingen[1];
  check("het weektempo 57 is target_value", tempo.target_value === 57 && tempo.previous_value === null);
  const beschrijving = bevindingBeschrijving(cpa);
  check("de beschrijving zegt 'tegenover maanddoel', niet 'was'", beschrijving.includes("tegenover maanddoel 45") && !beschrijving.includes("(was"), beschrijving);
  check("de titel noemt de afstand tot het doel", bevindingTitel(cpa).includes("+110,8% t.o.v. maanddoel"), bevindingTitel(cpa));
  const zoekterm = bevindingen[2];
  check("zonder vorige waarde geen '(was null)'", !bevindingBeschrijving(zoekterm).includes("was null") && !bevindingBeschrijving(zoekterm).includes("(was"), bevindingBeschrijving(zoekterm));
  // Een echte vorige periode blijft een vorige waarde.
  const echt = normaliseerDoelVeld({ ...cpa, target_value: undefined, previous_value: 80, benchmark_type: "previous_month" });
  check("previous_month houdt zijn vorige waarde", echt.previous_value === 80 && echt.target_value === undefined);
  check("en wordt 'was' genoemd", bevindingBeschrijving(echt).includes("(was 80)"));
}

console.log("\nDe getallen worden tegen de brondata gelegd, niet tegen de modeltekst");
// Een geconstrueerde brondata in de vorm die de weekly-route het model geeft: weekrij, zoektermen,
// campagnemaanden, impressieaandeel (als fractie, zoals in de tabel) en het doel uit de doelen.
const weekrij = { week_start: "2026-08-24", impressions: 41000, clicks: 1672, cost: 2759.82, conversions: 29, cost_per_conversion: 94.84 };
const zoektermen = [
  { search_term: "hydroponics diy home", clicks: 54, cost: 160, conversions: 0 },
  { search_term: "gratis kas bouwen", clicks: 48, cost: 135, conversions: 0 },
  { search_term: "greentech festival tickets", clicks: 42, cost: 110, conversions: 0 },
  { search_term: "tuinbouw vacature", clicks: 36, cost: 85, conversions: 0 },
  { search_term: "greenhouse jobs", clicks: 30, cost: 60, conversions: 0 },
];
const campagnes = [
  { campaign_name: "GRT | Search | NL", month: "2026-08-01", cost: 1729.2, conversions: 10 },
  { campaign_name: "GRA | Search | US", month: "2026-08-01", cost: 1000, conversions: 12 },
  { campaign_name: "GreenTech | Display | Prospecting", month: "2026-08-01", cost: 800, conversions: 2 },
];
const impressieaandeel = [
  { campaign_name: "GRT | Search | NL", search_budget_lost_is: 0.28, search_rank_lost_is: 0.1, budget_utilization: 0.97 },
  { campaign_name: "GRA | Search | US", search_budget_lost_is: 0.04, search_rank_lost_is: 0.22 },
];
const doelen = "## Doelen\nCPA-doel: € 45\nMaanddoel: 229 conversies";
{
  const feiten = bouwBronFeiten([doelen, [weekrij], zoektermen, campagnes, impressieaandeel]);
  const t = toetsExtractie(bevindingen, [], [], feiten);
  check("het CPA-kerngetal 94,84 staat in de weekrij", t.bevindingen[0].kerngetalHerleidbaar === true, JSON.stringify(t.bevindingen[0]));
  check("de vijf zoektermbedragen staan in de zoektermtabel", t.bevindingen.slice(2, 7).every((b) => b.kerngetalHerleidbaar === true));
  check("28% budget lost IS staat er als fractie 0,28", t.bevindingen[7].kerngetalHerleidbaar === true, JSON.stringify(t.bevindingen[7]));
  check("de display-CPA 400 is door code afgeleid (800 / 2)", t.bevindingen[9].kerngetalHerleidbaar === true);
  check("+284,3% is de afstand van € 172,92 tot het doel van € 45", !t.bevindingen[7].nietHerleidbaar.some((x) => x.includes("284")), JSON.stringify(t.bevindingen[7].nietHerleidbaar));
  check("het weektempo 57 staat nergens in de brondata en wordt genoemd", t.bevindingen[1].nietHerleidbaar.some((x) => x.startsWith("doel 57")), JSON.stringify(t.bevindingen[1].nietHerleidbaar));
  check("een conversieratio van 2,0% klopt niet met 29 / 1672 = 1,73%", t.bevindingen[0].nietHerleidbaar.some((x) => x.includes("2,0%")), JSON.stringify(t.bevindingen[0].nietHerleidbaar));
}
{
  // Zonder de kolom cost_per_conversion rekent code 2759,82 / 29 = 95,17. De analyse schreef
  // 94,84: dat getal komt dan nergens vandaan, en de bevinding gaat gemarkeerd naar het scherm.
  const { cost_per_conversion: _weg, ...zonderKolom } = weekrij;
  void _weg;
  const feiten = bouwBronFeiten([doelen, [zonderKolom], zoektermen, campagnes, impressieaandeel]);
  const t = toetsExtractie(bevindingen, [], [], feiten);
  check("94,84 tegen 95,17: niet herleidbaar", t.bevindingen[0].kerngetalHerleidbaar === false);
  const titel = bevindingTitel(bevindingen[0], t.bevindingen[0]);
  check("de titel draagt de markering", titel.startsWith(NIET_HERLEIDBAAR_LABEL), titel);
  check("de beschrijving zegt welk getal", bevindingBeschrijving(bevindingen[0], t.bevindingen[0]).startsWith("Let op: het kerngetal 94,84"));
  check("de telling klopt", t.bevindingenNietHerleidbaar === 1);
}

console.log("\nAanbevelingen en taken: niet-herleidbare getallen worden gemarkeerd, de drempel niet");
{
  const feiten = bouwBronFeiten([doelen, [weekrij], zoektermen, campagnes]);
  const rec = {
    finding_index: 2, cluster_id: "c", thread_id: null, source: "hypothesis" as const,
    hypothesis: "Sluit 'hydroponics diy home' uit; dat bespaart € 160 per maand en daarna nog € 2.400",
    expected_result: "CPA onder € 40 binnen 4 weken",
    measurement_metric: "cpa", timeframe: "4 weken",
    rationale: "54 klikken en 0 conversies; 1650 euro aan verspilling",
    ice_impact: 7, ice_confidence: 7, ice_ease: 8, ice_total: 7.3,
  };
  const taak = {
    recommendation_index: 0, cluster_id: "c", thread_id: null,
    title: "Uitsluiten: hydroponics diy home", description: "Bespaart € 160; verhoog budget naar € 2.400",
    action_type: "negative_keyword", owner: "specialist", affected_campaign: null, affected_adgroup: null, affected_keyword: null,
    current_value: null, target_value: null, priority: "high", frequency: "direct", due_date_days: 7,
  } as unknown as Parameters<typeof toetsExtractie>[2][number];
  const t = toetsExtractie(bevindingen, [rec], [taak], feiten);
  check("€ 160 blijft staan", t.recommendations[0].hypothesis.includes("€ 160"));
  check("verzonnen € 2.400 wordt gemarkeerd", !t.recommendations[0].hypothesis.includes("2.400") && t.recommendations[0].hypothesis.includes("[bedrag niet uit data]"), t.recommendations[0].hypothesis);
  check("'1650 euro' zonder €-teken wordt ook gelezen en gemarkeerd", t.recommendations[0].rationale.includes("[bedrag niet uit data]"), t.recommendations[0].rationale);
  check("aantallen uit de bron blijven staan", t.recommendations[0].rationale.includes("54 klikken"));
  check("de drempel in expected_result blijft onaangeroerd", t.recommendations[0].expected_result === "CPA onder € 40 binnen 4 weken");
  check("ook in de taak", t.tasks[0].description.includes("[bedrag niet uit data]") && t.tasks[0].description.includes("€ 160"), t.tasks[0].description);
  check("en de telling", t.cijfersNietHerleidbaar === 3, String(t.cijfersNietHerleidbaar));
}

// ── Detectiekracht op een weekly van realistische omvang ──────────────────────
// De herstelronde: met een set voor alle bedragen en aantallen samen (1681 waarden) ging 86% van
// de verzonnen bedragen tussen 10 en 99 euro door, 59% van de ronde bedragen tussen 500 en 5.000,
// en "€ 54" was herleidbaar omdat er 54 klikken stonden. De grenzen hieronder leggen vast wat de
// gescheiden sets nu halen; ze zijn geen belofte dat kleine hele bedragen gevangen worden. Een
// heel bedrag onder de 100 heeft een resolutie van een euro, en tussen honderden CPA's, CPM's en
// zoektermkosten is er bijna altijd wel een in de buurt. Dat staat eerlijk in de kop van
// brondata-toets.ts.
console.log("\nDetectiekracht op een weekly van realistische omvang");
{
  let zaad = 7;
  const rnd = () => { zaad = (zaad * 1103515245 + 12345) % 2147483648; return zaad / 2147483648; };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const campagneRijen: Record<string, unknown>[] = [];
  for (let m = 0; m < 3; m++) for (let c = 0; c < 12; c++) {
    const impressions = Math.round(2000 + rnd() * 80000);
    const clicks = Math.round(impressions * (0.01 + rnd() * 0.06));
    const cost = r2(clicks * (0.5 + rnd() * 2.5));
    const conversions = Math.round(clicks * rnd() * 0.05);
    campagneRijen.push({ client_id: "x", month: `2026-0${7 + m}-01`, campaign_id: String(1e9 + c * 7919), campaign_name: `GRT | Search | C${c}`, impressions, clicks, cost, conversions, conversions_value: r2(conversions * 300 * rnd()), ctr: clicks / impressions, average_cpc: r2(cost / clicks), cost_per_conversion: conversions ? r2(cost / conversions) : null, search_impression_share: rnd(), search_budget_lost_is: rnd() * 0.4, search_rank_lost_is: rnd() * 0.4 });
  }
  const weekRijen: Record<string, unknown>[] = [];
  for (let w = 0; w < 2; w++) {
    const impressions = 60000 + Math.round(rnd() * 10000); const clicks = 1600 + Math.round(rnd() * 200); const cost = r2(clicks * 1.65); const conversions = 25 + Math.round(rnd() * 8);
    weekRijen.push({ week_start: `2026-08-${17 + 7 * w}`, impressions, clicks, cost, conversions, ctr: clicks / impressions, cost_per_conversion: r2(cost / conversions), conversions_value: r2(conversions * 250) });
  }
  const termRijen: Record<string, unknown>[] = [];
  for (let i = 0; i < 30; i++) { const clicks = Math.round(5 + rnd() * 80); termRijen.push({ search_term: `term ${i}`, week_start: "2026-08-01", clicks, impressions: Math.round(clicks * (10 + rnd() * 30)), cost: r2(clicks * (1 + rnd() * 2)), conversions: 0 }); }
  const doelTekst = "Doelen: CPA € 45, maanddoel 229 conversies, jaarbudget € 120.000, maandbudget € 10.000. Benodigd weektempo 57.";
  const feiten = bouwBronFeiten([doelTekst, weekRijen, termRijen, campagneRijen, campagneRijen]);
  const nl = (n: number, d = 0) => n.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
  const aandeelDoor = (maak: () => string, N = 1000) => {
    let door = 0;
    for (let i = 0; i < N; i++) { const c = toetsTekst(maak(), feiten); if (c.length > 0 && c.every((x) => x.herleidbaar)) door++; }
    return door / N;
  };
  const meting: Array<[string, () => string, number]> = [
    ["verzonnen € 10-99", () => `bespaar € ${nl(10 + Math.floor(rnd() * 90))}`, 0.75],
    ["verzonnen € 100-999", () => `bespaar € ${nl(100 + Math.floor(rnd() * 900))}`, 0.15],
    ["verzonnen € 1.000-9.999", () => `verhoog budget naar € ${nl(1000 + Math.floor(rnd() * 9000))}`, 0.05],
    ["verzonnen ronde bedragen € 500-5.000 (het budgetadvies)", () => `verhoog budget naar € ${nl(100 * (5 + Math.floor(rnd() * 45)))}`, 0.45],
    ["verzonnen € xx,xx", () => `CPA wordt € ${nl(10 + rnd() * 90, 2)}`, 0.05],
    ["verzonnen 10-99 conversies", () => `${10 + Math.floor(rnd() * 90)} conversies`, 0.6],
    ["verzonnen ROAS x,x", () => `ROAS van ${nl(1 + rnd() * 8, 1)}`, 0.35],
  ];
  for (const [naam, maak, grens] of meting) {
    const a = aandeelDoor(maak);
    check(`${naam}: hooguit ${Math.round(grens * 100)}% gaat door (gemeten ${(a * 100).toFixed(1)}%)`, a <= grens, `${(a * 100).toFixed(1)}%`);
  }
  // Het tegenvoorbeeld zelf: een bedrag dat alleen als telling in de bron staat.
  const alleenKlikken = bouwBronFeiten([[{ search_term: "x", clicks: 54, cost: 160, conversions: 0 }, { search_term: "y", clicks: 48, cost: 135, conversions: 0 }]]);
  check("'€ 54' is niet herleidbaar op 54 klikken", toetsTekst("bespaar € 54", alleenKlikken).every((c) => !c.herleidbaar));
  check("'54 klikken' wel", toetsTekst("54 klikken", alleenKlikken).every((c) => c.herleidbaar));
  check("campagne-id's tellen niet als feit", !toetsTekst("bespaar 1000007919 klikken", feiten).every((c) => c.herleidbaar));
  // En wat wel klopt, blijft herleidbaar: elk echt kostenbedrag, elke CPA, elke klikcount.
  const echteCitaten = [
    ...campagneRijen.map((r) => `de kosten waren € ${nl(r.cost as number, 2)}`),
    ...campagneRijen.filter((r) => r.cost_per_conversion != null).map((r) => `een CPA van € ${nl(r.cost_per_conversion as number, 2)}`),
    ...termRijen.map((r) => `${r.clicks} klikken en € ${nl(r.cost as number, 2)}`),
    ...weekRijen.map((r) => `${r.conversions} conversies bij € ${nl(r.cost as number)}`),
    "CPA 45", "€ 120.000 per jaar",
  ];
  const vals = echteCitaten.filter((t) => !toetsTekst(t, feiten).every((c) => c.herleidbaar));
  check("elk echt citaat uit de brondata blijft herleidbaar", vals.length === 0, JSON.stringify(vals.slice(0, 3)));
}

console.log("\nEen run telt alleen als gedraaid als zijn bevindingen er staan");
{
  const basis = { findingsParseOk: true, findings: [1, 2], saved: true, saveError: null, waarschuwingen: [] as string[] };
  check("geslaagd", !extractieUitkomst(basis, "Gereed.").mislukt && extractieUitkomst(basis, "Gereed.").melding === "Gereed.");
  check("onleesbare bevindingen: mislukt", extractieUitkomst({ ...basis, findingsParseOk: false }, "Gereed.").mislukt);
  check("niet opgeslagen: mislukt, met de reden", (() => {
    const u = extractieUitkomst({ ...basis, saved: false, saveError: "insert geweigerd" }, "Gereed.");
    return u.mislukt && u.melding.includes("insert geweigerd");
  })());
  check("nul bevindingen bij leesbare uitvoer is een rustige week, geen fout", !extractieUitkomst({ ...basis, findings: [], saved: false }, "Gereed.").mislukt);
  check("waarschuwingen staan in de melding zelf", extractieUitkomst({ ...basis, waarschuwingen: ["7 van de 10 vielen af."] }, "Gereed.").melding.includes("7 van de 10"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

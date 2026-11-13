// De lerende lus: meten op het juiste kanaal, niet oordelen op een stilgevallen sync, een
// ruisband in plaats van "elke beweging telt", een volumeguardrail, meetbaarheid bij het
// wegschrijven, en wie er besliste.
// Draaien: node_modules/.bin/tsx lib/learning/__redeneerketen_evaluator_test.ts
//
// De gevallen komen uit de doorlichting van 13 november (sectie 2).

import { evaluateHypothesisRow, ruisbandVoor, MIN_BASELINE_WEKEN, type HypothesisRow } from "./evaluate-hypothesis-row";
import { kanaalVoorBron, weekRijenUitDagen, maandagVan } from "./kanaal-weekdata";
import { beoordeelMeetbaarheid, meetbaarheidTekst, extractThreshold } from "./hypothesis-parser";
import { stempelBeslissing, beslisserVan } from "./beslis-stempel";
import { DEFAULT_CHANNEL_CONVERSION_CONFIG } from "@/lib/analysis/channel-conversion-config";
import type { WeeklyRow } from "./weekly-metrics";
import type { ChangeEvent } from "./hypothesis-evaluator";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function rij(over: Partial<HypothesisRow> = {}): HypothesisRow {
  return {
    id: "h1", client_id: "c1",
    hypothesis: "Pauzeer Blog Traffic",
    expected_result: "CPA daalt",
    measurement_metric: "cpa",
    timeframe: "4 weken",
    accepted_at: "2026-06-15T00:00:00Z",
    source: "weekly",
    ...over,
  };
}

/** Weken vanaf een maandag met per week een eigen waarde. */
function weken(vanaf: string, rijen: Array<Partial<WeeklyRow>>): WeeklyRow[] {
  const start = new Date(`${vanaf}T00:00:00Z`);
  return rijen.map((r, i) => ({
    week_start: new Date(start.getTime() + i * 7 * 86_400_000).toISOString().slice(0, 10),
    impressions: 100_000, clicks: 2000, cost: 2500, conversions: 100, conversions_value: 8000,
    ...r,
  }));
}

const NU = new Date("2026-09-01T00:00:00Z");

console.log("Het kanaal volgt uit de bron van het voorstel");
check("weekly is Google", kanaalVoorBron("weekly") === "google_ads");
check("analysis (de maandpijplijn) is Google", kanaalVoorBron("analysis") === "google_ads");
check("meta_biweekly is Meta", kanaalVoorBron("meta_biweekly") === "meta_ads");
check("linkedin_biweekly is LinkedIn", kanaalVoorBron("linkedin_biweekly") === "linkedin_ads");
check("microsoft_weekly is Microsoft", kanaalVoorBron("microsoft_weekly") === "microsoft_ads");
check("cross_channel is geen enkel kanaal", kanaalVoorBron("cross_channel") === null);

console.log("\nDagrijen van een niet-Google-kanaal worden weekrijen, met de conversieselectie");
{
  const dagen = [
    { date: "2026-06-01", impressions: 1000, link_clicks: 50, spend: 100, conversions: 2, leads: 1, conversion_value: 0 },
    { date: "2026-06-03", impressions: 1000, link_clicks: 50, spend: 100, conversions: 2, leads: 1, conversion_value: 0 },
    { date: "2026-06-08", impressions: 500, link_clicks: 20, spend: 40, conversions: 1, leads: 0, conversion_value: 0 },
  ];
  const w = weekRijenUitDagen(dagen, "meta_ads", DEFAULT_CHANNEL_CONVERSION_CONFIG);
  check("twee weken", w.length === 2, JSON.stringify(w));
  check("week_start is de maandag", w[0].week_start === "2026-06-01" && maandagVan("2026-06-03") === "2026-06-01");
  check("klikken uit link_clicks, kosten uit spend", w[0].clicks === 100 && w[0].cost === 200);
}

console.log("\nEen Meta-voorstel wordt op Meta gemeten, niet op Google");
{
  // Tegenvoorbeeld: "Blog Traffic pauzeren, blended CPA richting 45 euro" (meta_biweekly) kreeg
  // "cpa ging van 95.76 naar 103.71; verdict rejected": twee Google-cijfers.
  const meta = weken("2026-05-04", Array.from({ length: 12 }, (_, i) => ({ cost: 900, conversions: i < 6 ? 20 : 30 })));
  const googlePauze: ChangeEvent[] = [{ date: "2026-06-20", type: "status_paused", entity: "Iets in Google", detail: "" }];
  const r = evaluateHypothesisRow({
    row: rij({ source: "meta_biweekly", hypothesis: "Pauzeer Blog Traffic", expected_result: "blended CPA daalt met 20%" }),
    weekly: meta, changeEvents: googlePauze, now: NU,
  });
  check("het oordeel noemt Meta", r.soort === "oordeel" && r.uitkomst.reason.includes("Gemeten op de cijfers van Meta"), JSON.stringify(r));
  check("CPA van 45 naar 30 haalt -20%", r.soort === "oordeel" && r.uitkomst.resultMet === true);
  check("een Google-pauze telt niet als uitvoering van een Meta-voorstel",
    r.soort === "oordeel" && r.uitkomst.verdict === "accepted" && r.uitkomst.reason.includes("geen wijzigingshistorie van Meta"), r.soort === "oordeel" ? r.uitkomst.verdict : "");
}
{
  const r = evaluateHypothesisRow({ row: rij({ source: "cross_channel" }), weekly: [], changeEvents: [], now: NU });
  check("een voorstel over meerdere kanalen is onmeetbaar, met de reden", r.soort === "oordeel" && r.uitkomst.verdict === "unmeasurable" && r.uitkomst.reason.includes("meer dan een kanaal"));
}

console.log("\nEen stilgevallen sync is geen uitkomst");
{
  // Tegenvoorbeeld: gads-4140363870, aanvaard 8 april, weekdata tot 6 april. Werd "expired" met
  // "cpa ging van 74.20 naar onbekend erna", definitief, en nooit meer herzien.
  const totApril = weken("2026-02-09", Array.from({ length: 9 }, () => ({})));
  const r = evaluateHypothesisRow({
    row: rij({ accepted_at: "2026-04-08T00:00:00Z", expected_result: "CPA daalt met 10%" }),
    weekly: totApril, changeEvents: [], now: new Date("2026-11-13T00:00:00Z"),
  });
  check("geen oordeel maar 'geen data'", r.soort === "geen_data", JSON.stringify(r));
  check("met tot wanneer de data loopt", r.soort === "geen_data" && r.reden.includes("niet te beoordelen, geen data") && r.reden.includes("2026-04-06"), r.soort === "geen_data" ? r.reden : "");
  const leeg = evaluateHypothesisRow({ row: rij({ expected_result: "CPA daalt met 10%" }), weekly: [], changeEvents: [], now: NU });
  check("zonder enige weekdata ook 'geen data'", leeg.soort === "geen_data");
}

console.log("\nZonder drempel telt alleen een beweging buiten de ruis");
{
  // Een baseline die per week tussen 23 en 27 euro CPA schommelt.
  const cpaReeks = [23, 27, 24, 26, 25, 23, 27, 25];
  const voor = cpaReeks.map((c) => ({ cost: c * 100, conversions: 100 }));
  const ruis = ruisbandVoor("cpa", weken("2026-04-20", voor), 4);
  check("de ruisband is positief bij een schommelende baseline", ruis != null && ruis > 0, String(ruis));
  check(`uit minder dan ${MIN_BASELINE_WEKEN} weken geen spreiding`, ruisbandVoor("cpa", weken("2026-05-18", voor.slice(4)), 4) === null);
  // Tegenvoorbeeld: CPA van 25,00 naar 24,99 gold als "gehaald".
  const amperDaling = weken("2026-04-20", [...voor, ...Array.from({ length: 4 }, () => ({ cost: 2499, conversions: 100 }))]);
  const r = evaluateHypothesisRow({ row: rij({ hypothesis: "Iets met de strategie" }), weekly: amperDaling, changeEvents: [], now: NU });
  check("25 naar 24,99 is niet gehaald", r.soort === "oordeel" && r.uitkomst.resultMet === false, JSON.stringify(r));
  check("en de reden noemt de ruisband", r.soort === "oordeel" && r.uitkomst.reason.includes("ruisband"));
  const echteDaling = weken("2026-04-20", [...voor, ...Array.from({ length: 4 }, () => ({ cost: 1800, conversions: 100 }))]);
  const r2 = evaluateHypothesisRow({ row: rij({ hypothesis: "Iets met de strategie" }), weekly: echteDaling, changeEvents: [], now: NU });
  check("25 naar 18 is wel gehaald", r2.soort === "oordeel" && r2.uitkomst.resultMet === true, JSON.stringify(r2));
  const kort = weken("2026-06-01", Array.from({ length: 6 }, () => ({})));
  const r3 = evaluateHypothesisRow({ row: rij({ timeframe: "2 weken" }), weekly: kort, changeEvents: [], now: NU });
  check("met te weinig weken voor acceptatie geen gok", r3.soort === "oordeel" && r3.uitkomst.verdict === "unmeasurable" && r3.uitkomst.reason.includes("ruis"), JSON.stringify(r3));
}

console.log("\nMinstens een guardrail op volume");
{
  // Kosten halveren is "gehaald", maar niet als de conversies ook halveren.
  const voor = Array.from({ length: 6 }, () => ({ cost: 2500, conversions: 100 }));
  const na = Array.from({ length: 4 }, () => ({ cost: 1250, conversions: 50 }));
  const r = evaluateHypothesisRow({
    row: rij({ hypothesis: "Iets met de strategie", expected_result: "kosten dalen met 30%", measurement_metric: "kosten" }),
    weekly: weken("2026-05-04", [...voor, ...na]), changeEvents: [], now: NU,
  });
  check("de succesmetriek is gehaald, de guardrail niet: verworpen", r.soort === "oordeel" && r.uitkomst.verdict === "rejected", JSON.stringify(r));
  check("de reden zegt welke guardrail", r.soort === "oordeel" && r.uitkomst.reason.includes("Guardrail geschonden: conversions"));
}

console.log("\nMeetbaarheid bij het wegschrijven");
{
  const ok = beoordeelMeetbaarheid({ expectedResult: "CPA daalt met 15%", measurementMetric: "cpa", timeframe: "4 weken" });
  check("metriek, richting, drempel en venster", ok.meetbaar && ok.metric === "cpa" && ok.richting === "decrease" && ok.relatieveDrempel === 0.15 && ok.vensterDagen === 28);
  const ruis = beoordeelMeetbaarheid({ expectedResult: "CPA daalt", measurementMetric: "cpa", timeframe: "2 weken" });
  check("zonder drempel meetbaar tegen de ruisband", ruis.meetbaar && ruis.ruisband);
  check("en dat staat er", meetbaarheidTekst(ruis).includes("ruisband"));
  // Zonder venster meet de evaluator over de standaard van 28 dagen en geeft hij een oordeel; de
  // meetbaarheid zegt dan hetzelfde, en zegt erbij dat het de standaard is.
  const geenVenster = beoordeelMeetbaarheid({ expectedResult: "CPA daalt met 15%", measurementMetric: "cpa", timeframe: "Q4" });
  check("zonder venster: de standaard van 28 dagen", geenVenster.meetbaar && geenVenster.vensterDagen === 28 && geenVenster.vensterStandaard);
  check("en dat staat erbij", meetbaarheidTekst(geenVenster).includes("geen venster genoemd"), meetbaarheidTekst(geenVenster));
  const kanalen = beoordeelMeetbaarheid({ expectedResult: "CPA daalt met 15%", measurementMetric: "cpa", timeframe: "4 weken", bron: "cross_channel" });
  check("een voorstel over meer kanalen: niet meetbaar, zoals de evaluator zegt", !kanalen.meetbaar);
  // Tegenvoorbeeld uit de echte data: de letterlijke waarde "recommendation-1" als meetmetriek.
  const rare = beoordeelMeetbaarheid({ expectedResult: "beter resultaat", measurementMetric: "recommendation-1", timeframe: "4 weken" });
  check("'recommendation-1' als metriek: niet meetbaar", !rare.meetbaar);
  check("de tekst begint met 'Niet meetbaar:'", meetbaarheidTekst(rare).startsWith("Niet meetbaar:"));
  const leeg = beoordeelMeetbaarheid({ expectedResult: "", measurementMetric: "cpa", timeframe: "4 weken" });
  check("zonder verwacht resultaat niet meetbaar", !leeg.meetbaar);
  const is = beoordeelMeetbaarheid({ expectedResult: "impressieaandeel stijgt met 10%", measurementMetric: "impression share", timeframe: "4 weken" });
  check("impressieaandeel zit niet in de weekdata: niet meetbaar", !is.meetbaar && is.reden.includes("impression_share"));
  check("een grens van € 1.650 is 1650, niet 1,65", extractThreshold("CPA onder € 1.650", "below") === 1650);
}

// ── Ruis zonder effect ───────────────────────────────────────────────────────
// Tegenvoorbeeld uit de herstelronde: de band rekende voor conversies en klikken (SOMMEN over het
// venster) met de formule voor gemiddelden, vier keer te smal bij vier weken. Op pure ruis haalde
// "conversies stijgen" 34%, "klikken stijgen" 34% en "CPA daalt" 12%. Een eenzijdige toets tegen
// een 95%-band hoort rond 2,5% te zitten; met een geschatte spreiding iets meer. Grens: 5%.
let zaad = 11;
const willekeurig = () => { zaad = (zaad * 1103515245 + 12345) % 2147483648; return zaad / 2147483648; };
const normaal = () => Math.sqrt(-2 * Math.log(willekeurig() + 1e-12)) * Math.cos(2 * Math.PI * willekeurig());
function ruisReeks(weken: number): WeeklyRow[] {
  const start = new Date("2026-02-02T00:00:00Z");
  return Array.from({ length: weken }, (_, i) => {
    const clicks = Math.round(2000 + 150 * normaal());
    const conversions = Math.max(1, Math.round(30 + 5 * normaal()));
    return { week_start: new Date(start.getTime() + i * 7 * 86_400_000).toISOString().slice(0, 10), impressions: 100_000, clicks, cost: Math.round(clicks * 1.25), conversions, conversions_value: conversions * 80 };
  });
}
function gehaaldOpRuis(metric: string, verwacht: string, venster: string, N = 1500): { gehaald: number; oordelen: number } {
  let gehaald = 0, oordelen = 0;
  for (let k = 0; k < N; k++) {
    const r = evaluateHypothesisRow({
      row: rij({ hypothesis: "Iets met de strategie", expected_result: verwacht, measurement_metric: metric, timeframe: venster, accepted_at: "2026-06-01T00:00:00Z" }),
      weekly: ruisReeks(22), changeEvents: [], now: NU,
    });
    if (r.soort === "oordeel" && r.uitkomst.verdict !== "unmeasurable") oordelen++;
    if (r.soort === "oordeel" && r.uitkomst.resultMet === true) gehaald++;
  }
  return { gehaald: gehaald / N, oordelen: oordelen / N };
}
console.log("\nOp pure ruis zonder effect is een voorstel zelden 'gehaald'");
for (const [metric, verwacht, venster] of [
  ["conversions", "conversies stijgen", "4 weken"],
  ["clicks", "klikken stijgen", "4 weken"],
  ["cpa", "CPA daalt", "4 weken"],
  ["conversions", "conversies stijgen", "1 week"],
  ["cpa", "CPA daalt", "14 dagen"],
] as const) {
  const { gehaald, oordelen } = gehaaldOpRuis(metric, verwacht, venster);
  check(`'${verwacht}' over ${venster}: hooguit 5% gehaald`, gehaald <= 0.05, `${(gehaald * 100).toFixed(1)}%`);
  check(`'${verwacht}' over ${venster}: wel een oordeel`, oordelen > 0.95, `${(oordelen * 100).toFixed(1)}%`);
}

// ── Wat bij het wegschrijven meetbaar heet, krijgt later een oordeel ─────────
// Tegenvoorbeeld: van de 73 als meetbaar vastgelegde voorstellen werden er 35 op een schone reeks
// van 40 weken "unmeasurable" met "minder dan 3 baselineweken": alle voorstellen zonder drempel
// met een venster van 7 of 14 dagen. De spreiding komt nu uit de weken voor acceptatie, los van
// het venster, en de standaard bij een ontbrekend venster is voor beide dezelfde.
console.log("\nMeetbaar bij het wegschrijven is meetbaar in de evaluator");
{
  const voorstellen = [
    { expectedResult: "CPA daalt", measurementMetric: "cpa", timeframe: "14 dagen" },
    { expectedResult: "conversies stijgen", measurementMetric: "conversies", timeframe: "2 weken" },
    { expectedResult: "CTR stijgt", measurementMetric: "ctr", timeframe: "7 dagen" },
    { expectedResult: "ROAS stijgt", measurementMetric: "roas", timeframe: "1 week" },
    { expectedResult: "klikken stijgen", measurementMetric: "klikken", timeframe: null },
    { expectedResult: "CPA daalt met 15%", measurementMetric: "cpa", timeframe: "4 weken" },
    { expectedResult: "kosten dalen", measurementMetric: "kosten", timeframe: "3 maanden" },
    { expectedResult: "CPA onder € 40", measurementMetric: "cpa", timeframe: "30 dagen" },
    { expectedResult: "conversieratio stijgt met 10%", measurementMetric: "conversion rate", timeframe: "6 weken" },
  ];
  const schoon = ruisReeks(40).map((w) => ({ ...w, week_start: new Date(new Date(w.week_start).getTime() - 10 * 7 * 86_400_000).toISOString().slice(0, 10) }));
  let meetbaar = 0;
  for (const v of voorstellen) {
    const m = beoordeelMeetbaarheid({ ...v, bron: "weekly" });
    if (!m.meetbaar) { check(`'${v.expectedResult}' (${v.timeframe}) is meetbaar`, false, m.reden); continue; }
    meetbaar++;
    const r = evaluateHypothesisRow({
      row: rij({ hypothesis: "Iets met de strategie", expected_result: v.expectedResult, measurement_metric: v.measurementMetric, timeframe: v.timeframe, accepted_at: "2026-05-04T00:00:00Z" }),
      weekly: schoon, changeEvents: [], now: new Date("2026-11-13T00:00:00Z"),
    });
    check(`'${v.expectedResult}' (${v.timeframe ?? "geen venster"}): de evaluator geeft een oordeel`,
      r.soort === "oordeel" && r.uitkomst.verdict !== "unmeasurable", JSON.stringify(r).slice(0, 240));
  }
  check("alle voorstellen in deze set heten meetbaar", meetbaar === voorstellen.length);
}

console.log("\nWie besliste en wanneer, volgens de server");
{
  const nu = new Date("2026-11-13T10:00:00Z");
  const v = stempelBeslissing({
    table: "sprint_hypotheses",
    values: { status: "accepted", accepted_at: "2020-01-01T00:00:00Z", decided_at: "2020-01-01T00:00:00Z", decided_by: "iemand anders" },
    beslisser: "specialist@bureau.nl", nu,
  });
  check("decided_by uit de sessie", v?.decided_by === "specialist@bureau.nl");
  check("decided_at en accepted_at van de server", v?.decided_at === nu.toISOString() && v?.accepted_at === nu.toISOString());
  const zonder = stempelBeslissing({ table: "sprint_hypotheses", values: { status: "rejected", decided_by: "verzonnen" }, beslisser: null, nu });
  check("zonder sessie geen beslisser uit de browser", zonder !== undefined && !("decided_by" in zonder));
  check("een afwijzing zet geen accepted_at", zonder !== undefined && !("accepted_at" in zonder));
  const geenBeslissing = { hypothesis: "nieuwe tekst" };
  check("een gewone wijziging blijft ongemoeid", stempelBeslissing({ table: "sprint_hypotheses", values: geenBeslissing, beslisser: "x", nu }) === geenBeslissing);
  check("andere tabellen blijven ongemoeid", stempelBeslissing({ table: "sop_tasks", values: { status: "accepted" }, beslisser: "x", nu })?.decided_by === undefined);
  // Herstelronde: afronden overschreef de beslistijd, een tweede "accepted" het startpunt.
  const afronden = stempelBeslissing({ table: "sprint_hypotheses", values: { status: "completed", decided_at: "2020-01-01T00:00:00Z" }, beslisser: "x@y.nl", nu, huidig: { status: "accepted", accepted_at: "2026-06-01T00:00:00Z" } });
  check("afronden laat decided_at en decided_by staan", afronden !== undefined && !("decided_at" in afronden) && !("decided_by" in afronden), JSON.stringify(afronden));
  check("afronden zet geen accepted_at", afronden !== undefined && !("accepted_at" in afronden));
  const nogmaals = stempelBeslissing({ table: "sprint_hypotheses", values: { status: "accepted", accepted_at: "2026-11-13T09:00:00Z" }, beslisser: "x@y.nl", nu, huidig: { status: "accepted", accepted_at: "2026-06-01T00:00:00Z" } });
  check("een tweede 'accepted' verschuift het startpunt niet", nogmaals !== undefined && !("accepted_at" in nogmaals) && !("decided_at" in nogmaals), JSON.stringify(nogmaals));
  const eerste = stempelBeslissing({ table: "sprint_hypotheses", values: { status: "accepted" }, beslisser: "x@y.nl", nu, huidig: { status: "pending", accepted_at: null } });
  check("de overgang van pending naar accepted zet beide tijden en de beslisser", eerste?.accepted_at === nu.toISOString() && eerste?.decided_at === nu.toISOString() && eerste?.decided_by === "x@y.nl");
  const afwijzen = stempelBeslissing({ table: "sprint_hypotheses", values: { status: "rejected", accepted_at: "2026-11-13T09:00:00Z" }, beslisser: null, nu, huidig: { status: "accepted", accepted_at: "2026-06-01T00:00:00Z" } });
  check("afwijzen na aanvaarding: nieuwe beslistijd, accepted_at blijft van de rij", afwijzen?.decided_at === nu.toISOString() && afwijzen !== undefined && !("accepted_at" in afwijzen));
  const nieuw = stempelBeslissing({ table: "sprint_hypotheses", values: { status: "accepted", hypothesis: "handmatig" }, beslisser: "x@y.nl", nu, huidig: null });
  check("een nieuwe rij die direct accepted is krijgt een startpunt", nieuw?.accepted_at === nu.toISOString());
  check("de beslisser is het e-mailadres, anders het id", beslisserVan({ id: "u1", email: "a@b.nl" }) === "a@b.nl" && beslisserVan({ id: "u1", email: null }) === "u1" && beslisserVan(null) === null);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

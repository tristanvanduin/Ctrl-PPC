// De bedrading van de hypothese-evaluator: van één sprint_hypotheses-rij naar één oordeel.
// Draaien: npx tsx lib/learning/__evaluate_hypothesis_row_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// De pure rekenkern (evaluateHypothesisOutcome) was al getest. Wat níét getest was, is de keten
// eromheen: hypothesetekst ontleden, het meetvenster bepalen, de baseline reconstrueren uit de
// weken vóór accepted_at, de relatieve drempel omzetten met die baseline, en er de
// uitvoeringsdetectie overheen leggen. Die keten stond inline in de cron-route, verweven met auth
// en supabase, en droeg daarom LIVE-ONGETEST in zijn kop.
//
// Dat is de stap die de lerende lus sluit -- de enige plek waar het systeem terugkijkt of een
// belofte is uitgekomen. Er zijn geen live klanten, dus zonder deze test is er geen enkele manier
// om te weten of hij werkt vóórdat hij voor het eerst op echte data draait.
//
// Twee soorten invoer, met opzet:
//  - DEMO-WEEKDATA (26 echte weken) bewijst dat de keten op realistisch gevormde data draait.
//  - GECONSTRUEERDE WEKEN bewijzen dat hij het JUISTE antwoord geeft, want daar ken ik de uitkomst.

import { evaluateHypothesisRow, type HypothesisRow } from "./evaluate-hypothesis-row";
import type { WeeklyRow } from "./weekly-metrics";
import type { ChangeEvent } from "./hypothesis-evaluator";
import { demoRows } from "@/lib/demo/demo-rows";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const NU = new Date("2026-08-24T00:00:00Z");

function rij(over: Partial<HypothesisRow> = {}): HypothesisRow {
  return {
    id: "h1",
    client_id: "c1",
    hypothesis: "Verhoog het dagbudget van de merkcampagne",
    expected_result: "conversies stijgen met 20%",
    measurement_metric: "conversions",
    timeframe: "4 weken",
    accepted_at: "2026-06-15T00:00:00Z",
    ...over,
  };
}

/** Weken bouwen met een vaste waarde vóór en ná een omslagpunt, zodat de uitkomst bekend is. */
function weken(opts: { vanaf: string; aantal: number; omslagIndex: number; voor: Partial<WeeklyRow>; na: Partial<WeeklyRow> }): WeeklyRow[] {
  const start = new Date(`${opts.vanaf}T00:00:00Z`);
  return Array.from({ length: opts.aantal }, (_, i) => {
    const d = new Date(start.getTime() + i * 7 * 86_400_000);
    const basis = i < opts.omslagIndex ? opts.voor : opts.na;
    return {
      week_start: d.toISOString().slice(0, 10),
      impressions: 100_000, clicks: 2000, cost: 4000, conversions: 60, conversions_value: 8000,
      ...basis,
    } as WeeklyRow;
  });
}

const GEEN_EVENTS: ChangeEvent[] = [];
// Een wijziging van het type dat de hypothesetekst noemt ("dagbudget"), binnen het meetvenster.
// Nodig zodra je het METRIEK-oordeel wil zien: zonder zo'n event slaat de uitvoeringsdetectie het
// verdict terecht om naar "niet_uitgevoerd", want een beweging die niet aan een interventie is toe
// te schrijven zegt niets over die interventie. Die volgorde is geen detail maar de kern van de
// evaluator, en de eerste versie van deze test had hem verkeerd om.
// Geen cast: de echte vorm invullen, zodat een veld dat de evaluator nodig heeft niet stilzwijgend
// kan ontbreken. De eerste versie gebruikte `as ChangeEvent` en miste `entity` -- de testrunner
// liet dat door, tsc niet.
const BUDGET_EVENT: ChangeEvent[] = [
  { date: "2026-06-20", type: "budget", entity: "Merk", detail: "dagbudget verhoogd" },
];

console.log("De vier manieren waarop er geen oordeel komt, blijven uit elkaar");
{
  // 1. Niet toetsbaar geformuleerd.
  const r = evaluateHypothesisRow({ row: rij({ expected_result: "" }), weekly: [], changeEvents: GEEN_EVENTS, now: NU });
  check("zonder verwacht resultaat: unmeasurable", r.soort === "oordeel" && r.uitkomst.verdict === "unmeasurable");
  check("en met een leesbare reden", r.soort === "oordeel" && r.uitkomst.reason.includes("niet toetsbaar geformuleerd"));
  // Cruciaal: geen gegokt oordeel. resultMet moet null zijn, niet false.
  check("geen gegokt resultMet", r.soort === "oordeel" && r.uitkomst.resultMet === null);
}
{
  // 2. Het venster loopt nog -- dit mag GEEN oordeel opleveren, want dan zou een te vroege
  //    evaluatie definitief worden weggeschreven en de hypothese nooit meer opnieuw bekeken.
  const r = evaluateHypothesisRow({
    row: rij({ accepted_at: "2026-08-20T00:00:00Z" }), weekly: [], changeEvents: GEEN_EVENTS, now: NU,
  });
  check("lopend venster wordt overgeslagen, niet beoordeeld", r.soort === "overgeslagen", JSON.stringify(r));
  check("met de einddatum erbij", r.soort === "overgeslagen" && r.reden.includes("2026-09-17"), r.soort === "overgeslagen" ? r.reden : "");
}
{
  // 3. Metric bestaat wel als belofte, maar niet in accountweekdata.
  const r = evaluateHypothesisRow({
    row: rij({ measurement_metric: "hook rate", expected_result: "hook rate stijgt met 20%" }),
    weekly: [], changeEvents: GEEN_EVENTS, now: NU,
  });
  check("niet-afleidbare metric: unmeasurable", r.soort === "oordeel" && r.uitkomst.verdict === "unmeasurable", JSON.stringify(r));
}
{
  // 4. Wel gemeten, maar te weinig volume om iets te concluderen.
  const stil = weken({ vanaf: "2026-05-04", aantal: 12, omslagIndex: 6, voor: { impressions: 10, cost: 1 }, na: { impressions: 10, cost: 1 } });
  const r = evaluateHypothesisRow({ row: rij(), weekly: stil, changeEvents: GEEN_EVENTS, now: NU });
  check("te weinig volume geeft geen hard oordeel",
    r.soort === "oordeel" && (r.uitkomst.verdict === "unmeasurable" || r.uitkomst.verdict === "expired"), JSON.stringify(r));
}

console.log("\nDe baseline komt uit de weken VOOR acceptatie, de meting uit de weken erna");
{
  // 60 conversies per week vóór, 90 erna: +50%, dus een belofte van +20% is gehaald.
  const gestegen = weken({
    vanaf: "2026-05-04", aantal: 14, omslagIndex: 6,
    voor: { conversions: 60 }, na: { conversions: 90 },
  });
  const r = evaluateHypothesisRow({ row: rij(), weekly: gestegen, changeEvents: BUDGET_EVENT, now: NU });
  check("gehaald en uitgevoerd geeft een positief oordeel",
    r.soort === "oordeel" && r.uitkomst.resultMet === true && r.uitkomst.verdict === "uitgevoerd_en_gehaald", JSON.stringify(r));
  // De reden moet BEIDE getallen noemen: zonder de baseline is het oordeel niet na te rekenen.
  check("de reden noemt beide vensters", r.soort === "oordeel" && /ging van .* naar /.test(r.uitkomst.reason), r.soort === "oordeel" ? r.uitkomst.reason : "");
  check("en waarschuwt voor het accountniveau", r.soort === "oordeel" && r.uitkomst.reason.includes("accountniveau"));
}
{
  // Vlak blijven is niet +20% halen.
  const vlak = weken({ vanaf: "2026-05-04", aantal: 14, omslagIndex: 6, voor: { conversions: 60 }, na: { conversions: 60 } });
  const r = evaluateHypothesisRow({ row: rij(), weekly: vlak, changeEvents: BUDGET_EVENT, now: NU });
  check("niet gehaald geeft een negatief oordeel", r.soort === "oordeel" && r.uitkomst.resultMet === false, JSON.stringify(r));
}
{
  // De relatieve drempel moet met de ECHTE baseline worden omgezet. Zou 20% als absolute
  // magnitude gelden (0,20), dan zou vrijwel elke stijging slagen -- precies de fout die
  // resolvePredicate voorkomt. Een stijging van 60 naar 66 is +10%: te weinig voor +20%.
  const beetje = weken({ vanaf: "2026-05-04", aantal: 14, omslagIndex: 6, voor: { conversions: 60 }, na: { conversions: 66 } });
  const r = evaluateHypothesisRow({ row: rij(), weekly: beetje, changeEvents: BUDGET_EVENT, now: NU });
  check("+10% haalt een belofte van +20% niet", r.soort === "oordeel" && r.uitkomst.resultMet === false, JSON.stringify(r));
  // Het bewijs dat resolvePredicate de relatieve eis met de ECHTE baseline omzet: 20% van 240 = 48.
  // Zou 20% als absolute magnitude gelden (0,20), dan zou +24 ruimschoots slagen.
  check("de drempel is met de baseline omgezet, niet absoluut genomen",
    r.soort === "oordeel" && JSON.stringify(r.uitkomst.metrics).includes("minimaal 48"),
    JSON.stringify(r.soort === "oordeel" ? r.uitkomst.metrics : null));
}

console.log("\nUitvoeringsdetectie kan een oordeel omdraaien");
{
  const vlak = weken({ vanaf: "2026-05-04", aantal: 14, omslagIndex: 6, voor: { conversions: 60 }, na: { conversions: 60 } });
  const zonder = evaluateHypothesisRow({ row: rij(), weekly: vlak, changeEvents: GEEN_EVENTS, now: NU });
  // Niet gehaald én niets uitgevoerd is een ANDERE les dan niet gehaald ondanks uitvoering: in het
  // eerste geval is er niets geleerd over de interventie, alleen over het account.
  check("niet uitgevoerd wint van het metriekverdict",
    zonder.soort === "oordeel" && zonder.uitkomst.verdict === "niet_uitgevoerd", JSON.stringify(zonder));
  check("en resultMet valt terug op null", zonder.soort === "oordeel" && zonder.uitkomst.resultMet === null);

  const met = evaluateHypothesisRow({ row: rij(), weekly: vlak, changeEvents: BUDGET_EVENT, now: NU });
  check("uitgevoerd en niet gehaald is een eigen verdict",
    met.soort === "oordeel" && met.uitkomst.verdict === "uitgevoerd_en_niet_gehaald", JSON.stringify(met));
  check("met het bewijs erbij", met.soort === "oordeel" && met.uitkomst.reason.includes("Uitgevoerd:"));
}
{
  // Een event BUITEN het meetvenster telt niet mee: anders zou een wijziging van maanden later
  // een oordeel over deze periode kunnen rechtvaardigen.
  const vlak = weken({ vanaf: "2026-05-04", aantal: 14, omslagIndex: 6, voor: { conversions: 60 }, na: { conversions: 60 } });
  const buiten: ChangeEvent[] = [{ date: "2026-08-01", type: "budget", entity: "Merk", detail: "later" }];
  const r = evaluateHypothesisRow({ row: rij(), weekly: vlak, changeEvents: buiten, now: NU });
  check("een event buiten het venster telt niet als uitvoering",
    r.soort === "oordeel" && r.uitkomst.verdict === "niet_uitgevoerd", JSON.stringify(r));
}
{
  // Zonder herkenbaar wijzigingstype in de tekst is uitvoering onbekend -- en dan mag het
  // metriekverdict blijven staan in plaats van "niet uitgevoerd" te claimen.
  const gestegen = weken({ vanaf: "2026-05-04", aantal: 14, omslagIndex: 6, voor: { conversions: 60 }, na: { conversions: 90 } });
  const r = evaluateHypothesisRow({
    row: rij({ hypothesis: "Iets vaags doen met de strategie" }), weekly: gestegen, changeEvents: GEEN_EVENTS, now: NU,
  });
  check("onbekende uitvoering laat het metriekverdict staan",
    r.soort === "oordeel" && r.uitkomst.verdict === "accepted", JSON.stringify(r));
  check("en zegt dat uitvoering niet vast te stellen was",
    r.soort === "oordeel" && r.uitkomst.reason.includes("niet vast te stellen"));
}

console.log("\nDe keten draait op de echte demo-weekdata");
{
  const alle = demoRows() as Record<string, Record<string, unknown>[]>;
  const weekly = (alle.ads_account_weekly ?? []) as unknown as WeeklyRow[];
  check("de demo levert weken", weekly.length >= 20, String(weekly.length));

  // accepted_at ruim binnen het bereik van de demo-weken, zodat baseline én meting gevuld zijn.
  const midden = weekly[Math.floor(weekly.length / 2)].week_start;
  const r = evaluateHypothesisRow({
    row: rij({ accepted_at: `${midden}T00:00:00Z`, hypothesis: "Verhoog het dagbudget van de merkcampagne" }),
    weekly,
    changeEvents: GEEN_EVENTS,
    now: NU,
  });
  check("levert een oordeel op echte weekdata", r.soort === "oordeel", JSON.stringify(r));
  check("het oordeel is een bekende waarde", r.soort === "oordeel" &&
    ["accepted", "rejected", "unmeasurable", "expired", "niet_uitgevoerd", "uitgevoerd_en_gehaald", "uitgevoerd_en_niet_gehaald"].includes(r.uitkomst.verdict),
    r.soort === "oordeel" ? r.uitkomst.verdict : "");
  // Geen NaN in de tekst: dat zou betekenen dat een aggregatie op een leeg venster is uitgevoerd.
  check("geen NaN in de onderbouwing", r.soort === "oordeel" && !r.uitkomst.reason.includes("NaN"), r.soort === "oordeel" ? r.uitkomst.reason : "");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

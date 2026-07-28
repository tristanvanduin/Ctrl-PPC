// Zelf-draaiende test voor de action-gating (de veiligheidspoort). Draait via tsx.
// Kern: 'direct_action' mag alleen bij deterministisch + hoog vertrouwen; kleine bedragen en
// laag-vertrouwde/hypothese-aanbevelingen worden gedowngraded; en tegenstrijdige budgetacties
// op dezelfde entiteit vallen allebei terug naar 'investigate_first'. Een gat hier laat zwak
// bewijs door als directe actie — precies wat deze poort moet tegenhouden.

import { applyActionGating } from "./action-gating";
import type { Finding, Recommendation } from "../schema/analysis-schema";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

const rec = (over: Record<string, unknown>): Recommendation => ({
  finding_index: null, source: "finding", hypothesis: "", action_readiness: "direct_action",
  evidence_level: "deterministic", confidence: "high", ...over,
} as unknown as Recommendation);

// `metric` hoort erbij: de drempel van 50 euro geldt alleen voor metrieken die een bedrag zijn,
// en deze fixture bedoelde blijkens zijn eigen omschrijving ("waste onder €50") altijd al euro's.
const finding = (over: Record<string, unknown>): Finding => ({
  entity_name: "Entiteit", metric: "cost", current_value: 100, insight_type: "trend", confidence: "high", ...over,
} as unknown as Finding);

const readiness = (r: Recommendation): string => (r as Record<string, unknown>).action_readiness as string;

console.log("regel 1 — direct_action vereist deterministisch + hoog:");
{
  const ok = applyActionGating([], [rec({ evidence_level: "deterministic", confidence: "high" })]);
  assert(readiness(ok[0]) === "direct_action", "deterministisch + hoog blijft direct_action");
  const lowConf = applyActionGating([], [rec({ evidence_level: "deterministic", confidence: "medium" })]);
  assert(readiness(lowConf[0]) === "investigate_first", "medium vertrouwen => investigate_first");
  const inferred = applyActionGating([], [rec({ evidence_level: "inferred", confidence: "high" })]);
  assert(readiness(inferred[0]) === "investigate_first", "niet-deterministisch bewijs => investigate_first");
}

console.log("regel 2 — klein bedrag en laag-vertrouwde finding:");
{
  const small = applyActionGating(
    [finding({ current_value: 30, insight_type: "trend" })],
    [rec({ finding_index: 0 })]
  );
  assert(readiness(small[0]) === "monitor", "waste onder €50 (geen anomaly) => monitor");

  const anomaly = applyActionGating(
    [finding({ current_value: 30, insight_type: "anomaly" })],
    [rec({ finding_index: 0 })]
  );
  assert(readiness(anomaly[0]) === "direct_action", "klein bedrag maar anomaly => niet gedowngraded");

  const lowFinding = applyActionGating(
    [finding({ current_value: 100, confidence: "low" })],
    [rec({ finding_index: 0 })]
  );
  assert(readiness(lowFinding[0]) === "investigate_first", "laag-vertrouwde finding => investigate_first");
}

console.log("regel 3 — hypothese-bron:");
{
  const hyp = applyActionGating([], [rec({ source: "hypothesis" })]);
  assert(readiness(hyp[0]) === "strategic_hypothesis", "bron hypothese => strategic_hypothesis");
}

console.log("regel 4 — tegenstrijdige budgetacties op dezelfde entiteit:");
{
  const recs = applyActionGating(
    [finding({ entity_name: "Campagne X", current_value: 500 })],
    [
      rec({ finding_index: 0, hypothesis: "Verhoog budget voor deze campagne" }),
      rec({ finding_index: 0, hypothesis: "Verlaag budget voor deze campagne" }),
    ]
  );
  assert(readiness(recs[0]) === "investigate_first" && readiness(recs[1]) === "investigate_first",
    "budget omhoog + omlaag op dezelfde entiteit => beide investigate_first");
}

// ── De drempel van 50 euro geldt alleen voor bedragen ──────────────────────
//
// `current_value` is de waarde van welke metriek de bevinding ook beschrijft. De drempel werd er
// zonder onderscheid op losgelaten, en een ROAS van 4,2 of een CTR van 0,05 is altijd kleiner
// dan 50. Elke aanbeveling op een verhoudingsmetriek werd zo stil teruggezet naar monitor.

console.log("regel 2 — de drempel geldt alleen voor bedragen:");
{
  for (const [metric, waarde] of [["ROAS", 4.2], ["CPA", 45], ["CTR", 0.05], ["conversies", 12], ["impression_share", 0.65]] as [string, number][]) {
    const r = applyActionGating([finding({ metric, current_value: waarde })], [rec({ finding_index: 0 })]);
    assert(readiness(r[0]) === "direct_action", `${metric} van ${waarde} is geen bedrag onder €50`);
  }
  for (const naam of ["spend", "kosten", "budget", "omzet", "revenue"]) {
    const r = applyActionGating([finding({ metric: naam, current_value: 20 })], [rec({ finding_index: 0 })]);
    assert(readiness(r[0]) === "monitor", `${naam} telt wel als bedrag`);
  }
  // Ontbreekt de metriek, dan grijpt de drempel niet in en crasht het niet.
  const zonder = applyActionGating([finding({ metric: undefined, current_value: 30 })], [rec({ finding_index: 0 })]);
  assert(readiness(zonder[0]) === "direct_action", "een ontbrekende metriek crasht niet en waardeert niet af");
}

// ── De regels bouwen op elkaar voort ───────────────────────────────────────
//
// action_readiness werd één keer bovenaan uitgelezen, waarna regel 2 en 3 hun beslissing namen
// op een waarde die regel 1 inmiddels had gewijzigd.

console.log("regels lezen de actuele stand:");
{
  const r = applyActionGating(
    [finding({ metric: "cost", current_value: 10 })],
    [rec({ finding_index: 0, evidence_level: "inferred" })]
  );
  assert(readiness(r[0]) === "investigate_first",
    "regel 1 waardeert af en regel 2 ziet dat ook (was: monitor via een verouderde waarde)");

  // Regel 3 is bewust wél onvoorwaardelijk: strategic_hypothesis is een categorie en geen
  // sterktegraad. Een aanbeveling uit een hypothese hoort in het sprintspoor, ook — en juist —
  // als het bewijs zwak is. Zwak bewijs is de normale toestand van een hypothese.
  const h = applyActionGating([], [rec({ source: "hypothesis", evidence_level: "inferred" })]);
  assert(readiness(h[0]) === "strategic_hypothesis", "een hypothese met zwak bewijs gaat naar de hypothesebak");

  const schoon = applyActionGating([], [rec({ source: "hypothesis" })]);
  assert(readiness(schoon[0]) === "strategic_hypothesis", "een schone hypothese ook");

  const monitor = applyActionGating([], [rec({ source: "hypothesis", action_readiness: "monitor" })]);
  assert(readiness(monitor[0]) === "strategic_hypothesis", "en een hypothese die al op monitor stond");
}

// ── Een kapotte bewijskoppeling geeft minder vrijheid, niet meer ───────────
//
// Wees de aanbeveling naar een bevinding die niet bestaat, dan viel hij stil buiten regel 2 en
// behield hij direct_action. Het bewijs waar hij op zegt te rusten is dan niet te vinden.

console.log("een finding_index die nergens naar wijst:");
{
  for (const idx of [5, 99, -1]) {
    const r = applyActionGating([finding({})], [rec({ finding_index: idx })]);
    assert(readiness(r[0]) === "investigate_first", `index ${idx} bestaat niet => geen directe actie`);
  }
  const leeg = applyActionGating([], [rec({ finding_index: 0 })]);
  assert(readiness(leeg[0]) === "investigate_first", "een lege bevindingenlijst crasht niet en waardeert af");
  const nul = applyActionGating([finding({})], [rec({ finding_index: null })]);
  assert(readiness(nul[0]) === "direct_action", "null betekent geen koppeling en blijft toegestaan");
}

// ── Tegenstrijdigheden tussen verschillende entiteiten ─────────────────────
//
// Zonder bevinding was de sleutel de eerste 30 tekens van de hypothese. "Verhoog het budget van
// campagne Brand NL" en "...Generic BE" kappen allebei af op "Verhoog het budget van campagn",
// dus twee losse campagnes konden elkaars aanbeveling afwaarderen.

console.log("regel 4 — verschillende entiteiten worden niet samengevoegd:");
{
  const a = "Verhoog het budget van campagne Brand NL";
  const b = "Verlaag het budget van campagne Generic BE";
  const los = applyActionGating([], [rec({ hypothesis: a }), rec({ hypothesis: b })]);
  assert(readiness(los[0]) === "direct_action" && readiness(los[1]) === "direct_action",
    "twee losse campagnes zijn geen tegenstrijdigheid");

  const beide = "Verhoog het budget van campagne Brand NL";
  const beide2 = "Verhoog het budget van campagne Generic BE";
  assert(beide.slice(0, 30) === beide2.slice(0, 30), "de oude sleutel van 30 tekens botste werkelijk");

  // Bekende beperking, nu expliciet: zonder gekoppelde bevinding is de entiteit niet vast te
  // stellen. De hypothesetekst is het enige aanknopingspunt, en een "verhoog"- en een
  // "verlaag"-hypothese hebben per definitie verschillende tekst — dus daar vindt regel 4 niets.
  // Dat gold ook voor de oude sleutel van 30 tekens, die op precies die woorden afweek; het
  // verschil is dat die soms wél samenvoegde, namelijk als het richtingwoord voorbij teken 30
  // stond, en dan even vaak de verkeerde twee. Op een bevinding groeperen is wel betrouwbaar,
  // en dat is het pad waar regel 4 zijn werk doet.
  const zonderBevinding = applyActionGating([], [
    rec({ hypothesis: "Verhoog budget van campagne A" }),
    rec({ hypothesis: "Verlaag budget van campagne A" }),
  ]);
  assert(zonderBevinding.every((r) => readiness(r) === "direct_action"),
    "zonder bevinding wordt een tegenstrijdigheid niet gevonden (bekende beperking)");

  const metBevinding = applyActionGating(
    [finding({ entity_name: "Campagne A", current_value: 5000 })],
    [
      rec({ finding_index: 0, hypothesis: "Verhoog budget van campagne A" }),
      rec({ finding_index: 0, hypothesis: "Verlaag budget van campagne A" }),
    ]
  );
  assert(metBevinding.every((r) => readiness(r) === "investigate_first"),
    "met een bevinding als entiteit wel: beide investigate_first");
}

// ── Twee keer draaien verandert niets ──────────────────────────────────────

console.log("stabiliteit:");
{
  const r = [rec({ finding_index: 0 })];
  applyActionGating([finding({})], r);
  const eerste = readiness(r[0]);
  applyActionGating([finding({})], r);
  assert(readiness(r[0]) === eerste, `twee keer toepassen geeft hetzelfde (${eerste})`);
  assert(applyActionGating([], []).length === 0, "een lege lijst geeft een lege lijst");
}

if (failed > 0) { console.error(`\n${failed} assertie(s) gefaald`); process.exit(1); }
console.log("\nalle action-gating-tests geslaagd");

// Het parsen van LLM-uitvoer naar databaserijen. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__extract_structured_test.ts
//
// Dit is de gevaarlijkste grens in de codebase: onbetrouwbare, ongestructureerde LLM-tekst
// wordt hier permanente databaserijen in sop_insights, sop_recommendations en sop_tasks. Wat
// hier stil misgaat, wordt later als waarheid teruggelezen.
//
// De validatie zelf is goed verdedigd — het volledige schema eerst, dan per item herstel — maar
// dat herstelpad gooide weg zonder spoor. Bij drie voorgestelde taken waarvan er een ongeldig
// was kwam er "success: true" met twee taken uit, en omdat de foutlogging naar `success` kijkt
// sloeg die ook niet aan. Wie de analyse las zag twee taken en kon niet weten dat er een derde
// was bedacht en verdwenen.

import { parseRecommendations, TaskSchema, RecommendationSchema } from "../schema/analysis-schema";
import { OWNER_TEAM } from "../branding/brand";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const taak = (titel: string, o: Record<string, unknown> = {}) => ({
  title: titel, description: "d", action_type: "budget", owner: OWNER_TEAM,
  affected_campaign: null, affected_adgroup: null, affected_keyword: null,
  current_value: null, target_value: null, priority: "high", frequency: "weekly",
  due_date_days: 7, recommendation_index: 0, ...o,
});
const aanbeveling = (o: Record<string, unknown> = {}) => ({
  hypothesis: "H", expected_result: "R", measurement_metric: "CPA", timeframe: "4 weken",
  rationale: "X", ice_impact: 8, ice_confidence: 7, ice_ease: 6, ice_total: 7,
  finding_index: 0, action_readiness: "direct_action", source: "finding", ...o,
});
const uitvoer = (recs: unknown[], taken: unknown[]) => JSON.stringify({ recommendations: recs, tasks: taken });

// ── Weggevallen items worden gemeld ───────────────────────────────────────

console.log("Het herstelpad meldt wat het weggooit");
{
  const r = parseRecommendations(uitvoer([aanbeveling()], [taak("A"), taak("B", { due_date_days: 400 }), taak("C", { due_date_days: 14 })]));
  check("het parsen slaagt", r.success);
  if (r.success) {
    check("de geldige taken blijven", r.data.tasks.length === 2, String(r.data.tasks.length));
    check("en het zijn de juiste", r.data.tasks.map((t) => t.title).join(",") === "A,C");
    // Dit is de fix: zonder dit veld was het verlies onzichtbaar.
    check("het verlies wordt gemeld", r.dropped !== undefined && r.dropped.counts.tasks === 1,
      JSON.stringify(r.dropped ?? null));
    check("met een reden erbij", (r.dropped?.reasons ?? []).some((x) => /due_date_days/.test(x)),
      (r.dropped?.reasons ?? []).join(" | "));
  }
}
{
  // Niets weggevallen: dan hoort er ook geen melding te staan, anders wordt het ruis.
  const r = parseRecommendations(uitvoer([aanbeveling()], [taak("A"), taak("B")]));
  check("bij een schone uitvoer geen melding", r.success && r.dropped === undefined,
    r.success ? JSON.stringify(r.dropped ?? null) : "");
}
{
  // Ook aan de aanbevelingenkant.
  const r = parseRecommendations(uitvoer([aanbeveling(), aanbeveling({ ice_impact: "veel" })], [taak("A")]));
  check("een ongeldige aanbeveling wordt geteld", r.success && r.dropped?.counts.recommendations === 1,
    r.success ? JSON.stringify(r.dropped ?? null) : "");
}
{
  // Alles ongeldig: dan hoort het gewoon te falen, niet stil leeg terug te komen.
  const r = parseRecommendations(uitvoer([aanbeveling({ ice_impact: "veel" })], [taak("A", { due_date_days: 999 })]));
  check("alles ongeldig geeft geen success", !r.success);
}

// ── due_date_days is en blijft een getal ──────────────────────────────────
//
// Verderop wordt hij opgeteld bij een datum. Zou hij als tekst doorkomen, dan is
// getDate() + "7" stringconcatenatie en wordt setDate("287") acht maanden vooruit — zonder
// fout. Het schema hoort dat tegen te houden.

console.log("\nde due_date_days-grens");
for (const [naam, waarde] of Object.entries({
  tekst: "7", leeg: null, ontbrekend: undefined, nul: 0, negatief: -5,
  gebroken: 1.5, teGroot: 400, tekstwoord: "zeven", oneindig: Infinity,
})) {
  const r = TaskSchema.safeParse(taak("X", { due_date_days: waarde }));
  check(`${naam} wordt geweigerd`, !r.success, `${JSON.stringify(waarde)} kwam er doorheen`);
}
check("een geldig getal komt er wel door", TaskSchema.safeParse(taak("X", { due_date_days: 7 })).success);
check("de ondergrens 1 mag", TaskSchema.safeParse(taak("X", { due_date_days: 1 })).success);
check("de bovengrens 365 mag", TaskSchema.safeParse(taak("X", { due_date_days: 365 })).success);

// ── De koppelingsindexen ─────────────────────────────────────────────────
//
// finding_index en recommendation_index komen uit de LLM en hebben geen bereikcontrole in het
// schema. Buiten bereik werd de koppeling stil null, en dan staat er een aanbeveling in de
// database zonder de bevinding waar hij uit voortkomt.

// ice_total wordt genormaliseerd in plaats van hard geweigerd: het model levert soms de SOM
// van de drie ICE-delen (tot 30) in plaats van het gemiddelde, en de harde max(10) gooide
// daarop live 4 van de 4 aanbevelingen van een LinkedIn-weekly weg (1 september 2026).
console.log("\nice_total-normalisatie");
{
  const som = RecommendationSchema.safeParse(aanbeveling({ ice_total: 21 }));
  check("som van de delen (21) wordt gemiddelde (7)", som.success && som.data.ice_total === 7,
    som.success ? String(som.data.ice_total) : "parse faalde");
  const netjes = RecommendationSchema.safeParse(aanbeveling({ ice_total: 7.3 }));
  check("een waarde binnen de schaal blijft ongemoeid", netjes.success && netjes.data.ice_total === 7.3);
  const onder = RecommendationSchema.safeParse(aanbeveling({ ice_total: 0.4 }));
  check("onder de schaal klemt naar 1", onder.success && onder.data.ice_total === 1);
  const onzin = RecommendationSchema.safeParse(aanbeveling({ ice_total: "hoog" }));
  check("tekst blijft een parse-fout", !onzin.success);
}

console.log("\nDe koppelingsindexen");
{
  const r = RecommendationSchema.safeParse(aanbeveling({ finding_index: 99 }));
  check("het schema laat een index buiten bereik door", r.success,
    "als dit faalt is de bereikcontrole verplaatst naar het schema; werk dan de fix in extract-structured bij");
  const n = RecommendationSchema.safeParse(aanbeveling({ finding_index: null }));
  check("null is toegestaan (geen bijbehorende bevinding)", n.success);
  const t = RecommendationSchema.safeParse(aanbeveling({ finding_index: "eerste" }));
  check("tekst niet", !t.success);
}
{
  // Het gedrag dat extract-structured nu telt: buiten bereik levert geen koppeling op.
  const insightIds = ["id-A", "id-B"];
  const koppel = (idx: number | null) => {
    const buiten = idx !== null && (idx < 0 || idx >= insightIds.length);
    return idx !== null && !buiten ? insightIds[idx] : null;
  };
  check("index 0 koppelt", koppel(0) === "id-A");
  check("index 1 koppelt", koppel(1) === "id-B");
  check("index 2 koppelt niet", koppel(2) === null);
  check("een negatieve index koppelt niet", koppel(-1) === null);
  check("null koppelt niet", koppel(null) === null);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);

// De brug tussen sop_tasks en de taakstatus-grounding. Geen IO; supabase is gemockt.
// Draaien: npx tsx lib/tasks/__prior_tasks_test.ts
//
// buildTaskStatusGrounding stond gebouwd en getest zonder bron: de pure kern is geschreven op
// analysis_tasks (migratie 006), en die tabel wordt nergens geschreven of gelezen. De taken die
// de analyses werkelijk opleveren staan in sop_tasks. Zonder die brug begon elke maandanalyse
// met een schone lei en beval opnieuw aan wat vorige maand al was uitgevoerd.
//
// Waar het hier op aankomt is de statusafbeelding. sop_tasks kent "completed" waar task-tracking
// "done" zegt, en een onbekende status moet als OPEN gelden — een taak ten onrechte als afgerond
// bestempelen laat hem stilzwijgend uit de opvolging verdwijnen, en dat is de dure kant.

import { mapTaskStatus, entityVanTaak, toPriorTasks, priorTasksVoorGrounding } from "./prior-tasks";
import { buildTaskStatusGrounding } from "./task-tracking";
import type { SupabaseClient } from "@supabase/supabase-js";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De statusafbeelding ───────────────────────────────────────────────────

console.log("De statusafbeelding");
{
  check("completed wordt done", mapTaskStatus("completed") === "done");
  check("done blijft done", mapTaskStatus("done") === "done");
  check("in_progress blijft", mapTaskStatus("in_progress") === "in_progress");
  check("skipped blijft", mapTaskStatus("skipped") === "skipped");
  check("wont_do blijft", mapTaskStatus("wont_do") === "wont_do");
  check("hoofdletters maken niet uit", mapTaskStatus("COMPLETED") === "done");

  // De veilige kant: onbekend is open, niet done.
  for (const raar of ["", "  ", "iets_anders", null, undefined]) {
    check(`${JSON.stringify(raar)} geldt als open`, mapTaskStatus(raar as string) === "open",
      mapTaskStatus(raar as string));
  }
}

// ── De entiteit ───────────────────────────────────────────────────────────

console.log("\nDe entiteit van een taak");
{
  check("zoekwoord wint van adgroep en campagne",
    entityVanTaak({ affected_keyword: "beurs tickets", affected_adgroup: "AG", affected_campaign: "C" }) === "beurs tickets");
  check("adgroep wint van campagne",
    entityVanTaak({ affected_adgroup: "AG", affected_campaign: "C" }) === "AG");
  check("campagne als er niets specifiekers is",
    entityVanTaak({ affected_campaign: "C" }) === "C");
  check("niets levert null", entityVanTaak({}) === null);
  // Lege strings zijn geen entiteit; die zouden anders "()" in de prompt opleveren.
  check("lege strings tellen niet mee",
    entityVanTaak({ affected_keyword: "", affected_adgroup: "   ", affected_campaign: "C" }) === "C");
}

// ── De afbeelding als geheel ──────────────────────────────────────────────

console.log("\nVan rijen naar PriorTask");
{
  const uit = toPriorTasks([
    { title: "Budget verhogen", status: "completed", affected_campaign: "Brand NL" },
    { title: "Zoekterm uitsluiten", status: "open", affected_keyword: "gratis pdf" },
    { title: "  ", status: "open" },              // lege titel: weg
    { status: "open", affected_campaign: "X" },   // geen titel: weg
  ]);
  check("rijen zonder titel vallen weg", uit.length === 2, String(uit.length));
  check("de status is afgebeeld", uit[0].status === "done", uit[0].status);
  check("de entiteit staat erbij", uit[1].entity_name === "gratis pdf", String(uit[1].entity_name));
  // Deze twee velden bestaan niet in sop_tasks en mogen niet verzonnen worden.
  check("execution_status blijft onbekend", uit.every((t) => t.execution_status === "unknown"));
  check("deadline_hint blijft leeg", uit.every((t) => t.deadline_hint === null));
}

// ── Wat er in de prompt belandt ───────────────────────────────────────────

console.log("\nHet groundingblok");
{
  const blok = buildTaskStatusGrounding(toPriorTasks([
    { title: "Budget verhogen", status: "completed", affected_campaign: "Brand NL" },
    { title: "Zoekterm uitsluiten", status: "open", affected_keyword: "gratis pdf" },
  ]));
  check("afgeronde taken staan erin", /Budget verhogen/.test(blok), blok.slice(0, 120));
  check("met de instructie niet te herhalen", /niet opnieuw aanbevelen/.test(blok));
  check("openstaande taken staan er apart", /Nog openstaande taken/.test(blok));
  // Zonder detectie hoort er geen "(uitvoering gedetecteerd)" te staan.
  check("geen verzonnen detectiemelding", !/gedetecteerd/.test(blok), blok);
  // En zonder deadline geen escalatie.
  check("geen verzonnen escalatie", !/deadline direct/.test(blok), blok);
}
{
  // Geen taken: een leeg blok, zodat een eerste run een byte-identieke prompt houdt. Dat is
  // ook wat de cachetest bewaakt — een blok dat er altijd staat zou het gedeelde promptbegin
  // per klant laten verschillen.
  check("geen taken geeft een lege string", buildTaskStatusGrounding([]) === "");
  check("en rijen zonder titel dus ook", buildTaskStatusGrounding(toPriorTasks([{ status: "open" }])) === "");
}

// ── De ophaal faalt zacht ─────────────────────────────────────────────────

// De runner compileert naar cjs, dus geen top-level await.
async function main() {
  console.log("\nAls de database niet meewerkt");
  {
    const kapot = { from() { throw new Error("verbinding weg"); } } as unknown as SupabaseClient;
    const r = await priorTasksVoorGrounding(kapot, "c1", "2026-07-01");
    check("een fout geeft een lege lijst", r.length === 0);
    check("en dus een leeg blok", buildTaskStatusGrounding(r) === "");
  }
  {
    const metFout = {
      from: () => ({
        select: () => ({ eq: () => ({ lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "boem" } }) }) }) }) }),
      }),
    } as unknown as SupabaseClient;
    const r = await priorTasksVoorGrounding(metFout, "c1", "2026-07-01");
    check("een databasefout ook", r.length === 0);
  }
  {
    const goed = {
      from: () => ({
        select: () => ({ eq: () => ({ lt: () => ({ order: () => ({ limit: () => Promise.resolve({
          data: [{ title: "Bod verlagen", status: "completed", affected_campaign: "Generic BE" }], error: null,
        }) }) }) }) }),
      }),
    } as unknown as SupabaseClient;
    const r = await priorTasksVoorGrounding(goed, "c1", "2026-07-01");
    check("een geslaagde ophaal levert taken", r.length === 1 && r[0].status === "done", JSON.stringify(r));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

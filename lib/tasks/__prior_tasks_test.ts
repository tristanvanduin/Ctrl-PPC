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
    check("een fout geeft een lege lijst", r.taken.length === 0);
    check("en meldt niets als afgekapt", r.weggelaten === 0);
    check("en dus een leeg blok", buildTaskStatusGrounding(r.taken, r.weggelaten) === "");
  }
  {
    const metFout = {
      from: () => ({
        select: () => ({ eq: () => ({ lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "boem" } }) }) }) }) }),
      }),
    } as unknown as SupabaseClient;
    const r = await priorTasksVoorGrounding(metFout, "c1", "2026-07-01");
    check("een databasefout ook", r.taken.length === 0 && r.weggelaten === 0);
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
    check("een geslaagde ophaal levert taken", r.taken.length === 1 && r.taken[0].status === "done", JSON.stringify(r));
    check("en meldt niets als afgekapt", r.weggelaten === 0);
  }

  // ── Het kanaalfilter ────────────────────────────────────────────────────
  //
  // sop_tasks had geen sop_type, dus de enige filters waren client_id en datum. De
  // Google-maandprompt kreeg daardoor de taken van de Meta- en LinkedIn-runs ongelabeld binnen,
  // mét de instructie afgeronde taken niet te herhalen: dan leest een Google-analyse dat een
  // LinkedIn-formulierwijziging al gedaan is en laat hij een echte Google-actie liggen.
  //
  // Wat hier te toetsen valt is niet of de query rijen teruggeeft (dat doet de database), maar
  // WELK filter er wordt meegestuurd. De mock legt het `in`-argument vast.

  console.log("\nHet kanaalfilter");
  {
    /** Mock die vastlegt of en waarop `.in()` is aangeroepen. */
    function spionerendeClient(): { client: SupabaseClient; gezien: () => { kolom: string; waarden: string[] } | null } {
      let gezien: { kolom: string; waarden: string[] } | null = null;
      const eindpunt = { order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) };
      const naLt = {
        ...eindpunt,
        in: (kolom: string, waarden: string[]) => { gezien = { kolom, waarden }; return eindpunt; },
      };
      const client = {
        from: () => ({ select: () => ({ eq: () => ({ lt: () => naLt }) }) }),
      } as unknown as SupabaseClient;
      return { client, gezien: () => gezien };
    }

    // Zonder sopType blijft het gedrag exact zoals het was: geen `in`, dus geen filter.
    {
      const { client, gezien } = spionerendeClient();
      await priorTasksVoorGrounding(client, "c1", "2026-07-01");
      check("zonder sopType wordt er niet gefilterd", gezien() === null, JSON.stringify(gezien()));
    }

    // Elk kanaal krijgt zijn eigen drie cadansen -- niet alleen zijn eigen sop_type. Een
    // maandanalyse HOORT te zien wat de weekly van hetzelfde kanaal heeft aangedragen; dat is de
    // doorgeefketen. Alleen het andere KANAAL valt af.
    const verwacht: Record<string, string[]> = {
      monthly: ["weekly", "biweekly", "monthly"],
      weekly: ["weekly", "biweekly", "monthly"],
      meta_monthly: ["meta_weekly", "meta_biweekly", "meta_monthly"],
      meta_weekly: ["meta_weekly", "meta_biweekly", "meta_monthly"],
      linkedin_monthly: ["linkedin_weekly", "linkedin_biweekly", "linkedin_monthly"],
      linkedin_biweekly: ["linkedin_weekly", "linkedin_biweekly", "linkedin_monthly"],
    };
    for (const [sopType, types] of Object.entries(verwacht)) {
      const { client, gezien } = spionerendeClient();
      await priorTasksVoorGrounding(client, "c1", "2026-07-01", sopType);
      const g = gezien();
      check(`${sopType} filtert op zijn eigen kanaal`,
        g !== null && g.kolom === "sop_type" && JSON.stringify([...g.waarden].sort()) === JSON.stringify([...types].sort()),
        JSON.stringify(g));
    }

    // De harde eis waar dit allemaal om begonnen is: geen enkel filter mag een sop_type van een
    // ANDER kanaal doorlaten.
    for (const [sopType] of Object.entries(verwacht)) {
      const { client, gezien } = spionerendeClient();
      await priorTasksVoorGrounding(client, "c1", "2026-07-01", sopType);
      const waarden = gezien()?.waarden ?? [];
      const meta = waarden.filter((w) => w.startsWith("meta_")).length;
      const li = waarden.filter((w) => w.startsWith("linkedin_")).length;
      const google = waarden.filter((w) => !w.startsWith("meta_") && !w.startsWith("linkedin_")).length;
      check(`${sopType} mengt geen kanalen`, [meta, li, google].filter((n) => n > 0).length === 1,
        JSON.stringify(waarden));
    }

    // cross_channel hoort bij geen enkel kanaal. Dan liever ongefilterd dan alles weggooien: een
    // lege `in` zou nul taken opleveren en dat leest als "er is niets gedaan".
    {
      const { client, gezien } = spionerendeClient();
      await priorTasksVoorGrounding(client, "c1", "2026-07-01", "cross_channel");
      check("cross_channel filtert niet in plaats van alles weg te gooien", gezien() === null,
        JSON.stringify(gezien()));
    }
  }

  // ── De limiet, en de eerlijkheid erover ─────────────────────────────────
  //
  // De drie cadansen hanteren verschillende limieten (TAAKLIMIET): de weekly-prompt is expliciet
  // kort en veertig regels taakhistorie zouden daar de rest verdringen. Een limiet is prima; een
  // STILLE limiet niet, want dit blok sluit af met "Verzin geen taken die hier niet staan". Wordt
  // er stil afgekapt, dan leest het model dat als "die taak bestaat niet" terwijl hij gewoon
  // buiten de selectie viel -- en dat is een verkeerde bewering, niet een ontbrekende.

  console.log("\nDe limiet wordt gemeld en niet stil toegepast");
  {
    /** Mock die N rijen teruggeeft en vastlegt met welke limiet er is gevraagd. */
    function metRijen(n: number): { client: SupabaseClient; gevraagd: () => number | null } {
      let gevraagd: number | null = null;
      const rijen = Array.from({ length: n }, (_, i) => ({
        title: `Taak ${i + 1}`, status: "open", analysis_date: "2026-06-01",
      }));
      const client = {
        from: () => ({ select: () => ({ eq: () => ({ lt: () => ({
          order: () => ({ limit: (l: number) => { gevraagd = l; return Promise.resolve({ data: rijen.slice(0, l), error: null }); } }),
        }) }) }) }),
      } as unknown as SupabaseClient;
      return { client, gevraagd: () => gevraagd };
    }

    // Precies op de limiet: niets afgekapt.
    {
      const { client } = metRijen(12);
      const r = await priorTasksVoorGrounding(client, "c1", "2026-07-01", undefined, 12);
      check("precies aan de limiet: alles komt mee", r.taken.length === 12, String(r.taken.length));
      check("en er wordt niets gemeld", r.weggelaten === 0, String(r.weggelaten));
    }

    // Eén erover: de eerste twaalf komen mee en de rest wordt geméld.
    {
      const { client } = metRijen(13);
      const r = await priorTasksVoorGrounding(client, "c1", "2026-07-01", undefined, 12);
      check("boven de limiet: precies de limiet komt mee", r.taken.length === 12, String(r.taken.length));
      check("en de rest wordt gemeld", r.weggelaten === 1, String(r.weggelaten));
    }

    // De query vraagt er één MEER dan hij toont -- anders valt niet te zien of er meer was.
    {
      const { client, gevraagd } = metRijen(50);
      await priorTasksVoorGrounding(client, "c1", "2026-07-01", undefined, 12);
      check("de query vraagt limiet + 1", gevraagd() === 13, String(gevraagd()));
    }

    // Zonder opgave blijft de oude maandlimiet gelden: geen gedragswijziging voor de monthly.
    {
      const { client, gevraagd } = metRijen(5);
      await priorTasksVoorGrounding(client, "c1", "2026-07-01");
      check("zonder opgave geldt de maandlimiet van 40", gevraagd() === 41, String(gevraagd()));
    }
  }

  console.log("\nHet blok zegt het ook echt");
  {
    const taken = toPriorTasks([{ title: "Bod verlagen", status: "open" }]);
    const zonder = buildTaskStatusGrounding(taken, 0);
    const met = buildTaskStatusGrounding(taken, 7);
    check("zonder afkapping geen melding", !/niet getoond/.test(zonder), zonder);
    check("met afkapping wel", /7 oudere taken/.test(met), met);
    // De melding mag de belofte "verzin geen taken" niet vervangen maar aanvullen: allebei blijven.
    check("en de slotregel blijft staan", met.includes("Verzin geen taken die hier niet staan"), met);
    // Geen taken blijft geen blok, ook als er iets is afgekapt -- dat kan niet, maar als het ooit
    // kan mag het geen blok met alleen een meldregel opleveren.
    check("nul taken geeft nog steeds niets", buildTaskStatusGrounding([], 5) === "");
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

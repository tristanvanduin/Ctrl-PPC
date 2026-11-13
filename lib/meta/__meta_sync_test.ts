// Test van de Meta-sync-vensters en rij-mapping.
// Draaien: npx tsx lib/meta/__meta_sync_test.ts
import { todayUTC, addDaysISO, trailingWindow, backfillWindow, monthlyChunks } from "./sync-windows";
import { metaDailyToDbRow, metaBreakdownToDbRow, metaPeriodToDbRow, META_DAILY_CONFLICT, META_PERIOD_CONFLICT } from "./rows";
import { fetchInsightsAsync, syncMetaPeriodReach, isOntbrekendeTabel } from "./sync";
import { mapInsightsRow } from "./transform";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("1. addDaysISO over maand- en jaargrenzen");
check("een dag terug over jaargrens", addDaysISO("2026-01-01", -1) === "2025-12-31");
check("een dag vooruit over maandgrens", addDaysISO("2026-02-28", 1) === "2026-03-01");
check("28 terug", addDaysISO("2026-05-28", -27) === "2026-05-01");

console.log("\n2. trailingWindow (28-daagse attributie-herstatement)");
const tw = trailingWindow("2026-05-28", 28);
check("until is endDate", tw.until === "2026-05-28");
check("since is 28 dagen inclusief", tw.since === "2026-05-01", JSON.stringify(tw));

console.log("\n3. backfillWindow (13 maanden)");
const bw = backfillWindow("2026-05-15", 13);
check("since is eerste dag 13 maanden terug", bw.since === "2025-05-01", JSON.stringify(bw));
check("until is endDate", bw.until === "2026-05-15");

console.log("\n4. monthlyChunks (geclamped op de randen)");
const chunks = monthlyChunks("2026-04-10", "2026-06-05");
check("drie maand-chunks", chunks.length === 3, JSON.stringify(chunks));
check("eerste chunk start op since, niet maandbegin", chunks[0].since === "2026-04-10" && chunks[0].until === "2026-04-30");
check("middelste chunk volledige maand", chunks[1].since === "2026-05-01" && chunks[1].until === "2026-05-31");
check("laatste chunk eindigt op until, niet maandeinde", chunks[2].since === "2026-06-01" && chunks[2].until === "2026-06-05");

console.log("\n5. todayUTC formaat");
check("YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayUTC()));

console.log("\n6. metaDailyToDbRow mapping");
const dayRow = mapInsightsRow({
  date_start: "2026-05-01", ad_id: "ad_1", impressions: "1000", inline_link_clicks: "50", spend: "100",
  actions: [{ action_type: "purchase", value: "5" }], action_values: [{ action_type: "purchase", value: "500" }],
});
const db = metaDailyToDbRow(dayRow, "client_x");
check("client_id gezet", db.client_id === "client_x");
check("snake_case datum en entity", db.date === "2026-05-01" && db.entity_id === "ad_1");
check("metriek gemapt", db.link_clicks === 50 && db.spend === 100 && db.conversions === 5);
check("afgeleide cpa gemapt", db.cpa === 20);
check("geen rankings zonder optie", db.quality_ranking === undefined);
const dbRank = metaDailyToDbRow(dayRow, "client_x", { includeRankings: true });
check("rankings met optie aanwezig (ook als null)", "quality_ranking" in dbRank);

console.log("\n7. metaBreakdownToDbRow mapping");
const bd = metaBreakdownToDbRow(dayRow, "client_x", { level: "campaign", entityId: "camp_1", breakdownType: "gender", breakdownValue: "female" });
check("breakdown dimensie gezet", bd.breakdown_type === "gender" && bd.breakdown_value === "female");
check("breakdown level en entity", bd.level === "campaign" && bd.entity_id === "camp_1");
check("breakdown subset metriek", bd.impressions === 1000 && bd.spend === 100);

console.log("\n8. conflict-sleutels matchen de unique-constraints");
check("daily conflict key", META_DAILY_CONFLICT === "client_id,date,entity_id");

console.log("\n9. periodelezing (doorlichting 13 november 2026): bereik over het hele venster");
const periodeRauw = { date_start: "2026-10-16", date_stop: "2026-11-12", ad_id: "ad_1", impressions: "42000", reach: "10000", frequency: "4.2" };
const periode = metaPeriodToDbRow(periodeRauw, mapInsightsRow(periodeRauw), "client_x", "ad");
check("periode-rij krijgt begin en eind uit de rij", periode?.period_start === "2026-10-16" && periode?.period_end === "2026-11-12");
check("periode-rij draagt het ontdubbelde bereik", periode?.reach === 10000 && periode?.impressions === 42000);
check("zonder date_stop geen rij (geen verzonnen venster)", metaPeriodToDbRow({ date_start: "2026-10-16" }, mapInsightsRow({ date_start: "2026-10-16", ad_id: "x" }), "c", "ad") === null);
check("period conflict key", META_PERIOD_CONFLICT === "client_id,level,entity_id,period_start,period_end");

(async () => {
  // De aanroep zelf: met periode zonder time_increment (Meta geeft dan een rij per entiteit over
  // het hele venster), zonder periode met time_increment 1. Geen netwerk: fetch is vervangen.
  const bodies: URLSearchParams[] = [];
  const echt = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    if (init?.body instanceof URLSearchParams) bodies.push(init.body);
    return { json: async () => ({}) } as Response;
  }) as typeof fetch;
  const ctx = { supabase: null as never, clientId: "c", accountId: "act_1", accessToken: "t" };
  await fetchInsightsAsync(ctx, { level: "ad", since: "2026-10-16", until: "2026-11-12", periode: true });
  await fetchInsightsAsync(ctx, { level: "ad", since: "2026-10-16", until: "2026-11-12" });
  globalThis.fetch = echt;
  check("periodelezing vraagt geen time_increment", bodies[0] != null && !bodies[0].has("time_increment"));
  check("periodelezing vraagt bereik en vertoningen", (bodies[0]?.get("fields") ?? "").split(",").includes("reach"));
  check("de daglezing blijft per dag", bodies[1]?.get("time_increment") === "1");

  // De periodelezing in de dagelijkse run: zonder tabel (migratie 110 niet gedraaid) niets aan
  // Meta vragen en geen fout, met tabel wel vragen. Supabase en fetch zijn vervangen.
  const nepSupabase = (fout: { code: string; message: string } | null) => ({
    from: () => ({ select: () => ({ limit: async () => ({ data: fout ? null : [], error: fout }) }), upsert: async () => ({ error: null }) }),
  }) as never;
  let aanroepen = 0;
  globalThis.fetch = (async () => { aanroepen += 1; return { json: async () => ({}) } as Response; }) as typeof fetch;
  const zonder = await syncMetaPeriodReach({ ...ctx, supabase: nepSupabase({ code: "PGRST205", message: "Could not find the table 'public.meta_period_reach' in the schema cache" }) }, "2026-11-12");
  check("zonder tabel: overgeslagen, geen fout", zonder.tabelOntbreekt && zonder.failed.length === 0 && zonder.rows === 0);
  check("zonder tabel: niets aan Meta gevraagd", aanroepen === 0, String(aanroepen));
  const met = await syncMetaPeriodReach({ ...ctx, supabase: nepSupabase(null) }, "2026-11-12");
  check("met tabel: Meta wordt gevraagd voor campagne en advertentie", !met.tabelOntbreekt && aanroepen >= 2, String(aanroepen));
  check("met tabel: een mislukte Meta-job staat als niveau in failed", met.failed.length === 2, JSON.stringify(met.failed));
  globalThis.fetch = echt;
  check("42P01 is een ontbrekende tabel", isOntbrekendeTabel({ code: "42P01", message: 'relation "meta_period_reach" does not exist' }));
  check("een rechtenfout niet", !isOntbrekendeTabel({ code: "42501", message: "permission denied for table meta_period_reach" }));

  console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
  if (failed > 0) process.exit(1);
})();

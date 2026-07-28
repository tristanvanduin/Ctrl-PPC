// Historie laten aangroeien in plaats van hem elke sync weg te gooien. Geen IO; supabase is gemockt.
// Draaien: npx tsx lib/sync/__append_batch_test.ts
//
// Zeventien tabellen werden gesynct met replaceBatch: eerst alle rijen van de klant verwijderen,
// dan opnieuw invoegen. Zo'n tabel kan nooit meer bevatten dan wat de laatste sync ophaalde, en
// dat is veertien maanden. De zestien tabellen die met upsertBatch werken groeien al wel mee.
//
// Voor tijdreeksen is dat verlies definitief: Google bewaart zoektermdata niet onbeperkt, dus wat
// daar uit het venster loopt is niet opnieuw op te halen.
//
// De terugval is wat deze wijziging veilig maakt. Zonder unieke sleutel kan Postgres geen ON
// CONFLICT en geeft hij 42P10. Zou appendBatch daarop stukgaan, dan brak de sync op elke
// omgeving waar de migratie nog niet is gedraaid — en de gebruiker kan die migratie nu niet
// draaien. Met de terugval verandert er daar niets.

import type { SupabaseClient } from "@supabase/supabase-js";
import { appendBatch, replaceBatch, dedup } from "./orchestrator";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Op = { type: "upsert" | "insert" | "delete"; table: string; rows?: number; onConflict?: string };

/** `upsertFout` simuleert een database waar de unieke sleutel nog niet is aangelegd. */
function mock(cfg: { upsertFout?: { code?: string; message?: string } } = {}) {
  const ops: Op[] = [];
  const from = (table: string) => ({
    upsert(rows: Record<string, unknown>[], opts: { onConflict: string }) {
      ops.push({ type: "upsert", table, rows: rows.length, onConflict: opts.onConflict });
      return Promise.resolve({ error: cfg.upsertFout ?? null });
    },
    insert(rows: Record<string, unknown>[]) {
      ops.push({ type: "insert", table, rows: rows.length });
      return Promise.resolve({ error: null });
    },
    delete() {
      return { eq(_k: string, _v: unknown) { ops.push({ type: "delete", table }); return Promise.resolve({ error: null }); } };
    },
  });
  return { client: { from } as unknown as SupabaseClient, ops };
}

const rijen = (n: number) => Array.from({ length: n }, (_, i) => ({ client_id: "c1", month: "2026-06-01", country_code: `L${i}` }));

async function main() {
  // ── Met de sleutel: bijwerken, niets wissen ─────────────────────────────

  console.log("Met een unieke sleutel");
  {
    const m = mock();
    const n = await appendBatch(m.client, "ads_country_monthly", rijen(3), "client_id,month,country_code", "c1");
    check("alle rijen geschreven", n === 3, String(n));
    check("via upsert", m.ops.every((o) => o.type === "upsert"), JSON.stringify(m.ops));
    // Dit is de kern: geen delete betekent dat de historie blijft staan.
    check("er wordt niets verwijderd", !m.ops.some((o) => o.type === "delete"), JSON.stringify(m.ops));
    check("met de opgegeven sleutel", m.ops[0].onConflict === "client_id,month,country_code", String(m.ops[0].onConflict));
  }
  {
    // Meer dan een chunk: alles moet mee.
    const m = mock();
    const n = await appendBatch(m.client, "t", rijen(1200), "client_id", "c1");
    check("1200 rijen in drie chunks", n === 1200 && m.ops.length === 3, `${n} / ${m.ops.length} ops`);
  }

  // ── Zonder de sleutel: terugvallen, niet breken ─────────────────────────

  console.log("\nZonder unieke sleutel (migratie nog niet gedraaid)");
  {
    const m = mock({ upsertFout: { code: "42P10", message: "no unique or exclusion constraint" } });
    const n = await appendBatch(m.client, "ads_country_monthly", rijen(3), "client_id,month,country_code", "c1");
    check("het gaat niet stuk", n === 3, String(n));
    check("er wordt teruggevallen op vervangen",
      m.ops.some((o) => o.type === "delete") && m.ops.some((o) => o.type === "insert"), JSON.stringify(m.ops));
    check("in de juiste volgorde: eerst verwijderen, dan invoegen",
      m.ops.findIndex((o) => o.type === "delete") < m.ops.findIndex((o) => o.type === "insert"));
  }
  {
    // Een ANDERE fout mag juist niet stil worden weggeslikt.
    const m = mock({ upsertFout: { code: "23505", message: "duplicate key" } });
    let gegooid = false;
    try { await appendBatch(m.client, "t", rijen(2), "client_id", "c1"); } catch { gegooid = true; }
    check("een andere databasefout wordt wel gegooid", gegooid,
      "anders boekt syncDataset een mislukte schrijfactie als geslaagd");
    check("en er wordt niet teruggevallen", !m.ops.some((o) => o.type === "delete"), JSON.stringify(m.ops));
  }

  // ── Een lege ophaal raakt niets aan ─────────────────────────────────────
  //
  // De getters in google-ads.ts eindigen op `catch { return []; }`, dus een netwerkfout of een
  // quota-limiet levert een lege array. Die mag de tabel niet leegmaken — dat is de reden dat
  // replaceBatch deze controle heeft, en appendBatch moet hem net zo goed hebben.

  console.log("\nEen lege ophaal");
  {
    const m = mock();
    const n = await appendBatch(m.client, "t", [], "client_id", "c1");
    check("nul rijen geschreven", n === 0);
    check("en de tabel wordt niet aangeraakt", m.ops.length === 0, JSON.stringify(m.ops));
  }
  {
    const m = mock();
    await replaceBatch(m.client, "t", [], "c1");
    check("replaceBatch doet hetzelfde", m.ops.length === 0, JSON.stringify(m.ops));
  }

  // ── Dubbelen binnen één batch ───────────────────────────────────────────
  //
  // Een upsert kan niet twee rijen met dezelfde sleutel in dezelfde opdracht verwerken. De
  // aanroeper ontdubbelt daarom vooraf; dat gedrag moet blijven werken.

  console.log("\nOntdubbelen vooraf");
  {
    const metDubbelen = [
      { client_id: "c1", week_start: "2026-06-01", search_term: "beurs tickets", cost: 10 },
      { client_id: "c1", week_start: "2026-06-01", search_term: "beurs tickets", cost: 12 },
      { client_id: "c1", week_start: "2026-06-01", search_term: "beurs parkeren", cost: 5 },
    ];
    const uniek = dedup(metDubbelen, ["client_id", "week_start", "search_term"]);
    check("drie rijen worden er twee", uniek.length === 2, String(uniek.length));
    check("de laatste wint", (uniek.find((r) => r.search_term === "beurs tickets") as Record<string, unknown>).cost === 12);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

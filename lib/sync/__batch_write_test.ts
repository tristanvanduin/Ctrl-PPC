// De twee functies die bepalen of de historie van een klant blijft bestaan.
// Draaien: npx tsx lib/sync/__batch_write_test.ts
//
// DE FOUT DIE HIER IS DICHTGEZET
//
// replaceBatch verwijderde eerst alle rijen van de klant en keek daarna pas of er iets te
// schrijven viel. De 24 getters in lib/api/google-ads.ts eindigen allemaal op
// `catch { return []; }`, dus elke netwerkfout, quota-limiet of verlopen token leverde een lege
// array op. Die ging naar binnen, alles werd verwijderd, er kwam niets voor terug — en omdat
// syncDataset alleen op een throw let, werd de run als GESLAAGD geregistreerd.
//
// Zeventien tabellen gebruiken replaceBatch, waaronder ads_country_monthly. De verwijdering is
// niet op datum begrensd, dus het ging niet om het syncvenster maar om de hele historie.

import { replaceBatch, upsertBatch, dedup, getDateRange13Months } from "./orchestrator";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

/** Minimale Supabase-stub die noteert wat er gebeurt en fouten kan simuleren. */
function stub(opts: { insertError?: string; upsertError?: string } = {}) {
  const log: string[] = [];
  const client = {
    from(table: string) {
      return {
        delete() { return { eq(_c: string, id: string) { log.push(`DELETE ${table} client=${id}`); return Promise.resolve({ error: null }); } }; },
        insert(rows: unknown[]) { log.push(`INSERT ${table} n=${(rows as unknown[]).length}`); return Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null }); },
        upsert(rows: unknown[]) { log.push(`UPSERT ${table} n=${(rows as unknown[]).length}`); return Promise.resolve({ error: opts.upsertError ? { message: opts.upsertError } : null }); },
      };
    },
  };
  return { client: client as never, log };
}

const rij = (i: number) => ({ client_id: "k1", month: "2026-07-01", n: i });

async function main() {
  console.log("replaceBatch: een lege API-uitkomst mag niets wissen");
  {
    const { client, log } = stub();
    const n = await replaceBatch(client, "ads_country_monthly", [], "k1");
    check("schrijft niets", n === 0);
    check("en verwijdert niets", !log.some((l) => l.startsWith("DELETE")), log.join(" | "));
  }

  console.log("\nreplaceBatch: met rijen wél vervangen");
  {
    const { client, log } = stub();
    const n = await replaceBatch(client, "ads_country_monthly", [rij(1), rij(2)], "k1");
    check("schrijft de rijen", n === 2, String(n));
    check("verwijdert eerst", log[0] === "DELETE ads_country_monthly client=k1", log.join(" | "));
    check("en voegt daarna in", log[1] === "INSERT ads_country_monthly n=2", log.join(" | "));
  }

  console.log("\nreplaceBatch: chunkt boven de 500");
  {
    const { client, log } = stub();
    const veel = Array.from({ length: 1200 }, (_, i) => rij(i));
    const n = await replaceBatch(client, "t", veel, "k1");
    check("schrijft alles", n === 1200, String(n));
    check("in drie chunks", log.filter((l) => l.startsWith("INSERT")).length === 3, log.filter((l) => l.startsWith("INSERT")).join(" | "));
    check("maar verwijdert één keer", log.filter((l) => l.startsWith("DELETE")).length === 1);
  }

  console.log("\nEen mislukte schrijfactie mag niet als geslaagd tellen");
  {
    const { client } = stub({ insertError: "permission denied" });
    let gooide = false;
    try { await replaceBatch(client, "t", [rij(1)], "k1"); } catch { gooide = true; }
    // Na de delete is de tabel leeg; stil doorgaan zou "0 rijen, geslaagd" opleveren.
    check("replaceBatch gooit bij een insert-fout", gooide);
  }
  {
    const { client } = stub({ upsertError: "conflict" });
    let gooide = false;
    try { await upsertBatch(client, "t", [rij(1)], "client_id,month"); } catch { gooide = true; }
    check("upsertBatch gooit bij een upsert-fout", gooide);
  }

  console.log("\nupsertBatch: leeg is een no-op");
  {
    const { client, log } = stub();
    check("schrijft niets", (await upsertBatch(client, "t", [], "client_id,month")) === 0);
    check("en raakt de tabel niet aan", log.length === 0, log.join(" | "));
  }

  console.log("\ndedup houdt de laatste rij per sleutel");
  {
    const r = dedup([
      { client_id: "k", id: "a", v: 1 },
      { client_id: "k", id: "a", v: 2 },
      { client_id: "k", id: "b", v: 3 },
    ], ["client_id", "id"]);
    check("één rij per sleutel", r.length === 2, String(r.length));
    check("de laatste wint", r.find((x) => x.id === "a")?.v === 2);
    check("lege waarden botsen niet met elkaar", dedup([{ a: null, b: 1 }, { a: undefined, b: 2 }], ["a"]).length === 1);
  }


  console.log("\ngetDateRange13Months over de kalender");
  {
    // Deze berekening werkt met negatieve maandindices, Math.floor over negatieve getallen en een
    // magische +120 om te normaliseren. Hij is CORRECT -- 17.532 gemeten combinaties over vier
    // jaar en drie tijdzones, nul afwijkingen -- maar dat is niet af te lezen. Vandaar deze test:
    // niet omdat er iets stuk is, maar omdat dit het soort code is dat iemand ooit "opschoont".
    //
    // Hij rekent bewust in lokale datumdelen (zie de comment bij fmt) en gaat nooit door
    // toISOString. Dat is precies waarom hij standhoudt waar monthsAgo sneuvelde.
    const Echt = Date;
    const origineel = globalThis.Date;
    let nu = "";
    class Klok extends Echt {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(nu); else super(...(a as ConstructorParameters<typeof Date>));
      }
      static now(): number { return new Echt(nu).getTime(); }
    }
    (globalThis as unknown as { Date: typeof Date }).Date = Klok as unknown as typeof Date;

    const gevallen: Array<[string, string, string]> = [
      // klok                    startDate     endDate
      ["2026-01-01T12:00:00Z", "2024-11-01", "2026-01-01"], // jaargrens
      ["2026-07-27T12:00:00Z", "2025-05-01", "2026-07-27"],
      ["2026-03-31T12:00:00Z", "2025-01-01", "2026-03-31"], // maandeinde
      ["2028-02-29T12:00:00Z", "2026-12-01", "2028-02-29"], // schrikkeldag
      ["2028-12-31T12:00:00Z", "2027-10-01", "2028-12-31"],
    ];
    for (const [klok, vStart, vEind] of gevallen) {
      nu = klok;
      const r = getDateRange13Months();
      check(`${klok.slice(0, 10)} start`, r.startDate === vStart, `${r.startDate} != ${vStart}`);
      check(`${klok.slice(0, 10)} eind`, r.endDate === vEind, `${r.endDate} != ${vEind}`);
    }
    (globalThis as unknown as { Date: typeof Date }).Date = origineel;
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

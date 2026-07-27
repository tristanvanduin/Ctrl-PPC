// De mock-Supabase moet dezelfde ANTWOORDEN geven als Postgres, niet dezelfde features hebben.
// Draaien: npx tsx lib/demo/__mock_supabase_test.ts
//
// Aanleiding: .order() en .limit() werden genegeerd. Het patroon .order(desc).limit(1) betekent
// "pak de laatste rij" en gaf zo de eerste — de oudste. In de second opinion bepaalde die ene
// waarde de maand waarop tien andere queries filteren, waardoor negen controlepunten "geen data
// beschikbaar" meldden over een account dat de data gewoon heeft.

import { createDemoSupabase, isDemoClientValue } from "./mock-supabase";
import { DEMO_GREENTECH_ID as CID } from "./greentech-mock";

// De mock is getypeerd als SupabaseClient, maar we willen hem hier als kale keten aanspreken.
// Eén expliciete vorm is leesbaarder dan overal door `never` casten.
type Row = Record<string, unknown>;
interface Enkel extends PromiseLike<{ data: Row | null; error: unknown }> { /* na maybeSingle */ }
interface Keten extends PromiseLike<{ data: Row[]; error: unknown }> {
  select(...a: unknown[]): Keten;
  eq(kolom: string, waarde: unknown): Keten;
  order(kolom: string, opties?: { ascending?: boolean; nullsFirst?: boolean }): Keten;
  limit(n: number): Keten;
  range(van: number, tot: number): Keten;
  maybeSingle(): Enkel;
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const rijen = {
  t: [
    { client_id: CID, month: "2024-07-01", cost: 10, naam: "oud" },
    { client_id: CID, month: "2026-07-01", cost: 30, naam: "nieuw" },
    { client_id: CID, month: "2025-07-01", cost: 20, naam: "midden" },
    { client_id: CID, month: "2025-01-01", cost: null, naam: "zonder kosten" },
  ],
};

async function main() {
  const sb = createDemoSupabase(null, rijen) as unknown as { from: (t: string) => Keten };
  const q = (): Keten => sb.from("t").select("*").eq("client_id", CID);

  console.log("Sortering");
  const aflopend = (await q().order("month", { ascending: false })).data;
  check("aflopend geeft de nieuwste eerst", aflopend[0].naam === "nieuw", String(aflopend[0].naam));
  const oplopend = (await q().order("month", { ascending: true })).data;
  check("oplopend geeft de oudste eerst", oplopend[0].naam === "oud", String(oplopend[0].naam));
  check("standaard is oplopend", (await q().order("month")).data[0].naam === "oud");

  console.log("\nGetallen numeriek, niet als tekst");
  // De lege waarde staat bij aflopend vooraan (zie de nulls-controle hieronder), dus we kijken
  // naar de volgorde van de gevulde waarden.
  const opKosten = (await q().order("cost", { ascending: false })).data;
  const gevuld = opKosten.map((r) => r.cost).filter((c) => c != null);
  check("30 komt voor 20 en 10", JSON.stringify(gevuld) === "[30,20,10]", JSON.stringify(opKosten.map((r) => r.cost)));
  check("en niet als tekst gesorteerd", gevuld[0] === 30, "als tekst zou 30 na 10 komen");

  console.log("\nLege waarden zoals Postgres");
  const aflNull = (await q().order("cost", { ascending: false })).data;
  check("bij aflopend staan nulls vooraan", aflNull[0].cost == null, JSON.stringify(aflNull.map((r) => r.cost)));
  const oplNull = (await q().order("cost", { ascending: true })).data;
  check("bij oplopend staan nulls achteraan", oplNull[oplNull.length - 1].cost == null, JSON.stringify(oplNull.map((r) => r.cost)));

  console.log("\nAfkappen");
  const twee = (await q().order("month", { ascending: false }).limit(2)).data;
  check("limit(2) geeft twee rijen", twee.length === 2, String(twee.length));
  check("limit kapt ná het sorteren af", twee[0].naam === "nieuw" && twee[1].naam === "midden", JSON.stringify(twee.map((r) => r.naam)));
  const bereik = (await q().order("month", { ascending: true }).range(1, 2)).data;
  check("range(1,2) is inclusief en geeft twee rijen", bereik.length === 2 && bereik[0].naam === "zonder kosten", JSON.stringify(bereik.map((r) => r.naam)));

  console.log("\nHet patroon dat misging: laatste rij ophalen");
  const laatste = (await q().order("month", { ascending: false }).limit(1).maybeSingle()).data;
  check("maybeSingle na order+limit geeft de nieuwste", laatste?.month === "2026-07-01", String(laatste?.month));

  console.log("\nKlant-scoping blijft staan");
  const ander = (await sb.from("t").select("*").eq("client_id", "andere-klant")).data;
  check("een andere klant krijgt geen demo-rijen", (ander ?? []).length === 0, JSON.stringify(ander));
  check("isDemoClientValue kent de gads-variant", isDemoClientValue(`gads-${CID}`) && isDemoClientValue(CID));
  check("en wijst de rest af", !isDemoClientValue("iets-anders") && !isDemoClientValue(null));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

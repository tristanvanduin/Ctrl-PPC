// De opruimstap van de demo-seeders: alleen demo, alleen het eigen account, alle vijf de
// geprojecteerde tabellen, en een fout is een fout.
// Draaien: npx tsx lib/demo/__projectie_opruimen_test.ts

import { wisDemoProjectie, isDemoKlantId, GEPROJECTEERDE_TABELLEN } from "./projectie-opruimen";
import { FakeSupabase } from "../decision/__fake_supabase";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

async function main() {
  console.log("isDemoKlantId");
  check("demo-greentech is demo", isDemoKlantId("demo-greentech"));
  check("demo-gra is demo", isDemoKlantId("demo-gra"));
  check("gads-123 is geen demo", !isDemoKlantId("gads-1426896617"));
  check("een id dat 'demo' alleen bevat is geen demo", !isDemoKlantId("gads-demo-1") && !isDemoKlantId("demogreentech") && !isDemoKlantId("demo-"));

  console.log("wisDemoProjectie");
  const sb = new FakeSupabase();
  sb.seed("accounts", [{ id: "acc-demo", client_id: "demo-greentech" }, { id: "acc-echt", client_id: "gads-1" }]);
  for (const t of GEPROJECTEERDE_TABELLEN) {
    sb.seed(t, [{ account_id: "acc-demo", x: 1 }, { account_id: "acc-demo", x: 2 }, { account_id: "acc-echt", x: 3 }]);
  }
  const verslag = await wisDemoProjectie(sb as never, "demo-greentech");
  check("het demo-account gevonden", verslag.accountIds.join(",") === "acc-demo", JSON.stringify(verslag.accountIds));
  for (const t of GEPROJECTEERDE_TABELLEN) {
    const rest = sb.tables[t] ?? [];
    check(`${t}: demo weg, echte klant onaangeroerd`, rest.length === 1 && rest[0].account_id === "acc-echt", JSON.stringify(rest));
  }
  check("vijf tabellen gemeld", verslag.tabellen.length === 5);

  let weigering: unknown = null;
  try { await wisDemoProjectie(sb as never, "gads-1"); } catch (e) { weigering = e; }
  check("weigert een echte klant, voordat er iets gelezen wordt", weigering instanceof Error && String((weigering as Error).message).includes("weigert"));
  check("de echte klant staat er nog", (sb.tables["fact_core"] ?? []).some((r) => r.account_id === "acc-echt"));

  const leeg = await wisDemoProjectie(new FakeSupabase() as never, "demo-onbekend");
  check("demo-klant zonder account: niets te doen, geen fout", leeg.accountIds.length === 0 && leeg.tabellen.length === 0);

  const kapot = new FakeSupabase();
  kapot.seed("accounts", [{ id: "acc-demo", client_id: "demo-greentech" }]);
  kapot.faalOp("meta_metrics", "permission denied");
  let fout: unknown = null;
  try { await wisDemoProjectie(kapot as never, "demo-greentech"); } catch (e) { fout = e; }
  check("een wisfout gooit, met tabel en reden", fout instanceof Error && (fout as Error).message.includes("meta_metrics") && (fout as Error).message.includes("permission denied"), String(fout));

  const accFout = new FakeSupabase();
  accFout.faalOp("accounts", "relation does not exist");
  let fout2: unknown = null;
  try { await wisDemoProjectie(accFout as never, "demo-greentech"); } catch (e) { fout2 = e; }
  check("een leesfout op accounts gooit", fout2 instanceof Error && (fout2 as Error).message.includes("accounts"));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

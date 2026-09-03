// De projectie naar fact_core: aangeroepen met de klant, en een fout komt terug in plaats van
// gegooid of geslikt. Draaien: npx tsx lib/sync/__projectie_test.ts

import { projecteerNaarFactCore, PROJECTIE_FUNCTIE } from "./projectie";
import { FakeSupabase } from "../decision/__fake_supabase";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

async function main() {
  const sb = new FakeSupabase();
  const ok = await projecteerNaarFactCore(sb as never, "k1");
  check("geslaagd, functie aangeroepen met p_client_id", ok.ok && sb.rpcAanroepen.length === 1 && sb.rpcAanroepen[0].naam === PROJECTIE_FUNCTIE && sb.rpcAanroepen[0].args?.p_client_id === "k1", JSON.stringify(sb.rpcAanroepen));

  const kapot = new FakeSupabase();
  kapot.faalOp(`rpc:${PROJECTIE_FUNCTIE}`, "permission denied for function refresh_fact_from_legacy");
  const fout = await projecteerNaarFactCore(kapot as never, "k1");
  check("fout komt terug met de functienaam en de reden", !fout.ok && fout.fout.includes(PROJECTIE_FUNCTIE) && fout.fout.includes("permission denied"), JSON.stringify(fout));

  const gooit = { rpc: async () => { throw new Error("fetch failed"); } };
  const worp = await projecteerNaarFactCore(gooit as never, "k1");
  check("een worp uit de client wordt een fout, geen crash", !worp.ok && worp.fout.includes("fetch failed"));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

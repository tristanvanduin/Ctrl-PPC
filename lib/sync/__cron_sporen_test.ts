// Bewijst dat een overgeslagen sync een spoor achterlaat, en dat een schrijffout daarbij gemeld
// wordt in plaats van geslikt. Draaien: npx tsx lib/sync/__cron_sporen_test.ts

import { noteerOvergeslagenSync } from "./cron-sporen";
import { FakeSupabase } from "../decision/__fake_supabase";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

async function main() {
  const sb = new FakeSupabase();
  const uit = await noteerOvergeslagenSync(sb as never, { clientId: "k1", customerId: "123", reden: "geen credentials" });
  check("lukt", uit.ok === true && uit.fout === null);
  const runs = sb.tables["sync_runs"] ?? [];
  check("één failed-run met de reden", runs.length === 1 && runs[0].status === "failed" && runs[0].error_summary === "geen credentials" && runs[0].triggered_by === "cron", JSON.stringify(runs));
  const status = sb.tables["client_sync_status"] ?? [];
  check("statusrij op failed/stale, zonder last_successful_sync_at te overschrijven", status.length === 1 && status[0].last_sync_status === "failed" && status[0].freshness_status === "stale" && !("last_successful_sync_at" in status[0]), JSON.stringify(status));

  const kapot = new FakeSupabase();
  kapot.faalOp("sync_runs", "permission denied");
  const fout = await noteerOvergeslagenSync(kapot as never, { clientId: "k2", customerId: null, reden: "x" });
  check("schrijffout wordt gemeld, niet geslikt", fout.ok === false && (fout.fout ?? "").includes("permission"));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

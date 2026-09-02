// De beslis-kern tegen een in-memory database: providers, oogst en observaties. Bewijst de vier
// herbouwprincipes op de plek waar de audit ze geschonden vond: een kapotte query gooit (geen
// "geen signalen"), niet-gemeten en niet-beschikbaar blijven uit elkaar, het datavenster komt
// uit de rijen, en een observatie zonder bureau-uuid wordt gemeld in plaats van stil weggegooid.
// Draaien: npx tsx lib/decision/__signaal_oogst_test.ts

import { FakeSupabase } from "./__fake_supabase";
import { registerProvider } from "./channel-provider";
import { googleProvider } from "./providers/google-provider";
import { metaProvider } from "./providers/meta-provider";
import { linkedinProvider } from "./providers/linkedin-provider";
import { verzamelSignalen } from "./signaal-oogst";
import { signalHypothesisDiscovery } from "./signal-hypothesis-discovery";
import { classify } from "./hypothesis-discovery";
import { recordGateObservations } from "./gate-observations";
import { DataLaagFout } from "@/lib/analysis/db-veilig";
import { WASTE_MIN_CLICKS } from "@/lib/signals/google-schedule";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

registerProvider(googleProvider);
registerProvider(metaProvider);
registerProvider(linkedinProvider);

const KLANT = "klant-1";
const BUREAU = "d825eab8-ec2c-4898-a309-a45addcbda03";
const DAGEN = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/** Een week × 24 uur schedule-data met één dood dagdeel (zondag 2-4 uur: veel klikken, nul conversies). */
function scheduleRijen(): Record<string, unknown>[] {
  const rijen: Record<string, unknown>[] = [];
  for (const dag of DAGEN) {
    for (let uur = 0; uur < 24; uur++) {
      const dood = dag === "SUNDAY" && uur >= 2 && uur <= 4;
      rijen.push({
        id: `${dag}-${uur}`, client_id: KLANT, day_of_week: dag, hour_of_day: uur,
        cost: dood ? 60 : 10, clicks: dood ? WASTE_MIN_CLICKS + 5 : 20, conversions: dood ? 0 : 1,
        period_start: "2025-07-01", period_end: "2026-08-31",
      });
    }
  }
  return rijen;
}

async function main() {
  console.log("verzamelSignalen: gemeten / niet gemeten / niet beschikbaar");
  {
    const sb = new FakeSupabase();
    sb.seed("ads_account_monthly", [{ client_id: KLANT, month: "2026-08-01" }]);
    sb.seed("meta_account_daily", [{ client_id: KLANT, date: "2026-08-15" }]);
    sb.seed("ads_ad_schedule_performance", scheduleRijen());
    const oogst = await verzamelSignalen(sb as never, BUREAU, KLANT, "weekly");
    check("google is gemeten", oogst.gemeten.some((k) => k.channel === "google"), JSON.stringify(oogst.gemeten));
    check("meta heeft data maar geen detector: niet gemeten", oogst.nietGemeten.includes("meta"));
    check("linkedin heeft geen data: niet beschikbaar", oogst.nietBeschikbaar.includes("linkedin"));
    check("het venster komt uit de rijen, niet uit de wandklok", oogst.gemeten[0]?.venster.start === "2025-07-01" && oogst.gemeten[0]?.venster.eind === "2026-08-31");
    check("het dode dagdeel levert een signaal", oogst.signalen.length === 1 && oogst.signalen[0].id === "schedule_waste", JSON.stringify(oogst.signalen));
    check("het signaal draagt de detectorcategorie", oogst.signalen[0]?.category === "budget_pacing");
    const [hyp] = signalHypothesisDiscovery.discover({ agencyId: BUREAU, accountId: KLANT, signals: oogst.signalen, causes: [] });
    check("de hypothese classificeert als budget, niet als null", classify(hyp) === "budget");
  }

  console.log("verzamelSignalen: een kapotte query gooit, geen 'geen signalen'");
  {
    const sb = new FakeSupabase();
    sb.seed("ads_account_monthly", [{ client_id: KLANT, month: "2026-08-01" }]);
    sb.faalOp("ads_ad_schedule_performance", "column hour_of_day does not exist");
    let fout: unknown = null;
    try { await verzamelSignalen(sb as never, BUREAU, KLANT, "weekly"); } catch (e) { fout = e; }
    check("DataLaagFout met de bron erin", fout instanceof DataLaagFout && String(fout).includes("ads_ad_schedule_performance"), String(fout));

    const sb2 = new FakeSupabase();
    sb2.faalOp("ads_account_monthly", "permission denied");
    let fout2: unknown = null;
    try { await verzamelSignalen(sb2 as never, BUREAU, KLANT, "weekly"); } catch (e) { fout2 = e; }
    check("ook de beschikbaarheidscheck gooit bij een queryfout", fout2 instanceof DataLaagFout);
  }

  console.log("verzamelSignalen: klant zonder enige data");
  {
    const oogst = await verzamelSignalen(new FakeSupabase() as never, BUREAU, KLANT, "biweekly");
    check("alle drie niet beschikbaar, geen signalen, geen gemeten kanaal", oogst.nietBeschikbaar.length === 3 && oogst.gemeten.length === 0 && oogst.signalen.length === 0);
  }

  console.log("recordGateObservations: uuid-eis en uitkomst");
  {
    const sb = new FakeSupabase();
    const geen = await recordGateObservations(sb as never, { runId: "r1", agencyId: "onbekend", accountId: KLANT, analysisDate: "2026-09-01" });
    check("zonder bureau-uuid: niets geschreven, reden genoemd", geen.geschreven === 0 && (geen.overgeslagen ?? "").includes("bureau-uuid"), JSON.stringify(geen));
    check("en er is geen rij geprobeerd", (sb.tables["quality_gate_observations"] ?? []).length === 0);

    const ok = await recordGateObservations(sb as never, { runId: "r2", agencyId: BUREAU, accountId: KLANT, analysisDate: "2026-09-01" });
    check("met bureau-uuid: negen observaties geschreven", ok.geschreven === 9 && ok.overgeslagen === null && (sb.tables["quality_gate_observations"] ?? []).length === 9, JSON.stringify(ok));

    const kapot = new FakeSupabase();
    kapot.faalOp("quality_gate_observations", "relation does not exist");
    const fout = await recordGateObservations(kapot as never, { runId: "r3", agencyId: BUREAU, accountId: KLANT, analysisDate: "2026-09-01" });
    check("insertfout komt als tekst terug, gooit niet", fout.geschreven === 0 && (fout.overgeslagen ?? "").includes("relation"));
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

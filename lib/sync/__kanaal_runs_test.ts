// Bewijst de eerlijkheidsregels van de kanaalruns (zie de kop van kanaal-runs.ts): een
// queryfout op de koppelingstabel is een fout, "disabled" synct niet, geen credentials en een
// dode token laten een failed-run-rij na, en een run zonder administratie begint niet.
// Netwerk wordt op fetch-niveau nagebootst; er gaat niets naar buiten.
// Draaien: npx tsx lib/sync/__kanaal_runs_test.ts

import { draaiMetaSync, draaiLinkedinSync, draaiMicrosoftSync, kanaalKoppelingen, noteerKanaalRunMislukt } from "./kanaal-runs";
import { FakeSupabase } from "../decision/__fake_supabase";
import { DataLaagFout } from "../analysis/db-veilig";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const ENV_SLEUTELS = [
  "META_ADS_APP_ID", "META_ADS_APP_SECRET", "META_ADS_ACCESS_TOKEN",
  "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REFRESH_TOKEN",
  "MICROSOFT_ADS_CLIENT_ID", "MICROSOFT_ADS_CLIENT_SECRET", "MICROSOFT_ADS_DEVELOPER_TOKEN", "MICROSOFT_ADS_REFRESH_TOKEN", "MICROSOFT_ADS_CUSTOMER_ID",
];
function zonderOmgevingsCredentials(): void {
  for (const k of ENV_SLEUTELS) delete process.env[k];
}

const echteFetch = globalThis.fetch;
function fetchGeeft(body: unknown, status = 200): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

async function main() {
  zonderOmgevingsCredentials();

  console.log("koppelingstabel: queryfout is een fout, geen koppeling is geen koppeling");
  {
    const kapot = new FakeSupabase();
    kapot.faalOp("meta_connections", "permission denied for table meta_connections");
    let fout: unknown = null;
    try { await draaiMetaSync(kapot as never, "k1", "daily"); } catch (e) { fout = e; }
    check("meta: queryfout gooit DataLaagFout met de tabelnaam", fout instanceof DataLaagFout && (fout as Error).message.includes("meta_connections"), String(fout));

    const leeg = new FakeSupabase();
    const geen = await draaiMetaSync(leeg as never, "k1", "daily");
    check("meta: zonder rij is het geen_koppeling", geen.soort === "geen_koppeling");
    check("meta: geen_koppeling laat geen run-rij na (er is niets om te draaien)", (leeg.tables["meta_sync_runs"] ?? []).length === 0);

    const uit = new FakeSupabase();
    uit.seed("meta_connections", [{ client_id: "k1", ad_account_id: "123", status: "disabled" }]);
    const disabled = await draaiMetaSync(uit as never, "k1", "daily");
    check("meta: disabled synct ook handmatig niet", disabled.soort === "geen_koppeling" && disabled.melding.includes("uit"), JSON.stringify(disabled));

    const li = new FakeSupabase();
    li.faalOp("linkedin_connections", "relation does not exist");
    let liFout: unknown = null;
    try { await draaiLinkedinSync(li as never, "k1", "daily"); } catch (e) { liFout = e; }
    check("linkedin: queryfout gooit DataLaagFout", liFout instanceof DataLaagFout);

    const ms = new FakeSupabase();
    ms.seed("microsoft_connections", [{ client_id: "k1", account_id: "555", customer_id: "9", status: "disabled" }]);
    const msUit = await draaiMicrosoftSync(ms as never, "k1", "daily");
    check("microsoft: disabled synct niet", msUit.soort === "geen_koppeling" && msUit.melding.includes("uit"));
  }

  console.log("geen credentials: een failed-run-rij met de reden, per kanaal");
  {
    const sb = new FakeSupabase();
    sb.seed("meta_connections", [{ client_id: "k1", ad_account_id: "123", status: "active" }]);
    sb.seed("linkedin_connections", [{ client_id: "k1", ad_account_urn: "urn:li:sponsoredAccount:1", status: "active" }]);
    sb.seed("microsoft_connections", [{ client_id: "k1", account_id: "555", customer_id: "9", status: "active" }]);
    const meta = await draaiMetaSync(sb as never, "k1", "backfill");
    const linkedin = await draaiLinkedinSync(sb as never, "k1", "daily");
    const microsoft = await draaiMicrosoftSync(sb as never, "k1", "daily");
    check("alle drie: geen_credentials", meta.soort === "geen_credentials" && linkedin.soort === "geen_credentials" && microsoft.soort === "geen_credentials", JSON.stringify([meta, linkedin, microsoft]));
    const metaMelding = meta.soort === "klaar" ? "" : meta.melding;
    check("meta: melding zegt waar de credentials horen te staan", metaMelding.includes("agency_connections") && metaMelding.includes("META_ADS_ACCESS_TOKEN"), metaMelding);
    for (const [tabel, scope] of [["meta_sync_runs", "backfill"], ["linkedin_sync_runs", "daily"], ["microsoft_sync_runs", "daily"]] as const) {
      const runs = sb.tables[tabel] ?? [];
      check(`${tabel}: één failed-run met reden, scope ${scope} en einde`, runs.length === 1 && runs[0].status === "failed" && String(runs[0].error).includes("credentials") && runs[0].scope === scope && typeof runs[0].finished_at === "string", JSON.stringify(runs));
    }
    check("de koppelingsrij zelf blijft active (het is geen tokenprobleem van de klant)", (sb.tables["meta_connections"] ?? [])[0]?.status === "active");
  }

  console.log("dode token: koppeling op expired, failed-run-rij, geen sync gestart");
  {
    process.env.META_ADS_APP_ID = "app";
    process.env.META_ADS_APP_SECRET = "geheim";
    process.env.META_ADS_ACCESS_TOKEN = "dood";
    fetchGeeft({ error: { code: 190, message: "Error validating access token: Session has expired" } });
    const sb = new FakeSupabase();
    sb.seed("meta_connections", [{ client_id: "k1", ad_account_id: "act_123", status: "active", last_sync_at: "2026-04-17T04:00:00Z" }]);
    const uit = await draaiMetaSync(sb as never, "k1", "daily");
    check("token_probleem met de Graph-melding", uit.soort === "token_probleem" && uit.melding.includes("expired"), JSON.stringify(uit));
    const conn = (sb.tables["meta_connections"] ?? [])[0];
    check("koppeling op expired met last_error, last_sync_at onaangeroerd", conn.status === "expired" && String(conn.last_error).includes("expired") && conn.last_sync_at === "2026-04-17T04:00:00Z", JSON.stringify(conn));
    const runs = sb.tables["meta_sync_runs"] ?? [];
    check("failed-run-rij met de preflight-reden", runs.length === 1 && runs[0].status === "failed" && String(runs[0].error).includes("preflight"), JSON.stringify(runs));
  }

  console.log("run-administratie: een mislukte insert van de run-rij breekt de run af");
  {
    fetchGeeft({ account_status: 1 });
    const sb = new FakeSupabase();
    sb.seed("meta_connections", [{ client_id: "k1", ad_account_id: "act_123", status: "active" }]);
    sb.faalOp("meta_sync_runs", "permission denied for table meta_sync_runs");
    let fout: unknown = null;
    try { await draaiMetaSync(sb as never, "k1", "daily"); } catch (e) { fout = e; }
    check("DataLaagFout met 'run starten'", fout instanceof DataLaagFout && (fout as Error).message.includes("run starten"), String(fout));
    const uit = await noteerKanaalRunMislukt(sb as never, "meta_sync_runs", "k1", "daily", "x");
    check("noteerKanaalRunMislukt slikt zijn eigen schrijffout (logt), gooit niet", uit === undefined);
  }
  globalThis.fetch = echteFetch;
  zonderOmgevingsCredentials();

  console.log("bedrading: de projectie naar fact_core zit in elke kanaalsync en in de Google-sync");
  {
    // Een volledige Meta-run nabootsen vergt elf async-rapportjobs; deze bedradingstest bewaakt
    // het ene dat er niet uit mag vallen: sinds migratie 054 ziet de app een sync pas na de
    // projectie (lib/sync/projectie.ts).
    const fs = await import("node:fs");
    const path = await import("node:path");
    // __dirname bestaat in de CJS-modus van tsx; anders vanaf de repo-root (de testrunner).
    const hier = typeof __dirname === "string" ? __dirname : path.join(process.cwd(), "lib", "sync");
    const kanaalBron = fs.readFileSync(path.join(hier, "kanaal-runs.ts"), "utf8");
    const aanroepen = kanaalBron.split("projecteerNaarFactCore(").length - 1;
    check("kanaal-runs: Meta én LinkedIn projecteren (twee aanroepen)", aanroepen === 2, String(aanroepen));
    const metaNaProjectie = kanaalBron.indexOf("projecteerNaarFactCore(") < kanaalBron.indexOf('schrijfRun(supabase, "meta_sync_runs"');
    check("meta: de projectie loopt vóór de run-administratie, zodat een projectiefout de run failed maakt", metaNaProjectie);
    const orchestratorBron = fs.readFileSync(path.join(hier, "orchestrator.ts"), "utf8");
    check("google: de projectie is een dataset-resultaat vóór de statusberekening", orchestratorBron.indexOf('name: "fact_core_projectie"') > 0 && orchestratorBron.indexOf('name: "fact_core_projectie"') < orchestratorBron.indexOf("// ── Compute result ──"));
    check("google: geen losse rpc-aanroep meer die alleen logt", !orchestratorBron.includes('supabase.rpc("refresh_fact_from_legacy"'));
  }

  console.log("kanaalKoppelingen: paren zonder disabled, en een onleesbare tabel als fout");
  {
    const sb = new FakeSupabase();
    sb.seed("meta_connections", [
      { client_id: "k1", ad_account_id: "1", status: "active" },
      { client_id: "k2", ad_account_id: "2", status: "expired" },
      { client_id: "k3", ad_account_id: "3", status: "disabled" },
    ]);
    sb.seed("microsoft_connections", [{ client_id: "k1", account_id: "5", status: "active" }]);
    sb.faalOp("linkedin_connections", "relation \"linkedin_connections\" does not exist");
    const { paren, fouten } = await kanaalKoppelingen(sb as never);
    const sleutels = paren.map((p) => `${p.kanaal}:${p.clientId}`).sort();
    check("active en expired doen mee, disabled niet", JSON.stringify(sleutels) === JSON.stringify(["meta:k1", "meta:k2", "microsoft:k1"]), JSON.stringify(sleutels));
    check("de onleesbare tabel staat in fouten, met de tabelnaam", fouten.length === 1 && fouten[0].includes("linkedin_connections"), JSON.stringify(fouten));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

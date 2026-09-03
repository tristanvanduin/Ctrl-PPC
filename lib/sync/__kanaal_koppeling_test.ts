// De kanaalkoppeling per klant: normaliseren, valideren, de rij, schrijven/uitzetten op de fake,
// het overzicht, de bureaukant, en de accountlijsten met nagebootste platform-antwoorden.
// Draaien: npx tsx lib/sync/__kanaal_koppeling_test.ts

import {
  normaliseerAccountId, valideerKoppelVerzoek, koppelRij, koppelKanaal, ontkoppelKanaal,
  leesKanaalKoppelingen, bureauKoppelingStand, omgevingHeeftCredentials,
} from "./kanaal-koppeling";
import { kanaalAccounts, classificeerApiFout } from "./kanaal-accounts";
import { fetchAdAccounts } from "../linkedin/entities";
import { fetchMicrosoftAccounts } from "../microsoft/api";
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
function zonderOmgevingsCredentials(): void { for (const k of ENV_SLEUTELS) delete process.env[k]; }
const echteFetch = globalThis.fetch;
function fetchGeeft(body: unknown, status = 200): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

async function main() {
  zonderOmgevingsCredentials();

  console.log("normaliseerAccountId: de drie vormen");
  {
    check("meta: cijfers krijgen act_", normaliseerAccountId("meta", " 123456 ") === "act_123456");
    check("meta: act_ blijft", normaliseerAccountId("meta", "act_123456") === "act_123456");
    check("meta: letters zijn geen id", normaliseerAccountId("meta", "act_abc") === null);
    check("linkedin: cijfers worden een URN", normaliseerAccountId("linkedin", "5085") === "urn:li:sponsoredAccount:5085");
    check("linkedin: URN blijft", normaliseerAccountId("linkedin", "urn:li:sponsoredAccount:5085") === "urn:li:sponsoredAccount:5085");
    check("microsoft: alleen cijfers", normaliseerAccountId("microsoft", "1234567") === "1234567" && normaliseerAccountId("microsoft", "act_1") === null);
    check("geen string is null", normaliseerAccountId("meta", 123) === null);
  }

  console.log("valideerKoppelVerzoek");
  {
    check("geen object", !valideerKoppelVerzoek(null).ok);
    check("client_id ontbreekt", !valideerKoppelVerzoek({ kanaal: "meta", account_id: "1234" }).ok);
    const kanaal = valideerKoppelVerzoek({ client_id: "k1", kanaal: "tiktok", account_id: "1234" });
    check("onbekend kanaal noemt de geldige", !kanaal.ok && kanaal.fout.includes("meta, linkedin, microsoft"), JSON.stringify(kanaal));
    const id = valideerKoppelVerzoek({ client_id: "k1", kanaal: "meta", account_id: "abc" });
    check("ongeldig account_id noemt de verwachte vorm", !id.ok && id.fout.includes("act_"), JSON.stringify(id));
    const ok = valideerKoppelVerzoek({ client_id: " k1 ", kanaal: "meta", account_id: "1234", currency: "eur" });
    check("geldig meta-verzoek: id genormaliseerd, valuta hoofdletters", ok.ok && ok.verzoek.clientId === "k1" && ok.verzoek.accountId === "act_1234" && ok.verzoek.valuta === "EUR", JSON.stringify(ok));
    const ms = valideerKoppelVerzoek({ client_id: "k1", kanaal: "microsoft", account_id: "1234567", customer_id: 987654 });
    check("microsoft met numeriek customer_id", ms.ok && ms.verzoek.customerId === "987654", JSON.stringify(ms));
    const msFout = valideerKoppelVerzoek({ client_id: "k1", kanaal: "microsoft", account_id: "1234567", customer_id: "x" });
    check("ongeldig customer_id", !msFout.ok);
    const valuta = valideerKoppelVerzoek({ client_id: "k1", kanaal: "linkedin", account_id: "5085", currency: "euro" });
    check("ongeldige valuta", !valuta.ok);
  }

  console.log("koppelRij: de tabel en de kolommen per kanaal");
  {
    const meta = koppelRij({ clientId: "k1", kanaal: "meta", accountId: "act_1", customerId: null, valuta: "EUR" }, "2026-09-03T10:00:00Z");
    check("meta: ad_account_id + token_ref 'bureau' (NOT NULL-kolom uit het oude ontwerp)", meta.tabel === "meta_connections" && meta.rij.ad_account_id === "act_1" && meta.rij.token_ref === "bureau" && meta.rij.status === "active", JSON.stringify(meta));
    const li = koppelRij({ clientId: "k1", kanaal: "linkedin", accountId: "urn:li:sponsoredAccount:1", customerId: null, valuta: null }, "2026-09-03T10:00:00Z");
    check("linkedin: ad_account_urn", li.tabel === "linkedin_connections" && li.rij.ad_account_urn === "urn:li:sponsoredAccount:1" && !("token_ref" in li.rij));
    const ms = koppelRij({ clientId: "k1", kanaal: "microsoft", accountId: "555", customerId: "9", valuta: null }, "2026-09-03T10:00:00Z");
    check("microsoft: account_id + customer_id", ms.tabel === "microsoft_connections" && ms.rij.account_id === "555" && ms.rij.customer_id === "9");
  }

  console.log("koppelKanaal / ontkoppelKanaal op de fake");
  {
    const sb = new FakeSupabase();
    await koppelKanaal(sb as never, { clientId: "k1", kanaal: "meta", accountId: "act_1", customerId: null, valuta: "EUR" });
    const rij = (sb.tables["meta_connections"] ?? [])[0];
    check("rij geschreven met status active", rij && rij.client_id === "k1" && rij.status === "active" && rij.last_error === null, JSON.stringify(rij));
    const uit = await ontkoppelKanaal(sb as never, "k1", "meta");
    check("ontkoppelen: gevonden, status disabled, reden in last_error", uit.gevonden && rij.status === "disabled" && String(rij.last_error).includes("ontkoppeld"), JSON.stringify(rij));
    const niet = await ontkoppelKanaal(sb as never, "onbekend", "linkedin");
    check("ontkoppelen zonder rij: niet gevonden", niet.gevonden === false);
    const kapot = new FakeSupabase();
    kapot.faalOp("linkedin_connections", "permission denied");
    let fout: unknown = null;
    try { await koppelKanaal(kapot as never, { clientId: "k1", kanaal: "linkedin", accountId: "urn:li:sponsoredAccount:1", customerId: null, valuta: null }); } catch (e) { fout = e; }
    check("schrijffout is een DataLaagFout met de tabel", fout instanceof DataLaagFout && (fout as Error).message.includes("linkedin_connections"), String(fout));
  }

  console.log("leesKanaalKoppelingen: rij, laatste run, dagstand per kanaal");
  {
    const sb = new FakeSupabase();
    sb.seed("meta_connections", [{ client_id: "k1", ad_account_id: "act_1", status: "active", last_sync_at: "2026-09-02T04:00:00Z", last_error: null, currency: "EUR" }]);
    sb.seed("meta_sync_runs", [
      { client_id: "k1", status: "completed", started_at: "2026-09-01T04:00:00Z", error: null },
      { client_id: "k1", status: "failed", started_at: "2026-09-02T04:00:00Z", error: "invariant: x" },
    ]);
    sb.seed("meta_account_daily", [{ client_id: "k1", date: "2026-09-01" }]);
    sb.seed("microsoft_connections", [{ client_id: "k1", account_id: "555", customer_id: "9", status: "disabled", last_sync_at: null, last_error: "ontkoppeld", currency: null }]);
    const stand = await leesKanaalKoppelingen(sb as never, "k1");
    const meta = stand.find((s) => s.kanaal === "meta")!;
    const li = stand.find((s) => s.kanaal === "linkedin")!;
    const ms = stand.find((s) => s.kanaal === "microsoft")!;
    check("drie kanalen, in vaste volgorde", stand.map((s) => s.kanaal).join(",") === "meta,linkedin,microsoft");
    check("meta: gekoppeld met account, sync en valuta", meta.gekoppeld && meta.accountId === "act_1" && meta.laatsteSync === "2026-09-02T04:00:00Z" && meta.valuta === "EUR", JSON.stringify(meta));
    check("meta: de NIEUWSTE run (failed) met fout", meta.laatsteRun?.status === "failed" && meta.laatsteRun.fout === "invariant: x", JSON.stringify(meta.laatsteRun));
    check("meta: dagstand uit de dagtabel", meta.dagstand.laatsteDag === "2026-09-01" && meta.dagstand.laatsteGeslaagdeSync === "2026-09-02T04:00:00Z", JSON.stringify(meta.dagstand));
    check("linkedin: niets gekoppeld, geen run, dagstand geen", !li.gekoppeld && li.accountId === null && li.laatsteRun === null && li.dagstand.toestand === "geen");
    check("microsoft: disabled telt als niet gekoppeld, maar de rij is zichtbaar", !ms.gekoppeld && ms.status === "disabled" && ms.accountId === "555" && ms.customerId === "9", JSON.stringify(ms));
    const kapot = new FakeSupabase();
    kapot.faalOp("linkedin_sync_runs", "relation does not exist");
    let fout: unknown = null;
    try { await leesKanaalKoppelingen(kapot as never, "k1"); } catch (e) { fout = e; }
    check("een onleesbare runs-tabel is een DataLaagFout", fout instanceof DataLaagFout && (fout as Error).message.includes("linkedin_sync_runs"));
  }

  console.log("bureauKoppelingStand: bureau-OAuth of omgevingsterugval");
  {
    check("omgeving zonder sleutels: niets", !omgevingHeeftCredentials("meta", {}) && !omgevingHeeftCredentials("linkedin", {}) && !omgevingHeeftCredentials("microsoft", {}));
    check("omgeving meta compleet", omgevingHeeftCredentials("meta", { META_ADS_APP_ID: "a", META_ADS_APP_SECRET: "b", META_ADS_ACCESS_TOKEN: "c" }));
    check("omgeving microsoft zonder developer token is niet compleet", !omgevingHeeftCredentials("microsoft", { MICROSOFT_ADS_CLIENT_ID: "a", MICROSOFT_ADS_CLIENT_SECRET: "b", MICROSOFT_ADS_REFRESH_TOKEN: "c" }));

    const sb = new FakeSupabase();
    sb.seed("accounts", [{ id: "uuid-1", client_id: "k1", name: "Klant", source: "meta", external_id: null, agency_id: "b1" }]);
    sb.seed("agency_connections", [
      { agency_id: "b1", provider: "meta", external_id: null, token_ref: "oauth_meta_b1", scopes: ["ads_read"], status: "actief", expires_at: null, connected_at: null, last_refreshed_at: null, last_error: null },
      { agency_id: "b1", provider: "linkedin", external_id: null, token_ref: null, scopes: [], status: "ingetrokken", expires_at: null, connected_at: null, last_refreshed_at: null, last_error: "x" },
    ]);
    process.env.MICROSOFT_ADS_CLIENT_ID = "a"; process.env.MICROSOFT_ADS_CLIENT_SECRET = "b";
    process.env.MICROSOFT_ADS_DEVELOPER_TOKEN = "c"; process.env.MICROSOFT_ADS_REFRESH_TOKEN = "d";
    const stand = await bureauKoppelingStand(sb as never, "k1");
    check("agencyId uit accounts", stand.agencyId === "b1");
    check("meta: bureau actief met token → bruikbaar, bron bureau", stand.perKanaal.meta.bruikbaar && stand.perKanaal.meta.bron === "bureau" && stand.perKanaal.meta.status === "actief", JSON.stringify(stand.perKanaal.meta));
    check("linkedin: ingetrokken zonder token → niet bruikbaar", !stand.perKanaal.linkedin.bruikbaar && stand.perKanaal.linkedin.status === "ingetrokken" && stand.perKanaal.linkedin.bron === null);
    check("microsoft: geen bureaurij maar omgeving compleet → bron omgeving", stand.perKanaal.microsoft.bruikbaar && stand.perKanaal.microsoft.bron === "omgeving" && stand.perKanaal.microsoft.status === null);
    const zonderKlant = await bureauKoppelingStand(new FakeSupabase() as never, "onbekend");
    check("onbekende klant: geen bureau, alleen de omgeving telt", zonderKlant.agencyId === null && !zonderKlant.perKanaal.meta.bruikbaar && zonderKlant.perKanaal.microsoft.bron === "omgeving");
    zonderOmgevingsCredentials();
  }

  console.log("accountlijsten: de platform-antwoorden vertaald, fouten benoemd");
  {
    check("classificatie: 401 en 'access token' zijn tokenproblemen", classificeerApiFout("Meta Ads API error (400): Error validating access token") === "token_probleem" && classificeerApiFout("LinkedIn adAccounts 401: x") === "token_probleem" && classificeerApiFout("Microsoft API 500 op AccountsInfo/Query: boem") === "api_fout");

    const sb = new FakeSupabase();
    const geen = await kanaalAccounts(sb as never, "k1", "meta");
    check("meta zonder credentials: geen_credentials met de weg erbij", !geen.ok && geen.reden === "geen_credentials" && geen.fout.includes("Koppelingen"), JSON.stringify(geen));

    process.env.META_ADS_APP_ID = "app"; process.env.META_ADS_APP_SECRET = "geheim"; process.env.META_ADS_ACCESS_TOKEN = "tok";
    fetchGeeft({ data: [{ id: "act_11", name: "Webshop", currency: "EUR", timezone_name: "Europe/Amsterdam", account_status: 1 }, { id: "act_12", name: "", currency: "USD", account_status: 101 }] });
    const meta = await kanaalAccounts(sb as never, "k1", "meta");
    check("meta: twee accounts, status vertaald, bron omgeving", meta.ok && meta.accounts.length === 2 && meta.accounts[0].status === "ACTIVE" && meta.accounts[1].status === "CLOSED" && meta.accounts[1].naam === "act_12" && meta.bron === "omgeving", JSON.stringify(meta));
    fetchGeeft({ error: { message: "Error validating access token: Session has expired", code: 190 } }, 400);
    const dood = await kanaalAccounts(sb as never, "k1", "meta");
    check("meta: dode token is token_probleem, niet 'geen accounts'", !dood.ok && dood.reden === "token_probleem" && dood.fout.includes("expired"), JSON.stringify(dood));
    zonderOmgevingsCredentials();

    fetchGeeft({ elements: [{ id: 5085, name: "B2B", currency: "USD", status: "ACTIVE" }, { name: "zonder id" }] });
    const li = await fetchAdAccounts({ accessToken: "t" });
    check("linkedin: element zonder id valt af, URN gevormd", li.length === 1 && li[0].urn === "urn:li:sponsoredAccount:5085" && li[0].name === "B2B" && li[0].currency === "USD", JSON.stringify(li));
    fetchGeeft({ message: "Invalid access token", status: 401 }, 401);
    let liFout: unknown = null;
    try { await fetchAdAccounts({ accessToken: "t" }); } catch (e) { liFout = e; }
    check("linkedin: niet-OK gooit met de status (geen lege lijst)", liFout instanceof Error && liFout.message.includes("401"), String(liFout));

    fetchGeeft({ AccountsInfo: [{ Id: 777, Name: "MS Shop", Number: "X0001", AccountLifeCycleStatus: "Active" }, { Name: "zonder Id" }] });
    const ms = await fetchMicrosoftAccounts({ accessToken: "t", developerToken: "d", customerId: "9" });
    check("microsoft: AccountsInfo doorgegeven", ms.length === 2 && ms[0].Id === 777);
    process.env.MICROSOFT_ADS_CLIENT_ID = "a"; process.env.MICROSOFT_ADS_CLIENT_SECRET = "b"; process.env.MICROSOFT_ADS_DEVELOPER_TOKEN = "c"; process.env.MICROSOFT_ADS_REFRESH_TOKEN = "d";
    const handmatig = await kanaalAccounts(sb as never, "k1", "microsoft");
    check("microsoft zonder customer-id: 'handmatig' met uitleg", !handmatig.ok && handmatig.reden === "handmatig" && handmatig.fout.includes("customer-id"), JSON.stringify(handmatig));
    zonderOmgevingsCredentials();
  }
  globalThis.fetch = echteFetch;

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

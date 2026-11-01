// Regressietest: de blended historie (/api/blended/client-data -> Jaaroverzicht, Prognose-tabel en
// Pacing op "Alle kanalen"). Draaien: tsx lib/api/__blended_historical_test.ts
//
// Wat er misging (stap 0, items F en E):
// - Meta en LinkedIn kwamen uit fact_core-maand, waar de SQL-projectie de STANDAARDselectie inbakt.
//   Een klant die in Instellingen "alleen leads" koos, zag in de KPI-band andere conversies dan in
//   het Jaaroverzicht. Er telden ook maandrollups mee zonder dagrijen eronder (de demo-februari:
//   114 Meta-conversies die nergens anders bestonden), en Microsoft telde nooit mee.
// - realizedThroughMonth was "de hoogste maand met een rij vóór de lopende UTC-maand". Een sync die
//   op 26 augustus stopte maakte augustus gerealiseerd.
//
// De rijen hieronder gaan door de echte functie, op een in-memory nep-Supabase.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBlendedHistoricalData } from "./blended-historical";
import { FakeSupabase } from "../decision/__fake_supabase";
import { resolveChannelConversionConfig, sumSelectedConversions } from "../analysis/channel-conversion-config";
import { DataLaagFout } from "../analysis/db-veilig";
import { addDays } from "../reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = Record<string, unknown>;
type Uitkomst = Awaited<ReturnType<typeof fetchBlendedHistoricalData>>;
// Losjes getypeerd: dezelfde test moet op de oude code draaien (en daar falen), waar de functie
// geen derde parameter, geen dataStand en geen perKanaal kent.
const haal = (sb: unknown, klant: string, nu: string): Promise<Uitkomst> =>
  (fetchBlendedHistoricalData as (...a: unknown[]) => Promise<Uitkomst>)(sb as SupabaseClient, klant, nu);

const NU = "2026-11-01";
const maand = (u: Uitkomst, m: number) => u?.currentYearMonthly.find((x) => x.month === m);
const kanaal = (u: Uitkomst, k: string) => (u as { perKanaal?: { kanaal: string; maanden: { month: string; conversions: number; adSpend: number; revenue: number }[] }[] } | null)?.perKanaal?.find((x) => x.kanaal === k);

/** Een rij per dag van `van` t/m `tot`, met `maak` voor de velden. */
function dagen(van: string, tot: string, maak: (d: string) => Rij): Rij[] {
  const uit: Rij[] = [];
  for (let d = van; d <= tot; d = addDays(d, 1)) uit.push(maak(d));
  return uit;
}

// ── 1. De conversieselectie van de klant, Microsoft, en geen wees-rollups ────────────────────
//
// Klant die op Meta alleen leads telt en op LinkedIn alleen lead-formulieren. fact_core draagt de
// maandrijen zoals refresh_fact_from_legacy ze schrijft (Meta = conversions + leads, LinkedIn =
// ocl + ewc), plus een Meta-februari zonder dagrijen eronder.

function klantF(config: unknown): FakeSupabase {
  const sb = new FakeSupabase();
  sb.seed("accounts", [{ id: "acc-f", client_id: "klant-f", name: "F", source: "google_ads", external_id: "1", agency_id: "a" }]);
  sb.seed("client_settings", [{ client_id: "klant-f", channel_conversion_config: config }]);
  const fc = (channel: string, m: string, cost: number, conversions: number, conv_value: number) =>
    ({ account_id: "acc-f", channel, level: "account", grain: "month", period_start: `2026-${m}-01`, impressions: 0, clicks: 0, cost, conversions, conv_value });
  sb.seed("fact_core", [
    fc("google", "01", 1000, 10, 900),
    fc("google", "02", 500, 5, 400),
    fc("meta", "01", 200, 17, 120),
    fc("linkedin", "01", 200, 10, 0),
    fc("meta", "02", 2850, 114, 0), // de wees-rollup
  ]);
  // Google: maandbron, gesynct op 2 maart -> februari is vol.
  sb.seed("ads_account_monthly", [{ client_id: "klant-f", month: "2026-01-01" }, { client_id: "klant-f", month: "2026-02-01" }]);
  sb.seed("client_sync_status", [{ client_id: "klant-f", last_successful_sync_at: "2026-03-02T05:00:00Z" }]);
  // Elk dagkanaal heeft een (lege) rij op 28 februari: de data loopt t/m het eind van februari.
  sb.seed("meta_account_daily", [
    { client_id: "klant-f", date: "2026-01-05", entity_id: "m1", impressions: 100, link_clicks: 10, spend: 100, conversions: 7, leads: 3, conversion_value: 70 },
    { client_id: "klant-f", date: "2026-01-20", entity_id: "m1", impressions: 100, link_clicks: 10, spend: 100, conversions: 5, leads: 2, conversion_value: 50 },
    { client_id: "klant-f", date: "2026-02-28", entity_id: "m1", impressions: 0, link_clicks: 0, spend: 0, conversions: 0, leads: 0, conversion_value: 0 },
  ]);
  sb.seed("linkedin_account_daily", [
    { client_id: "klant-f", date: "2026-01-10", entity_urn: "l1", impressions: 100, clicks: 5, spend: 200, one_click_leads: 4, external_website_conversions: 6, post_click_conversions: 1, conversion_value: 0 },
    { client_id: "klant-f", date: "2026-02-28", entity_urn: "l1", impressions: 0, clicks: 0, spend: 0, one_click_leads: 0, external_website_conversions: 0, post_click_conversions: 0, conversion_value: 0 },
  ]);
  sb.seed("microsoft_account_daily", [
    { client_id: "klant-f", date: "2026-01-12", entity_id: "ms1", impressions: 50, clicks: 4, spend: 40, conversions: 2, conversion_value: 20 },
    { client_id: "klant-f", date: "2026-02-28", entity_id: "ms1", impressions: 0, clicks: 0, spend: 0, conversions: 0, conversion_value: 0 },
  ]);
  return sb;
}

async function main() {
  console.log("Conversieselectie: het Jaaroverzicht telt wat de KPI-band telt");
  {
    const opgeslagen = { meta_ads: ["leads"], linkedin_ads: ["one_click_leads"] };
    const sb = klantF(opgeslagen);
    const uit = await haal(sb, "klant-f", NU);
    const cfg = resolveChannelConversionConfig(opgeslagen);
    // Wat de KPI-band per kanaal optelt: sumSelectedConversions met de opgeslagen selectie.
    const som = (tabel: string, ch: "meta_ads" | "linkedin_ads" | "microsoft_ads", c = cfg) =>
      (sb.tables[tabel] ?? []).filter((r) => String(r.date).startsWith("2026-01")).reduce((s, r) => s + sumSelectedConversions(r, ch, c), 0);
    const verwacht = 10 + som("meta_account_daily", "meta_ads") + som("linkedin_account_daily", "linkedin_ads") + som("microsoft_account_daily", "microsoft_ads");
    check("januari: de opgeslagen selectie telt (10 + 5 leads + 4 lead-formulieren + 2 Microsoft = 21)",
      verwacht === 21 && maand(uit, 1)?.conversions === 21, `kreeg ${maand(uit, 1)?.conversions}, verwacht ${verwacht}`);
    check("januari: kosten = Google + de dagkosten per kanaal, Microsoft inbegrepen (1.440)",
      maand(uit, 1)?.adSpend === 1000 + 200 + 200 + 40, `kreeg ${maand(uit, 1)?.adSpend}`);
    check("februari: de Meta-rollup zonder dagrijen telt niet mee (alleen Google: 5 / 500)",
      maand(uit, 2)?.conversions === 5 && maand(uit, 2)?.adSpend === 500, JSON.stringify(maand(uit, 2)));
    check("Microsoft staat erin, als eigen kanaal", kanaal(uit, "microsoft")?.maanden.find((m) => m.month === "2026-01")?.conversions === 2,
      JSON.stringify(kanaal(uit, "microsoft")));
    const meta = kanaal(uit, "meta");
    check("perKanaal Meta: januari 5 (alleen leads), 200 kosten, 120 waarde; februari 0",
      meta?.maanden.find((m) => m.month === "2026-01")?.conversions === 5
        && meta?.maanden.find((m) => m.month === "2026-01")?.adSpend === 200
        && meta?.maanden.find((m) => m.month === "2026-01")?.revenue === 120
        && meta?.maanden.find((m) => m.month === "2026-02")?.conversions === 0,
      JSON.stringify(meta));
    check("perKanaal Google uit fact_core: januari 10, februari 5",
      JSON.stringify(kanaal(uit, "google")?.maanden.map((m) => [m.month, m.conversions])) === JSON.stringify([["2026-01", 10], ["2026-02", 5]]),
      JSON.stringify(kanaal(uit, "google")));

    const std = resolveChannelConversionConfig(null);
    const zonder = await haal(klantF(null), "klant-f", NU);
    const verwachtStd = 10 + som("meta_account_daily", "meta_ads", std) + som("linkedin_account_daily", "linkedin_ads", std) + som("microsoft_account_daily", "microsoft_ads", std);
    check("zonder opgeslagen selectie: de standaard aan beide kanten (10 + 17 + 10 + 2 = 39)",
      verwachtStd === 39 && maand(zonder, 1)?.conversions === 39, `kreeg ${maand(zonder, 1)?.conversions}, verwacht ${verwachtStd}`);
  }

  console.log("Tot welke maand: data t/m 25/26 augustus, bekeken op 1 november");
  {
    const sb = new FakeSupabase();
    sb.seed("accounts", [{ id: "acc-1", client_id: "c1", name: "C1", source: "google_ads", external_id: null, agency_id: null }]);
    sb.seed("client_settings", [{ client_id: "c1", channel_conversion_config: null }]);
    sb.seed("fact_core", Array.from({ length: 8 }, (_, i) => ({
      account_id: "acc-1", channel: "google", level: "account", grain: "month",
      period_start: `2026-${String(i + 1).padStart(2, "0")}-01`, impressions: 0, clicks: 0, cost: 100, conversions: 10, conv_value: 0,
    })));
    sb.seed("ads_account_monthly", Array.from({ length: 8 }, (_, i) => ({ client_id: "c1", month: `2026-${String(i + 1).padStart(2, "0")}-01` })));
    sb.seed("client_sync_status", [{ client_id: "c1", last_successful_sync_at: "2026-08-26T06:44:34Z" }]);
    // Eén Meta-conversie per dag, 13 maart t/m 26 augustus: de vorm van de demo-Meta-reeks.
    sb.seed("meta_account_daily", dagen("2026-03-13", "2026-08-26", (d) => ({
      client_id: "c1", date: d, entity_id: "m1", impressions: 0, link_clicks: 0, spend: 10, conversions: 1, leads: 0, conversion_value: 0,
    })));
    sb.seed("meta_connections", [{ client_id: "c1", last_sync_at: "2026-08-26T06:44:34Z" }]);

    const uit = await haal(sb, "c1", NU);
    const stand = (uit as { dataStand?: { laatsteVolleMaand: string | null; partieel: { maand: string; tmDag: number } | null; dataTot: string | null; uitgesloten: string[] } | null } | null)?.dataStand;
    check("gerealiseerd t/m juli, niet augustus (realizedThroughMonth 7)", uit?.realizedThroughMonth === 7, String(uit?.realizedThroughMonth));
    check("dataStand: laatste volle maand juli, augustus partieel t/m 25 (Google: dag vóór de sync)",
      stand?.laatsteVolleMaand === "2026-07" && stand?.partieel?.maand === "2026-08" && stand?.partieel?.tmDag === 25 && stand?.dataTot === "2026-08-25",
      JSON.stringify(stand));
    check("augustus staat niet in currentYearMonthly, juli wel",
      maand(uit, 8) === undefined && maand(uit, 7)?.conversions === 10 + 31, JSON.stringify(uit?.currentYearMonthly.map((m) => [m.month, m.conversions])));
    const meta = kanaal(uit, "meta");
    check("perKanaal Meta: maart 19, april 30, ..., en de partiële augustus 26 (het venster is aan de lezer)",
      JSON.stringify(meta?.maanden.map((m) => m.conversions)) === JSON.stringify([19, 30, 31, 30, 31, 26]), JSON.stringify(meta?.maanden));
    check("perKanaal Google: acht maanden van 10", kanaal(uit, "google")?.maanden.length === 8
      && kanaal(uit, "google")!.maanden.every((m) => m.conversions === 10), JSON.stringify(kanaal(uit, "google")));
    // De eerste rij op 13 maart: maart is negen-tiende gemeten en paart niet tegen een volle maart
    // een jaar later (review [0], [35]). Google is een maandbron zonder dagen: geen vanaf.
    const vanaf = (k: string) => (kanaal(uit, k) as { vanaf?: string | null } | undefined)?.vanaf;
    check("perKanaal Meta: de eerste volle maand is april", vanaf("meta") === "2026-04", String(vanaf("meta")));
    check("perKanaal Google: geen vanaf (de eerste maand met data is de start)", vanaf("google") === null, String(vanaf("google")));
    // En de eerste dag zelf: het tempo zonder doel rekent dan over de dagen dat het kanaal liep, als
    // die partiële maand de laatste gerealiseerde is (forecastCoreMetric).
    const eersteDag = (k: string) => (kanaal(uit, k) as { eersteDag?: string | null } | undefined)?.eersteDag;
    check("perKanaal Meta: de eerste dag is 13 maart", eersteDag("meta") === "2026-03-13", String(eersteDag("meta")));
    check("perKanaal Google: geen eerste dag", eersteDag("google") === null, String(eersteDag("google")));
    check("het jaar komt uit `nu` (Amsterdam), niet uit de serverklok", uit?.currentYear === 2026, String(uit?.currentYear));
  }

  console.log("Een gepauzeerd kanaal met een gezonde sync remt de rest niet af");
  {
    const sb = new FakeSupabase();
    sb.seed("accounts", [{ id: "acc-2", client_id: "c2", name: "C2", source: "google_ads", external_id: null, agency_id: null }]);
    sb.seed("client_settings", [{ client_id: "c2", channel_conversion_config: null }]);
    sb.seed("fact_core", Array.from({ length: 10 }, (_, i) => ({
      account_id: "acc-2", channel: "google", level: "account", grain: "month",
      period_start: `2026-${String(i + 1).padStart(2, "0")}-01`, impressions: 0, clicks: 0, cost: 100, conversions: 10, conv_value: 0,
    })));
    sb.seed("ads_account_monthly", Array.from({ length: 10 }, (_, i) => ({ client_id: "c2", month: `2026-${String(i + 1).padStart(2, "0")}-01` })));
    sb.seed("client_sync_status", [{ client_id: "c2", last_successful_sync_at: "2026-11-01T05:00:00Z" }]);
    // LinkedIn stopte eind maart; de sync draait wel (gisteren geslaagd, op de echte klok, want
    // dagstandVoorKlant beoordeelt de sync tegen vandaag).
    sb.seed("linkedin_account_daily", dagen("2026-03-01", "2026-03-31", (d) => ({
      client_id: "c2", date: d, entity_urn: "l1", impressions: 0, clicks: 0, spend: 5, one_click_leads: 1, external_website_conversions: 0, post_click_conversions: 0, conversion_value: 0,
    })));
    // Op de peildag van de route (NU), niet op de echte klok: de standlezers krijgen `nu` nu mee.
    sb.seed("linkedin_connections", [{ client_id: "c2", last_sync_at: "2026-10-31T05:00:00Z" }]);
    const uit = await haal(sb, "c2", NU);
    const stand = (uit as { dataStand?: { laatsteVolleMaand: string | null; uitgesloten: string[] } | null } | null)?.dataStand;
    check("de stand volgt Google (oktober), LinkedIn staat als uitgesloten genoemd",
      stand?.laatsteVolleMaand === "2026-10" && JSON.stringify(stand?.uitgesloten) === JSON.stringify(["linkedin"]), JSON.stringify(stand));
    check("realizedThroughMonth 10", uit?.realizedThroughMonth === 10, String(uit?.realizedThroughMonth));
  }

  // ── Een kanaal dat niet meer bijkomt, houdt de rest niet tegen (review [9], [36]) ───────────
  //
  // Google t/m oktober, sync vandaag. Daarnaast een LinkedIn die maar een tijdje liep. Onbegrensd
  // remde die het hele "Alle kanalen" op zijn laatste dag: het Jaaroverzicht projecteerde Google's
  // gemeten maanden erna als toekomst, en de band zei "Data t/m ..." zonder te zeggen door wie.
  const stand = (u: Uitkomst) => (u as { dataStand?: { laatsteVolleMaand: string | null; partieel: unknown; dataTot: string | null; uitgesloten: string[]; bronnen?: { bron: string; dataTot: string | null; syncDraait: boolean }[] } | null } | null)?.dataStand;
  const googleTotOktober = (id: string): FakeSupabase => {
    const sb = new FakeSupabase();
    sb.seed("accounts", [{ id: `acc-${id}`, client_id: id, name: id, source: "google_ads", external_id: null, agency_id: null }]);
    sb.seed("client_settings", [{ client_id: id, channel_conversion_config: null }]);
    const maanden = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
    sb.seed("fact_core", maanden.map((m) => ({ account_id: `acc-${id}`, channel: "google", level: "account", grain: "month", period_start: `${m}-01`, impressions: 0, clicks: 0, cost: 100, conversions: 10, conv_value: 0 })));
    sb.seed("ads_account_monthly", maanden.map((m) => ({ client_id: id, month: `${m}-01` })));
    sb.seed("client_sync_status", [{ client_id: id, last_successful_sync_at: "2026-11-01T05:00:00Z" }]);
    return sb;
  };
  const linkedinRij = (id: string) => (d: string) => ({ client_id: id, date: d, entity_urn: "l1", impressions: 0, clicks: 0, spend: 5, one_click_leads: 1, external_website_conversions: 0, post_click_conversions: 0, conversion_value: 0 });

  console.log("Een ontkoppeld of nooit gekoppeld kanaal remt niet");
  {
    const sb = googleTotOktober("los");
    sb.seed("linkedin_account_daily", dagen("2026-03-01", "2026-04-30", linkedinRij("los")));
    const uit = await haal(sb, "los", NU);
    check("geen koppelingsrij: oktober, LinkedIn uitgesloten",
      stand(uit)?.laatsteVolleMaand === "2026-10" && stand(uit)?.uitgesloten.join(",") === "linkedin", JSON.stringify(stand(uit)));
    check("geen koppelingsrij: realizedThroughMonth 10, mei t/m oktober gerealiseerd",
      uit?.realizedThroughMonth === 10 && uit?.currentYearMonthly.length === 10, `${uit?.realizedThroughMonth} ${uit?.currentYearMonthly.map((m) => m.month)}`);

    // Via Instellingen ontkoppeld op 16 mei: de rij blijft staan met status "disabled", en
    // kanaal-runs.ts slaat hem daarna altijd over. Ook dicht bij de rest: er komt niets meer bij.
    const sb2 = googleTotOktober("uit");
    sb2.seed("linkedin_account_daily", dagen("2026-01-01", "2026-09-20", linkedinRij("uit")));
    sb2.seed("linkedin_connections", [{ client_id: "uit", last_sync_at: "2026-09-21T05:00:00Z", status: "disabled" }]);
    const uit2 = await haal(sb2, "uit", NU);
    check("status disabled (een maand achter): remt niet, LinkedIn uitgesloten",
      stand(uit2)?.laatsteVolleMaand === "2026-10" && stand(uit2)?.uitgesloten.join(",") === "linkedin", JSON.stringify(stand(uit2)));
  }

  console.log("Een gekoppeld kanaal waarvan de sync al lang faalt, remt hooguit tot de grens");
  {
    // Token verlopen: de rij staat nog op actief, maar de laatste geslaagde sync is van april 2025.
    const sb = googleTotOktober("dood");
    sb.seed("linkedin_account_daily", dagen("2025-02-01", "2025-03-20", linkedinRij("dood")));
    sb.seed("linkedin_connections", [{ client_id: "dood", last_sync_at: "2025-04-02T05:00:00Z", status: "active" }]);
    const uit = await haal(sb, "dood", NU);
    check("anderhalf jaar achter: oktober, realizedThroughMonth 10, LinkedIn uitgesloten",
      stand(uit)?.laatsteVolleMaand === "2026-10" && uit?.realizedThroughMonth === 10 && stand(uit)?.uitgesloten.join(",") === "linkedin", JSON.stringify(stand(uit)));

    // Eén maand achter met een falende sync: dat is de storing die de rest hoort tegen te houden.
    const sb2 = googleTotOktober("hapert");
    sb2.seed("linkedin_account_daily", dagen("2026-01-01", "2026-09-20", linkedinRij("hapert")));
    sb2.seed("linkedin_connections", [{ client_id: "hapert", last_sync_at: "2026-09-21T05:00:00Z", status: "active" }]);
    const uit2 = await haal(sb2, "hapert", NU);
    check("een maand achter en gekoppeld: remt (augustus vol, september t/m de 20e)",
      stand(uit2)?.laatsteVolleMaand === "2026-08" && stand(uit2)?.dataTot === "2026-09-20" && stand(uit2)?.uitgesloten.length === 0, JSON.stringify(stand(uit2)));
  }

  console.log("Een gezonde sync na de laatste rij: de dag ervoor is gemeten (review [10])");
  {
    // Microsoft levert alleen op werkdagen; 31 oktober 2026 is een zaterdag. Sync vannacht.
    const sb = googleTotOktober("wk");
    const werkdag = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
    sb.seed("microsoft_account_daily", dagen("2026-01-01", "2026-10-31", (d) => ({ client_id: "wk", date: d, entity_id: "ms1", impressions: 10, clicks: 1, spend: 5, conversions: 1, conversion_value: 0 })).filter((r) => werkdag(String(r.date))));
    sb.seed("microsoft_connections", [{ client_id: "wk", last_sync_at: "2026-11-01T05:10:00Z", status: "active" }]);
    const uit = await haal(sb, "wk", NU);
    check("laatste rij vrijdag 30 okt, sync 1 nov: oktober is vol, realizedThroughMonth 10",
      stand(uit)?.laatsteVolleMaand === "2026-10" && stand(uit)?.partieel === null && stand(uit)?.dataTot === "2026-10-31" && uit?.realizedThroughMonth === 10, JSON.stringify(stand(uit)));
    // De invoer per bron gaat mee: de KPI-band leest Google live en kan <kanaal>_connections niet
    // lezen, en hoort dezelfde regel over zijn eigen bronnen te draaien (review [3], [12]).
    const ms = stand(uit)?.bronnen?.find((b) => b.bron === "microsoft");
    check("dataStand.bronnen draagt de dataTot per kanaal, met de sync erin verwerkt",
      ms?.dataTot === "2026-10-31" && ms?.syncDraait === false && stand(uit)?.bronnen?.find((b) => b.bron === "google")?.dataTot === "2026-10-31",
      JSON.stringify(stand(uit)?.bronnen));
  }

  console.log("Alles gepauzeerd met gezonde syncs: de laatste dag telt (review [11])");
  {
    // Google gestopt eind april, Meta liep door tot 15 september; beide syncs slagen vandaag.
    const sb = new FakeSupabase();
    const id = "stil";
    sb.seed("accounts", [{ id: `acc-${id}`, client_id: id, name: id, source: "google_ads", external_id: null, agency_id: null }]);
    sb.seed("client_settings", [{ client_id: id, channel_conversion_config: null }]);
    const maanden = ["2026-01", "2026-02", "2026-03", "2026-04"];
    sb.seed("fact_core", maanden.map((m) => ({ account_id: `acc-${id}`, channel: "google", level: "account", grain: "month", period_start: `${m}-01`, impressions: 0, clicks: 0, cost: 100, conversions: 10, conv_value: 0 })));
    sb.seed("ads_account_monthly", maanden.map((m) => ({ client_id: id, month: `${m}-01` })));
    sb.seed("client_sync_status", [{ client_id: id, last_successful_sync_at: "2026-11-01T05:00:00Z" }]);
    sb.seed("meta_account_daily", dagen("2026-01-01", "2026-09-15", (d) => ({ client_id: id, date: d, entity_id: "m1", impressions: 0, link_clicks: 0, spend: 10, conversions: 1, leads: 0, conversion_value: 0 })));
    sb.seed("meta_connections", [{ client_id: id, last_sync_at: "2026-11-01T05:00:00Z", status: "active" }]);
    const uit = await haal(sb, id, NU);
    check("Meta's gemeten mei t/m september blijven gerealiseerd (eerst: t/m april)",
      (uit?.realizedThroughMonth ?? 0) >= 9 && maand(uit, 6)?.conversions === 30 && maand(uit, 9)?.conversions === 15,
      `${uit?.realizedThroughMonth} ${JSON.stringify(uit?.currentYearMonthly.map((m) => [m.month, m.conversions]))}`);
    check("Google, dat eerder ophoudt, wordt genoemd", stand(uit)?.uitgesloten.includes("google") === true, JSON.stringify(stand(uit)));
  }

  console.log("Pagineren langs de 1000-rijengrens van PostgREST");
  {
    const sb = new FakeSupabase();
    sb.seed("accounts", [{ id: "acc-3", client_id: "c3", name: "C3", source: "google_ads", external_id: null, agency_id: null }]);
    sb.seed("client_settings", [{ client_id: "c3", channel_conversion_config: null }]);
    // Twee Meta-accounts, 600 dagen: 1.200 dagrijen.
    const rijen = ["m1", "m2"].flatMap((e) => dagen("2025-03-01", addDays("2025-03-01", 599), (d) => ({
      client_id: "c3", date: d, entity_id: e, impressions: 0, link_clicks: 0, spend: 1, conversions: 1, leads: 0, conversion_value: 0,
    })));
    sb.seed("meta_account_daily", rijen);
    sb.seed("meta_connections", [{ client_id: "c3", last_sync_at: "2026-10-23T05:00:00Z" }]);
    const uit = await haal(metPlafond(sb), "c3", NU);
    const totaal = (kanaal(uit, "meta")?.maanden ?? []).reduce((s, m) => s + m.conversions, 0);
    check("alle 1.200 dagrijen tellen mee, niet de eerste 1.000", totaal === 1200, String(totaal));
  }

  console.log("Een kapotte query is een fout, geen 'geen data'");
  {
    const sb = klantF(null);
    sb.faalOp("client_settings", "column channel_conversion_config does not exist");
    let fout: unknown = null;
    try { await haal(sb, "klant-f", NU); } catch (e) { fout = e; }
    check("client_settings faalt -> DataLaagFout, niet stil de standaardselectie", fout instanceof DataLaagFout, String(fout));

    const sb2 = klantF(null);
    sb2.faalOp("microsoft_account_daily");
    let fout2: unknown = null;
    try { await haal(sb2, "klant-f", NU); } catch (e) { fout2 = e; }
    check("een dagtabel faalt -> DataLaagFout met de tabelnaam", fout2 instanceof DataLaagFout && String((fout2 as DataLaagFout).context).includes("microsoft_account_daily"), String(fout2));

    // De standlezer van een kanaal faalt: het kanaal valt terug op zijn eigen nieuwste dag in
    // plaats van uit de rem te verdwijnen.
    const sb3 = klantF(null);
    sb3.faalOp("meta_connections");
    const uit3 = await haal(sb3, "klant-f", NU);
    const stand3 = (uit3 as { dataStand?: { dataTot: string | null } | null } | null)?.dataStand;
    check("standlezer faalt -> terugval op de eigen rijen, de stand blijft februari", stand3?.dataTot === "2026-02-28" && uit3?.realizedThroughMonth === 2, JSON.stringify(stand3));
  }

  console.log("Geen account of geen data: null");
  {
    const sb = new FakeSupabase();
    check("onbekende klant -> null", (await haal(sb, "bestaat-niet", NU)) === null);
    sb.seed("accounts", [{ id: "acc-4", client_id: "c4", name: "C4", source: "google_ads", external_id: null, agency_id: null }]);
    sb.seed("client_settings", [{ client_id: "c4", channel_conversion_config: null }]);
    check("account zonder rijen -> null", (await haal(sb, "c4", NU)) === null);
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  if (failed > 0) process.exit(1);
}

/**
 * De nep-Supabase met de PostgREST-cap: een query zonder .range() krijgt hooguit 1000 rijen terug,
 * zoals de echte API stil doet.
 */
function metPlafond(sb: FakeSupabase): unknown {
  return {
    rpc: sb.rpc.bind(sb),
    from(tabel: string) {
      const b = sb.from(tabel);
      let gepagineerd = false;
      const proxy: unknown = new Proxy(b, {
        get(doel, prop) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              doel.then((r: { data: unknown }) => res(!gepagineerd && Array.isArray(r.data) ? { ...r, data: r.data.slice(0, 1000) } : r), rej);
          }
          const v = doel[prop];
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (prop === "range") gepagineerd = true;
            const uit = v.apply(doel, args);
            return uit === doel ? proxy : uit;
          };
        },
      });
      return proxy;
    },
  };
}

main().catch((e) => { console.error(e); process.exit(1); });

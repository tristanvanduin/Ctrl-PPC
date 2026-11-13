// Google per dag in de sync (lib/sync/google-dagen.ts): het venster per tabel, de omzetting naar de
// dagtabellen van migratie 111, dat de upsert per dag nooit iets buiten het opgehaalde venster
// aanraakt, en de lus per maandstuk met tijdbudget: een afgebroken eerste run gaat de volgende keer
// verder, een mislukt stuk schuift de stand niet op. Plus: zonder tabel slaat de sync over.
// Draaien: tsx --tsconfig ./tsconfig.json lib/sync/__google_dagen_test.ts

import {
  accountDagRijen, campagneDagRijen, checkoutDagRijen, DAG_SLEUTELS, DAG_TABELLEN, googleDagVenster, leesGoogleDagStand,
  landDagRijen, regioDagRijen, selectieSleutel, syncGoogleDagen, GOOGLE_NALOOP_DAGEN,
  type DagTabel, type DagVenster, type TabelStand,
} from "./google-dagen";
import { upsertBatch } from "./orchestrator";
import { buildRegionRows } from "../geo/region-rows";
import type { GoogleAdsMetrics } from "../api/google-ads";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = "2026-11-13T04:00:00Z";
const metriek = (date: string, cost: number, extra: Partial<GoogleAdsMetrics> = {}): GoogleAdsMetrics => ({
  date, impressions: 100, clicks: 10, cost, conversions: 2, conversionsValue: 50,
  ctr: 0.1, avgCpc: cost / 10, costPerConversion: cost / 2, conversionRate: 0.2, ...extra,
});

console.log("Het venster per tabel");
{
  const eerste = googleDagVenster(null, "2026-11-12");
  check("zonder stand: de eerste run haalt drie jaar terug, vanaf de eerste van een maand", eerste.reden === "eerste run" && eerste.since === "2023-11-01" && eerste.until === "2026-11-12" && eerste.vanaf === "2023-11-01", JSON.stringify(eerste));

  const stand: TabelStand = { vanaf: "2023-11-01", tot: "2026-11-11", selectie: "" };
  const daarna = googleDagVenster(stand, "2026-11-12");
  check(`daarna een naloopvenster van ${GOOGLE_NALOOP_DAGEN} dagen voor late conversies`, daarna.reden === "naloop" && daarna.since === "2026-10-14" && daarna.until === "2026-11-12", JSON.stringify(daarna));

  const gat = googleDagVenster({ ...stand, tot: "2026-08-31" }, "2026-11-12");
  check("stopte de vorige run eerder, dan begint het venster de dag na `tot` (geen gat)", gat.since === "2026-09-01", JSON.stringify(gat));

  const anders = googleDagVenster({ ...stand, selectie: "1,2" }, "2026-11-12", "ads_account_daily", "1");
  check("een andere conversieselectie: account rekent opnieuw vanaf het begin van de opslag", anders.reden === "selectie gewijzigd" && anders.since === "2023-11-01", JSON.stringify(anders));
  const land = googleDagVenster({ ...stand, selectie: "" }, "2026-11-12", "ads_country_daily", "1");
  check("landen hangen niet van de selectie af: gewoon de naloop", land.reden === "naloop");
  check("de selectie als vaste tekst, ongeacht volgorde en dubbelen", selectieSleutel(["2", "1", "2"]) === "1,2" && selectieSleutel(undefined) === "");
}

const venster: DagVenster = { since: "2026-11-01", until: "2026-11-12" };

console.log("De omzetting per dag");
{
  const acc = accountDagRijen([
    metriek("2026-11-02", 10), metriek("2026-11-03", 20), metriek("2026-11-03", 25),
    metriek("2026-10-31", 99), metriek("2026-11-13", 99), metriek("2026-11", 99),
  ], "k1", venster, NU);
  check("een dag per rij; een dag die twee keer terugkomt telt één keer (de laatste)",
    acc.length === 2 && acc.find((r) => r.date === "2026-11-03")?.cost === 25, JSON.stringify(acc));
  check("een dag buiten het opgehaalde venster wordt niet geschreven", acc.every((r) => String(r.date) >= "2026-11-01" && String(r.date) <= "2026-11-12"));
  check("de kolommen van ads_account_daily", Object.keys(acc[0]).sort().join(",") === "clicks,client_id,conversions,conversions_value,cost,date,impressions,synced_at");

  const camp = campagneDagRijen([
    { date: "2026-11-02", campaignId: "1", campaignName: "Brand", campaignType: "SEARCH", impressions: 5, clicks: 1, cost: 3, conversions: 1, conversionsValue: 9 },
    { date: "2026-11-02", campaignId: "", campaignName: "?", campaignType: "", impressions: 5, clicks: 1, cost: 3, conversions: 1, conversionsValue: 9 },
  ], "k1", venster, NU);
  check("campagne per dag, zonder campagne-id geen rij", camp.length === 1 && camp[0].campaign_type === "SEARCH" && camp[0].campaign_name === "Brand");

  const geo = (date: string, land: string, cost: number) => ({
    date, campaignId: "1", campaignName: "c", countryCode: land, locationType: "AREA_OF_INTEREST", impressions: 10, clicks: 2, cost,
    conversions: 1, conversionsValue: 5, ctr: 0, avgCpc: 0, costPerConversion: 0, conversionRate: 0,
  });
  const land = landDagRijen([geo("2026-11-02", "nl", 3), geo("2026-11-02", "NL", 4), geo("2026-11-02", "", 7), geo("2026-11-03", "DE", 1)] as never, "k1", venster, NU);
  check("per land per dag opgeteld over de campagnes", land.rijen.length === 2 && land.rijen.find((r) => r.country_code === "NL")?.cost === 7);
  check("een rij zonder land valt af, maar wordt geteld", land.zonderLand === 1);

  const regio = regioDagRijen(buildRegionRows(
    [{ month: "2026-11-02", campaignId: "1", campaignName: "c", geoTargetState: "geoTargetConstants/21137", impressions: 10, clicks: 1, cost: 2, conversions: 1, conversionsValue: 3 }],
    new Map([["geoTargetConstants/21137", { name: "California", canonicalName: "California,United States", countryCode: "US", targetType: "State" }]]) as never,
  ), "k1", venster, NU);
  check("regio per dag: de dag uit buildRegionRows wordt `date`", regio.length === 1 && regio[0].date === "2026-11-02" && regio[0].region_code === "CA", JSON.stringify(regio));

}

console.log("Upsert per dag: niets buiten het venster wordt aangeraakt, niets gewist");
async function upsertProef() {
  // Een tabel in het geheugen die upsert op de conflictsleutel doet zoals Postgres, en delete telt.
  const tabel = new Map<string, Record<string, unknown>>();
  let wissen = 0;
  const sleutel = (r: Record<string, unknown>) => DAG_SLEUTELS.ads_account_daily.split(",").map((k) => String(r[k])).join("|");
  const sb = {
    from: () => ({
      upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => {
        if (opts.onConflict !== DAG_SLEUTELS.ads_account_daily) throw new Error("verkeerde sleutel");
        for (const r of rows) tabel.set(sleutel(r), r);
        return Promise.resolve({ error: null });
      },
      delete: () => { wissen++; return { eq: () => Promise.resolve({ error: null }) }; },
    }),
  };
  // Eerder geschreven: oktober (ver voor het venster) en 5 november (erin).
  for (const [date, cost] of [["2025-10-05", 1], ["2026-11-05", 1]] as const) tabel.set(`k1|${date}`, { client_id: "k1", date, cost });
  const rijen = accountDagRijen([metriek("2026-11-05", 8), metriek("2026-11-06", 9)], "k1", venster, NU);
  await upsertBatch(sb as never, "ads_account_daily", rijen, DAG_SLEUTELS.ads_account_daily);
  check("een oude dag buiten het venster blijft staan (eigen geschiedenis)", tabel.get("k1|2025-10-05")?.cost === 1);
  check("een dag in het venster wordt overschreven, niet verdubbeld", tabel.get("k1|2026-11-05")?.cost === 8 && tabel.size === 3);
  check("er wordt niets gewist", wissen === 0);
}

console.log("Zonder tabel: overslaan");
async function standProef() {
  const sb = (antwoord: { data: unknown; error: unknown }) => ({
    from: (t: string) => {
      if (t !== "google_dag_stand") throw new Error(`verkeerde tabel ${t}`);
      const q = { select: () => q, eq: () => Promise.resolve(antwoord) };
      return q;
    },
  });
  const weg = await leesGoogleDagStand(sb({ data: null, error: { code: "42P01", message: 'relation "google_dag_stand" does not exist' } }) as never, "k1");
  check("een ontbrekende tabel: ontbreekt, geen fout", weg.ontbreekt === true);
  const leeg = await leesGoogleDagStand(sb({ data: [], error: null }) as never, "k1");
  check("nog geen stand: de eerste run", !leeg.ontbreekt && leeg.stand.size === 0 && leeg.fout === null);
  const stand = await leesGoogleDagStand(sb({ data: [{ tabel: "ads_account_daily", vanaf: "2023-11-01", tot: "2026-11-11", conversie_selectie: "1" }, { tabel: "iets_anders", vanaf: "2023-11-01", tot: "2026-11-11" }], error: null }) as never, "k1");
  check("met een stand: per tabel, onbekende tabellen genegeerd", !stand.ontbreekt && stand.stand.size === 1 && stand.stand.get("ads_account_daily")?.tot === "2026-11-11" && stand.stand.get("ads_account_daily")?.selectie === "1");
  const fout = await leesGoogleDagStand(sb({ data: null, error: { code: "57014", message: "timeout" } }) as never, "k1");
  check("een andere fout: geen venster te bepalen, dus deze run overslaan", !fout.ontbreekt && fout.fout === "timeout");
}

console.log("De lus: per maandstuk, van oud naar nieuw, met tijdbudget");
async function lusProef() {
  // Een nep-wereld: een klok die per opgehaald stuk een seconde verder loopt, tabellen en een stand.
  function wereld(opties: { faalt?: (t: DagTabel, s: DagVenster) => boolean } = {}) {
    let klok = 0;
    const gevraagd: { tabel: DagTabel; stuk: DagVenster }[] = [];
    const geschreven = new Map<DagTabel, string[]>();
    const stand = new Map<DagTabel, TabelStand>();
    return {
      gevraagd, geschreven, stand,
      io: {
        haal: async (tabel: DagTabel, stuk: DagVenster) => {
          klok += 1000;
          gevraagd.push({ tabel, stuk });
          if (opties.faalt?.(tabel, stuk)) return { rijen: [], fout: "getStoring" };
          // Account heeft elke dag een rij; regio nooit (een klant zonder VS); een rij buiten het stuk telt niet.
          if (tabel === "ads_region_daily") return { rijen: [], fout: null };
          return { rijen: [{ date: stuk.since }, { date: stuk.until }, { date: "1999-01-01" }], fout: null };
        },
        schrijf: async (tabel: DagTabel, rijen: Record<string, unknown>[]) => {
          geschreven.set(tabel, [...(geschreven.get(tabel) ?? []), ...rijen.map((r) => String(r.date))]);
          return rijen.length;
        },
        bewaarStand: async (tabel: DagTabel, st: TabelStand) => { stand.set(tabel, st); },
        nuMs: () => klok,
      },
    };
  }

  // De eerste run: 37 maanden x 5 tabellen = 185 stukken, het budget laat er 25 toe (5 maanden).
  const w = wereld();
  const eerste = await syncGoogleDagen(w.io, new Map(), "2026-11-12", "", 24_500);
  check("het budget stopt de run netjes, zonder fout", eerste.every((u) => u.success && u.onaf), JSON.stringify(eerste.map((u) => [u.name, u.onaf])));
  check("van oud naar nieuw: het eerste stuk is de oudste maand", w.gevraagd[0].stuk.since === "2023-11-01" && w.gevraagd[0].stuk.until === "2023-11-30");
  check("na elk stuk geschreven en de stand opgeschoven", w.stand.get("ads_account_daily")?.tot === "2024-03-31" && w.stand.get("ads_account_daily")?.vanaf === "2023-11-01", JSON.stringify(w.stand.get("ads_account_daily")));
  check("een rij buiten het opgehaalde stuk wordt niet geschreven", !(w.geschreven.get("ads_account_daily") ?? []).includes("1999-01-01"));
  check("ook een tabel zonder rijen (regio) schuift op", w.stand.get("ads_region_daily")?.tot === "2024-03-31");

  // De volgende run gaat verder waar deze stopte, en begint niet opnieuw aan 37 maanden.
  w.gevraagd.length = 0;
  await syncGoogleDagen(w.io, new Map(w.stand), "2026-11-12", "", 19_500);
  check("de volgende run gaat verder bij de dag na `tot`", w.gevraagd[0].stuk.since === "2024-04-01", JSON.stringify(w.gevraagd[0]));

  // Volledig gevuld: daarna alleen de naloop, ook voor de regio die nooit een rij had.
  w.gevraagd.length = 0;
  const vol = await syncGoogleDagen(w.io, new Map(DAG_TABELLEN.map((t) => [t, { vanaf: "2023-11-01", tot: "2026-11-11", selectie: "" }])), "2026-11-12", "", 60_000);
  check("gevuld: alleen het naloopvenster, per tabel", vol.every((u) => u.success && !u.onaf) && w.gevraagd.every((g) => g.stuk.since >= "2026-10-14"), JSON.stringify(w.gevraagd.map((g) => g.stuk)));

  // Een mislukt stuk: die tabel schuift niet op en gaat deze run niet verder; de andere wel.
  const f = wereld({ faalt: (t, st) => t === "ads_country_daily" && st.since === "2023-12-01" });
  const mis = await syncGoogleDagen(f.io, new Map(), "2026-11-12", "", 9_500);
  const land = mis.find((u) => u.name === "ads_country_daily")!;
  check("een mislukt stuk boekt de tabel als mislukt", !land.success && !!land.error?.includes("getStoring"));
  check("en de stand blijft voor dat stuk staan", f.stand.get("ads_country_daily")?.tot === "2023-11-30" && f.stand.get("ads_account_daily")?.tot !== "2023-11-30", JSON.stringify([...f.stand]));
}

function checkoutProef() {
  const v = { since: "2026-11-01", until: "2026-11-30" };
  const r = (date: string, device: string, atc: number) => ({ date, campaignId: "c1", campaignName: "C", device, addToCartCount: atc, addToCartValue: 0, beginCheckoutCount: 1, beginCheckoutValue: 0, purchaseCount: 1, purchaseValue: 10 });
  const rijen = checkoutDagRijen([r("2026-11-03", "MOBILE", 4), r("2026-11-03", "MOBILE", 2), r("2026-11-03", "DESKTOP", 1), r("2026-10-31", "MOBILE", 9)], "k", v, "nu");
  check("checkout per dag: buiten het stuk niet geschreven", rijen.every((x) => x.date !== "2026-10-31"));
  const mob = rijen.find((x) => x.device === "MOBILE");
  check("checkout per dag: dubbele sleutel opgeteld", rijen.length === 2 && mob?.add_to_cart_count === 6 && mob?.purchase_value === 20, JSON.stringify(rijen));
  check("checkout per dag: zit in de lus en heeft de sleutel van migratie 111", (DAG_TABELLEN as readonly string[]).includes("google_ads_checkout_funnel_daily") && DAG_SLEUTELS.google_ads_checkout_funnel_daily === "client_id,date,campaign_id,device");
}

(async () => {
  checkoutProef();
  await upsertProef();
  await standProef();
  await lusProef();
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

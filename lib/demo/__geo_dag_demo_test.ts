// De kaart in de demo leest Google per land en staat uit de dagrijen, zoals bij een echte klant.
//
// De demo-database had Google per dag voor account en campagne, maar ads_country_daily en
// ads_region_daily waren leeg: de kaart verdeelde Google daarom met de aandelen van de mock. Nu vult
// de seed ook die twee tabellen uit één generator (lib/demo/geo-dag-demo.ts), en neemt de kaart in de
// demo voor Google de weg van leesGoogle (lib/geo/geo-periode.ts) zodra de dagrijen de periode en de
// vergelijking dekken. De afrondingsrest gaat tussen de dagen mee, zodat ook kleine aantallen
// (conversies per staat) over een periode bij hun aandeel uitkomen.
//
// Draaien: tsx --tsconfig ./tsconfig.json lib/demo/__geo_dag_demo_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import { demoRows } from "./demo-rows";
import { DEMO_GREENTECH_ID } from "./greentech-mock";
import { googleGeoDagRijen, verdeelReeks } from "./geo-dag-demo";
import { demoGeoCountries, demoGeoStates, type GeoAgg } from "./geo-demo";
import { demoMetGoogleDagen, resolveGeoPeriode, type GeoPeriodeResultaat } from "../geo/geo-periode";
import type { GeoKanaalTelling } from "../geo/geo-dag";
import type { GeoLevel } from "../geo/geo-source";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const gelijk = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
type Row = Record<string, unknown>;
const METRIEKEN = ["impressions", "clicks", "cost", "conversions", "conversions_value"] as const;

function somPer(rijen: readonly Row[], sleutel: (r: Row) => string): Map<string, Record<string, number>> {
  const m = new Map<string, Record<string, number>>();
  for (const r of rijen) {
    const k = sleutel(r);
    const a = m.get(k) ?? Object.fromEntries(METRIEKEN.map((x) => [x, 0]));
    for (const x of METRIEKEN) a[x] += Number(r[x] ?? 0);
    m.set(k, a);
  }
  return m;
}

async function main() {
  // ── De generator ──────────────────────────────────────────────────────────
  const rijen = demoRows() as unknown as Record<string, Row[]>;
  const account = rijen.ads_account_daily;
  const { landen, staten } = googleGeoDagRijen(DEMO_GREENTECH_ID, account);
  check("de mock serveert dezelfde rijen als de generator",
    JSON.stringify(rijen.ads_country_daily) === JSON.stringify(landen) && JSON.stringify(rijen.ads_region_daily) === JSON.stringify(staten));
  check("er zijn landrijen en staatrijen", landen.length > account.length && staten.length > account.length);

  // Land per dag telt op tot het account per dag.
  const landPerDag = somPer(landen, (r) => String(r.date));
  let landFout = "";
  for (const a of account) {
    const s = landPerDag.get(String(a.date));
    for (const x of METRIEKEN) if (!s || !gelijk(s[x], Number(a[x] ?? 0))) landFout ||= `${a.date} ${x}: ${s?.[x]} tegen ${a[x]}`;
  }
  check("de landen van een dag tellen op tot het account van die dag", landFout === "" && landPerDag.size === account.length, landFout);
  check("de gehele metrieken tellen exact op", account.every((a) => {
    const s = landPerDag.get(String(a.date))!;
    return ["impressions", "clicks", "conversions"].every((x) => s[x] === Number(a[x]));
  }));

  // Staten tellen op tot de VS.
  const vsPerDag = new Map(landen.filter((r) => r.country_code === "US").map((r) => [String(r.date), r]));
  const statenPerDag = somPer(staten, (r) => String(r.date));
  let statFout = "";
  for (const [dag, vs] of vsPerDag) {
    const s = statenPerDag.get(dag);
    for (const x of METRIEKEN) if (!s || !gelijk(s[x], Number(vs[x] ?? 0))) statFout ||= `${dag} ${x}: ${s?.[x]} tegen ${vs[x]}`;
  }
  check("de staten van een dag tellen op tot de VS van die dag", statFout === "" && statenPerDag.size === vsPerDag.size, statFout);
  check("de staten zijn VS-staten met een USPS-code en een Engelse naam",
    staten.every((r) => r.country_code === "US" && /^[A-Z]{2}$/.test(String(r.region_code)) && String(r.region_name).length > 2)
    && staten.some((r) => r.region_code === "CA" && r.region_name === "California"));

  // Kolommen exact als migratie 111 (zonder synced_at, die vult de database).
  const kolommen = (r: Row) => Object.keys(r).sort().join(",");
  check("landkolommen als ads_country_daily", kolommen(landen[0]) === "clicks,client_id,conversions,conversions_value,cost,country_code,date,impressions", kolommen(landen[0]));
  check("staatkolommen als ads_region_daily", kolommen(staten[0]) === "clicks,client_id,conversions,conversions_value,cost,country_code,date,impressions,region_code,region_name", kolommen(staten[0]));

  // ── De kaart in de demo ───────────────────────────────────────────────────
  // De terugval, herkenbaar: wat de mockverdeling zou geven.
  const mock = (kanaal: "google" | "meta"): Record<GeoLevel, GeoKanaalTelling> => ({
    country: { kanaal, rows: [{ code: "ZZ", impressions: 1, clicks: 1, cost: 1, conversions: 1, conversionsValue: 1 }], label: null, exact: true, opmerking: "mock" },
    region: { kanaal, rows: [{ code: "ZZ", impressions: 1, clicks: 1, cost: 1, conversions: 1, conversionsValue: 1 }], label: null, exact: true, opmerking: "mock" },
  });
  const periode = { start: "2026-10-01", eind: "2026-10-31" };
  const vergelijking = { start: "2026-09-01", eind: "2026-09-30" };
  const demo = (): GeoPeriodeResultaat => ({
    periode, vergelijking,
    kanalen: [{ kanaal: "google", nu: mock("google"), toen: mock("google") }, { kanaal: "meta", nu: mock("meta"), toen: null }],
  });
  const verwacht = (p: { start: string; eind: string }, tabel: Row[], code: string) =>
    tabel.filter((r) => String(r.date) >= p.start && String(r.date) <= p.eind && (r.country_code === code || r.region_code === code))
      .reduce((s, r) => s + Number(r.cost), 0);

  {
    // Met dagrijen: Google uit de dagrijen, Meta ongemoeid.
    const sb = new FakeSupabase();
    sb.seed("ads_country_daily", landen);
    sb.seed("ads_region_daily", staten);
    const uit = await demoMetGoogleDagen(sb as never, `gads-${DEMO_GREENTECH_ID}`, demo());
    const g = uit.kanalen.find((k) => k.kanaal === "google")!;
    const nl = g.nu.country.rows.find((r) => r.code === "NL");
    const ca = g.nu.region.rows.find((r) => r.code === "CA");
    const nlToen = g.toen!.country.rows.find((r) => r.code === "NL");
    check("de kaart in de demo neemt de dagweg als er rijen zijn (land)", !!nl && gelijk(nl.cost, verwacht(periode, landen, "NL")) && !g.nu.country.rows.some((r) => r.code === "ZZ"));
    check("de kaart in de demo neemt de dagweg als er rijen zijn (staat)", !!ca && gelijk(ca.cost, verwacht(periode, staten, "CA")));
    check("de vergelijkingsperiode ook uit de dagrijen", !!nlToen && gelijk(nlToen.cost, verwacht(vergelijking, landen, "NL")));
    const totaal = g.nu.country.rows.reduce((s, r) => s + r.cost, 0);
    const accountTotaal = account.filter((r) => String(r.date) >= periode.start && String(r.date) <= periode.eind).reduce((s, r) => s + Number(r.cost), 0);
    check("de landen op de kaart tellen op tot het account over de periode", gelijk(totaal, accountTotaal), `${totaal} tegen ${accountTotaal}`);
    check("meta blijft de mockweg", uit.kanalen.find((k) => k.kanaal === "meta")!.nu.country.opmerking === "mock");
  }
  {
    // Zonder rijen: de bestaande terugval, ongewijzigd.
    const sb = new FakeSupabase();
    const uit = await demoMetGoogleDagen(sb as never, DEMO_GREENTECH_ID, demo());
    check("zonder dagrijen blijft de mockverdeling", JSON.stringify(uit) === JSON.stringify(demo()));
  }
  {
    // Een lezing die faalt (tabel ontbreekt): de terugval, geen throw.
    const sb = new FakeSupabase();
    sb.faalOp("ads_country_daily");
    sb.faalOp("ads_region_daily");
    const uit = await demoMetGoogleDagen(sb as never, DEMO_GREENTECH_ID, demo());
    check("een ontbrekende tabel geeft de terugval", JSON.stringify(uit) === JSON.stringify(demo()));
  }
  {
    // Half gedekt: de periode wel, de vergelijking niet. Dan blijven BEIDE periodes op de mock, zodat
    // ze uit één bron komen (eerst kwam de periode uit de dagrijen en de vergelijking uit de mock).
    const sb = new FakeSupabase();
    sb.seed("ads_country_daily", landen.filter((r) => String(r.date) >= "2026-09-15"));
    sb.seed("ads_region_daily", staten.filter((r) => String(r.date) >= "2026-09-15"));
    const uit = await demoMetGoogleDagen(sb as never, DEMO_GREENTECH_ID, demo());
    const g = uit.kanalen.find((k) => k.kanaal === "google")!;
    check("half gedekt: de periode blijft ook op de mock", g.nu.country.opmerking === "mock" && g.nu.region.opmerking === "mock");
    check("half gedekt: de vergelijking blijft op de mock", g.toen!.country.opmerking === "mock" && g.toen!.region.opmerking === "mock");
    // Zonder vergelijking dekken de dagrijen de periode wel: dan de dagweg.
    const alleen = await demoMetGoogleDagen(sb as never, DEMO_GREENTECH_ID, { ...demo(), vergelijking: null,
      kanalen: [{ kanaal: "google", nu: mock("google"), toen: null }] });
    check("zonder vergelijking en gedekt: de dagweg", alleen.kanalen[0].nu.country.opmerking !== "mock");
  }

  // ── De verdeling over een periode ─────────────────────────────────────────
  // Per code komt de som over twaalf maanden bij zijn aandeel uit. Een geheel getal tegen een exact
  // aandeel, met een afrondingsrest aan begin en eind van de periode: minder dan 2 ernaast. Eerst
  // werd elke dag los afgerond, en kregen 23 van de 30 staten over een jaar 0 conversies.
  {
    const jaar = { start: "2025-11-01", eind: "2026-10-31" };
    const binnen = (r: Row) => String(r.date) >= jaar.start && String(r.date) <= jaar.eind;
    const accountJaar = somPer(account.filter(binnen), () => "x").get("x")!;
    const landJaar = somPer(landen.filter(binnen), (r) => String(r.country_code));
    const landProfiel = demoGeoCountries("google");
    const vsJaar = landJaar.get("US")!;
    const statenJaar = somPer(staten.filter(binnen), (r) => String(r.region_code));
    const statenProfiel = demoGeoStates("google");
    let afwijking = "";
    const toets = (profiel: GeoAgg[], som: Map<string, Record<string, number>>, totaal: Record<string, number>) => {
      for (const m of ["impressions", "clicks", "cost", "conversions"] as const) {
        const gewicht = profiel.reduce((s, p) => s + p[m], 0);
        for (const p of profiel) {
          const verwacht = (p[m] / gewicht) * totaal[m];
          const kreeg = som.get(p.code)?.[m] ?? 0;
          if (Math.abs(kreeg - verwacht) >= 2) afwijking ||= `${p.code} ${m}: ${kreeg} tegen ${verwacht.toFixed(1)}`;
        }
      }
    };
    toets(landProfiel, landJaar, accountJaar);
    toets(statenProfiel, statenJaar, vsJaar);
    check("over twaalf maanden krijgt elke code zijn aandeel (land en staat)", afwijking === "", afwijking);
    const pa = statenJaar.get("PA")?.conversions ?? 0;
    check("Pennsylvania krijgt zijn conversies", pa > 0, String(pa));
  }
  check("geen staat-dag met omzet zonder conversies", !staten.some((r) => Number(r.conversions) === 0 && Number(r.conversions_value) > 0),
    String(staten.filter((r) => Number(r.conversions) === 0 && Number(r.conversions_value) > 0).length));
  check("geen land-dag met omzet zonder conversies", !landen.some((r) => Number(r.conversions) === 0 && Number(r.conversions_value) > 0));
  check("geen negatieve delen", [...landen, ...staten].every((r) => METRIEKEN.every((x) => Number(r[x]) >= 0)));
  {
    const r = verdeelReeks([3, 4, 3, 4], [1, 1, 1, 1, 1, 1, 1]);
    check("verdeelReeks: per dag exact het dagtotaal", r.every((d, t) => d.reduce((s, x) => s + x, 0) === [3, 4, 3, 4][t]));
    const som = r[0].map((_, i) => r.reduce((s, d) => s + d[i], 0));
    check("verdeelReeks: de rest schuift door naar wie nog niets kreeg", som.every((x) => x === 2), JSON.stringify(som));
  }

  // ── De aansluiting in resolveGeoPeriode ───────────────────────────────────
  // De hele demotak met een ingespoten database: met dagrijen neemt Google de dagweg, zonder de mock.
  {
    const zaai = (metGeo: boolean) => {
      const sb = new FakeSupabase();
      for (const [tabel, r] of Object.entries(rijen)) {
        if (!metGeo && (tabel === "ads_country_daily" || tabel === "ads_region_daily")) continue;
        sb.seed(tabel, r);
      }
      sb.seed("accounts", [{ id: "acc-demo", client_id: DEMO_GREENTECH_ID, name: "Demo", source: "google_ads", external_id: "1", agency_id: "a" }]);
      sb.seed("fact_core", (rijen.ads_account_monthly ?? []).map((r) => ({
        account_id: "acc-demo", channel: "google", level: "account", grain: "month", period_start: `${String(r.month).slice(0, 7)}-01`,
        impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, conv_value: r.conversions_value,
      })));
      return sb;
    };
    const vraag = { clientId: DEMO_GREENTECH_ID, channel: "google" as const, periode, vergelijking };
    const met = await resolveGeoPeriode(vraag, zaai(true) as never);
    const zonder = await resolveGeoPeriode(vraag, zaai(false) as never);
    const nl = (x: GeoPeriodeResultaat) => x.kanalen[0].nu.country.rows.find((r) => r.code === "NL")?.cost ?? NaN;
    const pa = (x: GeoPeriodeResultaat) => x.kanalen[0].toen!.region.rows.find((r) => r.code === "PA")?.cost ?? NaN;
    check("resolveGeoPeriode in de demo: met dagrijen de dagweg", gelijk(nl(met), verwacht(periode, landen, "NL")) && gelijk(pa(met), verwacht(vergelijking, staten, "PA")),
      `${nl(met)} tegen ${verwacht(periode, landen, "NL")}`);
    check("resolveGeoPeriode in de demo: zonder dagrijen de mockverdeling", Number.isFinite(nl(zonder)) && !gelijk(nl(zonder), verwacht(periode, landen, "NL")),
      String(nl(zonder)));
  }

  console.log(`geo-dag-demo: ${passed} geslaagd, ${failed} mislukt`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

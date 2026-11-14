// De kaart per dag (nieuwe weergave): wat elk kanaal over de periode van de kiezer per land telde
// (lib/geo/geo-dag.ts), de terugval van Google op de maanden alleen voor het deel vóór de dagopslag,
// de verandering per land tegen de vergelijkingsperiode (ook met een ontbrekend land), en dat
// /api/geo zonder periode precies het oude antwoord geeft (de schakelaar uit).
// Draaien: tsx --tsconfig ./tsconfig.json lib/geo/__geo_dag_test.ts

import { NextRequest } from "next/server";
import { geoVergelijking, telGeoKanaal, type GeoDagRij, type GeoKanaalTelling } from "./geo-dag";
import { metaGeoDagen, telGeoPeriode } from "./geo-periode";
import { resolveGeo } from "./geo-source";
import type { GeoAgg } from "../demo/geo-demo";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { GET } from "../../app/api/geo/route";

// Nooit een echte database: de kaart van de demo leest met sleutels de geseede database (geo-periode.ts).
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete process.env[k];

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const r = (date: string, code: string, cost: number, conversions = 1): GeoDagRij =>
  ({ date, code, impressions: 100, clicks: 10, cost, conversions, conversionsValue: 0 });
const conv = (a: GeoAgg) => a.conversions;

console.log("Eén kanaal over een periode per dag");
{
  const meta = telGeoKanaal({ start: "2026-11-03", eind: "2026-11-05" }, {
    kanaal: "meta", dagen: [r("2026-11-02", "NL", 100), r("2026-11-03", "NL", 1), r("2026-11-05", "NL", 2), r("2026-11-05", "DE", 4), r("2026-11-06", "DE", 100)],
  });
  check("exact de dagen van de periode, per land opgeteld",
    meta.rows.length === 2 && meta.rows.find((x) => x.code === "NL")?.cost === 3 && meta.rows.find((x) => x.code === "DE")?.cost === 4, JSON.stringify(meta.rows));
  check("zonder terugval geen label", meta.label === null && meta.exact && meta.opmerking === null);

  const geen = telGeoKanaal({ start: "2026-11-03", eind: "2026-11-05" }, { kanaal: "linkedin", dagen: null });
  check("een kanaal zonder landdata wordt genoemd", geen.rows.length === 0 && geen.opmerking === "LinkedIn heeft geen landdata.", String(geen.opmerking));
}

console.log("Google: terugval alleen voor het deel vóór de dagopslag");
{
  const dagen = [r("2026-11-01", "NL", 5), r("2026-11-10", "NL", 6), r("2026-11-11", "DE", 7)];
  const maanden = [r("2026-09-01", "NL", 50), r("2026-10-01", "NL", 60), r("2026-10-01", "BE", 9), r("2026-11-01", "NL", 999)];
  const t = telGeoKanaal({ start: "2026-09-01", eind: "2026-11-30" }, { kanaal: "google", dagen, maanden, eersteDag: "2026-11-01" });
  check("sep en okt per maand, nov per dag (de novembermaand telt niet mee)",
    t.rows.find((x) => x.code === "NL")?.cost === 50 + 60 + 5 + 6 && t.rows.find((x) => x.code === "BE")?.cost === 9 && t.rows.find((x) => x.code === "DE")?.cost === 7, JSON.stringify(t.rows));
  check("en het label zegt dat precies", t.label === "1 t/m 30 nov 2026 per dag; sep–okt 2026 per maand, voor de dagopslag begon", String(t.label));
  check("hele maanden gevraagd, dus exact", t.exact);

  const binnen = telGeoKanaal({ start: "2026-11-05", eind: "2026-11-10" }, { kanaal: "google", dagen, maanden, eersteDag: "2026-11-01" });
  check("een periode binnen de dagopslag: per dag, zonder label", binnen.label === null && binnen.rows.length === 1 && binnen.rows[0].cost === 6);

  const half = telGeoKanaal({ start: "2026-10-15", eind: "2026-11-10" }, { kanaal: "google", dagen, maanden, eersteDag: "2026-11-01" });
  check("een halve maand vóór de dagopslag: hele maand, niet exact, en dat staat erbij", !half.exact && !!half.label?.includes("hele maanden"), String(half.label));

  const zonder = telGeoKanaal({ start: "2026-09-01", eind: "2026-10-31" }, { kanaal: "google", dagen: null, maanden });
  check("zonder dagtabel: de maanden, met de reden", zonder.label === "sep–okt 2026 per maand, er is nog geen dagopslag" && zonder.rows.find((x) => x.code === "NL")?.cost === 110, String(zonder.label));
}

console.log("De verandering per land");
{
  const tel = (kanaal: GeoKanaalTelling["kanaal"], rows: GeoAgg[], exact = true): GeoKanaalTelling => ({ kanaal, rows, label: null, exact, opmerking: null });
  const agg = (code: string, conversions: number): GeoAgg => ({ code, impressions: 1, clicks: 1, cost: 1, conversions, conversionsValue: 0 });
  const v = geoVergelijking(
    [tel("google", [agg("NL", 12), agg("FR", 5), agg("DE", 3)]), tel("meta", [agg("NL", 8)])],
    [tel("google", [agg("NL", 10), agg("DE", 0)]), tel("meta", [])],
    conv,
  );
  check("per land gepaard over de kanalen met data in beide periodes", Math.abs((v.perCode.get("NL")?.pct ?? 0) - 0.2) < 1e-12, JSON.stringify([...v.perCode]));
  check("een land zonder data in de vergelijkingsperiode: geen percentage, wel een reden",
    v.perCode.get("FR")?.pct === null && v.perCode.get("FR")?.reden === "geen data in de vergelijkingsperiode");
  check("nul in de vergelijkingsperiode is geen percentage", v.perCode.get("DE")?.pct === null && v.perCode.get("DE")?.reden === "nul in de vergelijkingsperiode");
  check("een kanaal zonder landdata in de vergelijkingsperiode valt buiten de verandering, met reden",
    v.gepaard.join() === "google" && v.buiten.length === 1 && v.buiten[0].startsWith("Meta had in de vergelijkingsperiode geen landdata"));

  const ongelijk = geoVergelijking([tel("google", [agg("NL", 12)], false)], [tel("google", [agg("NL", 10)])], conv);
  check("hele maanden tegen dagen is geen eerlijke vergelijking", ongelijk.perCode.get("NL")?.pct === null && ongelijk.buiten[0].includes("hele maanden"));
}

console.log("Meta op regioniveau: een regio buiten de VS is niet onbekend");
{
  const r = (date: string, waarde: string) => ({ date, breakdown_value: waarde, impressions: 10, link_clicks: 1, spend: 2, conversions: 1, conversion_value: 3 });
  const regio = metaGeoDagen([r("2026-11-02", "California"), r("2026-11-02", "North Holland"), r("2026-11-03", "Bavaria")], "region");
  check("de Amerikaanse staat telt", regio.dagen.length === 1 && regio.dagen[0].code === "CA");
  check("een provincie elders valt af zonder melding als onbekend", regio.onbekend === 0, String(regio.onbekend));
  const land = metaGeoDagen([r("2026-11-02", "NL"), r("2026-11-02", "Atlantis")], "country");
  check("op landniveau blijft een onvertaalbaar land onbekend", land.dagen.length === 1 && land.onbekend === 1);
}

async function main() {
  console.log("De periode en de vergelijking in één lezing per kanaal en niveau");
  {
    const vensters: string[] = [];
    const uit = await telGeoPeriode(["meta"], { start: "2026-11-01", eind: "2026-11-07" }, { start: "2025-11-01", eind: "2025-11-07" }, async (kanaal, niveau, v) => {
      vensters.push(`${niveau}:${v.start}..${v.eind}`);
      return { kanaal, dagen: [r("2025-11-03", "NL", 1), r("2026-11-03", "NL", 2), r("2026-11-03", "US", 3)] };
    });
    check("één lezing per niveau over beide periodes samen", vensters.join() === "country:2025-11-01..2026-11-07,region:2025-11-01..2026-11-07", vensters.join());
    check("de periode en de vergelijking apart geteld", uit.kanalen[0].nu.country.rows.length === 2 && uit.kanalen[0].toen?.country.rows.length === 1);
    const zonder = await telGeoPeriode(["meta"], { start: "2026-11-01", eind: "2026-11-07" }, null, async (kanaal) => ({ kanaal, dagen: [] }));
    check("zonder vergelijking alleen totalen", zonder.vergelijking === null && zonder.kanalen[0].toen === null);
  }

  // De demo per dag staat in lib/demo/__geo_demo_periode_test.ts: de kaart telt daar op tot de
  // kanaaltotalen van de kerncijfers, uit dezelfde rijen.

  console.log("/api/geo: zonder periode het oude antwoord, met periode per dag");
  {
    const vraag = (q: string) => GET(new NextRequest(`http://localhost/api/geo?clientId=${DEMO_GREENTECH_ID}&channel=google&level=beide${q}`));
    const oud = await (await vraag("")).json();
    const verwacht = { country: await resolveGeo({ clientId: DEMO_GREENTECH_ID, channel: "google", level: "country" }), region: await resolveGeo({ clientId: DEMO_GREENTECH_ID, channel: "google", level: "region" }) };
    check("zonder van/tot: hetzelfde antwoord als voorheen (het vaste venster)",
      JSON.stringify(oud.niveaus) === JSON.stringify(verwacht) && oud.kanalen === undefined);
    const nieuw = await (await vraag("&van=2026-11-01&tot=2026-11-10")).json();
    check("met van/tot: per kanaal per dag", Array.isArray(nieuw.kanalen) && nieuw.kanalen[0].kanaal === "google" && nieuw.periode.start === "2026-11-01");
    const fout = await vraag("&van=2026-11-10&tot=2026-11-01");
    check("een omgekeerde periode is een 400", fout.status === 400);
    const vfout = await vraag("&van=2026-11-01&tot=2026-11-10&vvan=2025-13-01&vtot=2025-11-10");
    check("een ongeldige vergelijking is een 400", vfout.status === 400);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

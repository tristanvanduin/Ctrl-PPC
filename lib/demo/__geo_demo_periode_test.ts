// F2 uit de browser: de kaart in de demo kwam uit een andere bron dan de rest van de pagina. /api/geo
// gaf mockcijfers voor elke dag, ook voor Meta in een periode waarin Meta volgens de kerncijfers (de
// geseede database, Meta pas vanaf 7 jun 2026) nog niet liep.
//
// Nu telt de kaart in de demo per kanaal en periode op tot dezelfde kanaaltotalen als de kerncijfers:
// dezelfde rijen (laadDemoGeoInvoer), dezelfde telling (telDagPeriode), verdeeld over de landen met
// de vaste aandelen van de mock. Een kanaal dat nog niet liep heeft geen landcijfers en wordt genoemd.
//
// Draaien: tsx --tsconfig ./tsconfig.json lib/demo/__geo_demo_periode_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import { demoRows } from "./demo-rows";
import { DEMO_GREENTECH_ID } from "./greentech-mock";
import { demoGeoCountries } from "./geo-demo";
import { demoGeoPeriode, demoGeoUitTelling, laadDemoGeoInvoer } from "./geo-demo-periode";
import { verdeelOverProfiel } from "./geo-dag-demo";
import { telDagPeriode } from "../period/dag-telling";
import { geoVergelijking, somPerCode, type GeoDagKanaal } from "../geo/geo-dag";
import { geoDagRegels } from "../geo/use-geo-breakdown";
import type { DagPeriode } from "../period/dag-periode";
import { resolveGeoPeriode } from "../geo/geo-periode";
import { getSupabaseAdmin } from "../supabase-admin";

// Nooit een echte database: de kaart van de demo leest met sleutels de geseede database (geo-periode.ts).
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete process.env[k];

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const gelijk = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
const ALLE: GeoDagKanaal[] = ["google", "meta", "linkedin", "microsoft"];

async function main() {
  // De database zoals de demo hem heeft: Meta pas vanaf 7 jun 2026, en ads_account_daily bestaat nog
  // niet (migratie 111 niet gedraaid).
  const rijen = demoRows() as unknown as Record<string, Record<string, unknown>[]>;
  const sb = new FakeSupabase();
  for (const [tabel, r] of Object.entries(rijen)) {
    sb.seed(tabel, tabel === "meta_account_daily" ? r.filter((x) => String(x.date) >= "2026-06-07") : r);
  }
  sb.faalOp("ads_account_daily");
  // De vertoningen en klikken van Google per maand komen uit de blended route (fact_core, per
  // account), zoals op de pagina. Zonder die rijen heeft Google op de kaart geen landcijfers.
  sb.seed("accounts", [{ id: "acc-demo", client_id: DEMO_GREENTECH_ID, name: "Demo", source: "google_ads", external_id: "1", agency_id: "a" }]);
  sb.seed("fact_core", (rijen.ads_account_monthly ?? []).map((r) => ({
    account_id: "acc-demo", channel: "google", level: "account", grain: "month", period_start: `${String(r.month).slice(0, 7)}-01`,
    impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, conv_value: r.conversions_value,
  })));
  const invoer = await laadDemoGeoInvoer(sb as never, DEMO_GREENTECH_ID);
  check("de invoer heeft de rijen van de pagina", !!invoer.google?.maanden && !!invoer.google.weken?.length && invoer.google.dagen === null
    && !!invoer.dagkanalen?.meta?.length && !!invoer.dagkanalen.linkedin?.length && !!invoer.dagkanalen.microsoft?.length
    && !!invoer.google.maandTellers?.size);

  const somKlopt = (p: DagPeriode, vergelijking: DagPeriode | null, kanalen: GeoDagKanaal[]) => {
    const kaart = demoGeoPeriode(kanalen, p, vergelijking, invoer);
    const kern = telDagPeriode(p, invoer);
    return { kaart, kern };
  };

  console.log("Black Friday 2025: de kaart telt op tot de kerncijfers, Meta liep nog niet");
  {
    const p = { start: "2025-11-21", eind: "2025-12-01" };
    const c = { start: "2025-11-10", eind: "2025-11-20" };
    const { kaart, kern } = somKlopt(p, c, ALLE);
    for (const k of ["google", "linkedin"] as const) {
      const t = kern.perKanaal.find((x) => x.kanaal === k)!;
      const rows = kaart.kanalen.find((x) => x.kanaal === k)!.nu.country.rows;
      const som = somPerCode(rows.map((r) => ({ ...r, code: "X" })))[0];
      check(`${k}: de landen tellen op tot de kosten en conversies van de kerncijfers`,
        t.totalen.adSpend > 0 && gelijk(som.cost, t.totalen.adSpend) && gelijk(som.conversions, t.totalen.conversions) && gelijk(som.conversionsValue, t.totalen.revenue),
        `${som.cost} / ${t.totalen.adSpend}, ${som.conversions} / ${t.totalen.conversions}`);
      const vs = rows.find((r) => r.code === "US")!;
      const staten = somPerCode(kaart.kanalen.find((x) => x.kanaal === k)!.nu.region.rows.map((r) => ({ ...r, code: "X" })))[0];
      check(`${k}: de staten tellen op tot het deel van de VS`, gelijk(staten.cost, vs.cost) && gelijk(staten.conversions, vs.conversions));
    }
    const meta = kaart.kanalen.find((x) => x.kanaal === "meta")!;
    check("Meta heeft geen landcijfers in een periode waarin het nog niet liep",
      meta.nu.country.rows.length === 0 && meta.nu.region.rows.length === 0, JSON.stringify(meta.nu.country.rows.slice(0, 2)));
    check("en dat wordt gezegd", meta.nu.country.opmerking === "Meta liep in deze periode nog niet; eerste dag met data: 7 jun 2026.", String(meta.nu.country.opmerking));
    const regels = geoDagRegels(kaart.kanalen, "country", []);
    check("de kaart noemt Meta en Microsoft als kanalen zonder landcijfers",
      !!regels.toevoeging?.includes("Meta") && regels.toevoeging.includes("Microsoft Ads") && regels.regels.includes("Meta liep in deze periode nog niet; eerste dag met data: 7 jun 2026."), JSON.stringify(regels));
    const google = kaart.kanalen.find((x) => x.kanaal === "google")!;
    check("Google telt hier per maand, met het label van de kerncijfers, en niet exact",
      !!google.nu.country.label?.startsWith("nov–dec 2025 per maand") && google.nu.country.exact === false, String(google.nu.country.label));
    const v = geoVergelijking(kaart.kanalen.map((k) => k.nu.country), kaart.kanalen.flatMap((k) => (k.toen ? [k.toen.country] : [])), (a) => a.conversions);
    check("Google valt buiten de verandering per land: hele maanden tegen dagen, net als in de kerncijfers",
      !v.gepaard.includes("google") && v.buiten.some((b) => b.startsWith("Google Ads telde")), JSON.stringify(v.buiten));
  }

  console.log("Een periode waarin Meta liep: ook Meta telt op tot de kerncijfers");
  {
    const p = { start: "2026-07-01", eind: "2026-07-10" };
    const { kaart, kern } = somKlopt(p, null, ["meta"]);
    const t = kern.perKanaal.find((x) => x.kanaal === "meta")!;
    const som = somPerCode(kaart.kanalen[0].nu.country.rows.map((r) => ({ ...r, code: "X" })))[0];
    check("Meta: landen = kerncijfers, ook de vertoningen en klikken",
      gelijk(som.cost, t.totalen.adSpend) && gelijk(som.conversions, t.totalen.conversions) && som.impressions === t.tellers!.impressions && som.clicks === t.tellers!.clicks,
      `${som.cost} / ${t.totalen.adSpend}`);
    check("met de landen van het Meta-profiel", kaart.kanalen[0].nu.country.rows.map((r) => r.code).join() === demoGeoCountries("meta").map((r) => r.code).join());
  }

  console.log("Herstel 4: de id met het voorvoegsel gads- leest dezelfde rijen");
  {
    const met = await laadDemoGeoInvoer(sb as never, `gads-${DEMO_GREENTECH_ID}`);
    check("weekrijen en dagrijen ook met gads-",
      met.google?.weken?.length === invoer.google?.weken?.length && (met.google?.weken?.length ?? 0) > 0
      && met.dagkanalen?.meta?.length === invoer.dagkanalen?.meta?.length && (met.dagkanalen?.linkedin?.length ?? 0) > 0,
      `${met.google?.weken?.length} / ${invoer.google?.weken?.length}`);
    const p = { start: "2026-07-01", eind: "2026-07-10" };
    const a = demoGeoPeriode(["google", "linkedin"], p, null, met);
    const b = demoGeoPeriode(["google", "linkedin"], p, null, invoer);
    check("en dus dezelfde kaart", JSON.stringify(a) === JSON.stringify(b));
  }

  console.log("Herstel 6: zonder vertoningen en klikken geen nullen op de kaart");
  {
    const t = telDagPeriode({ start: "2026-07-01", eind: "2026-07-10" }, invoer).perKanaal.find((x) => x.kanaal === "google")!;
    const g = demoGeoUitTelling("google", { ...t, tellers: null }, "country");
    check("geen landcijfers met vertoningen 0", g.rows.length === 0, JSON.stringify(g.rows.slice(0, 1)));
    check("en dat wordt gezegd", !!g.opmerking?.includes("niet bekend") && !g.opmerking.includes("op nul"), String(g.opmerking));
    check("met tellers wel landcijfers", demoGeoUitTelling("google", t, "country").rows.length > 0);
  }

  console.log("De verdeling zelf");
  {
    const profiel = demoGeoCountries("google");
    const d = verdeelOverProfiel({ impressions: 1001, clicks: 77, cost: 1234.56, conversions: 12.5, conversionsValue: 999 }, profiel);
    const s = somPerCode(d.map((r) => ({ ...r, code: "X" })))[0];
    check("de som van de delen is exact het totaal", s.impressions === 1001 && s.clicks === 77 && gelijk(s.cost, 1234.56) && gelijk(s.conversions, 12.5) && s.conversionsValue === 999);
    check("een markt zonder conversies in het profiel krijgt er geen", d.find((r) => r.code === "FR")?.conversions === 0);
    check("zonder telling: geen landdata, en dat wordt gezegd", demoGeoUitTelling("linkedin", null, "country").opmerking === "LinkedIn heeft geen landdata.");
  }

  console.log("/api/geo in de demo serveert de mockreeks per dag niet meer");
  {
    // Zonder database (de sleutels zijn bovenaan gewist) is er niets te tellen: de kaart zegt dat per
    // kanaal, en toont geen verzonnen landcijfers. Met een database loopt hij via laadDemoGeoInvoer.
    check("zonder sleutels geen database", getSupabaseAdmin() === null);
    const res = await resolveGeoPeriode({ clientId: DEMO_GREENTECH_ID, channel: "blended", periode: { start: "2025-11-21", eind: "2025-12-01" }, vergelijking: null });
    check("geen landcijfers uit een andere bron dan de pagina", res.kanalen.length === 4 && res.kanalen.every((k) => k.nu.country.rows.length === 0 && k.nu.region.rows.length === 0),
      JSON.stringify(res.kanalen.map((k) => [k.kanaal, k.nu.country.rows.length])));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

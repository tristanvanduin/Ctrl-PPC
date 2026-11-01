// Test: de KPI-band van de demo telt hetzelfde op als de kanaalkaarten eronder.
//
// Waarom hij er is. Op Overzicht "Alle kanalen" stond voor de demo 3.011 conversies, terwijl de
// kanalen eronder samen 3.401 gaven. De band telde Google uit een JS-fixture
// (lib/demo/greentech-mock.ts, via /api/google-ads/client-data) op bij Meta, LinkedIn en Microsoft
// uit de database. Twee verzonnen werelden in één optelling: andere bedragen, andere campagnes, en
// september en oktober 2026 die in de database niet eens bestonden. De vergelijkingsperiode was
// bovendien alleen fixture-Google.
//
// Wat hij controleert. demoRows() via createDemoSupabase is hier de database: één samenhangende
// set rijen. Google wordt gebouwd zoals de route hem serveert (seededDemoClientData ->
// buildClientDataFromApi, zoals lib/use-client-data.ts dat doet), Meta/LinkedIn/Microsoft met
// precies de pure functies van de hook (lib/period/kanaal-maanden.ts). De kanaalkaarten worden
// per kanaal rechtstreeks uit dezelfde rijen opgeteld. Per venster moet de band gelijk zijn aan de
// som van de kaarten, en Google in de band gelijk aan ads_account_monthly.
//
// Geen netwerk, geen database: alles uit demoRows().

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoRows } from "./demo-rows";
import { createDemoSupabase } from "./mock-supabase";
import { DEMO_GREENTECH_ID as ID } from "./greentech-mock";
import { seededDemoClientData } from "./geoclone-demo-data";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import { NIET_GOOGLE, CONVERSIE_KANAAL, kanaalDagbron, kanaalStandUitDagen, samenvoegen, type NietGoogleKanaal } from "../period/kanaal-maanden";
import { comparePeriods, flattenMonths } from "../period/apply-period";
import { resolvePeriod, resolveComparison, monthsIn, type PeriodRange } from "../period/period-range";
import { resolveChannelConversionConfig, sumSelectedConversions } from "../analysis/channel-conversion-config";
import { today } from "../reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const route = readFileSync(join(import.meta.dirname, "..", "..", "app/api/google-ads/client-data/route.ts"), "utf8");
check("de client-data-route serveert de GreenTech-fixture niet meer", !/buildGreentechClientData\s*\(/.test(route));
check("de client-data-route leest de demoklanten uit de geseede database", /seededDemoClientData\s*\(/.test(route));

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
type Som = { conversions: number; adSpend: number; revenue: number };

async function main() {
  const rows = demoRows() as Record<string, Record<string, unknown>[]>;
  const sb = createDemoSupabase(null, rows);
  const cc = resolveChannelConversionConfig(null);

  // Google zoals de route hem serveert en use-client-data hem bouwt.
  const api = await seededDemoClientData(sb, ID);
  const google = buildClientDataFromApi(
    ID,
    (api.historicalYears as YearDataInput[]) ?? [],
    (api.currentYearMonthly as ApiMonthlyData[]) ?? [],
    (api.currentYearWeekly as ApiWeeklyData[]) ?? [],
    api.targetCurrentYear,
    api.currentYear,
    api.realizedThroughMonth,
  );
  // De andere drie zoals de hook ze bouwt: dezelfde pure functies, dezelfde tabel.
  const kanaal = (k: NietGoogleKanaal) => kanaalStandUitDagen(ID, rows[kanaalDagbron(k).table] ?? [], k, cc).data;
  const band = samenvoegen(ID, [google, ...NIET_GOOGLE.map(kanaal)]);

  // De kanaalkaarten: elk kanaal rechtstreeks uit zijn eigen rijen, zoals de kanaaltabs en de
  // cross-channel-tabel het tonen. Google alleen over afgesloten maanden: de lopende maand telt
  // nergens als gerealiseerd.
  const lopend = today().slice(0, 7);
  const kaart = (ch: "google" | NietGoogleKanaal, w: PeriodRange): Som => {
    const inW = new Set(monthsIn(w));
    const t: Som = { conversions: 0, adSpend: 0, revenue: 0 };
    if (ch === "google") {
      for (const r of rows.ads_account_monthly ?? []) {
        const k = String(r.month).slice(0, 7);
        if (!inW.has(k) || k >= lopend) continue;
        // Afgerond zoals de route het doorgeeft (toApiMonthly).
        t.conversions += Math.round(n(r.conversions)); t.adSpend += Math.round(n(r.cost)); t.revenue += Math.round(n(r.conversions_value));
      }
      return t;
    }
    for (const r of rows[kanaalDagbron(ch).table] ?? []) {
      if (!inW.has(String(r.date).slice(0, 7))) continue;
      t.conversions += sumSelectedConversions(r, CONVERSIE_KANAAL[ch], cc); t.adSpend += n(r.spend); t.revenue += n(r.conversion_value);
    }
    return t;
  };

  const p12 = resolvePeriod("last_12m");
  const p6 = resolvePeriod("last_6m");
  const ramen: [string, PeriodRange][] = [
    ["laatste 12 maanden", p12],
    ["zelfde periode vorig jaar", resolveComparison(p12, "same_period_last_year")!],
    ["dit jaar", resolvePeriod("this_year")],
    ["laatste 6 maanden", p6],
    ["voorgaande periode", resolveComparison(p6, "previous_period")!],
  ];
  for (const [naam, w] of ramen) {
    const b = comparePeriods(band, w, null).current.totals;
    const som: Som = { conversions: 0, adSpend: 0, revenue: 0 };
    for (const ch of ["google", ...NIET_GOOGLE] as const) {
      const k = kaart(ch, w);
      som.conversions += k.conversions; som.adSpend += k.adSpend; som.revenue += k.revenue;
    }
    for (const m of ["conversions", "adSpend", "revenue"] as const) {
      check(`${naam} ${w.start}..${w.end}: band.${m} == som van de kanaalkaarten`, Math.abs(b[m] - som[m]) < 0.5, `${Math.round(b[m])} tegen ${Math.round(som[m])}`);
    }
    const g = comparePeriods(google, w, null).current.totals.conversions;
    const gk = kaart("google", w).conversions;
    check(`${naam}: Google in de band == ads_account_monthly`, Math.abs(g - gk) < 0.5, `${g} tegen ${gk}`);
  }

  // Geen verzonnen maanden: elke Google-maand in de band bestaat als rij in de database.
  const dbMaanden = new Set((rows.ads_account_monthly ?? []).map((r) => String(r.month).slice(0, 7)));
  const vreemd = flattenMonths(google).filter((m) => !dbMaanden.has(m.key) && (m.conversions || m.adSpend || m.revenue));
  check("de band toont geen Google-maand die de database niet heeft", vreemd.length === 0, vreemd.map((m) => m.key).join(", "));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// De periodekeuze op de demo, via precies de keten die het dashboard gebruikt.
// Draaien: npx tsx lib/period/__period_demo_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De rekenlaag is los getest, maar dat bewijst niet dat de keten werkt: demo-bron -> route ->
// adapter -> ClientHistoricalData -> slicePeriod. Juist daar zit de aanname die stil fout kan
// gaan, namelijk dat de vorm die de demo oplevert dezelfde is als die van echte data. Gaat dat
// mis, dan toont het dashboard lege of halve totalen zonder een foutmelding.
//
// ── WAT HIJ EERST TOETSTE ───────────────────────────────────────────────────
//
// Hier liep de keten vanaf buildGreentechClientData, de JS-fixture in lib/demo/greentech-mock.ts.
// Het dashboard las de demo-Google toen ook uit die fixture, dus dat klopte. Sinds stap 0 serveert
// /api/google-ads/client-data de demo uit de geseede database (seededDemoClientData), omdat de
// KPI-band fixture-Google optelde bij Meta, LinkedIn en Microsoft uit de database. Was deze test
// op de fixture blijven staan, dan had hij groen gestaan bij een bron die niemand meer ziet: een
// controle die iets anders verifieert dan hij beweert.
//
// Daarna liep hij op demoRows() via createDemoSupabase. Ook dat is niet wat het dashboard leest:
// de route haalt de demo met getSupabaseAdmin uit de echte database, en demoRows loopt t/m de
// laatste kalendermaand met historie ver genoeg terug. Daarop stond "elke maand van de
// vergelijking heeft echt besteding" groen, terwijl de echte seed (t/m 26 augustus 2026, vanaf
// september 2024) op de standaardinstelling een maand zonder tegenhanger heeft. Een test die groen
// blijft hoe de seed er ook uitziet.
//
// Nu: een FakeSupabase met de grenzen van de echte seed (zie geseed), door seededDemoClientData en
// dezelfde adapteraanroep als lib/use-client-data.ts. De verwachtingen over de standaardinstelling
// zijn die van die grenzen; de rest komt uit de rijen en uit de datastand die de route meegeeft.

import { FakeSupabase } from "../decision/__fake_supabase";
import { seededDemoClientData } from "../demo/geoclone-demo-data";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import type { ClientHistoricalData } from "../types";
import { flattenMonths, slicePeriod, comparePeriods } from "./apply-period";
import {
  resolvePeriod, resolveComparison, monthCount, monthsIn, addMonths, monthIndex, lastCompleteMonth, vensterEindMaand,
  PERIOD_PRESETS, COMPARISON_MODES,
} from "./period-range";
import { today } from "../reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/**
 * De demo zoals de database hem heeft (gelezen op 1 november 2026, met alleen GET): maandrijen van
 * september 2024 t/m augustus 2026, weekrijen vanaf 2 maart 2026, en de laatste geslaagde sync op
 * 26 augustus. De waarden zelf zijn niet die van de seed; de grenzen wel, en die bepalen wat de
 * kiezer doet. Ook rijen van een andere klant, die nergens mogen meetellen.
 */
function geseed(): { sb: FakeSupabase; rows: Record<string, Record<string, unknown>[]> } {
  const rows: Record<string, Record<string, unknown>[]> = {
    ads_account_monthly: monthsIn({ start: "2024-09", end: "2026-08" }).map((k, i) => ({
      client_id: DEMO_GREENTECH_ID, month: `${k}-01`, impressions: 50_000 + i, clicks: 2_500, cost: 10_000 + 50 * i,
      conversions: 100 + i, conversions_value: 20_000 + 100 * i, ctr: 0.05, avg_cpc: 4, conversion_rate: 0.04,
    })),
    ads_account_weekly: [],
    client_sync_status: [{ client_id: DEMO_GREENTECH_ID, last_successful_sync_at: "2026-08-26T06:44:34.346+00:00" }],
  };
  for (let d = Date.UTC(2026, 2, 2); d <= Date.UTC(2026, 7, 24); d += 7 * 86_400_000) {
    rows.ads_account_weekly.push({ client_id: DEMO_GREENTECH_ID, week_start: new Date(d).toISOString().slice(0, 10), impressions: 1, clicks: 1, cost: 2_500, conversions: 25, conversions_value: 5_000 });
  }
  const sb = new FakeSupabase();
  for (const [tabel, rijen] of Object.entries(rows)) sb.seed(tabel, rijen);
  sb.seed("ads_account_monthly", [{ client_id: "iemand-anders", month: "2026-10-01", cost: 999_999, conversions: 999, conversions_value: 0, impressions: 0, clicks: 0, ctr: 0, avg_cpc: 0, conversion_rate: 0 }]);
  return { sb, rows };
}

async function main() {
  const { sb, rows } = geseed();
  const api = await seededDemoClientData(sb as never, DEMO_GREENTECH_ID);
  // Exact wat lib/use-client-data.ts met het antwoord doet.
  const data: ClientHistoricalData = {
    ...buildClientDataFromApi(
      DEMO_GREENTECH_ID,
      api.historicalYears as YearDataInput[],
      api.currentYearMonthly as ApiMonthlyData[],
      api.currentYearWeekly as ApiWeeklyData[],
      api.targetCurrentYear,
      api.currentYear,
      api.realizedThroughMonth,
    ),
    dataStand: api.dataStand ?? null,
  };

  // De maanden die de database echt heeft, en tot waar de route ze definitief noemt.
  const dbMaanden = [...new Set((rows.ads_account_monthly ?? []).map((r) => String(r.month).slice(0, 7)))].sort();
  const EERSTE = dbMaanden[0];
  const VOL = data.dataStand?.laatsteVolleMaand ?? null;
  const metData = flattenMonths(data).filter((m) => m.conversions || m.revenue || m.adSpend);

  console.log("De datastand die de route meegeeft");
  {
    check("de route geeft een datastand mee", data.dataStand != null && VOL !== null, JSON.stringify(data.dataStand));
    // De sync van 26 augustus: juli is vol, augustus loopt t/m de 25e. Dat pad (een partiële
    // laatste maand) liep op demoRows nooit, want die rijen lopen t/m de laatste kalendermaand.
    check("op de seed: juli 2026 vol, augustus t/m de 25e",
      VOL === "2026-07" && data.dataStand?.partieel?.maand === "2026-08" && data.dataStand?.partieel?.tmDag === 25,
      JSON.stringify(data.dataStand));
    check("de laatste volle maand ligt niet voorbij de data", VOL !== null && VOL <= dbMaanden[dbMaanden.length - 1], `${VOL} vs ${dbMaanden[dbMaanden.length - 1]}`);
    check("en niet voorbij de kalender", VOL !== null && monthIndex(VOL) <= monthIndex(lastCompleteMonth()), String(VOL));
    check("data t/m is nooit vandaag of later", (data.dataStand?.dataTot ?? "") < today(), String(data.dataStand?.dataTot));
    const verwacht = VOL !== null && Number(VOL.slice(0, 4)) === api.currentYear ? Number(VOL.slice(5, 7)) : 0;
    check("realizedThroughMonth volgt de datastand, niet de klok", api.realizedThroughMonth === verwacht, `${api.realizedThroughMonth} vs ${verwacht}`);
  }

  console.log("De demo-data door de adapter");
  {
    check("er zijn maanden met data", metData.length > 0, String(metData.length));
    check("de eerste maand met data is de eerste databasemaand", metData[0]?.key === EERSTE, `${metData[0]?.key} vs ${EERSTE}`);
    check("de laatste maand met data is de laatste volle maand", metData[metData.length - 1]?.key === VOL, `${metData[metData.length - 1]?.key} vs ${VOL}`);
    check("elke maand met data bestaat in de database", metData.every((m) => dbMaanden.includes(m.key)));
    const verwachtAantal = dbMaanden.filter((m) => VOL !== null && m <= VOL).length;
    check("alle databasemaanden t/m de volle maand komen door", metData.length === verwachtAantal, `${metData.length} vs ${verwachtAantal}`);
    const alle = flattenMonths(data);
    check("elke maand vanaf de eerste databasemaand heeft besteding", alle.filter((m) => m.key >= EERSTE).every((m) => m.adSpend > 0));
    check("geen dubbele maanden", new Set(alle.map((m) => m.key)).size === alle.length);
    check("oplopend gesorteerd", alle.every((m, i) => i === 0 || alle[i - 1].key < m.key));
  }

  // De pagina laat de presets eindigen op de laatste volle maand met data (PeriodProvider, via
  // vensterEindMaand); "nu" is dus de maand daarna.
  const NU = addMonths(vensterEindMaand(VOL), 1);

  console.log("\nDe standaardinstelling van de kiezer");
  {
    // last_12m plus same_period_last_year is wat een gebruiker als eerste ziet. Op de seed is dat
    // aug 2025 - jul 2026 tegen aug 2024 - jul 2025, en de data begint in september 2024.
    const p = resolvePeriod("last_12m", null, NU);
    const c = resolveComparison(p, "same_period_last_year")!;
    const huidig = slicePeriod(data, p);
    const vorig = slicePeriod(data, c);
    check("de standaardperiode: aug 2025 t/m jul 2026", p.start === "2025-08" && p.end === "2026-07", `${p.start}..${p.end}`);
    check("de periode eindigt op de laatste volle maand", p.end === VOL, `${p.end} vs ${VOL}`);
    check("de standaardperiode is volledig gedekt", huidig.missing.length === 0, huidig.missing.join(","));
    check("de vergelijking ook (de adapter vult 2024 aan met nulmaanden)", vorig.missing.length === 0, vorig.missing.join(","));
    check("twaalf maanden data", huidig.months.length === 12, String(huidig.months.length));
    check("en twaalf om tegen af te zetten", vorig.months.length === 12);
    // Hier stond "elke maand van de vergelijking heeft echt besteding" en "er valt niets buiten de
    // vergelijking". Dat gold op demoRows (data t/m oktober 2026, met historie ver genoeg terug),
    // maar dat is niet de bron die het dashboard leest. Op de seed ligt augustus 2024 vóór de eerste
    // maand met data: een nulmaand die de adapter aanvult, geen gemeten nul. Augustus 2025 heeft dus
    // geen tegenhanger, en dat is precies waar het dashboard "niet gepaard" voor meldt.
    const zonderBesteding = vorig.months.filter((m) => !(m.adSpend > 0)).map((m) => m.key);
    check("in de vergelijking heeft alleen augustus 2024 geen besteding", zonderBesteding.join(",") === "2024-08", zonderBesteding.join(","));
    const r = comparePeriods(data, p, c);
    check("augustus 2025 valt buiten de vergelijking: één maand ongepaard", r.ongepaard.huidig === 1 && r.ongepaard.vorig === 0, JSON.stringify(r.ongepaard));
    // Het percentage gaat dan over de elf gepaarde maanden, niet over de volle twaalf tegen elf.
    const gepaardHuidig = huidig.months.filter((m) => m.key !== "2025-08").reduce((s, m) => s + m.adSpend, 0);
    check("het percentage gaat over de elf gepaarde maanden",
      r.deltas !== null && r.deltas.adSpend.huidig === gepaardHuidig && r.deltas.adSpend.vorig === vorig.totals.adSpend,
      `${JSON.stringify(r.deltas?.adSpend)} vs ${gepaardHuidig}/${vorig.totals.adSpend}`);
  }

  console.log("\nElke preset levert cijfers op de demo");
  {
    // Het eigen bereik binnen de data, afgeleid van de stand: een vast bereik schuift met de
    // klok uit het venster van een demo die vanaf vandaag terugrekent.
    const eigen = { start: addMonths(vensterEindMaand(VOL), -8), end: addMonths(vensterEindMaand(VOL), -2) };
    for (const preset of PERIOD_PRESETS) {
      const p = resolvePeriod(preset, eigen, NU);
      const s = slicePeriod(data, p);
      check(`${preset}: heeft maanden`, s.months.length > 0, `${p.start}..${p.end}`);
      check(`${preset}: geen ontbrekende maanden`, s.missing.length === 0, s.missing.join(","));
      check(`${preset}: totalen zijn eindig`, [s.totals.conversions, s.totals.revenue, s.totals.adSpend].every(Number.isFinite));
      check(`${preset}: besteding is positief`, s.totals.adSpend > 0);
    }
  }

  console.log("\nElke vergelijking levert een deltaset op");
  {
    for (const mode of COMPARISON_MODES) {
      const p = resolvePeriod("last_6m", null, NU);
      const c = resolveComparison(p, mode);
      const r = comparePeriods(data, p, c);
      if (mode === "none") {
        check("geen vergelijking geeft geen deltas", r.deltas === null);
        continue;
      }
      check(`${mode}: er zijn deltas`, r.deltas !== null);
      check(`${mode}: even veel maanden`, r.previous?.months.length === r.current.months.length,
        `${r.current.months.length} tegen ${r.previous?.months.length}`);
      check(`${mode}: percentages zijn eindig of null`,
        [r.deltas!.conversions.pct, r.deltas!.revenue.pct, r.deltas!.adSpend.pct]
          .every((v) => v === null || Number.isFinite(v)));
      // De demo groeit; een vergelijking die overal nul teruggeeft zou betekenen dat de snede de
      // verkeerde maanden pakt.
      check(`${mode}: de cijfers verschillen echt`, r.current.totals.adSpend !== r.previous!.totals.adSpend);
    }
  }

  console.log("\nDe grenzen van de demo-dataset");
  {
    // Verder terug dan de demo reikt: dat hoort gemeld te worden, niet stil ingekort. Het jaar
    // vóór het eerste datajaar bestaat niet; het eerste datajaar zelf vult de adapter aan.
    const eersteJaar = Number(EERSTE.slice(0, 4));
    const venster = { start: `${eersteJaar - 1}-07`, end: `${eersteJaar}-06` };
    const s = slicePeriod(data, venster);
    check("ontbrekende maanden worden gemeld", s.missing.length === 6, String(s.missing.length));
    check("en de bestaande komen wel terug", s.months.length === 6);
    check("het totaal is eindig", [s.totals.conversions, s.totals.revenue, s.totals.adSpend].every(Number.isFinite));
    check("de gevraagde lengte klopt met de som", s.months.length + s.missing.length === monthCount(venster));
    // De aangevulde nulmaanden vóór de eerste databasemaand mogen de start van de vergelijking
    // niet naar voren halen: dan telden ze als "echt nul" en groeide de demo uit het niets.
    const p = { start: EERSTE, end: addMonths(EERSTE, 2) };
    const r = comparePeriods(data, p, { start: addMonths(EERSTE, -12), end: addMonths(EERSTE, -10) });
    check("de start van de vergelijking is de eerste databasemaand", r.perBron[0]?.start === EERSTE, String(r.perBron[0]?.start));
    check("een periode zonder tegenhanger met data krijgt geen percentage", r.deltas?.adSpend.pct === null, String(r.deltas?.adSpend.pct));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

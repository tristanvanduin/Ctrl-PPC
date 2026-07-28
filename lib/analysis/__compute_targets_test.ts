// Test voor de doelberekening. Deterministisch, geen IO — Supabase wordt gemockt.
// Draaien: npx tsx lib/analysis/__compute_targets_test.ts
//
// Deze module bouwt de meetlat: de historische jaren, de huidige stand en het jaardoel waar de
// forecast en alle oordelen eromheen tegen worden afgezet. Staat die scheef, dan klopt er
// verderop niets meer — en niets valt op, want er komt gewoon een getal uit.
//
// Twee dingen zaten fout. buildWeeks filterde alleen op MAANDNUMMER, niet op jaar, terwijl de
// weekdata alleen voor het huidige jaar werd opgehaald. Juni 2024 kreeg daardoor de weken van
// juni 2026 aangehangen, en maanden die dit jaar nog niet geweest zijn kregen nul weken in
// elk historisch jaar. De forecast gebruikt die weken voor de verdeling binnen een maand en
// voor het aantal weken per maand.

import { computeAnalysisTargets, buildWeeks, type WeeklyRow } from "./compute-targets";
import { today } from "../reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Een Supabase die per tabel teruggeeft wat de test wil, met eerbied voor gte en lte op
// tekstkolommen — want juist dat bereik is hier het onderwerp.
function mockSupabase(tabellen: Record<string, Record<string, unknown>[]>) {
  const maak = (tabel: string) => {
    let rijen = [...(tabellen[tabel] ?? [])];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.gte = (kol: string, waarde: string) => { rijen = rijen.filter((r) => String(r[kol]) >= waarde); return q; };
    q.lte = (kol: string, waarde: string) => { rijen = rijen.filter((r) => String(r[kol]) <= waarde); return q; };
    q.maybeSingle = async () => ({ data: rijen[0] ?? null, error: null });
    q.then = (res: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rijen, error: null }).then(res);
    return q;
  };
  return { from: (t: string) => maak(t) } as never;
}

const [JAAR, MAAND] = today().split("-").slice(0, 2).map(Number);

const maandRij = (jaar: number, maand: number, o: Record<string, number> = {}) => ({
  client_id: "x", month: `${jaar}-${String(maand).padStart(2, "0")}-01`,
  cost: 1000, conversions: 20, conversions_value: 4000, ...o,
});
const weekRij = (datum: string, o: Record<string, number> = {}) => ({
  client_id: "x", week_start: datum, cost: 250, conversions: 5, conversions_value: 1000, ...o,
});

// Twaalf maanden per jaar, drie jaar terug.
function maanden(): Record<string, unknown>[] {
  const uit: Record<string, unknown>[] = [];
  for (const jaar of [JAAR - 2, JAAR - 1]) for (let m = 1; m <= 12; m++) uit.push(maandRij(jaar, m));
  for (let m = 1; m < MAAND; m++) uit.push(maandRij(JAAR, m));
  return uit;
}

async function main() {
  // ── buildWeeks: de kern van de fix, rechtstreeks getoetst ───────────────
  //
  // Dit is het gedrag dat fout was. Een test die alleen op vorm en NaN controleert zou hier
  // groen blijven terwijl de bug er nog in zit, en dat is erger dan geen test.

  console.log("buildWeeks koppelt weken aan het juiste jaar");
  {
    const weken: WeeklyRow[] = [
      { week_start: `${JAAR - 2}-03-02`, cost: 100, conversions: 22, conversions_value: 400 },
      { week_start: `${JAAR - 1}-03-01`, cost: 100, conversions: 11, conversions_value: 400 },
      { week_start: `${JAAR}-03-02`, cost: 100, conversions: 99, conversions_value: 400 },
      { week_start: `${JAAR}-06-01`, cost: 100, conversions: 77, conversions_value: 400 },
    ];

    const tweeTerug = buildWeeks(weken, JAAR - 2, 3);
    check("maart van twee jaar terug krijgt precies een week", tweeTerug.length === 1, String(tweeTerug.length));
    check("en het is de week van dat jaar", tweeTerug[0]?.conversions === 22, String(tweeTerug[0]?.conversions));

    const ditJaar = buildWeeks(weken, JAAR, 3);
    check("maart van dit jaar krijgt zijn eigen week", ditJaar[0]?.conversions === 99, String(ditJaar[0]?.conversions));

    // Precies de fout die erin zat: zonder jaarfilter zou maart van 2 jaar terug alle drie de
    // maartweken krijgen, inclusief die van dit jaar.
    const zonderJaarfilter = weken.filter((w) => Number(w.week_start.split("-")[1]) === 3);
    check("zonder jaarfilter zouden het er drie zijn", zonderJaarfilter.length === 3);
    check("met jaarfilter blijft het er een", tweeTerug.length === 1);

    // En het tweede gevolg: een maand die dit jaar nog niet geweest is mag historisch niet leeg
    // zijn puur omdat dit jaar er nog niet is.
    check("juni van dit jaar heeft zijn week", buildWeeks(weken, JAAR, 6).length === 1);
    check("juni van twee jaar terug heeft er geen in deze set", buildWeeks(weken, JAAR - 2, 6).length === 0);
  }
  {
    // Weken horen op datum gesorteerd terug te komen, en genummerd vanaf 1.
    const weken: WeeklyRow[] = [
      { week_start: `${JAAR}-04-22`, cost: 1, conversions: 4, conversions_value: 1 },
      { week_start: `${JAAR}-04-01`, cost: 1, conversions: 1, conversions_value: 1 },
      { week_start: `${JAAR}-04-15`, cost: 1, conversions: 3, conversions_value: 1 },
      { week_start: `${JAAR}-04-08`, cost: 1, conversions: 2, conversions_value: 1 },
    ];
    const uit = buildWeeks(weken, JAAR, 4);
    check("gesorteerd op datum", uit.map((w) => w.conversions).join(",") === "1,2,3,4",
      uit.map((w) => w.conversions).join(","));
    check("genummerd vanaf 1", uit.map((w) => w.week).join(",") === "1,2,3,4");
  }

  // ── De volledige berekening ──────────────────────────────────────────────

  console.log("\nDe volledige berekening");
  {
    // Elk jaar krijgt een week in maart, met een herkenbaar aantal conversies per jaar.
    const weken = [
      weekRij(`${JAAR - 2}-03-02`, { conversions: 22 }),
      weekRij(`${JAAR - 1}-03-01`, { conversions: 11 }),
      weekRij(`${JAAR}-03-02`, { conversions: 99 }),
    ];
    const sb = mockSupabase({
      ads_account_monthly: maanden(),
      ads_account_weekly: weken,
      client_settings: [{ kpi_targets: {} }],
    });
    const r = await computeAnalysisTargets(sb, "x");
    check("er komt een uitkomst", r !== null);
    if (r) {
      // De forecast krijgt de historische jaren binnen; we controleren via het resultaat dat
      // er uberhaupt maandwaarden uitkomen en dat niets NaN is.
      check("elke maand heeft een verwachting", r.monthlyExpected.length === 12);
      check("geen NaN in de verwachtingen",
        r.monthlyExpected.every((m) => [m.conversions, m.revenue, m.adSpend].every(Number.isFinite)),
        JSON.stringify(r.monthlyExpected[0]));
      check("de laatste volledige maand klopt", r.lastCompleteMonth === (MAAND - 1 || 12), String(r.lastCompleteMonth));
      check("het jaar klopt", r.currentYear === JAAR, String(r.currentYear));
    }
  }

  // ── Zonder weekdata mag er niets omvallen ────────────────────────────────

  console.log("\nRandgevallen");
  {
    const sb = mockSupabase({
      ads_account_monthly: maanden(), ads_account_weekly: [], client_settings: [{ kpi_targets: {} }],
    });
    const r = await computeAnalysisTargets(sb, "x");
    check("zonder weken komt er nog steeds een uitkomst", r !== null);
    check("en geen NaN", r === null || r.monthlyExpected.every((m) => Number.isFinite(m.conversions)));
  }
  {
    const sb = mockSupabase({ ads_account_monthly: [], ads_account_weekly: [], client_settings: [] });
    check("zonder maanddata is de uitkomst null", (await computeAnalysisTargets(sb, "x")) === null);
  }
  {
    // Een jaar met nul conversies mag geen deling door nul geven in het standaarddoel.
    const nul = maanden().map((m) => ({ ...m, conversions: 0, conversions_value: 0, cost: 0 }));
    const sb = mockSupabase({ ads_account_monthly: nul, ads_account_weekly: [], client_settings: [{ kpi_targets: {} }] });
    const r = await computeAnalysisTargets(sb, "x");
    check("een leeg jaar geeft geen NaN",
      r === null || r.monthlyExpected.every((m) => [m.conversions, m.revenue, m.adSpend].every(Number.isFinite)));
  }

  // ── Het jaardoel ─────────────────────────────────────────────────────────

  console.log("\nHet jaardoel");
  {
    // Zonder ingesteld doel valt hij terug op het vorige jaar plus tien procent.
    const sb = mockSupabase({
      ads_account_monthly: maanden(), ads_account_weekly: [],
      client_settings: [{ kpi_targets: {} }],
    });
    const r = await computeAnalysisTargets(sb, "x");
    check("er komt een forecast uit", r?.forecast !== undefined);
    check("met een jaardoel voor conversies",
      r !== null && Number.isFinite(r.forecast.conversions.kpi.annualTarget),
      String(r?.forecast.conversions.kpi.annualTarget));
  }
  {
    // Een expliciet doel hoort te winnen van de terugval.
    const sb = mockSupabase({
      ads_account_monthly: maanden(), ads_account_weekly: [],
      client_settings: [{ kpi_targets: { conversionsAbsolute: 5000 } }],
    });
    const r = await computeAnalysisTargets(sb, "x");
    check("een ingesteld doel wordt gebruikt",
      r?.forecast.conversions.kpi.annualTarget === 5000,
      String(r?.forecast.conversions.kpi.annualTarget));
  }
}

main().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });

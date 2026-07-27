// Datumvensters over een heel jaar, in meerdere tijdzones, met een vastgezette klok.
// Draaien: npx tsx lib/analysis/__date_window_test.ts
//
// WAAROM DEZE TEST ER ANDERS UITZIET DAN DE REST
//
// De fouten die hij bewaakt waren onzichtbaar voor elke gewone test. De CI-container draait UTC,
// dus een tijdzone-fout laat zich daar nooit zien. En de maandeinde-fout sloeg maar op vijftien
// dagen per jaar toe, dus een test die "vandaag" gebruikt vindt hem gemiddeld eens per 24 runs.
// Vandaar: klok vastzetten, elke dag van het jaar aflopen, en dat in drie tijdzones.
//
// De twee fouten die hier onder liggen:
//   1. setMonth() vóór setDate(1) rolde "31 februari" door naar 1 maart, waardoor monthsAgo(1) op
//      de 29e t/m 31e de HUIDIGE maand teruggaf. Het analysevenster kromp dan van 13 naar 12
//      maanden en de jaar-op-jaar-tegenhanger van de geanalyseerde maand verdween.
//   2. Lokale datum-setters gecombineerd met toISOString() (dat UTC is) schoof elke grens met de
//      tijdzone-offset. In Amsterdam lag periodEnd daardoor altijd een dag te vroeg.

const RealDate = Date;
let NU = "2026-01-01T12:00:00Z";

class KlokDate extends RealDate {
  constructor(...a: unknown[]) {
    if (a.length === 0) super(NU);
    else super(...(a as ConstructorParameters<typeof Date>));
  }
  static now(): number { return new RealDate(NU).getTime(); }
}
(globalThis as unknown as { Date: typeof Date }).Date = KlokDate as unknown as typeof Date;

let passed = 0, failed = 0;
const fouten: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fouten.push(`${name}  ${detail}`); }
}

// 2027 is een gewoon jaar, 2028 een schrikkeljaar. Beide erin, want 29 februari is precies het
// soort dag waarop datum-rekenwerk omvalt: hij bestaat niet in het vorige jaar, en een maand die
// erop uitkomt heeft geen 30e of 31e.
const JAREN = [2027, 2028];

/** Elke dag van de gekozen jaren, plus een tijdstip dat de UTC-grens overschrijdt. */
function* dagen(): Generator<string> {
  for (const jaar of JAREN) {
    for (let m = 0; m < 12; m++) {
      const laatste = new RealDate(RealDate.UTC(jaar, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= laatste; d++) {
        const dag = `${jaar}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        yield `${dag}T12:00:00Z`;
        yield `${dag}T23:30:00Z`; // in UTC+1/+2 is het dan al morgen
      }
    }
  }
}

// Eeuwjaren volgen de uitzonderingsregel: deelbaar door 100 is géén schrikkeljaar, tenzij ook
// door 400. Die twee zitten er los bij, want een volledig jaar aflopen is er te duur voor.
const EEUWGEVALLEN = [
  "2100-03-31T12:00:00Z", // 2100 is GEEN schrikkeljaar -> februari heeft 28 dagen
  "2400-03-31T12:00:00Z", // 2400 wél -> 29
  "2028-02-29T12:00:00Z", // de schrikkeldag zelf
  "2028-02-29T23:30:00Z",
];

async function main() {
  const { monthsAgo, daysAgo } = await import("./helpers");

  for (const tz of ["UTC", "Europe/Amsterdam", "America/New_York"]) {
    process.env.TZ = tz;
    for (const moment of [...dagen(), ...EEUWGEVALLEN]) {
      NU = moment;
      const now = new RealDate(moment);

      for (const n of [0, 1, 2, 3, 6, 13]) {
        const verwacht = new RealDate(RealDate.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
          .toISOString().slice(0, 10);
        check(`${tz} ${moment} monthsAgo(${n})`, monthsAgo(n) === verwacht, `kreeg ${monthsAgo(n)}, verwacht ${verwacht}`);
      }

      const dVerwacht = new RealDate(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
      check(`${tz} ${moment} daysAgo(30)`, daysAgo(30) === dVerwacht, `kreeg ${daysAgo(30)}, verwacht ${dVerwacht}`);
    }
  }
  process.env.TZ = "UTC";

  console.log(`monthsAgo / daysAgo: ${passed} geslaagd, ${failed} gefaald`);
  for (const f of fouten.slice(0, 10)) console.log("  FAIL  " + f);

  // ── Het analysevenster ───────────────────────────────────────────────────
  // Het venster hoort altijd dertien hele maanden te zijn en te eindigen op de laatste dag van de
  // laatste volledige maand. Beide eigenschappen sneuvelden: de eerste op maandeindes, de tweede
  // in elke tijdzone vóór UTC.
  const { fetchMonthlyPreparedInputs } = await import("./monthly-prepared-context");
  const { createDemoSupabase } = await import("../demo/mock-supabase");
  const { demoRows } = await import("../demo/demo-rows");

  let vPassed = 0, vFailed = 0;
  const vFouten: string[] = [];
  const sb = createDemoSupabase(null, demoRows()) as never;

  for (const tz of ["UTC", "Europe/Amsterdam"]) {
    process.env.TZ = tz;
    for (const dag of ["2028-01-01", "2028-01-31", "2028-02-29", "2028-03-29", "2028-03-30",
                       "2028-03-31", "2028-05-31", "2028-07-15", "2028-07-31", "2028-12-31",
                       "2027-02-28", "2027-03-01", "2027-03-31"]) {
      for (const uur of ["12:00:00", "23:30:00"]) {
        NU = `${dag}T${uur}Z`;
        const i = await fetchMonthlyPreparedInputs(sb, "demo-greentech");
        const s = new RealDate(`${i.periodStart}T00:00:00Z`);
        const e = new RealDate(`${i.periodEnd}T00:00:00Z`);
        const maanden = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;

        const now = new RealDate(NU);
        const maandNu = now.getUTCMonth() + 1;
        const jaar = maandNu === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
        const laatsteVolle = maandNu === 1 ? 12 : maandNu - 1;
        const eindVerwacht = new RealDate(RealDate.UTC(jaar, laatsteVolle, 0)).toISOString().slice(0, 10);

        if (maanden === 13) vPassed++; else { vFailed++; vFouten.push(`${tz} ${NU}: venster ${i.periodStart}..${i.periodEnd} = ${maanden} maanden`); }
        if (i.periodEnd === eindVerwacht) vPassed++; else { vFailed++; vFouten.push(`${tz} ${NU}: periodEnd ${i.periodEnd}, verwacht ${eindVerwacht}`); }
        if (i.periodStart.endsWith("-01")) vPassed++; else { vFailed++; vFouten.push(`${tz} ${NU}: periodStart ${i.periodStart} is niet de 1e`); }
      }
    }
  }
  process.env.TZ = "UTC";

  console.log(`analysevenster: ${vPassed} geslaagd, ${vFailed} gefaald`);
  for (const f of vFouten.slice(0, 10)) console.log("  FAIL  " + f);

  console.log(`\n${passed + vPassed} geslaagd, ${failed + vFailed} gefaald`);
  if (failed + vFailed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

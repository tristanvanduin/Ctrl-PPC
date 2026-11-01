// De gerealiseerde maand van de GreenTech-demo-mock volgt de klok: per aanroep, in Amsterdamse tijd.
// Draaien: npx tsx lib/demo/__greentech_klok_test.ts
//
// WAAROM DEZE TEST ER ZO UITZIET
//
// De mock had een module-constante REALIZED_MONTH, uitgerekend bij het laden met getUTCMonth().
// Twee fouten die geen gewone test ziet:
//   1. BEVROREN. Een server die op 31 oktober opstartte, bleef "t/m september" zeggen tot hij
//      herstartte. Een test die de mock één keer laadt en één keer vraagt, ziet dat nooit.
//   2. UTC. Om 00:30 Amsterdamse tijd op 1 november is het in UTC nog 31 oktober: dan was oktober
//      nog niet afgesloten en viel hij weg, elke maand twee uur lang.
// Daarom: klok vastzetten VÓÓR het laden van de module (anders meet je de echte klok), daarna de
// klok verzetten zonder opnieuw te laden, en kijken of het antwoord meeloopt.

// Zonder een import bovenaan is dit bestand voor tsc een script in de globale scope, en botsen
// RealDate/KlokDate/check met die van __date_window_test.ts. Dit maakt het een module.
export {};

const RealDate = Date;
let NU = "2026-10-31T23:30:00Z"; // Amsterdam (CET, na de zomertijd): 1 november 00:30

class KlokDate extends RealDate {
  constructor(...a: unknown[]) {
    if (a.length === 0) super(NU);
    else super(...(a as ConstructorParameters<typeof Date>));
  }
  static now(): number { return new RealDate(NU).getTime(); }
}
(globalThis as unknown as { Date: typeof Date }).Date = KlokDate as unknown as typeof Date;

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

async function main() {
  // Pas NA het vastzetten van de klok laden: een module-constante wordt dan met deze klok berekend.
  const { buildGreentechClientData, buildGreentechOverview, DEMO_GREENTECH_ID } = await import("./greentech-mock");
  const gerealiseerd = (nu?: string) => buildGreentechClientData(DEMO_GREENTECH_ID, nu).realizedThroughMonth;

  console.log("De standaardklok: Amsterdam, en per aanroep");
  {
    check("1 november 00:30 Amsterdam (nog 31 oktober in UTC): t/m oktober", gerealiseerd() === 10, String(gerealiseerd()));
    NU = "2026-12-15T12:00:00Z";
    check("zonder herladen een maand later: t/m november", gerealiseerd() === 11, String(gerealiseerd()));
    NU = "2026-02-28T23:30:00Z"; // Amsterdam 00:30 op 1 maart, UTC nog 28 februari
    check("1 maart 00:30 Amsterdam: februari is afgesloten", gerealiseerd() === 2, String(gerealiseerd()));
    NU = "2026-10-31T23:30:00Z";
  }

  console.log("\nEen expliciete 'vandaag' (voor tests en routes met een vaste peildatum)");
  {
    const maart = buildGreentechClientData(DEMO_GREENTECH_ID, "2026-03-15");
    const november = buildGreentechClientData(DEMO_GREENTECH_ID, "2026-11-01");
    check("15 maart: t/m februari", maart.realizedThroughMonth === 2, String(maart.realizedThroughMonth));
    check("1 november: t/m oktober", november.realizedThroughMonth === 10, String(november.realizedThroughMonth));
    check("twee dagen, twee verschillende gerealiseerde maanden", maart.realizedThroughMonth !== november.realizedThroughMonth);

    // De rest van de respons volgt dezelfde grens: geen maand voorbij realizedThroughMonth.
    for (const [naam, d] of [["maart", maart], ["november", november]] as const) {
      const R = d.realizedThroughMonth;
      const maanden = d.currentYearMonthly.map((m) => m.month);
      check(`${naam}: currentYearMonthly loopt t/m ${R}`, Math.max(...maanden) === R && maanden.length === R, maanden.join(","));
      check(`${naam}: geen weekrij na maand ${R}`, d.currentYearWeekly.every((w) => w.month <= R));
      check(`${naam}: geen campagnerij na maand ${R}`,
        d.campaigns.every((c) => Number(c.month.slice(5, 7)) <= R) && d.campaigns.some((c) => Number(c.month.slice(5, 7)) === R));
    }

    const ov = buildGreentechOverview(DEMO_GREENTECH_ID, "2026-03-15");
    const ytd = maart.currentYearMonthly.reduce((s, m) => s + m.conversions, 0);
    check("overview op 15 maart: laatste maand februari", ov.lastMonth.month === 2, String(ov.lastMonth.month));
    check("overview op 15 maart: YTD = jan + feb van dezelfde mock", ov.ytd.conversions === ytd, `${ov.ytd.conversions} tegen ${ytd}`);
  }

  console.log("\nRanden van het demo-jaar");
  {
    check("januari 2026: minimaal 1 (er is nog geen afgesloten maand in 2026)", gerealiseerd("2026-01-10") === 1, String(gerealiseerd("2026-01-10")));
    check("vóór het demo-jaar: 1", gerealiseerd("2025-06-01") === 1, String(gerealiseerd("2025-06-01")));
    check("1 januari 2027: heel 2026 afgesloten", gerealiseerd("2027-01-01") === 12, String(gerealiseerd("2027-01-01")));
    check("ver daarna: 12", gerealiseerd("2028-05-20") === 12, String(gerealiseerd("2028-05-20")));
    let geweigerd = false;
    try { gerealiseerd("gisteren"); } catch { geweigerd = true; }
    check("een onleesbare datum wordt geweigerd, niet stil vervangen", geweigerd);
  }

  (globalThis as unknown as { Date: typeof Date }).Date = RealDate;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  (globalThis as unknown as { Date: typeof Date }).Date = RealDate;
  console.error(e);
  process.exit(1);
});

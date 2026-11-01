// Regressietest: berekenMaandPacing (lib/kanalen/maand-pacing.ts), de "maand tot nu tegen vorige
// maand tot dezelfde dag" op de pacingkaart van Meta, LinkedIn en Microsoft.
// Draaien: tsx lib/kanalen/__maand_pacing_test.ts
//
// Wat er misging: "een maand terug" werd met Date.setMonth berekend. Op de 29e t/m 31e rolde dat
// door naar de LOPENDE maand (31 maart -> "31 februari" -> 3 maart), dus vorige maand was gelijk
// aan deze, telde nul, en de kaart zei "geen vorige maand" terwijl februari gewoon data had. En in
// een tijdzone ten westen van UTC is new Date("2026-03-01") nog 28 februari, waardoor de
// vergelijking naar januari greep.
//
// De tijdzone van het proces wordt hier bewust op New York gezet, VOORDAT er een Date gemaakt is:
// de fout zat in de lokale tijd van de kijker, en in UTC (de servers, de suite) bleef hij verborgen.
process.env.TZ = "America/New_York";

import { berekenMaandPacing } from "./maand-pacing";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Elke dag 1 conversie en 10 x het maandnummer aan spend (januari 10, februari 20, ...), zodat
 *  een vergelijking met de verkeerde maand een ander getal geeft. Van `van` t/m `tot`. */
function dagen(van: string, tot: string): { date: string; spend: number; conv: number }[] {
  const uit: { date: string; spend: number; conv: number }[] = [];
  for (let t = Date.UTC(+van.slice(0, 4), +van.slice(5, 7) - 1, +van.slice(8, 10));
    t <= Date.UTC(+tot.slice(0, 4), +tot.slice(5, 7) - 1, +tot.slice(8, 10)); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    uit.push({ date, spend: 10 * Number(date.slice(5, 7)), conv: 1 });
  }
  return uit;
}
const rijen = dagen("2025-11-01", "2026-12-31");
// Zoals in productie: rijen t/m vandaag, niet verder.
const pacing = (vandaag: string) => berekenMaandPacing(rijen.filter((r) => r.date <= vandaag), (r) => r.conv, vandaag);

// 31 maart: vorige maand is februari, en die telt t/m dag 31 = de hele maand (28 dagen).
{
  const p = pacing("2026-03-31");
  check("31 maart: vorige maand (februari) telt mee", p.vorigeSpend === 28 * 20, String(p.vorigeSpend));
  check("31 maart: maand tot nu = 31 dagen", p.mtdSpend === 31 * 30, String(p.mtdSpend));
  check("31 maart: er is een verhouding", p.spendRatio !== null && Math.abs(p.spendRatio - (31 * 30) / (28 * 20)) < 1e-9, String(p.spendRatio));
}
// 29 maart in een niet-schrikkeljaar: "29 februari" bestaat niet.
{
  const p = pacing("2026-03-29");
  check("29 maart: februari t/m dag 29 = de hele februari", p.vorigeSpend === 28 * 20, String(p.vorigeSpend));
}
// 31 mei: april heeft 30 dagen.
{
  const p = pacing("2026-05-31");
  check("31 mei: april telt mee (30 dagen)", p.vorigeSpend === 30 * 40 && p.vorigeConv === 30, `${p.vorigeSpend}/${p.vorigeConv}`);
}
// 1 maart in New York: vorige maand is februari, niet januari.
{
  const p = pacing("2026-03-01");
  check("1 maart (tijdzone New York): vorige maand is februari t/m dag 1, niet januari", p.vorigeSpend === 20, String(p.vorigeSpend));
  check("1 maart: maand tot nu is alleen 1 maart", p.mtdSpend === 30, String(p.mtdSpend));
}
// Jaargrens: januari vergelijkt met december van het vorige jaar.
{
  const p = pacing("2026-01-15");
  check("15 januari: december 2025 t/m dag 15", p.vorigeSpend === 15 * 120, String(p.vorigeSpend));
}
// Een gewone dag midden in de maand blijft wat hij was.
{
  const p = pacing("2026-07-10");
  check("10 juli: juni t/m dag 10, juli t/m dag 10", p.vorigeSpend === 10 * 60 && p.mtdSpend === 10 * 70, `${p.vorigeSpend}/${p.mtdSpend}`);
  check("10 juli: dagVanMaand 10", p.dagVanMaand === 10);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);

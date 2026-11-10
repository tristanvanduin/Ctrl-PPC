// Gelijkheidstest voor de twee ingangen van de kanaalprognose (fase 1, stap 3):
// buildChannelForecast(rows, ...) == buildChannelForecastUitEmmers(kanaalEmmersUitRijen(rows), ...),
// op de fixtures van __channel_forecast_data_test.ts (dezelfde reeksen, dezelfde peildagen), en
// ook als de emmers door JSON zijn gegaan -- zo reizen ze van de blended route naar de hook.
// Draaien: tsx lib/analysis/__channel_forecast_emmers_test.ts
//
// Waarom deze test naast __channel_forecast_data_test.ts staat: die toetst het GEDRAG van
// buildChannelForecast (gerealiseerd t/m de laatste volle maand, de terugval op vorig jaar, de
// stopregel, het tempo na een pauze) en blijft via de wrapper groen; deze toetst dat de emmer-ingang
// per fixture het identieke object oplevert, inclusief de weken op positie, en dat een JSON-rondreis
// daar niets aan verandert. Wijkt de emmer-ingang ooit af (een eigen vorig-jaar-regel, een andere
// nieuwste dag), dan valt dat hier om, niet pas op een kanaaltab.

import {
  aggregateByYear, buildChannelForecast, buildChannelForecastUitEmmers, buildChannelHistoricalData,
  buildChannelHistoricalDataUitEmmers, forecastRijenUitDagen, kanaalEmmersUitRijen, type ChannelForecastRow, type KanaalEmmers,
} from "./channel-forecast-data";
import { resolveChannelConversionConfig } from "./channel-conversion-config";
import type { TargetRow } from "./o2-targets-cost";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rij(date: string, spend: number, conv: number, revenue: number): ChannelForecastRow {
  return { date, spend, conv, revenue };
}
const reeks = (maand: string, dagen: number, spend: number, conv: number, revenue: number): ChannelForecastRow[] =>
  Array.from({ length: dagen }, (_, i) => rij(`${maand}-${String(i + 1).padStart(2, "0")}`, spend, conv, revenue));

/** Dezelfde reeksen als __channel_forecast_data_test.ts, met hun peildag en syncdag. */
const FIXTURES: { naam: string; rows: ChannelForecastRow[]; vandaag: string; dataTot?: string | null; channel?: string; targets?: TargetRow[]; gestopt?: boolean }[] = [
  // Een vol vorig jaar (augustus 2025), juli 2026 afgesloten, augustus lopend.
  { naam: "basis", rows: [...reeks("2025-08", 28, 100, 2, 300), ...reeks("2026-07", 31, 110, 3, 380), ...reeks("2026-08", 23, 120, 3, 400)], vandaag: "2026-08-23" },
  { naam: "basis met doelen", rows: [...reeks("2025-08", 28, 100, 2, 300), ...reeks("2026-07", 31, 110, 3, 380), ...reeks("2026-08", 23, 120, 3, 400)], vandaag: "2026-08-23",
    targets: [
      { channel: "meta_ads", metric: "conversions", targetValue: 1000, validFrom: "2000-01-01", validTo: null },
      { channel: "meta_ads", metric: "spend", targetValue: 50000, validFrom: "2000-01-01", validTo: null },
      { channel: "google_ads", metric: "conversions", targetValue: 999999, validFrom: "2000-01-01", validTo: null },
    ] },
  // Alleen dit jaar: geen vorig jaar om op terug te vallen.
  { naam: "alleen dit jaar", rows: reeks("2026-08", 23, 120, 3, 400), vandaag: "2026-08-23" },
  // Terug na een pauze: januari-maart, stil, en op 20 juli terug (het tempo zonder doel).
  { naam: "terug na pauze", rows: [...reeks("2026-01", 31, 10, 1, 0), ...reeks("2026-02", 28, 10, 1, 0), ...reeks("2026-03", 31, 10, 1, 0), ...reeks("2026-07", 12, 10, 1, 0).map((r) => ({ ...r, date: `2026-07-${String(Number(r.date.slice(8)) + 19).padStart(2, "0")}` }))], vandaag: "2026-07-20" },
  // Gestopt eind augustus, bekeken op 1 november: de stopregel (kanaalGestopt).
  { naam: "gestopt", rows: [...reeks("2026-01", 31, 10, 1, 0), ...reeks("2026-05", 31, 10, 1, 0), ...reeks("2026-08", 26, 10, 1, 0)], vandaag: "2026-11-01" },
  // Met de syncdag van de route: data t/m 26 augustus, sync op 31 oktober geslaagd.
  { naam: "syncdag", rows: [...reeks("2026-03", 31, 10, 1, 0), ...reeks("2026-08", 26, 10, 1, 0)], vandaag: "2026-11-01", dataTot: "2026-10-31" },
  // De rij van de syncdag zelf is een deel van die dag.
  { naam: "rij op de syncdag", rows: [...reeks("2026-09", 30, 10, 1, 0), ...reeks("2026-10", 31, 10, 1, 0)], vandaag: "2026-11-03", dataTot: "2026-10-30" },
  // Uitgesloten door de route: gestopt, ook al lijkt het een seizoenspauze.
  { naam: "uitgesloten", rows: [...reeks("2026-01", 31, 10, 1, 0), ...reeks("2026-06", 15, 10, 1, 0)], vandaag: "2026-11-01", dataTot: "2026-10-31", gestopt: true },
  // Nieuwste eerst, zoals de kanaaltab zijn rijen leest: de weken moeten op positie blijven.
  { naam: "aflopend", rows: [...reeks("2025-08", 28, 100, 2, 300), ...reeks("2026-07", 31, 110, 3, 380), ...reeks("2026-08", 23, 120, 3, 400)].reverse(), vandaag: "2026-08-23", dataTot: "2026-08-22" },
  // LinkedIn en Microsoft als doelkanaal.
  { naam: "linkedin", rows: [...reeks("2025-10", 31, 20, 2, 0), ...reeks("2026-10", 14, 20, 2, 0)], vandaag: "2026-10-15", dataTot: "2026-10-14", channel: "linkedin_ads" },
  { naam: "microsoft", rows: [...reeks("2025-07", 9, 5, 0.5, 12.5).map((r, i) => ({ ...r, date: `2025-07-${23 + i}` })), ...reeks("2026-05", 31, 5, 0.5, 12.5)], vandaag: "2026-06-15", dataTot: "2026-05-31", channel: "microsoft_ads" },
];

const json = (v: unknown) => JSON.stringify(v);

for (const f of FIXTURES) {
  const channel = f.channel ?? "meta_ads";
  const targets = f.targets ?? [];
  const opties = { gestopt: f.gestopt };
  const emmers = kanaalEmmersUitRijen(f.rows);
  const viaRijen = buildChannelForecast("c1", f.rows, targets, channel, f.vandaag, f.dataTot, opties);
  const viaEmmers = buildChannelForecastUitEmmers("c1", emmers, targets, channel, f.vandaag, f.dataTot, opties);
  check(`${f.naam}: buildChannelForecast == buildChannelForecastUitEmmers`, json(viaRijen) === json(viaEmmers), `${json(viaRijen)?.slice(0, 200)} vs ${json(viaEmmers)?.slice(0, 200)}`);
  check(`${f.naam}: levert iets op (de gelijkheid is geen null == null)`, viaRijen !== null);

  // De emmers reizen als JSON van de route naar de hook: de rondreis verandert de uitkomst niet.
  const naReis = JSON.parse(JSON.stringify(emmers)) as KanaalEmmers;
  check(`${f.naam}: na een JSON-rondreis van de emmers dezelfde prognose`,
    json(buildChannelForecastUitEmmers("c1", naReis, targets, channel, f.vandaag, f.dataTot, opties)) === json(viaRijen));

  // De historische data apart: dezelfde twee ingangen.
  const doel = { conversions: 0, revenue: 0, adSpend: 0 };
  check(`${f.naam}: buildChannelHistoricalData == buildChannelHistoricalDataUitEmmers`,
    json(buildChannelHistoricalData("c1", f.rows, doel, f.vandaag, f.dataTot)) === json(buildChannelHistoricalDataUitEmmers("c1", emmers, doel, f.vandaag, f.dataTot)));

  // De emmers zelf zijn aggregateByYear, plat: per jaar monthly en weekly ongewijzigd.
  const plat = [...aggregateByYear(f.rows)].map(([jaar, b]) => ({ jaar, ...b }));
  check(`${f.naam}: emmers.jaren == aggregateByYear, plat`, json(emmers.jaren) === json(plat));
  const nieuwste = [...f.rows].map((r) => r.date).sort().pop() ?? null;
  check(`${f.naam}: emmers.laatsteDag is de nieuwste rij (${nieuwste})`, emmers.laatsteDag === nieuwste, String(emmers.laatsteDag));
}

// Zonder rijen: beide ingangen null, en de emmers zijn leeg.
check("zonder rijen: buildChannelForecast null", buildChannelForecast("c1", [], [], "meta_ads", "2026-08-23") === null);
check("zonder rijen: buildChannelForecastUitEmmers null", buildChannelForecastUitEmmers("c1", kanaalEmmersUitRijen([]), [], "meta_ads", "2026-08-23") === null);
check("zonder rijen: lege emmers", json(kanaalEmmersUitRijen([])) === json({ jaren: [], laatsteDag: null, eersteDag: null }));

// De eerste dag van de huidige loop volgt de dagen met besteding, geselecteerde conversie of waarde:
// een nulrij op de 1e telt niet (dezelfde regel als buildChannelHistoricalData altijd had).
{
  const metNulrij = [rij("2026-07-01", 0, 0, 0), ...reeks("2026-07", 12, 10, 1, 0).map((r) => ({ ...r, date: `2026-07-${String(Number(r.date.slice(8)) + 19).padStart(2, "0")}` }))];
  check("eersteDag: de nulrij op 1 juli telt niet, de loop begint op 20 juli", kanaalEmmersUitRijen(metNulrij).eersteDag === "2026-07-20", String(kanaalEmmersUitRijen(metNulrij).eersteDag));
}

// forecastRijenUitDagen: de dagrijen van de dagtabel (dagbronSelect) naar de rijvorm van de
// prognose, met de selectie van de klant -- dezelfde optelling die de kanaaltab deed via
// sumSelectedConversions. Number(x ?? 0) zoals kanaalMaandenUitDagen: een numeric die als tekst
// binnenkomt telt mee.
{
  const dag = [
    { date: "2026-01-05", impressions: 100, link_clicks: 10, spend: "100.5", conversions: 7, leads: 3, conversion_value: 70 },
    { date: "2026-01-06T00:00:00", impressions: 0, link_clicks: 0, spend: 0, conversions: 0, leads: null, conversion_value: 0 },
  ];
  const alleenLeads = forecastRijenUitDagen(dag, "meta_ads", resolveChannelConversionConfig({ meta_ads: ["leads"] }));
  check("forecastRijenUitDagen: de selectie telt (alleen leads: 3), spend als getal, datum op tien tekens",
    json(alleenLeads) === json([{ date: "2026-01-05", spend: 100.5, conv: 3, revenue: 70 }, { date: "2026-01-06", spend: 0, conv: 0, revenue: 0 }]), json(alleenLeads));
  const standaard = forecastRijenUitDagen(dag, "meta_ads", resolveChannelConversionConfig(null));
  check("forecastRijenUitDagen: de standaardselectie telt conversions + leads (10)", standaard[0].conv === 10, String(standaard[0].conv));
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
